import { render } from 'astro:content';
import { lastModifiedFor } from './last-modified';
import { toPageMarkdown } from './markdown';
import { getFlatPages, getHomePage } from './navigation';
import { plainHeading } from './plain-text';
import { byId, getPublishedDocs, type DocEntry } from './published';
import { slugify } from './slug';
import { seo } from '../docs.config';

/**
 * The join table every agent surface reads.
 *
 * AI Search gives back a passage, a relevance ordering and the key of the item
 * the passage came from — and nothing else. Everything a caller actually needs
 * to make sense of that passage (which page, under which heading, how far into
 * it, how long the page is) has to come from somewhere, and the two obvious
 * places are both wrong. Storing it as AI Search metadata is capped at five
 * fields and is per-*page*, so it could never describe a passage. Re-deriving
 * it at request time would mean parsing Markdown inside the Worker on every
 * search.
 *
 * So it is computed once, at build, into `dist/agent-manifest.json`.
 *
 * The one invariant that makes this work: **line numbers are counted against
 * the exact bytes we serve**. The same `toPageMarkdown(entry, { frontmatter:
 * true })` output is what `<page>.md` returns, what the `fetch` tool returns,
 * and what the indexer uploads. If those three ever diverge, a chunk's line
 * range starts pointing at the wrong paragraph — silently, which is the worst
 * kind of wrong. They are all routed through `pageMarkdown()` below for that
 * reason.
 */

export interface ManifestHeading {
  /**
   * The full heading path, deepest last: "Custom domains › DNS records".
   *
   * The parent carries half the meaning of a nested heading — "DNS records"
   * alone does not say which DNS. Storing the path costs a few bytes and saves
   * every consumer from reconstructing it.
   */
  path: string;
  /** Slug of the deepest heading, for building a deep link. */
  anchor: string;
  depth: number;
  /** 1-based and inclusive, into the served Markdown. */
  start: number;
  end: number;
}

export interface ManifestPage {
  id: string;
  url: string;
  title: string;
  description: string;
  /** `page`, or `api-endpoint` for a generated endpoint page. */
  type: string;
  /** The navigation tab this page sits under. */
  tab: string;
  /** ISO date, or undefined when nothing dates the page. */
  updated?: string;
  locale: string;
  /** Lines in the served Markdown, so a chunk's range can be read as a share. */
  totalLines: number;
  /**
   * First line of prose, past the YAML header.
   *
   * A hit on the text above a page's first heading has to be quoted from
   * somewhere, and quoting from line 1 would hand back the front matter.
   */
  bodyStart: number;
  headings: ManifestHeading[];
}

export interface AgentManifest {
  /** Bumped when the shape changes, so a stale cached copy is detectable. */
  version: 1;
  generatedFor: string;
  pages: ManifestPage[];
}

/**
 * The canonical bytes for a page: served at `<page>.md`, returned by `fetch`,
 * uploaded to the index, and measured by this manifest. One function so the
 * four cannot drift.
 */
export const pageMarkdown = (entry: DocEntry, url: string) =>
  toPageMarkdown(entry, { url, frontmatter: true });

/**
 * Walks the served Markdown and records where each heading's section begins and
 * ends.
 *
 * Fenced code is tracked because `# ` inside a shell block is a comment, not a
 * heading — a mistake that would shift every subsequent line range on any page
 * documenting a CLI.
 */
function outline(markdown: string, slugs: Map<string, string[]>): ManifestHeading[] {
  const lines = markdown.split('\n');
  const headings: ManifestHeading[] = [];
  /** Ancestor titles by depth, so a nested heading can name its parents. */
  const stack: string[] = [];
  /*
   * How many times each heading text has been seen. A page may repeat a
   * heading — "2. Update the DNS" appears under both the domain and the
   * subdomain procedure — and the renderer disambiguates the repeats as
   * `…-1`, `…-2`. Keyed by text alone, only one of those survives, so the
   * occurrence index is what picks the right one.
   */
  const seen = new Map<string, number>();
  let fenced = false;

  lines.forEach((line, index) => {
    if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) return;

    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!match) return;

    const depth = match[1].length;
    const text = plainHeading(match[2]);

    /* The page's own H1 is its title, already carried by the page record. */
    if (depth === 1) return;

    if (headings.length) headings[headings.length - 1].end = index;

    stack.length = Math.max(0, depth - 2);
    stack[depth - 2] = text;

    const occurrence = seen.get(text) ?? 0;
    seen.set(text, occurrence + 1);

    headings.push({
      path: stack.filter(Boolean).join(' › '),
      anchor: slugs.get(text)?.[occurrence] ?? slugify(text),
      depth,
      /* 1-based, and pointing at the heading line itself: a passage that starts
         at a heading should report the heading as its first line. */
      start: index + 1,
      end: lines.length,
    });
  });

  return headings;
}

/**
 * The line after the closing `---` of the YAML header, 1-based.
 *
 * `toPageMarkdown` always emits the header first when asked for one, so this is
 * a scan of the first few lines rather than a parse.
 */
function bodyStart(markdown: string): number {
  const lines = markdown.split('\n');
  if (lines[0]?.trim() !== '---') return 1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') return index + 2;
  }
  return 1;
}

let cache: AgentManifest | null = null;

export async function buildAgentManifest(site: URL | undefined): Promise<AgentManifest> {
  if (cache) return cache;

  const entries = byId(await getPublishedDocs());
  const home = await getHomePage();
  const flat = await getFlatPages();

  const rows = [
    ...(home ? [{ id: home.id, href: home.href, tab: 'Home' }] : []),
    ...flat.map(({ page, tab }) => ({ id: page.id, href: page.href, tab: tab.label })),
  ];

  const pages = await Promise.all(
    rows
      /* `noindex` keeps a page out of every surface that broadcasts it, and the
         agent surfaces are one of those: the manifest is what `search`,
         `list_pages` and the semantic index are all built from. Excluding it
         here is what makes that switch mean one thing everywhere instead of
         two — withheld from search engines, but handed to a model. The page
         stays reachable at its URL and as Markdown, exactly as before. */
      .filter(row => !entries.get(row.id)?.data.noindex)
      .map(async row => {
      const entry = entries.get(row.id)!;
      const url = site ? new URL(row.href, site).href : row.href;
      const markdown = pageMarkdown(entry, url);

      /* Astro's own slugs are authoritative for the HTML anchors; matching them
         by heading text keeps a deep link working. Headings the renderer does
         not produce (rare, and only where a component emits one) fall back to
         the computed slug. */
      const { headings } = await render(entry);
      /* Every slug the renderer produced for a given text, in document order —
         not one per text. See the occurrence counter in `outline`. */
      const slugs = new Map<string, string[]>();
      for (const heading of headings) {
        const key = heading.text.trim();
        slugs.set(key, [...(slugs.get(key) ?? []), heading.slug]);
      }

      const modified = lastModifiedFor(entry);

      return {
        id: row.id,
        url,
        title: entry.data.title,
        description: entry.data.description,
        type: entry.data.pageType === 'api-endpoint' ? 'api-endpoint' : 'page',
        tab: row.tab,
        ...(modified ? { updated: modified.toISOString().slice(0, 10) } : {}),
        locale: seo.language,
        totalLines: markdown.split('\n').length,
        bodyStart: bodyStart(markdown),
        headings: outline(markdown, slugs),
      } satisfies ManifestPage;
    }),
  );

  cache = { version: 1, generatedFor: site?.origin ?? '', pages };
  return cache;
}
