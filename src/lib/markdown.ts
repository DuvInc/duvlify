import type { CollectionEntry } from 'astro:content';
import { lastModifiedFor } from './last-modified';
import { mdxToMarkdown } from './mdx-to-markdown';

/**
 * The Markdown served for a page, shared by every consumer of it: the
 * `<page>.md` route, "Copy page", and /llms-full.txt. One function so those
 * three can never drift apart.
 *
 * The body is translated out of MDX into plain GFM first — see
 * mdx-to-markdown.ts for what each component becomes and why.
 */
export interface PageMarkdownOptions {
  /** Absolute URL of the HTML page this Markdown mirrors. */
  url?: string;
  /**
   * Emit a YAML header. On the standalone `.md` route this carries the
   * canonical URL, which is what tells any tool that follows the file that the
   * HTML page — not this one — is the original. Off inside /llms-full.txt,
   * where eighteen repeated headers would be noise around the actual content.
   */
  frontmatter?: boolean;
}

/** YAML-safe double-quoted scalar. */
const quote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export function toPageMarkdown(
  entry: CollectionEntry<'docs'>,
  { url, frontmatter = false }: PageMarkdownOptions = {},
) {
  const modified = lastModifiedFor(entry);

  const header = frontmatter
    ? [
        '---',
        `title: ${quote(entry.data.title)}`,
        `description: ${quote(entry.data.description)}`,
        ...(url ? [`canonical: ${quote(url)}`] : []),
        ...(modified ? [`updated: ${quote(modified.toISOString().slice(0, 10))}`] : []),
        '---',
        '',
      ]
    : [];

  /*
   * The URL is emitted exactly once, in whichever form the context has.
   *
   * Both used to be emitted: `canonical` in the header and a `Source:` line four
   * lines below it, saying the same thing. Same for the description, which
   * appeared as a field and again as the opening paragraph — so three of the
   * four header fields were duplicated in the body. These bytes are the `.md`
   * twin, the `fetch` payload and what gets embedded, so that sat in the first
   * chunk of all 331 pages, competing with each page's actual opening.
   *
   * But `Source:` is not merely redundant: inside /llms-full.txt the header is
   * off, and that line is the only thing carrying a page's URL. Dropping it
   * everywhere would strip every URL out of the full-corpus dump — whose own
   * preamble tells the reader to cite the HTML URL. Hence the condition rather
   * than a deletion.
   *
   * The H1 stays either way. Markdown without one reads as a fragment, and a
   * title earns its repetition where a description does not.
   */
  return [
    ...header,
    `# ${entry.data.title}`,
    ...(url && !frontmatter ? ['', `Source: ${url}`] : []),
    '',
    mdxToMarkdown(entry.body ?? ''),
    '',
  ].join('\n');
}
