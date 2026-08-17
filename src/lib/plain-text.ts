/**
 * Turns an MDX source body into the plain prose a reader would see, and splits
 * it by heading so a search hit can deep-link to the right section.
 *
 * This runs at build time only, for src/pages/search-index.json.ts. It works on
 * the *source* rather than the rendered HTML because the source is what the
 * content collection already hands us — no second render pass, no DOM.
 */

/** Attributes whose values are prose a reader sees, and should be searchable. */
const PROSE_ATTRIBUTES = /\b(?:title|description|label|caption|hint|name|path|cta)="([^"]*)"/g;

const MAX_SECTION_LENGTH = 4000;

export interface Section {
  /** Heading anchor. Absent for a page's opening prose, which has no heading. */
  a?: string;
  /** Heading text. Absent for the opening prose. */
  h?: string;
  /** Plain-text body under that heading. */
  t: string;
}

/** Strips MDX and Markdown syntax, keeping the words. */
export function toPlainText(source: string): string {
  return (
    source
      /* MDX module scaffolding is never reader-facing. */
      .replace(/^(?:import|export)\s.*$/gm, '')
      /* Fenced code: keep the code, drop the fences and the info string. */
      .replace(/^```[^\n]*\n([\s\S]*?)^```\s*$/gm, '$1')
      /* Component tags: keep the prose held in their attributes, drop the tag. */
      .replace(/<[A-Za-z][^>]*?>/g, tag => {
        const values: string[] = [];
        for (const match of tag.matchAll(PROSE_ATTRIBUTES)) values.push(match[1]);
        return values.length ? ` ${values.join(' ')} ` : ' ';
      })
      .replace(/<\/[A-Za-z][^>]*>/g, ' ')
      /* JSX expression containers, e.g. size={22} or {'{'}. */
      .replace(/\{[^{}]*\}/g, ' ')
      /* Links and images keep their label, lose their target. */
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      /* Inline code, emphasis, table pipes, list and quote markers. */
      .replace(/`([^`]*)`/g, '$1')
      .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
      .replace(/^\s{0,3}[-*+]\s+/gm, '')
      .replace(/^\s{0,3}\d+\.\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s*\|?\s*[-:| ]+\s*\|?\s*$/gm, '')
      .replace(/\|/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_SECTION_LENGTH)
  );
}

/**
 * A heading as a reader sees it, with inline Markdown removed.
 *
 * Everything that scans raw source and needs to match a heading back to what
 * Astro rendered — the agent manifest's outline, the search index's sections —
 * goes through this, because the renderer's heading text is the key both sides
 * must agree on. Reading the raw line instead once produced a path of
 * `****2. Update the DNS****` from `### **2. Update the DNS**` — syntax leaking
 * into a JSON string field that nothing renders, straight into what an agent
 * reads and may quote — and every decorated heading missed the slug lookup.
 *
 * Underscores are deliberately left alone. `_emphasis_` in a heading is rare;
 * `list_pages` in a heading is not, and stripping the delimiter that matters
 * here would corrupt every snake_case identifier we document.
 */
export const plainHeading = (markdown: string) =>
  markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*+/g, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Splits a body into one section per h2, using the slugs Astro already
 * computed for those headings so the anchors always agree with the page.
 * H3 content stays inside its parent H2 section: search remains useful without
 * producing an overly granular result list.
 */
export function toSections(body: string, headings: { depth: number; slug: string; text: string }[]): Section[] {
  /* Every slug the renderer produced for a given text, in document order — not
     one per text. A page may repeat a heading, and the renderer disambiguates
     the repeats as `…-1`, `…-2`; keyed by text alone only the first survives,
     and a hit under the second occurrence would deep-link to the first. The
     occurrence index picks the right one — the same scheme as `outline()` in
     agent-manifest.ts, which hit this exact bug first. */
  const bySlug = new Map<string, string[]>();
  for (const heading of headings) {
    if (heading.depth !== 2) continue;
    const key = heading.text.trim();
    bySlug.set(key, [...(bySlug.get(key) ?? []), heading.slug]);
  }

  const sections: Section[] = [];
  const seen = new Map<string, number>();
  let current: Section = { t: '' };
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    const text = toPlainText(buffer.join('\n'));
    if (text || current.h) sections.push({ ...current, t: text });
    buffer = [];
  };

  for (const line of body.split('\n')) {
    if (/^\s*(?:```|~~~)/.test(line)) inFence = !inFence;
    const heading = inFence ? null : line.match(/^(##)\s+(.*)$/);
    if (heading) {
      flush();
      /* `plainHeading`, not an ad-hoc strip: the map is keyed by the *rendered*
         text, so `## [Guide](…)` and `## list_pages` must reduce to exactly
         what Astro rendered or the lookup misses and the hit loses its anchor. */
      const text = plainHeading(heading[2]);
      const occurrence = seen.get(text) ?? 0;
      seen.set(text, occurrence + 1);
      current = { h: text, a: bySlug.get(text)?.[occurrence], t: '' };
      continue;
    }
    buffer.push(line);
  }
  flush();

  return sections.filter(section => section.t || section.h);
}
