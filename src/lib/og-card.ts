/**
 * Share cards, drawn as SVG and rasterised to PNG at build time.
 *
 * PNG rather than SVG because no social platform or chat client renders an SVG
 * `og:image` — Slack, LinkedIn, X and iMessage all skip it, which is worse than
 * having no card at all. sharp already ships with Astro for image processing,
 * so rasterising costs no new dependency.
 *
 * The card is drawn rather than screenshotted: no headless browser, ~15 ms per
 * page, and it cannot break because a layout changed.
 *
 * Text uses a generic sans stack. The brand webfont is not installed on the
 * machine running the build — embedding it would mean base64-ing a woff2 into
 * the SVG and hoping librsvg honours it, which it inconsistently does. A card
 * that renders in the right shape with the wrong grotesque beats one that
 * renders blank.
 */
import { cpus } from 'node:os';
import sharp from 'sharp';
import { seo, site, theme } from '../docs.config';

const WIDTH = seo.imageWidth;
const HEIGHT = seo.imageHeight;
const FONT = 'Geist, Inter, Helvetica Neue, Helvetica, Arial, DejaVu Sans, sans-serif';

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] as string,
  );

/**
 * Wraps on an estimated advance width. A real text measurement would need the
 * font we have just established is not present, and titles here are short
 * enough that a per-character estimate is never off by more than a word.
 */
function wrap(text: string, fontSize: number, maxWidth: number, maxLines: number) {
  const perCharacter = fontSize * 0.55;
  const perLine = Math.max(1, Math.floor(maxWidth / perCharacter));
  const lines: string[] = [];
  let current = '';

  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= perLine) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);

  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    const overflow = text.split(/\s+/).join(' ').length > lines.join(' ').length;
    if (overflow) lines[maxLines - 1] = `${last.slice(0, perLine - 1).trimEnd()}…`;
  }
  return lines;
}

export interface CardOptions {
  title: string;
  /** The section above the title, e.g. "API reference · Projects". */
  eyebrow?: string;
  /** Sits under the title, wrapped over at most two lines. */
  description?: string;
}

/* The text column, inset from both edges. Everything below measures against
   this rather than the card width, so nothing can run off the right edge. */
const MARGIN = 100;
const COLUMN = WIDTH - MARGIN * 2;
const EYEBROW_BASELINE = 252;
const SUMMARY_SIZE = 27;

export function cardSvg({ title, eyebrow, description }: CardOptions) {
  const titleSize = title.length > 46 ? 62 : 76;
  const titleLines = wrap(title, titleSize, COLUMN, 3);
  /* Wrapped, not truncated: a description cut mid-clause reads as a bug. */
  const summaryLines = description ? wrap(description, SUMMARY_SIZE, COLUMN, 2) : [];

  const titleTop = EYEBROW_BASELINE + titleSize + 12;
  const titleBottom = titleTop + (titleLines.length - 1) * (titleSize * 1.16);
  const summaryTop = titleBottom + 58;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="wash" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${theme.accent.base}" stop-opacity="0.20"/>
      <stop offset="0.55" stop-color="${theme.accent.base}" stop-opacity="0.03"/>
      <stop offset="1" stop-color="${theme.accent.base}" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="${WIDTH}" height="${HEIGHT}" fill="#0a0a0a"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#wash)"/>
  <rect x="0" y="0" width="${WIDTH}" height="6" fill="${theme.accent.base}"/>

  <g transform="translate(${MARGIN} 92)">
    <rect width="46" height="46" rx="12" fill="${theme.accent.base}"/>
    <path fill="${theme.accent.contrast}" fill-rule="evenodd"
      d="M14.4 11.5h8.9a11.5 11.5 0 0 1 0 23h-8.9v-23Zm5.8 5.2v12.6h3.1a6.3 6.3 0 0 0 0-12.6h-3.1Z"/>
    <text x="66" y="31" font-family="${FONT}" font-size="27" font-weight="700" fill="#ffffff">${escape(site.name)}</text>
    <text x="${66 + site.name.length * 16 + 20}" y="30" font-family="${FONT}" font-size="16" font-weight="600"
      letter-spacing="1.6" fill="#8a8a8a">DOCUMENTATION</text>
  </g>

  ${eyebrow ? `<text x="${MARGIN}" y="${EYEBROW_BASELINE}" font-family="${FONT}" font-size="24" font-weight="600"
    letter-spacing="2" fill="${theme.accent.strongDark}">${escape(eyebrow.toUpperCase())}</text>` : ''}

  ${titleLines
    .map(
      (line, index) =>
        `<text x="${MARGIN}" y="${titleTop + index * (titleSize * 1.16)}" font-family="${FONT}" font-size="${titleSize}"
          font-weight="700" fill="#ffffff">${escape(line)}</text>`,
    )
    .join('\n  ')}

  ${summaryLines
    .map(
      (line, index) =>
        `<text x="${MARGIN}" y="${summaryTop + index * (SUMMARY_SIZE * 1.42)}" font-family="${FONT}"
          font-size="${SUMMARY_SIZE}" fill="#a8a8a8">${escape(line)}</text>`,
    )
    .join('\n  ')}

  <text x="${MARGIN}" y="${HEIGHT - 62}" font-family="${FONT}" font-size="24" fill="#6b6b6b">${escape(
    new URL(seo.organization.url).host,
  )}</text>
</svg>`;
}

/**
 * The rasterised card. Deterministic, so two builds produce identical bytes.
 *
 * `palette: true` is what makes these small: the card is flat colour and text,
 * so 256 indexed colours reproduce it exactly rather than approximately, at
 * roughly a third of the truecolour size.
 *
 * `effort` is the palette quantiser's search budget, and its default of 7 is
 * calibrated for photographs. Lowering it to 4 is a deliberate trade, measured
 * over 318 real cards rather than guessed: encoding runs in a little over half
 * the time, and the cards come out 4.5% larger. That took about six seconds off
 * a thirty-six second build and added 0.4 MB to `dist`.
 *
 * Worth taking here because the two costs are not paid by the same person or at
 * the same rate. Build time is paid on every deploy, by whoever is waiting;
 * card bytes are paid by a crawler or a social unfurl, rarely, behind a
 * day-long cache with stale-while-revalidate. Raise it back to 7 if you ever
 * care more about the bytes than the wait.
 */
export async function cardPng(options: CardOptions): Promise<Buffer> {
  return sharp(Buffer.from(cardSvg(options)))
    .png({ compressionLevel: 9, palette: true, effort: 4 })
    .toBuffer();
}

/**
 * How many cards may rasterise at once.
 *
 * Astro generates static routes one after another, awaiting each before it
 * starts the next. For a route whose work is a CPU-bound call into libvips that
 * is pure wall-clock waste: one core encodes while the rest of the machine
 * waits. Priming the cards concurrently, ahead of the routes that ask for them,
 * turns a sum into a maximum.
 *
 * Bounded rather than unbounded because the intermediate bitmap is the real
 * memory cost, not the PNG: 1200 × 630 at four bytes a pixel is about 3 MB per
 * card in flight, so a site with a few hundred pages would otherwise try to
 * hold all of them at once. Two cores are left for everything else the build is
 * doing.
 */
const CONCURRENCY = Math.max(2, Math.min(8, cpus().length - 2));

let active = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(job: () => Promise<T>): Promise<T> {
  if (active >= CONCURRENCY) await new Promise<void>(resolve => waiting.push(resolve));
  active++;
  try {
    return await job();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/** Cards already started, keyed by the path they will be served at. */
const primed = new Map<string, Promise<Buffer>>();

/**
 * Starts a card if it has not been started, and returns it either way.
 *
 * Both a warm-up and an accessor, deliberately: `getStaticPaths` calls it for
 * every page to start the work, and each route then calls it again for its own
 * card and gets the promise already in flight. One function means the route
 * cannot accidentally rasterise a second copy of something already primed —
 * which would be invisible, since the bytes are deterministic, and would simply
 * cost twice.
 */
export function primeCard(key: string, options: CardOptions): Promise<Buffer> {
  let card = primed.get(key);
  if (!card) {
    card = withSlot(() => cardPng(options));
    /* Nothing awaits this until a route does, so an early failure would be an
       unhandled rejection first and a build error second — with the rejection
       reported against no particular page. Kept alive here; the route still
       sees the rejection when it awaits. */
    card.catch(() => {});
    primed.set(key, card);
  }
  return card;
}
