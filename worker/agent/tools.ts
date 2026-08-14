import { agents, site } from '../../src/docs.config';
import type { ManifestPage } from '../../src/lib/agent-manifest';
import {
  headingAt,
  loadManifest,
  loadMarkdown,
  locate,
  pageById,
  sliceLines,
  type Env,
} from './corpus';
import { retrieve } from './retrieval';

/**
 * The four tools, defined once.
 *
 * A tool is a name, a description, a JSON Schema and a handler that takes a
 * validated object and returns an object. Nothing here knows about MCP, about
 * HTTP, or about WebMCP — those are three transports in ../mcp.ts, ../http.ts
 * and the browser bridge, and each adapts this same array.
 *
 * That is what makes parity between the surfaces structural rather than a thing
 * somebody has to remember: there is no second implementation to keep in step.
 * Adding a tool is one entry here.
 *
 * The descriptions matter more than they look. They are the only text an agent
 * reads when deciding whether to call this server at all, or to fall back on a
 * web search — so they name the product and say when to reach for the tool.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** `read` tools are cheap; `search` hits retrieval; `write` leaves the site. */
  cost: 'search' | 'read' | 'write';
  handler(input: Record<string, unknown>, context: ToolContext): Promise<unknown>;
}

export interface ToolContext {
  env: Env;
  origin: string;
  /** Forwarded to the feedback webhook so a report can be attributed. */
  userAgent: string;
}

export class ToolError extends Error {}

/* ── search ─────────────────────────────────────────────────────────────── */

/**
 * Ceiling on a single quoted passage.
 *
 * A lexical hit quotes a whole heading section, and the last section of a page
 * runs to the end of the file — so an unlucky match on a long page could return
 * tens of kilobytes, and `limit: 25` could multiply that into a payload no
 * caller wants to spend context on. The cap is generous enough that a normal
 * section is untouched; a passage that hits it is one the caller should be
 * reading through `fetch` anyway.
 */
const MAX_PASSAGE_CHARS = 4000;

interface ResultChunk {
  lines: [number, number];
  heading: string;
  text: string;
}

interface ResultPage {
  url: string;
  title: string;
  description: string;
  type: string;
  tab: string;
  updated?: string;
  totalLines: number;
  chunks: ResultChunk[];
}

/**
 * Groups ordered passages into ordered pages.
 *
 * Two orderings, deliberately different, and both carry meaning:
 *
 *   Pages follow the retriever's ranking. The first passage of a page not seen
 *   before creates that page at the next position — so the page holding the
 *   best passage is first, the second page is the one holding the best
 *   remaining passage, and so on. The order of `pages` *is* the ranking, which
 *   is why no score needs to be published.
 *
 *   Chunks inside a page follow the document. An agent reading three passages
 *   from one page wants them in reading order; sorting them by relevance would
 *   scramble a procedure whose steps only make sense in sequence.
 */
async function consolidate(
  passages: Awaited<ReturnType<typeof retrieve>>['passages'],
  pages: Map<string, ManifestPage>,
  context: ToolContext,
): Promise<ResultPage[]> {
  const order: string[] = [];
  const grouped = new Map<string, ResultChunk[]>();

  for (const passage of passages) {
    const page = pages.get(passage.pageId);
    if (!page) continue;

    const markdown = await loadMarkdown(context.env, context.origin, page.id);
    if (!markdown) continue;

    let range: { start: number; end: number } | null = null;

    if (passage.anchor) {
      /* Lexical hit: the manifest already knows the section's extent. */
      const heading = page.headings.find(item => item.anchor === passage.anchor);
      if (heading) range = { start: heading.start, end: heading.end };
    } else if (!passage.text) {
      /* Lexical hit on the prose above the first heading — a page's opening
         paragraphs, which are often the best answer to "what is X". Quoted from
         `bodyStart` so the YAML header never becomes a passage. */
      const firstHeading = page.headings[0];
      range = { start: page.bodyStart, end: (firstHeading?.start ?? page.totalLines + 1) - 1 };
    }
    if (!range && passage.text) {
      /* AI Search hit: recover the position from the text itself. */
      range = locate(markdown, passage.text);
    }
    if (!range || range.end < range.start) continue;
    /* Clamp to the page. `locate`'s loose fallback anchors on a first line that
       may repeat, and then applies the passage's height at that position, so a
       reported range can run past EOF. Nothing downstream checks, and a caller
       reading `lines: [140, 260]` on a 200-line page has been told something
       false. */
    range = { start: Math.max(1, range.start), end: Math.min(range.end, page.totalLines) };

    const heading = headingAt(page, range.start);
    const text = (passage.text?.trim() || sliceLines(markdown, range.start, range.end)).slice(
      0,
      MAX_PASSAGE_CHARS,
    );
    if (!text) continue;

    if (!grouped.has(page.id)) {
      grouped.set(page.id, []);
      order.push(page.id);
    }
    const chunks = grouped.get(page.id)!;
    /* The same section can be reached twice — two chunks of one long section
       from AI Search, or a heading matched by several query terms. */
    if (chunks.some(chunk => chunk.lines[0] === range!.start)) continue;

    chunks.push({
      lines: [range.start, range.end],
      heading: heading?.path ?? page.title,
      text,
    });
  }

  return order.map(id => {
    const page = pages.get(id)!;
    return {
      url: page.url,
      title: page.title,
      description: page.description,
      type: page.type,
      tab: page.tab,
      ...(page.updated ? { updated: page.updated } : {}),
      totalLines: page.totalLines,
      chunks: grouped.get(id)!.sort((a, b) => a.lines[0] - b.lines[0]),
    };
  });
}

const searchTool: ToolDefinition = {
  name: 'search',
  description:
    `Search the ${site.name} documentation and return the most relevant passages, grouped by the page they come from. ` +
    `Use this before answering any question about ${site.name} — it searches the current published documentation directly, ` +
    'which is more reliable than recalling it. Pages are ordered by relevance; passages within a page are in reading order. ' +
    'Each passage reports its line range within the page, so you can tell whether you are seeing a small part of a long ' +
    'page and should call `fetch` for the rest. ' +
    'An empty result means nothing matched closely, not that the topic is missing — the response says what to do next, ' +
    'usually `list_pages` followed by `fetch`.',
  cost: 'search',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What you want to know, in natural language or as keywords.' },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: agents.maxLimit,
        default: agents.defaultLimit,
        description: `How many passages to retrieve. Leave unset for ${agents.defaultLimit}, which suits most questions.`,
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  async handler(input, context) {
    const query = String(input.query ?? '').trim();
    if (!query) throw new ToolError('`query` is required.');

    const requested = Number(input.limit ?? agents.defaultLimit);
    const limit = Math.min(
      Math.max(Number.isFinite(requested) ? Math.trunc(requested) : agents.defaultLimit, 1),
      agents.maxLimit,
    );

    /*
     * Timed in three parts, because "search is slow" is not actionable until
     * you know which of the three is slow. Retrieval crosses the network to AI
     * Search; consolidation reads one Markdown file per matched page through
     * the assets binding. Either could dominate, and the answer decides whether
     * tuning belongs in the index configuration or in this file.
     */
    const t0 = Date.now();
    const manifest = await loadManifest(context.env, context.origin);
    const t1 = Date.now();
    const { passages, backend } = await retrieve(context.env, context.origin, query, limit);
    const t2 = Date.now();
    const results = await consolidate(passages, pageById(manifest), context);
    const t3 = Date.now();

    console.log(
      JSON.stringify({
        event: 'search-timing',
        backend,
        manifestMs: t1 - t0,
        retrievalMs: t2 - t1,
        consolidateMs: t3 - t2,
        passages: passages.length,
        pages: results.length,
      }),
    );

    /*
     * An empty result is where an agent is most likely to go wrong: with
     * nothing to read it tends to either answer from memory or give up, and
     * both are worse than the third option it cannot see — browsing the corpus
     * instead of searching it. Semantic search fails on whole classes of real
     * questions ("what does this documentation cover?", a feature named
     * differently here than in the question), and for those `list_pages` then
     * `fetch` is the right move rather than a rephrased search.
     *
     * So the empty case says so, in the response the model actually reads. It
     * is not an error: the tool worked and the corpus has no close match.
     */
    if (!results.length) {
      return {
        query,
        pages: [],
        note:
          `No passage in the ${site.name} documentation matched this query closely enough to be worth quoting. ` +
          'This does not mean the topic is absent — the wording may simply differ. ' +
          'Try `list_pages` to see what the documentation covers, then `fetch` the pages that look relevant; ' +
          'that works when a phrasing-based search does not. Rephrasing the query with the terms the ' +
          'documentation itself would use is also worth one attempt.',
      };
    }

    return { query, pages: results };
  },
};

/* ── fetch ──────────────────────────────────────────────────────────────── */

const fetchTool: ToolDefinition = {
  name: 'fetch',
  description:
    `Return the complete Markdown of one ${site.name} documentation page. ` +
    'Takes the `url` reported by `search` or `list_pages`. ' +
    'Use it once `search` shows a page is relevant but you need the whole procedure, the full parameter table, ' +
    'or the surrounding context rather than a few passages.',
  cost: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The page URL, exactly as returned by `search` or `list_pages`.',
      },
    },
    required: ['url'],
    additionalProperties: false,
  },
  async handler(input, context) {
    const raw = String(input.url ?? '').trim();
    if (!raw) throw new ToolError('`url` is required.');

    /* A bare path is accepted alongside a full URL. The pages are identified
       by URL now, but an agent that shortens one to its path — or that carries
       a link from llms.txt — should still land on the page rather than on an
       error about a format it was never shown. */
    let id = raw;
    if (/^https?:\/\//.test(raw)) {
      /* `new URL` throws on a malformed absolute URL, and a raw TypeError would
         surface as a 500 "the request failed" — a server fault for what is a
         caller mistake. */
      try {
        id = new URL(raw).pathname;
      } catch {
        throw new ToolError(`"${raw}" is not a valid URL.`);
      }
    }
    /* `site.basePath` is in every URL this server hands out, and never in a
       page id — the id is the path inside `dist/`. Stripping it here is what
       lets an agent pass back, verbatim, the URL it was just given. */
    if (site.basePath && id.startsWith(site.basePath)) id = id.slice(site.basePath.length);
    id = id.replace(/^\//, '').replace(/\.md$/, '') || 'index';

    const manifest = await loadManifest(context.env, context.origin);
    const page = pageById(manifest).get(id);
    if (!page) {
      throw new ToolError(
        `No documentation page at "${raw}". Call \`list_pages\` for the available URLs.`,
      );
    }

    const markdown = await loadMarkdown(context.env, context.origin, page.id);
    if (markdown === null) throw new ToolError(`Page "${id}" could not be read.`);

    return {
      url: page.url,
      title: page.title,
      text: markdown,
      metadata: {
        description: page.description,
        type: page.type,
        tab: page.tab,
        ...(page.updated ? { updated: page.updated } : {}),
        totalLines: page.totalLines,
      },
    };
  },
};

/* ── list_pages ─────────────────────────────────────────────────────────── */

const listPagesTool: ToolDefinition = {
  name: 'list_pages',
  description:
    `List the pages of the ${site.name} documentation, with optional filters. ` +
    'Use it to see what the documentation covers, to confirm a page exists before citing it, ' +
    'or to find what changed recently. It does not search page contents — use `search` for that.',
  cost: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      tab: { type: 'string', description: 'Restrict to one navigation area, for example `Guides`.' },
      type: { type: 'string', enum: ['page', 'api-endpoint'], description: 'Restrict to prose pages or API endpoint pages.' },
      prefix: { type: 'string', description: 'Restrict to ids starting with this, for example `guides/`.' },
      updated_since: { type: 'string', description: 'ISO date. Only pages changed on or after it.' },
    },
    additionalProperties: false,
  },
  async handler(input, context) {
    const manifest = await loadManifest(context.env, context.origin);
    const tab = input.tab ? String(input.tab).toLowerCase() : undefined;
    const type = input.type ? String(input.type) : undefined;
    const prefix = input.prefix ? String(input.prefix).replace(/^\//, '') : undefined;
    const since = input.updated_since ? String(input.updated_since).slice(0, 10) : undefined;

    const pages = manifest.pages
      .filter(page => !tab || page.tab.toLowerCase() === tab)
      .filter(page => !type || page.type === type)
      .filter(page => !prefix || page.id.startsWith(prefix))
      /* String comparison is safe and cheap here: both sides are ISO dates. */
      .filter(page => !since || (page.updated ?? '') >= since)
      .map(page => ({
        url: page.url,
        title: page.title,
        description: page.description,
        type: page.type,
        tab: page.tab,
        ...(page.updated ? { updated: page.updated } : {}),
        sections: page.headings.length,
      }));

    return { total: pages.length, pages };
  },
};

/* ── report_issue ───────────────────────────────────────────────────────── */

/**
 * Built from `agents.feedback.fields`, so the schema an agent sees and the
 * payload the webhook receives come from one declaration and cannot disagree.
 */
function feedbackSchema(): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    page: { type: 'string', description: 'Id or URL of the page the problem is on.' },
  };
  const required: string[] = ['page'];

  for (const field of agents.feedback.fields) {
    properties[field.name] =
      field.type === 'enum'
        ? { type: 'string', enum: [...(field.values ?? [])], description: field.description }
        : { type: 'string', maxLength: field.maxLength, description: field.description };
    if (field.required) required.push(field.name);
  }

  return { type: 'object', properties, required, additionalProperties: false };
}

const reportIssueTool: ToolDefinition = {
  name: 'report_issue',
  description:
    `Report a problem with a page of the ${site.name} documentation — something inaccurate, out of date, missing or ambiguous. ` +
    'Use it when you find a genuine defect while answering, not for questions. The report reaches the documentation team; ' +
    'nothing is published and you get no reply.',
  cost: 'write',
  inputSchema: feedbackSchema(),
  async handler(input, context) {
    /* The live value comes from the env binding, not the config constant —
       see Env.FEEDBACK_WEBHOOK in corpus.ts and the comment beside
       agents.feedback.webhook in docs.config.ts for why. */
    const webhook = context.env.FEEDBACK_WEBHOOK ?? agents.feedback.webhook;
    /* Unreachable through tools/list, but a direct HTTP call could still get
       here — an endpoint that quietly discards its input would be worse. */
    if (!webhook) throw new ToolError('Feedback is not enabled on this documentation site.');

    const raw = String(input.page ?? '').trim();
    if (!raw) throw new ToolError('`page` is required.');
    let id = raw;
    if (/^https?:\/\//.test(raw)) {
      try {
        id = new URL(raw).pathname;
      } catch {
        throw new ToolError(`"${raw}" is not a valid URL.`);
      }
    }
    id = id.replace(/^\//, '').replace(/\.md$/, '');

    const manifest = await loadManifest(context.env, context.origin);
    const page = pageById(manifest).get(id || 'index');
    if (!page) throw new ToolError(`No documentation page at "${raw}".`);

    const payload: Record<string, unknown> = { type: 'docs.issue' };

    for (const field of agents.feedback.fields) {
      const value = input[field.name];
      if (value === undefined || value === null || value === '') {
        if (field.required) throw new ToolError(`\`${field.name}\` is required.`);
        continue;
      }
      const text = String(value);
      payload[field.name] = field.maxLength ? text.slice(0, field.maxLength) : text;
    }

    const context_: Record<string, unknown> = {
      page: page.url,
      pageId: page.id,
      /* Product and version only — never the full header, which can carry
         identifying detail we have no business relaying. */
      agent: context.userAgent.split(/[\s(]/)[0] || 'unknown',
      siteVersion: manifest.generatedFor,
      reportedAt: new Date().toISOString(),
    };
    for (const key of agents.feedback.context) {
      if (context_[key] !== undefined) payload[key] = context_[key];
    }

    try {
      const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        /* A feedback tool must not break the conversation that called it, and a
           webhook that hangs would do exactly that by holding the request open
           until the Worker's own limit. Five seconds is generous for an accept
           -and-queue endpoint, which is all this needs to be. */
        signal: AbortSignal.timeout(5000),
      });
      /* Reported, not thrown: a feedback tool must never break the conversation
         that called it. The agent is told plainly what happened. */
      if (!response.ok) {
        return { delivered: false, message: 'The report could not be delivered. Nothing else to do.' };
      }
    } catch {
      return { delivered: false, message: 'The report could not be delivered. Nothing else to do.' };
    }

    return { delivered: true, message: 'Thank you — the report reached the documentation team.' };
  },
};

/* ── registry ───────────────────────────────────────────────────────────── */

/**
 * The tools this deployment actually exposes, in the order agents see them.
 *
 * `env` is optional because a handful of call sites build a description of
 * the API (the OpenAPI document, `/api/docs/` with no path) before any request
 * has arrived with bindings to read — those fall back to
 * `agents.feedback.webhook`, which stays `undefined` in the committed config.
 * Every call that has a real request in hand should pass `env`, so the
 * env-bound secret is what actually gates the tool.
 */
export function toolset(env?: Env): ToolDefinition[] {
  const tools = [searchTool, fetchTool, listPagesTool];
  if (env?.FEEDBACK_WEBHOOK ?? agents.feedback.webhook) tools.push(reportIssueTool);
  return tools;
}

export const toolByName = (name: string, env?: Env) =>
  toolset(env).find(tool => tool.name === name);
