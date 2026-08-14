/**
 * Makes every content image cheap to load and impossible to shift the layout.
 *
 * Two attributes and two numbers, applied automatically so an author never has
 * to remember them:
 *
 *   loading="lazy"     an image below the fold costs nothing until scrolled to.
 *   decoding="async"   decoding happens off the main thread, so a large
 *                      screenshot cannot delay first paint.
 *   width / height     intrinsic dimensions, read from the file itself. This is
 *                      the one that matters: without them the browser reserves
 *                      no space, and the article jumps when each image arrives.
 *                      Cumulative Layout Shift is a ranking signal, and it is
 *                      also just unpleasant to read.
 *
 * Dimensions come from the file in public/, so they cannot disagree with it.
 *
 * That sentence used to be untrue, and the exception cost a real layout shift.
 * A bulk importer that re-encodes screenshots already knows the sizes it
 * produced, so it writes them to a manifest and this plugin trusted the
 * manifest ahead of the file — on the reasoning that re-deriving a number the
 * encoder already had meant parsing WebP's chunk layout for nothing.
 *
 * The flaw is that a manifest is a copy, and a copy goes stale. Replace one
 * screenshot without re-running the importer and the build keeps emitting the
 * old file's dimensions: a sibling site shipped `width="1265" height="1640"`
 * for an image that is actually 2398×1490, so the browser reserved a portrait
 * box for a landscape screenshot and the page jumped when it arrived — the
 * exact failure this plugin exists to prevent, caused by the optimisation meant
 * to serve it.
 *
 * So the file wins now, and the manifest is the fallback for anything the
 * sniffer cannot read. Parsing the chunk layout turned out to be twenty lines
 * (see `webpSize`), which is cheaper than a class of bug that only shows up as
 * a jumping page on someone else's deployment.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { basePath } from '../docs.config';
import type { Element, Root } from 'hast';

interface Parent {
  children?: unknown[];
}

type Size = { width: number; height: number };

const dimensions = new Map<string, Size | null>();

/** Written by the bulk importer, if there is one; absent until it has run. */
const manifest: Record<string, Size> = (() => {
  const file = path.resolve(process.cwd(), 'src/generated/image-manifest.json');
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
})();

/**
 * WebP dimensions, from whichever of the three chunk layouts the encoder used.
 *
 * Worth the twenty lines rather than a dependency, because WebP is the format
 * a screenshot should be in — and without this the plugin's whole purpose was
 * defeated for exactly those files. A hand-placed `.webp` got no width and no
 * height, so the browser reserved no space and the article jumped as each one
 * arrived. It only ever looked correct on a site whose bulk importer had left
 * an image manifest behind; the documented "sniffing the file is the fallback
 * for anything hand-placed" was true of PNG and SVG and of nothing else.
 *
 * All three layouts store width and height minus one, which is why each read
 * adds it back.
 */
function webpSize(header: Buffer): Size | null {
  const chunk = header.toString('ascii', 12, 16);

  /* Extended: 24-bit canvas dimensions, after a 1-byte flags field + 3 reserved. */
  if (chunk === 'VP8X') {
    return {
      width: header.readUIntLE(24, 3) + 1,
      height: header.readUIntLE(27, 3) + 1,
    };
  }

  /* Lossy: a 3-byte start code, then two 14-bit values with 2 scaling bits each. */
  if (chunk === 'VP8 ') {
    return {
      width: header.readUInt16LE(26) & 0x3fff,
      height: header.readUInt16LE(28) & 0x3fff,
    };
  }

  /* Lossless: 14 bits of width then 14 of height, packed into one little-endian
     word after the 1-byte signature. */
  if (chunk === 'VP8L') {
    const bits = header.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  return null;
}

/** Intrinsic size of a file in public/, or null if it cannot be determined. */
function intrinsicSize(src: string) {
  if (dimensions.has(src)) return dimensions.get(src)!;

  let result: Size | null = null;
  /*
   * `src` is a URL and carries `basePath`; `public/` is a directory and does
   * not. On a site served under `/docs`, `/docs/screenshots/x.webp` lives at
   * `public/screenshots/x.webp`, so resolving the URL verbatim looks for a
   * `public/docs/` that has never existed — `existsSync` says no, the file is
   * never read, and every image silently falls through to whatever the manifest
   * happens to say. That is how a sibling site emitted a stale portrait size
   * for a landscape screenshot: not because the manifest was consulted first,
   * but because it was the only thing that could answer at all.
   */
  const onDisk = basePath && src.startsWith(`${basePath}/`) ? src.slice(basePath.length) : src;
  const file = path.resolve(process.cwd(), 'public', onDisk.replace(/^\//, ''));

  if (src.startsWith('/') && existsSync(file)) {
    if (file.endsWith('.svg')) {
      const source = readFileSync(file, 'utf8').slice(0, 2000);
      const box = source.match(/viewBox\s*=\s*["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)/);
      const width = source.match(/\bwidth\s*=\s*["'](\d+)/);
      const height = source.match(/\bheight\s*=\s*["'](\d+)/);
      if (width && height) result = { width: Number(width[1]), height: Number(height[1]) };
      else if (box) result = { width: Math.round(Number(box[1])), height: Math.round(Number(box[2])) };
    } else {
      const header = readFileSync(file);
      /* PNG stores its dimensions in the IHDR chunk, at a fixed offset. */
      if (header.length > 24 && header.toString('ascii', 1, 4) === 'PNG') {
        result = { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
      } else if (header.length > 30 && header.toString('ascii', 0, 4) === 'RIFF'
        && header.toString('ascii', 8, 12) === 'WEBP') {
        result = webpSize(header);
      }
    }
  }

  /* Only if the file could not be read or its format is not one of the three
     above. A manifest entry is a copy of what some earlier tool measured, so it
     is trusted last and never against the file's own answer. */
  result ??= manifest[src] ?? null;

  dimensions.set(src, result);
  return result;
}

/**
 * An image reaches this plugin in one of two shapes, and both occur in this
 * content set. `![alt](src)` becomes a hast element with `properties`; an
 * `<img>` written as JSX — which is how any image inside a `<Frame>` is
 * written — stays an MDX node with an `attributes` array. Handling only the
 * first silently skips exactly the images that matter most.
 */
interface JsxAttribute {
  type: string;
  name?: string;
  value?: unknown;
}
interface JsxNode {
  type: string;
  name?: string;
  attributes?: JsxAttribute[];
}

const isJsxImage = (node: JsxNode) =>
  (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') && node.name === 'img';

function applyToJsx(node: JsxNode) {
  const attributes = (node.attributes ??= []);
  const named = (name: string) =>
    attributes.find(attribute => attribute.type === 'mdxJsxAttribute' && attribute.name === name);
  const set = (name: string, value: string | number) => {
    if (!named(name)) attributes.push({ type: 'mdxJsxAttribute', name, value: String(value) });
  };

  set('loading', 'lazy');
  set('decoding', 'async');

  const src = named('src')?.value;
  if (typeof src !== 'string' || named('width') || named('height')) return;
  const size = intrinsicSize(src);
  if (size) {
    set('width', size.width);
    set('height', size.height);
  }
}

function applyToElement(node: Element) {
  node.properties.loading ??= 'lazy';
  node.properties.decoding ??= 'async';

  const src = node.properties.src;
  if (typeof src !== 'string' || node.properties.width || node.properties.height) return;
  const size = intrinsicSize(src);
  if (size) {
    node.properties.width = size.width;
    node.properties.height = size.height;
  }
}

export function rehypeImages() {
  return (tree: Root) => {
    const visit = (node: Parent) => {
      if (!Array.isArray(node.children)) return;
      for (const child of node.children as (Element & JsxNode)[]) {
        if (!child) continue;
        if (child.type === 'element' && child.tagName === 'img') applyToElement(child);
        else if (isJsxImage(child)) applyToJsx(child);
        /* Recurse regardless: most content images live inside a <Frame>, which
           is itself an MDX node rather than a plain element. */
        else visit(child as Parent);
      }
    };
    visit(tree);
  };
}
