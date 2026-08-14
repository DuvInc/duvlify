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
 * Splits a body into one section per h2, using the slugs Astro already
 * computed for those headings so the anchors always agree with the page.
 * H3 content stays inside its parent H2 section: search remains useful without
 * producing an overly granular result list.
 */
export function toSections(body: string, headings: { depth: number; slug: string; text: string }[]): Section[] {
  const bySlug = new Map(headings.filter(heading => heading.depth === 2).map(heading => [heading.text.trim(), heading.slug]));
  const sections: Section[] = [];
  let current: Section = { t: '' };
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    const text = toPlainText(buffer.join('\n'));
    if (text || current.h) sections.push({ ...current, t: text });
    buffer = [];
  };

  for (const line of body.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const heading = inFence ? null : line.match(/^(##)\s+(.*)$/);
    if (heading) {
      flush();
      const text = heading[2].replace(/[`*_]/g, '').trim();
      current = { h: text, a: bySlug.get(text), t: '' };
      continue;
    }
    buffer.push(line);
  }
  flush();

  return sections.filter(section => section.t || section.h);
}
