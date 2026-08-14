/**
 * Turns a bare YouTube `<iframe>` into a framed, responsive embed.
 *
 * Imported content can contain a raw iframe with Tailwind classes —
 * `className="w-full aspect-video rounded-xl"` — that mean nothing here, since
 * no Tailwind runs on this site. Unstyled, an iframe has no intrinsic size at
 * all, so the browser fell back to its ancient default box: a fixed, tiny
 * frame with hard corners and no relation to the column it sat in, far from
 * the bordered, edge-to-edge treatment this site gives every other framed
 * image.
 *
 * This runs as a *remark* plugin, before rehype, because the JSX such content
 * already contains is an MDX node in the mdast tree at
 * this point, not yet a hast element — and rewriting it to a raw HTML string
 * is the same trick remark-mermaid.ts already uses for its own diagram markup,
 * proven to survive the rest of the pipeline unchanged.
 *
 * The replacement reuses Frame's own markup and CSS classes byte for byte —
 * `.frame-wrap` / `.frame` / `.frame-content` in components.css — rather than
 * inventing a second visual language for "a bordered thing with an aspect
 * ratio." Whatever that rule set looks like, a screenshot in a `<Frame>` and a
 * video match it identically, because they render through the same three
 * classes.
 */
import type { Root, RootContent } from 'mdast';

interface JsxAttribute {
  type: string;
  name?: string;
  value?: unknown;
}
interface JsxNode {
  type: string;
  name?: string;
  attributes?: JsxAttribute[];
  children?: RootContent[];
}

const VIDEO_HOST = /^(?:https?:)?\/\/(?:www\.)?(?:youtube(?:-nocookie)?\.com|youtu\.be)\//i;

const DEFAULT_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';

function attr(node: JsxNode, name: string): string | undefined {
  const found = node.attributes?.find(a => a.type === 'mdxJsxAttribute' && a.name === name);
  return typeof found?.value === 'string' ? found.value : undefined;
}

const isVideoIframe = (node: JsxNode) =>
  (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
  node.name === 'iframe' &&
  VIDEO_HOST.test(attr(node, 'src') ?? '');

const escapeAttr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

function toFrame(node: JsxNode): RootContent {
  const src = attr(node, 'src') ?? '';
  const title = attr(node, 'title') || 'YouTube video';
  const allow = attr(node, 'allow') || DEFAULT_ALLOW;

  return {
    type: 'html',
    value:
      '<div class="frame-wrap"><figure class="frame"><div class="frame-content">' +
      `<iframe src="${escapeAttr(src)}" title="${escapeAttr(title)}" loading="lazy" ` +
      `allow="${escapeAttr(allow)}" allowfullscreen></iframe>` +
      '</div></figure></div>',
  } satisfies RootContent;
}

export function remarkVideoEmbed() {
  return (tree: Root) => {
    /* `insideFrame` stops a video already hand-wrapped in a real <Frame> from
       being wrapped a second time — no content does that today, but the check
       is nearly free and the alternative is a silent double border. */
    const visit = (node: { children?: RootContent[] }, insideFrame = false) => {
      if (!node.children) return;
      node.children = node.children.map(child => {
        const jsx = child as unknown as JsxNode;
        if (!insideFrame && isVideoIframe(jsx)) return toFrame(jsx);
        const childIsFrame =
          (jsx.type === 'mdxJsxFlowElement' || jsx.type === 'mdxJsxTextElement') && jsx.name === 'Frame';
        visit(child as { children?: RootContent[] }, insideFrame || childIsFrame);
        return child;
      });
    };
    visit(tree);
  };
}
