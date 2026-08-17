/**
 * The URL of a page's Markdown twin.
 *
 * Every page is also served as Markdown at its own URL plus `.md`, which works
 * for all 334 of them except the home page: its path is `/`, so appending gives
 * `/.md`. The route itself is emitted as `/index.md`, matching the content id,
 * so the special case belongs here rather than in each of the four places that
 * needed to build this string — the `<link rel="alternate">`, the page menu, the
 * structured-data `contentUrl`, and the client-side "Copy page" fetch. Three of
 * them had the bug.
 *
 * Takes either an absolute URL or a root-relative path, and preserves which.
 */
export function markdownUrl(base: string): string {
  return base.endsWith('/') ? `${base}index.md` : `${base}.md`;
}
