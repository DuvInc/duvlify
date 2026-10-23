/**
 * Which pages answer a search, and in which order.
 *
 * Free of any DOM so it runs under Node: `test/search-rank.test.mjs` imports it,
 * and `src/pages/404.astro` reuses it to suggest pages for a path that does not
 * exist, against the same static index.
 *
 * The rules, in the order they matter:
 *
 *   1. A page must contain EVERY word of the query, in any field. A page with
 *      some of the words is not an answer, it is noise that happens to share a
 *      word. ("api key" must not return every page that says "API".)
 *   2. Each word scores by the best place it appears: the title (100), a
 *      heading (60), the URL path or sidebar section (30), the description
 *      (20), the body (10). So a page that names the thing in its title beats a
 *      page that merely mentions it, however many times.
 *   3. The exact phrase earns a bonus on top, larger where it sits higher.
 *   4. Ties go to the shorter title, which is the more specific page. Ordering
 *      ties alphabetically is how "stripe" once returned ActiveCampaign first.
 *
 * Each page yields one hit. If the title answers the query, the hit is the page.
 * Otherwise a heading that answers it deep-links to that heading, and failing
 * that the best body section does.
 */

export interface Section {
  /** Heading anchor, so a result can deep-link into the page. */
  a?: string;
  /** Heading text. Absent for a page's opening prose. */
  h?: string;
  /** Plain-text body under that heading. */
  t: string;
}
export interface Page {
  h: string;
  t: string;
  s: string;
  d: string;
  k: 'page' | 'endpoint';
  m?: string;
  b: Section[];
}
export interface QuickLink {
  h: string;
  t: string;
  s: string;
  k: 'page' | 'endpoint';
  m?: string;
}
export interface Index {
  quick: QuickLink[];
  pages: Page[];
}

export interface Hit {
  href: string;
  title: string;
  /** The second line of the result row: where it is, and/or what it says. */
  meta: string;
  score: number;
  kind: 'page' | 'endpoint' | 'heading';
  method?: string;
}

const WEIGHT = { title: 100, heading: 60, place: 30, description: 20, body: 10 } as const;

/**
 * A result line is one row of clipped text, so the match has to appear early in
 * it — enough words before to give context, and the rest of the budget after.
 * Centring the match instead pushes it past the clip on a narrow dialog.
 */
const SNIPPET_LEAD = 34;
const SNIPPET_TRAIL = 150;

/** The words of a query, lower-cased, with duplicates dropped. */
export const wordsOf = (query: string): string[] => [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];

/** A window of body text opening just before the match, cut at word boundaries. */
export function snippetAround(text: string, at: number) {
  let start = Math.max(0, at - SNIPPET_LEAD);
  let end = Math.min(text.length, at + SNIPPET_TRAIL);
  if (start > 0) start = text.indexOf(' ', start) + 1 || start;
  if (end < text.length) end = text.lastIndexOf(' ', end) + 1 || end;
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

const containsAll = (haystack: string, words: string[]) => words.every(word => haystack.includes(word));

function rankPage(page: Page, words: string[], phrase: string): Hit | null {
  const title = page.t.toLowerCase();
  const place = `${page.h} ${page.s}`.toLowerCase();
  const description = page.d.toLowerCase();
  const sections = page.b.map(section => ({
    section,
    heading: section.h?.toLowerCase() ?? '',
    body: section.t.toLowerCase(),
  }));
  const headings = sections.map(entry => entry.heading).filter(Boolean);
  const bodies = sections.map(entry => entry.body);

  /* The best field each word appears in, and whether every word appears at all. */
  let score = 0;
  for (const word of words) {
    const weight =
      title.includes(word) ? WEIGHT.title
      : headings.some(heading => heading.includes(word)) ? WEIGHT.heading
      : place.includes(word) ? WEIGHT.place
      : description.includes(word) ? WEIGHT.description
      : bodies.some(body => body.includes(word)) ? WEIGHT.body
      : 0;
    if (!weight) return null;
    score += weight;
  }

  /* The exact phrase, in the highest place it occurs. */
  if (title.startsWith(phrase)) score += 80;
  else if (title.includes(phrase)) score += 50;
  else if (headings.some(heading => heading.includes(phrase))) score += 30;
  else if (description.includes(phrase)) score += 15;
  else if (bodies.some(body => body.includes(phrase))) score += 10;

  const meta = `${page.s} · ${page.d}`;
  if (containsAll(title, words)) {
    return { href: page.h, title: page.t, meta, score, kind: page.k, method: page.m };
  }

  /* A heading that answers the whole query: link straight to it. */
  const headed = sections.find(entry => entry.heading && containsAll(entry.heading, words));
  if (headed) {
    return {
      href: headed.section.a ? `${page.h}#${headed.section.a}` : page.h,
      title: headed.section.h!,
      meta: `${page.t} · ${page.s}`,
      score,
      kind: 'heading',
    };
  }

  /* Otherwise the section that holds the most of the words, with its sentence. */
  let best: { entry: (typeof sections)[number]; found: number } | null = null;
  for (const entry of sections) {
    const text = `${entry.heading} ${entry.body}`;
    const found = words.filter(word => text.includes(word)).length;
    if (found && (!best || found > best.found)) best = { entry, found };
  }
  if (best) {
    const { section, body } = best.entry;
    const first = words.map(word => body.indexOf(word)).filter(at => at >= 0).sort((a, b) => a - b)[0];
    return {
      href: section.a ? `${page.h}#${section.a}` : page.h,
      title: section.h ? `${page.t} · ${section.h}` : page.t,
      /* The title line already says where this is, so the whole second line
         goes to the sentence that matched. */
      meta: first === undefined ? meta : snippetAround(section.t, first),
      score,
      kind: page.k,
      method: page.m,
    };
  }
  return { href: page.h, title: page.t, meta, score, kind: page.k, method: page.m };
}

export function rank(index: Index, rawQuery: string, limit = 20): Hit[] {
  const phrase = rawQuery.trim().toLowerCase();
  const words = wordsOf(rawQuery);
  if (!words.length) return [];
  const hits: Array<Hit & { titleLength: number }> = [];
  for (const page of index.pages) {
    const hit = rankPage(page, words, phrase);
    if (hit) hits.push({ ...hit, titleLength: page.t.length });
  }
  return hits
    .sort((a, b) => b.score - a.score || a.titleLength - b.titleLength || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map(({ titleLength: _unused, ...hit }) => hit);
}
