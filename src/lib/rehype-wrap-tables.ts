/**
 * Wraps every rendered `<table>` in a `.table-wrapper` div, so a wide table can
 * scroll horizontally on narrow screens and the bordered/rounded card look
 * (styles/components.css) can clip reliably — a `<table>` itself doesn't clip
 * its own border-radius consistently across browsers.
 */
import type { Element, Root } from 'hast';

/** Any node with children, including the MDX JSX nodes a component becomes. */
interface Parent {
  children?: unknown[];
}

export function rehypeWrapTables() {
  return (tree: Root) => {
    const visit = (node: Parent) => {
      if (!Array.isArray(node.children)) return;
      node.children = node.children.flatMap(node => {
        const child = node as Element;
        if (child.type === 'element' && child.tagName === 'table') {
          return [
            {
              type: 'element' as const,
              tagName: 'div',
              properties: { className: ['table-wrapper'] },
              children: [child],
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
