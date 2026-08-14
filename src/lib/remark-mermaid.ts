/**
 * Turns a ```mermaid fence into a diagram container.
 *
 * This has to run as a *remark* plugin, before highlighting: Shiki would
 * tokenise the definition into spans and Mermaid needs the raw text. Emitting
 * the container here also keeps the fence — the convention every author and
 * assistant already knows — as the way to write a diagram.
 */
import type { Root, RootContent } from 'mdast';

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>]/g,
    character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character] as string,
  );

export function remarkMermaid() {
  return (tree: Root) => {
    const visit = (node: { children?: RootContent[] }) => {
      if (!node.children) return;
      node.children = node.children.map(child => {
        if (child.type === 'code' && child.lang === 'mermaid') {
          const caption = child.meta?.match(/title="([^"]+)"/)?.[1];
          const actions = child.meta?.match(/actions=\{?(true|false)\}?/)?.[1];
          const placement = child.meta?.match(/placement="([^"]+)"/)?.[1] || 'bottom-right';
          return {
            type: 'html',
            value:
              `<figure class="diagram"><div class="mermaid" data-mermaid data-mermaid-placement="${escapeHtml(placement)}"${actions ? ` data-mermaid-actions="${actions}"` : ''}>${escapeHtml(child.value)}</div>` +
              (caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '') +
              `</figure>`,
          } satisfies RootContent;
        }
        visit(child as { children?: RootContent[] });
        return child;
      });
    };
    visit(tree);
  };
}
