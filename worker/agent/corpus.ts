import type { AgentManifest, ManifestHeading, ManifestPage } from '../../src/lib/agent-manifest';

/**
 * The Worker's read-only view of the build: the manifest, and the Markdown of
 * any page it needs to quote.
 *
 * Both are static assets, so both are immutable for the life of a deployment.
 * That is what makes module-scope caching correct here rather than merely
 * convenient — a cached entry cannot go stale, because a content change ships a
 * new Worker and therefore a new isolate. The alternative, re-fetching the
 * manifest on every search, would put a few hundred kilobytes of parsing in
 * front of every query for no gain.
 *
 * Nothing here is a Durable Object or KV: the data is already at the edge, next
 * to the code, and reading it costs a subrequest that the runtime serves from
 * memory.
 */

export interface Env {
  ASSETS: { fetch(request: Request | string | URL): Promise<Response> };
  /** Present only when an AI Search instance is bound. See wrangler.jsonc. */
  AI_SEARCH?: {
    search(options: Record<string, unknown>): Promise<AiSearchResponse>;
  };
  RL_SEARCH?: RateLimiter;
  RL_READ?: RateLimiter;
  RL_WRITE?: RateLimiter;
  /**
   * Where `report_issue` delivers, set with `wrangler secret put
   * FEEDBACK_WEBHOOK` rather than in docs.config.ts. Not a secret in the
   * security sense — see the comment beside `agents.feedback.webhook` — but
   * kept out of the repository anyway, because that file is a public
   * template and this value is one deployment's own operational detail.
   */
  FEEDBACK_WEBHOOK?: string;
}

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface AiSearchChunk {
  text?: string;
  item?: { key?: string };
  /** Fusion score, normalised 0–1 but *relative to this result set*. */
  score?: number;
  scoring_details?: {
    /** Cosine similarity, 0–1 and comparable across queries. */
    vector_score?: number;
    /** BM25, unbounded. Non-zero means the keyword pass matched. */
    keyword_score?: number;
  };
}

/**
 * Two shapes, because two transports disagree.
 *
 * The REST API wraps its payload in Cloudflare's standard
 * `{ result, success, errors }` envelope. The Workers binding does not — it
 * returns `{ query_kind, search_query, chunks, hybrid_meta }` directly. Reading
 * only `result.chunks` therefore yields `undefined` against the binding, which
 * an `?? []` turns into "no results" rather than an error: semantic search
 * silently degrades to the lexical fallback and nothing anywhere says why.
 *
 * Both are accepted so the same code works against either.
 */
export interface AiSearchResponse {
  chunks?: AiSearchChunk[];
  result?: { chunks?: AiSearchChunk[] };
}

let manifestCache: Promise<AgentManifest> | null = null;

/**
 * Bounded because an isolate is long-lived and a large corpus is not: without a
 * cap, an isolate that happens to serve queries across a few hundred pages ends
 * up holding all of them. The eviction is first-in-first-out and unweighted,
 * which is the right trade when every entry is a few kilobytes and the point is
 * a ceiling rather than a hit rate.
 */
const MARKDOWN_CACHE_LIMIT = 64;
const markdownCache = new Map<string, Promise<string | null>>();

/** The build manifest, parsed once per isolate. */
export function loadManifest(env: Env, origin: string): Promise<AgentManifest> {
  manifestCache ??= env.ASSETS.fetch(new URL('/agent-manifest.json', origin))
    .then(response => {
      if (!response.ok) throw new Error(`agent-manifest.json: ${response.status}`);
      return response.json() as Promise<AgentManifest>;
    })
    .catch(error => {
      /* A failed fetch must not poison the isolate for every later request. */
      manifestCache = null;
      throw error;
    });
  return manifestCache;
}

/**
 * A page's served Markdown — the same bytes as `<page>.md`, which is what the
 * manifest counted lines against.
 */
export function loadMarkdown(env: Env, origin: string, pageId: string): Promise<string | null> {
  const cached = markdownCache.get(pageId);
  if (cached) return cached;

  const pending = env.ASSETS.fetch(new URL(`/${pageId}.md`, origin))
    .then(response => {
      if (response.ok) return response.text();
      /* A 404 is a fact about the build and will not change under this
         deployment, so it is worth caching. */
      if (response.status === 404) return null;
      throw new Error(`${pageId}.md: ${response.status}`);
    })
    .catch(error => {
      /* Anything else is transient. Evicting before rethrowing keeps one bad
         read from removing the page from every future search in this isolate —
         `consolidate` drops passages whose Markdown it cannot load, silently. */
      markdownCache.delete(pageId);
      console.log(
        JSON.stringify({
          event: 'markdown-unavailable',
          pageId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return null;
    });

  if (markdownCache.size >= MARKDOWN_CACHE_LIMIT) {
    markdownCache.delete(markdownCache.keys().next().value!);
  }
  markdownCache.set(pageId, pending);
  return pending;
}

export const pageById = (manifest: AgentManifest) =>
  new Map<string, ManifestPage>(manifest.pages.map(page => [page.id, page]));

/**
 * The heading a line falls under.
 *
 * Ranges are contiguous and ordered, so the last heading that starts at or
 * before the line wins. A line above the first heading — a page's opening
 * paragraph — belongs to no heading, and says so by returning undefined rather
 * than being attributed to a section it is not in.
 */
export function headingAt(page: ManifestPage, line: number): ManifestHeading | undefined {
  let found: ManifestHeading | undefined;
  for (const heading of page.headings) {
    if (heading.start > line) break;
    found = heading;
  }
  return found;
}

/**
 * Where a passage sits in a page, as a 1-based inclusive line range.
 *
 * AI Search returns a chunk's text but not its position, so the position has to
 * be recovered by finding the text again in the page. The match is exact —
 * these are the bytes we uploaded — and anchored on the first non-blank line to
 * survive the leading and trailing whitespace a chunker adds.
 */
export function locate(markdown: string, passage: string): { start: number; end: number } | null {
  const trimmed = passage.trim();
  if (!trimmed) return null;

  const index = markdown.indexOf(trimmed);
  if (index === -1) {
    /* Fall back to the first line alone: a chunk that ends mid-word, or that
       had whitespace normalised, still locates on its opening. */
    const firstLine = trimmed.split('\n', 1)[0];
    const loose = firstLine.length > 12 ? markdown.indexOf(firstLine) : -1;
    if (loose === -1) return null;
    const start = markdown.slice(0, loose).split('\n').length;
    return { start, end: start + trimmed.split('\n').length - 1 };
  }

  const start = markdown.slice(0, index).split('\n').length;
  return { start, end: start + trimmed.split('\n').length - 1 };
}

/** Lines `start`..`end`, 1-based and inclusive. */
export const sliceLines = (markdown: string, start: number, end: number) =>
  markdown.split('\n').slice(start - 1, end).join('\n').trim();
