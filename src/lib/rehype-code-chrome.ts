/**
 * Gives an ordinary fenced code block the same chrome as the <CodeBlock>
 * component: a filename header, a copy button, and a scrollable body.
 *
 *     ```bash title="Terminal"
 *     npm install
 *     ```
 *
 * Why this exists: Shiki only highlights *fences*. Before this, an author had
 * to choose between highlighting (a fence, no chrome) and chrome (the
 * component, no highlighting) — two ways to write the same thing, and the one
 * an AI reaches for first was the one that looked unfinished. Now the fence is
 * the only way, and it gets both.
 *
 * `shikiCodeMeta` runs during highlighting to carry `title=` from the fence's
 * info string onto the <pre>; this plugin then reads it and builds the wrapper.
 * The copy button itself is cloned from a <template> at runtime (see
 * scripts/code.ts) so its icons still come from Icon.astro and nothing here
 * hand-writes SVG.
 */
import type { Element, ElementContent, Root } from 'hast';
import type { ShikiTransformer } from 'shiki';

/** Human labels for the languages that appear in this documentation set. */
const LANGUAGE_LABELS: Record<string, string> = {
  bash: 'Terminal',
  sh: 'Terminal',
  shell: 'Terminal',
  console: 'Terminal',
  http: 'HTTP',
  json: 'JSON',
  jsonc: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  ts: 'TypeScript',
  tsx: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  py: 'Python',
  python: 'Python',
  go: 'Go',
  rb: 'Ruby',
  ruby: 'Ruby',
  php: 'PHP',
  csharp: 'C#',
  java: 'Java',
  sql: 'SQL',
  css: 'CSS',
  html: 'HTML',
  md: 'Markdown',
  mdx: 'MDX',
  diff: 'Diff',
};

/**
 * Copies `title="…"` off the fence's info string onto the <pre>. Shiki is the
 * only stage that sees the raw meta, so it has to happen here.
 */
export const shikiCodeMeta: ShikiTransformer = {
  name: 'duvlify:code-meta',
  pre(node) {
    const raw = (this.options.meta as { __raw?: string } | undefined)?.__raw ?? '';
    const title = raw.match(/title="([^"]+)"/)?.[1] ?? raw.match(/title=([^\s"]+)/)?.[1];
    if (title) node.properties['data-filename'] = title;
  },
};

const element = (
  tagName: string,
  properties: Element['properties'],
  children: ElementContent[],
): Element => ({ type: 'element', tagName, properties, children });

/**
 * Any node that has children, including the MDX JSX nodes a component becomes.
 * Walking only `element` nodes would skip every fence written inside a
 * <CodeGroup> or <RequestExample> — which is most of them.
 */
interface Parent {
  children?: unknown[];
}

export function rehypeCodeChrome() {
  return (tree: Root) => {
    const visit = (node: Parent) => {
      if (!Array.isArray(node.children)) return;

      node.children = node.children.map(node => {
        const child = node as Element;
        if (child.type !== 'element' || child.tagName !== 'pre') {
          visit(child as Parent);
          return child;
        }

        /* hast accepts either spelling for a data attribute depending on who
           produced the node, so read both rather than betting on one. */
        const read = (name: string, camel: string) => child.properties[name] ?? child.properties[camel];
        const language = String(read('data-language', 'dataLanguage') ?? '');
        const filename = read('data-filename', 'dataFilename');
        /* `data-filename` has done its job; keep it off the DOM. */
        delete child.properties['data-filename'];
        delete child.properties.dataFilename;

        const label =
          (typeof filename === 'string' && filename) || LANGUAGE_LABELS[language] || language || 'Code';

        child.properties.tabindex = 0;

        return element('div', { className: ['code-block'], 'data-tab-title': label }, [
          element('header', { className: ['code-block-header'] }, [
            element('span', { className: ['code-block-filename'] }, [{ type: 'text', value: label }]),
          ]),
          element('div', { className: ['code-block-body'] }, [child]),
        ]);
      });
    };
    visit(tree);
  };
}
