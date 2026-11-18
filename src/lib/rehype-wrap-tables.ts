/**
 * Prepares every rendered `<table>` for the reading column:
 *
 * - Wraps it in a `.table-wrapper` (the bordered, rounded card, which clips
 *   reliably where a `<table>` doesn't clip its own border-radius) holding a
 *   `.table-scroll` that scrolls a wide table sideways. Two layers so the card
 *   can draw the scroll shadow above the rows: painted on the scroller itself,
 *   a hovered row's background covered it.
 * - Promotes the first body row to the header when the header row is empty.
 *   Notion and GitBook exports write a blank `|  |  |` header and put the real
 *   column names in the first row, which then renders as an empty grey strip
 *   above a header styled as data (softr-docs, 12 pages, 2026-11-18).
 * - Measures each column's longest cell and tags its cells `col-text`,
 *   `col-prose` or `col-long`. CSS gives those a minimum width, so a seven-column table of
 *   sentences scrolls sideways at a readable measure instead of being crushed
 *   to a word per line, while a column of `Yes`/`No` stays as narrow as it is.
 * - Marks a table whose first column is a short label (`data-row-labels`):
 *   that column stays pinned while the rest scrolls, so a row keeps its name.
 */
import type { Element, ElementContent, Root } from 'hast';

/** Any node with children, including the MDX JSX nodes a component becomes. */
interface Parent {
  children?: unknown[];
}

/** Longest cell above which a column holds paragraphs and gets a wider measure. */
const LONG_CHARS = 160;
/** Longest cell, in characters, above which a column is read as sentences. */
const PROSE_CHARS = 60;
/** Longest cell above which a column wraps, but gets a floor so it never crushes. */
const TEXT_CHARS = 24;
/** A first column at most this long reads as a row label and is pinned. */
const LABEL_CHARS = 24;

const isElement = (node: unknown, tagName?: string): node is Element =>
  (node as Element)?.type === 'element' && (!tagName || (node as Element).tagName === tagName);

const elements = (node: Element, tagName: string) =>
  node.children.filter((child): child is Element => isElement(child, tagName));

const textOf = (node: ElementContent): string =>
  node.type === 'text' ? node.value : 'children' in node ? node.children.map(textOf).join('') : '';

const cellsOf = (row: Element) =>
  row.children.filter((child): child is Element => isElement(child, 'td') || isElement(child, 'th'));

function promoteEmptyHeader(table: Element) {
  const head = elements(table, 'thead')[0];
  const body = elements(table, 'tbody')[0];
  if (!head || !body) return;
  const headRows = elements(head, 'tr');
  const bodyRows = elements(body, 'tr');
  if (headRows.length !== 1 || bodyRows.length < 2) return;
  if (cellsOf(headRows[0]).some(cell => textOf(cell).trim() !== '')) return;
  const promoted = bodyRows[0];
  for (const cell of cellsOf(promoted)) cell.tagName = 'th';
  head.children = [promoted];
  body.children = body.children.filter(child => child !== promoted);
}

function tagColumns(table: Element) {
  const rows = table.children
    .filter((child): child is Element => isElement(child, 'thead') || isElement(child, 'tbody'))
    .flatMap(section => elements(section, 'tr'));
  const longest: number[] = [];
  for (const row of rows) {
    cellsOf(row).forEach((cell, column) => {
      const length = textOf(cell).trim().length;
      longest[column] = Math.max(longest[column] ?? 0, length);
    });
  }
  const columnClass = longest.map(length =>
    length > LONG_CHARS ? 'col-long' : length > PROSE_CHARS ? 'col-prose' : length > TEXT_CHARS ? 'col-text' : undefined,
  );
  for (const row of rows) {
    cellsOf(row).forEach((cell, column) => {
      const name = columnClass[column];
      if (!name) return;
      const existing = cell.properties.className;
      cell.properties.className = [...(Array.isArray(existing) ? existing : []), name];
    });
  }
  if (longest.length >= 3 && longest[0] <= LABEL_CHARS) table.properties.dataRowLabels = '';
}

export function rehypeWrapTables() {
  return (tree: Root) => {
    const visit = (node: Parent) => {
      if (!Array.isArray(node.children)) return;
      node.children = node.children.flatMap(node => {
        const child = node as Element;
        if (isElement(child, 'table')) {
          promoteEmptyHeader(child);
          tagColumns(child);
          return [
            {
              type: 'element' as const,
              tagName: 'div',
              properties: { className: ['table-wrapper'] },
              children: [
                {
                  type: 'element' as const,
                  tagName: 'div',
                  properties: { className: ['table-scroll'] },
                  children: [child],
                },
              ],
            },
          ];
        }
        visit(child as Parent);
        return [child];
      });
    };
    visit(tree);
  };
}
