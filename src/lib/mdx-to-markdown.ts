/**
 * Turns an MDX page body into plain CommonMark/GFM — no component tags left.
 *
 * This is what `<page>.md`, "Copy page" and /llms-full.txt serve. Shipping the
 * raw MDX made a reader (human or model) parse our tag vocabulary before they
 * could read the page: `<ParamField query="limit" type="integer">` is house
 * syntax, while "**limit** (integer)" is universal. Every tag is rewritten into
 * the closest standard construct instead — headings, bold labels, blockquotes,
 * lists, fenced code — and anything we don't recognise is unwrapped so its prose
 * survives.
 *
 * Reliability comes from parsing rather than pattern-matching: remark-mdx builds
 * the same syntax tree the site itself renders from, so attribute quoting,
 * nesting, expressions and code fences are all handled by the parser. The
 * fallback (unwrap unknown tags, drop tags with no children) means a component
 * added tomorrow degrades to its own contents rather than leaking a tag.
 */
import type { BlockContent, Code, List, ListItem, Paragraph, PhrasingContent, Root, RootContent } from 'mdast';
import type { MdxJsxAttribute, MdxJsxFlowElement, MdxJsxTextElement } from 'mdast-util-mdx-jsx';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';

type JsxElement = MdxJsxFlowElement | MdxJsxTextElement;
type AnyContent = RootContent | PhrasingContent;

/** Node types that only exist to serve the JSX runtime, never the reader. */
const DISCARDED = new Set(['mdxjsEsm', 'mdxFlowExpression', 'mdxTextExpression']);

/* ── mdast constructors ──────────────────────────────────────────────────── */

const text = (value: string): PhrasingContent => ({ type: 'text', value });
const strong = (value: string): PhrasingContent => ({ type: 'strong', children: [text(value)] });
const code = (value: string): PhrasingContent => ({ type: 'inlineCode', value });
const paragraph = (children: PhrasingContent[]): Paragraph => ({ type: 'paragraph', children });
// A multi-block item (a step with prose and a code fence) reads better loose.
const listItem = (children: BlockContent[]): ListItem => ({ type: 'listItem', spread: children.length > 1, children });
const list = (children: ListItem[], ordered = false): List => ({ type: 'list', ordered, spread: false, children });

/**
 * Prose as-is, but an identifier-looking string (`invalid_field`, `_headers`)
 * in backticks — it reads as code, and it keeps the stringifier from escaping
 * the punctuation inside it.
 */
const phrase = (value: string): PhrasingContent[] =>
  value
    .split(/(\s+)/)
    .filter(Boolean)
    .map(token => (/[_*`[\]<>\\]/.test(token) ? code(token) : text(token)));

/** A `**Label**` lead-in paragraph, the workhorse for titled containers. */
const label = (value: string): Paragraph => paragraph([{ type: 'strong', children: phrase(value) }]);

/* ── attributes ──────────────────────────────────────────────────────────── */

const ENTITIES: Record<string, string> = {
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
};

const decode = (value: string) => value.replace(/&(?:quot|apos|#39|lt|gt|amp);/g, entity => ENTITIES[entity]);

/**
 * An attribute as a string. Covers the three shapes the parser produces: a
 * quoted string, a bare name (`required`, i.e. `true`), and an expression
 * (`required={true}`, `size={22}`) whose source text we read verbatim.
 */
function attribute(node: JsxElement, name: string): string | undefined {
  const found = node.attributes.find(
    (candidate): candidate is MdxJsxAttribute => candidate.type === 'mdxJsxAttribute' && candidate.name === name,
  );
  if (!found) return undefined;
  if (found.value == null) return 'true';
  if (typeof found.value === 'string') return decode(found.value);
  return found.value.value.replace(/^['"]|['"]$/g, '');
}

/** The first attribute present, for components that accept synonyms. */
const firstAttribute = (node: JsxElement, ...names: string[]) => {
  for (const name of names) {
    const value = attribute(node, name);
    if (value != null) return value;
  }
  return undefined;
};

const isTruthy = (value: string | undefined) => value != null && value !== 'false';

/* ── handlers ────────────────────────────────────────────────────────────── */

/**
 * A handler receives the element and its already-transformed children, and
 * returns the nodes that replace it. Returning the children unchanged is the
 * "unwrap" case: the tag disappears, its contents stay.
 */
type Handler = (node: JsxElement, children: AnyContent[]) => AnyContent[];

const unwrap: Handler = (_node, children) => children;
const drop: Handler = () => [];

/** `<Note>`, `<Warning>`, `<Callout tone="…">` → a labelled blockquote. */
function callout(fallbackTone: string): Handler {
  return (node, children) => {
    const tone = attribute(node, 'tone') || fallbackTone;
    const title = attribute(node, 'title');
    const name = `${tone.charAt(0).toUpperCase()}${tone.slice(1)}`;
    // A `<Callout tone="info" title="Info">` would otherwise read "Info: Info".
    const heading = title && title.toLowerCase() !== tone.toLowerCase() ? `${name}: ${title}` : name;
    return [
      {
        type: 'blockquote',
        children: [label(heading), ...(liftToBlocks(children) as BlockContent[])],
      },
    ];
  };
}

/**
 * `<ParamField>` / `<ResponseField>` → a bold name, its type and modifiers in
 * parentheses, then the field's own prose as ordinary paragraphs.
 */
const field: Handler = (node, children) => {
  const name = firstAttribute(node, 'name', 'query', 'path', 'body', 'header') ?? 'field';
  const type = attribute(node, 'type');
  const modifiers: (string | undefined)[] = [];
  if (isTruthy(attribute(node, 'required'))) modifiers.push('required');
  if (isTruthy(attribute(node, 'deprecated'))) modifiers.push('deprecated');
  modifiers.push(attribute(node, 'hint'), attribute(node, 'default'));

  // Names and types are identifiers, so they go in backticks: it reads as code
  // and it keeps the stringifier from escaping `_` and `[` inside them.
  const details: PhrasingContent[] = [];
  if (type) details.push(code(type));
  const rest = modifiers.filter(Boolean).join(', ');
  if (rest) details.push(...(details.length ? [text(', '), ...phrase(rest)] : phrase(rest)));

  return [
    paragraph([
      { type: 'strong', children: [code(name)] },
      ...(details.length ? [text(' ('), ...details, text(')')] : []),
    ]),
    ...children,
  ];
};

/** A titled container: `**Title**` then its contents. */
function titled(...names: string[]): Handler {
  return (node, children) => {
    const title = firstAttribute(node, ...names);
    return title ? [label(title), ...children] : children;
  };
}

/** A fixed lead-in, for containers whose meaning is in the tag name itself. */
function named(title: string): Handler {
  return (_node, children) => [label(title), ...children];
}

/** `<Steps>` → an ordered list, one item per `<Step>`, so numbering is real. */
const steps: Handler = (_node, children) => {
  const items = children.filter((child): child is ListItem => child.type === 'listItem');
  return items.length ? [list(items, true)] : children;
};

const step: Handler = (node, children) => {
  const title = attribute(node, 'title');
  return [listItem([...(title ? [label(title)] : []), ...(liftToBlocks(children) as BlockContent[])])];
};

/** `<Card>` / `<Tile>` → a linked title, then description and contents. */
const card: Handler = (node, children) => {
  const title = attribute(node, 'title');
  const href = attribute(node, 'href');
  const description = attribute(node, 'description');
  const bold: PhrasingContent = { type: 'strong', children: title ? phrase(title) : [] };
  const heading: PhrasingContent[] = title ? [href ? { type: 'link', url: href, children: [bold] } : bold] : [];
  return [
    ...(heading.length ? [paragraph(heading)] : []),
    ...(description ? [paragraph(phrase(description))] : []),
    ...children,
  ];
};

/**
 * `<CTA>` → its eyebrow, title, description, and the action as a real link.
 *
 * Not `card`, which is otherwise the same shape: a card's `href` belongs to its
 * title, and a CTA's belongs to its `label`. Running it through `card` would
 * have linked the headline and dropped the button's words — the one part of the
 * block that says what happens if you follow it.
 *
 * Worth a handler at all because every visible string here is an attribute
 * rather than a child, so without one the whole block renders to nothing in the
 * Markdown twin. That is the copy an agent reads, and a component that silently
 * empties itself there is the sort of thing nobody notices from the page.
 */
const cta: Handler = (node, children) => {
  const eyebrow = attribute(node, 'eyebrow');
  const title = attribute(node, 'title');
  const description = attribute(node, 'description');
  const href = attribute(node, 'href');
  const actionLabel = attribute(node, 'label');
  return [
    ...(eyebrow ? [paragraph([{ type: 'emphasis', children: phrase(eyebrow) }])] : []),
    ...(title ? [label(title)] : []),
    ...(description ? [paragraph(phrase(description))] : []),
    ...children,
    ...(href && actionLabel
      ? [paragraph([{ type: 'link', url: href, children: phrase(actionLabel) }])]
      : []),
  ];
};

/** The visible words inside a subtree, flattened: link text must be phrasing. */
const textOf = (nodes: AnyContent[]): string =>
  nodes
    .map(node => {
      if ('value' in node && typeof node.value === 'string') return node.value;
      if ('children' in node && Array.isArray(node.children)) return textOf(node.children as AnyContent[]);
      return '';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

/** `<Button>` → the link it already is, with its own label as the link text. */
const button: Handler = (node, children) => {
  const href = attribute(node, 'href');
  const words = textOf(children);
  if (!href || !words) return children;
  return [paragraph([{ type: 'link', url: href, children: phrase(words) }])];
};

/** `<Frame>` → the image or content it wraps, with its caption in italics. */
const frame: Handler = (node, children) => {
  const caption = firstAttribute(node, 'caption', 'label', 'hint');
  return [
    ...children,
    ...(caption ? [paragraph([{ type: 'emphasis', children: phrase(caption) }])] : []),
  ];
};

/**
 * `<Mermaid>` → a ```mermaid fence. The diagram source arrives either as a
 * `chart` attribute or as a fenced child, which is already a code node.
 */
const mermaid: Handler = (node, children) => {
  const chart = attribute(node, 'chart');
  if (chart) return [{ type: 'code', lang: 'mermaid', value: chart } satisfies Code];
  return children.map(child => (child.type === 'code' ? { ...child, lang: 'mermaid' } : child));
};

/** `<Tree>` / `<Folder>` / `<File>` → nested bullets, one per entry. */
const tree: Handler = (_node, children) => {
  const items = children.filter((child): child is ListItem => child.type === 'listItem');
  return items.length ? [list(items)] : children;
};

/** A file tree reads as a tight list, however many levels it nests. */
const tightItem = (children: BlockContent[]): ListItem => ({ type: 'listItem', spread: false, children });

const treeEntry = (suffix: string): Handler => (node, children) => {
  const name = attribute(node, 'name') ?? '';
  const nested = children.filter((child): child is ListItem => child.type === 'listItem');
  return [
    tightItem([
      paragraph([code(`${name}${suffix}`)]),
      ...(nested.length
        ? [list(nested)]
        : (liftToBlocks(children.filter(child => child.type !== 'listItem')) as BlockContent[])),
    ]),
  ];
};

/** `<ColorItem name="Accent" value="#16a34a" />` → `- **Accent** — `#16a34a``. */
const colorItem: Handler = node => {
  const name = attribute(node, 'name') ?? '';
  const value = attribute(node, 'value');
  return [listItem([paragraph([strong(name), ...(value ? [text(' — '), code(value)] : [])])])];
};

const handlers: Record<string, Handler> = {
  /* API reference */
  Endpoint: node => [paragraph([code(`${attribute(node, 'method') || 'GET'} ${attribute(node, 'path') || ''}`.trim())])],
  ApiResponseDetails: node => [paragraph([text(`Responses for ${attribute(node, 'method') || 'GET'} ${attribute(node, 'path') || ''} are defined in /openapi.yaml.`)])],
  ParamField: field,
  ResponseField: field,
  Response: field,
  Expandable: titled('title', 'name'),
  RequestExample: named('Request example'),
  ResponseExample: named('Response example'),

  /* Callouts */
  Callout: callout('note'),
  Note: callout('note'),
  Info: callout('info'),
  Tip: callout('tip'),
  Check: callout('success'),
  Warning: callout('warning'),
  Danger: callout('danger'),
  Banner: callout('note'),

  /* Containers that only carry layout */
  AccordionGroup: unwrap,
  CardGroup: unwrap,
  CodeBlock: unwrap,
  CodeGroup: unwrap,
  Columns: unwrap,
  Column: unwrap,
  Examples: unwrap,
  Panel: unwrap,
  Tabs: unwrap,
  View: titled('title'),

  /* Containers with a title worth keeping */
  Accordion: titled('title'),
  Tab: titled('title'),
  Update: titled('title', 'label'),

  CTA: cta,
  Button: button,
  LinkButton: button,

  Card: card,
  Tile: card,
  // Same shape: a title, an optional description attribute, then contents.
  Prompt: card,
  Frame: frame,
  Mermaid: mermaid,
  Steps: steps,
  Step: step,

  Tree: tree,
  FileTree: tree,
  Folder: treeEntry('/'),
  'Tree.Folder': treeEntry('/'),
  TreeFolder: treeEntry('/'),
  File: treeEntry(''),
  'Tree.File': treeEntry(''),
  TreeFile: treeEntry(''),

  Color: tree,
  ColorRow: tree,
  'Color.Row': tree,
  ColorItem: colorItem,
  'Color.Item': colorItem,

  /* The HTML page keeps human content; the Markdown twin is the agent view. */
  Visibility: (node, children) => attribute(node, 'for') === 'agents' ? children : [],

  /* Decoration: the tag carries no prose of its own. */
  Icon: drop,
  Badge: unwrap,
  Tooltip: unwrap,
  Brand: unwrap,

  /* Raw HTML is legal in MDX, and pages do use a little of it. It parses as JSX
     too, so the same table can turn it back into the Markdown it stands for. */
  p: (_node, children) => liftToBlocks(children),
  strong: (_node, children) => [{ type: 'strong', children: children as PhrasingContent[] }],
  b: (_node, children) => [{ type: 'strong', children: children as PhrasingContent[] }],
  em: (_node, children) => [{ type: 'emphasis', children: children as PhrasingContent[] }],
  i: (_node, children) => [{ type: 'emphasis', children: children as PhrasingContent[] }],
  code: (_node, children) => [code(children.map(child => ('value' in child ? child.value : '')).join(''))],
  a: (node, children) => [
    { type: 'link', url: attribute(node, 'href') ?? '', children: children as PhrasingContent[] },
  ],
  img: node => [
    { type: 'image', url: attribute(node, 'src') ?? '', alt: attribute(node, 'alt') ?? '' },
  ],
  br: () => [{ type: 'break' }],
  hr: () => [{ type: 'thematicBreak' }],
  ul: tree,
  ol: (_node, children) => {
    const items = children.filter((child): child is ListItem => child.type === 'listItem');
    return items.length ? [list(items, true)] : children;
  },
  li: (_node, children) => [listItem(liftToBlocks(children) as BlockContent[])],
};

/* ── tree walk ───────────────────────────────────────────────────────────── */

function transformChildren(children: AnyContent[]): AnyContent[] {
  const output: AnyContent[] = [];

  for (const child of children) {
    if (DISCARDED.has(child.type)) continue;

    if (child.type === 'mdxJsxFlowElement' || child.type === 'mdxJsxTextElement') {
      const element = child as JsxElement;
      let inner = transformChildren((element.children ?? []) as AnyContent[]);
      // A one-line flow element (`<Note>text</Note>`) parses with bare phrasing
      // children. Handlers put those children inside blockquotes and list items,
      // which must hold blocks — so wrap them before the handler sees them.
      if (element.type === 'mdxJsxFlowElement') inner = liftToBlocks(inner);

      // An unrecognised tag keeps its contents and loses itself; a description
      // held only in attributes would be lost, so it becomes the contents.
      const handler = (element.name && handlers[element.name]) || unwrap;
      output.push(...handler(element, inner));
      continue;
    }

    if ('children' in child && Array.isArray(child.children)) {
      const inner = transformChildren(child.children as AnyContent[]);
      // `<Note>one line</Note>` parses as an *inline* element inside a
      // paragraph, but becomes a blockquote here. Split the paragraph around any
      // such block rather than nesting one inside it.
      if (child.type === 'paragraph' && inner.some(node => !isPhrasing(node))) {
        output.push(...liftToBlocks(inner));
        continue;
      }
      (child as { children: AnyContent[] }).children = inner;
    }
    output.push(child);
  }

  return output;
}

const PHRASING = /^(text|strong|emphasis|inlineCode|link|linkReference|image|imageReference|break|delete|footnoteReference)$/;
const isPhrasing = (node: AnyContent) => PHRASING.test(node.type);

/**
 * Phrasing content promoted to paragraphs, so a run of inline nodes and a run of
 * blocks can sit side by side in a context that only accepts blocks.
 */
function liftToBlocks(children: AnyContent[]): RootContent[] {
  const output: RootContent[] = [];
  let inline: PhrasingContent[] = [];

  const flush = () => {
    // Line breaks left behind by a lifted block are not content of their own.
    while (inline.length && inline[0].type === 'text' && !inline[0].value.trim()) inline.shift();
    while (inline.length && inline[inline.length - 1].type === 'text') {
      const last = inline[inline.length - 1] as { value: string };
      if (last.value.trim()) break;
      inline.pop();
    }
    if (inline.length) output.push(paragraph(inline));
    inline = [];
  };

  for (const child of children) {
    if (isPhrasing(child)) {
      inline.push(child as PhrasingContent);
      continue;
    }
    flush();
    output.push(child as RootContent);
  }
  flush();
  return output;
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMdx)
  .use(function stripComponents() {
    return (tree: Root) => {
      tree.children = liftToBlocks(transformChildren(tree.children as AnyContent[]));
    };
  })
  .use(remarkStringify, {
    bullet: '-',
    emphasis: '_',
    fences: true,
    resourceLink: false,
    rule: '-',
    // Author prose is reflowed by whatever renders it; keep source lines intact
    // so diffs and copied text stay readable.
    ruleSpaces: false,
  });

/** MDX source in, component-free GFM out. */
export function mdxToMarkdown(source: string): string {
  return String(processor.processSync(source)).trim();
}
