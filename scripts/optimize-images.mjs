#!/usr/bin/env node
/**
 * Brings oversized screenshots down to the size the layout can actually use.
 *
 * The problem this solves is invisible in the markup and obvious in a profiler.
 * A screenshot exported from a retina display arrives around 2400–2900px wide,
 * the reading column is 712px, and the browser downscales the difference for
 * free — so nothing looks wrong and every reader pays for pixels no screen ever
 * shows. On one real site that was 1.3 MB of screenshots delivering about 500 KB
 * of usable detail.
 *
 * Resizing is the whole win, and re-encoding is not. Measured on a real
 * screenshot: re-encoding at its native size saved 2 KB of 96 KB, because a
 * WebP out of a screenshot tool is already well compressed. Anyone reaching for
 * "compress the images harder" is reaching for the wrong lever; the bytes are in
 * the dimensions.
 *
 *   Usage:  npm run images:optimize
 *           npm run images:check      (CI: fail if anything is oversized)
 *
 * Idempotent: a second run finds nothing to do, because every file is already
 * at or under the cap. Safe to run on a dirty tree — it rewrites files in place,
 * and git is the undo.
 */

import { readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

/**
 * The widest a content image needs to be, in pixels.
 *
 * Derived from the two things that display one, taking the larger:
 *
 *   The article. The reading column is 712px, less 2×8px of frame padding, so
 *   696px — and 1392px covers that at 2× device pixel ratio, which is every
 *   retina laptop and phone. A phone is *narrower*, so it never needs more.
 *
 *   The lightbox. Clicking a screenshot opens it at up to 92vw × 92vh, and
 *   height is what binds on a landscape image: 92vh of a 900px-tall laptop is
 *   828px, which at a 1.6 aspect ratio asks for about 1330px. A 14-inch retina
 *   laptop asks for roughly 1650px.
 *
 * 1600 sits above the article's 1392 with room to spare and covers the lightbox
 * on everything short of a desktop display turned sideways. Going lower would
 * start to soften the lightbox, which exists precisely so a reader can zoom in
 * and read the UI in the screenshot — that is the feature this must not trade
 * away for bytes.
 *
 * Raise it if a site's diagrams are genuinely wider than its screenshots; the
 * test guard reads this same constant, so both move together.
 */
export const MAX_WIDTH = 1600;

/**
 * Quality for the re-encode.
 *
 * Higher than a photo would need. These are screenshots of user interfaces, so
 * the content is small text and hairline borders — exactly what a lossy encoder
 * smears first, and exactly what a reader opened the lightbox to read. The
 * saving between 82 and 78 measured 9 KB on a 96 KB file, which is not worth
 * softening a label for.
 */
const QUALITY = 82;

const EXTENSIONS = new Set(['.webp', '.png', '.jpg', '.jpeg']);

/** Every raster image under public/, with its path relative to it. */
function rasterImages(dir = PUBLIC) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) return rasterImages(full);
    return EXTENSIONS.has(path.extname(item.name).toLowerCase()) ? [full] : [];
  });
}

/**
 * Images wider than the cap, measured rather than assumed.
 *
 * Exported because the test guard asserts this list is empty, so the check and
 * the fix cannot disagree about what counts as oversized.
 */
export async function oversized() {
  const found = [];
  for (const file of rasterImages()) {
    /* A file sharp cannot read is not this script's problem to report. */
    const meta = await sharp(file).metadata().catch(() => null);
    if (!meta?.width || meta.width <= MAX_WIDTH) continue;
    found.push({
      file: path.relative(ROOT, file),
      width: meta.width,
      height: meta.height,
      bytes: statSync(file).size,
    });
  }
  return found;
}

const kb = bytes => `${Math.round(bytes / 1024)} KB`;

async function main() {
  const check = process.argv.includes('--check');
  const found = await oversized();

  if (!found.length) {
    console.log(`optimize-images: nothing over ${MAX_WIDTH}px wide.`);
    return;
  }

  if (check) {
    console.log(`optimize-images: ${found.length} image(s) wider than ${MAX_WIDTH}px:\n`);
    for (const item of found) {
      console.log(`  ${item.width}x${item.height}  ${kb(item.bytes).padStart(7)}  ${item.file}`);
    }
    console.log('\nRun `npm run images:optimize` to resize them.');
    process.exitCode = 1;
    return;
  }

  let before = 0;
  let after = 0;
  for (const item of found) {
    const absolute = path.join(ROOT, item.file);
    /* Re-encoded to the same format it already was: this script's job is the
       dimensions, and changing a file's extension would break every page that
       links to it. */
    const format = path.extname(item.file).toLowerCase() === '.png' ? 'png' : 'webp';
    const pipeline = sharp(absolute).resize({ width: MAX_WIDTH, withoutEnlargement: true });
    const output = await (format === 'png'
      ? pipeline.png({ compressionLevel: 9 })
      : pipeline.webp({ quality: QUALITY, effort: 6 })
    ).toBuffer();

    /* Written only if it actually helped. Re-encoding can grow a file that was
       already near-optimal, and shipping a bigger image would be worse than
       leaving a wide one. */
    if (output.length >= item.bytes) {
      console.log(`  kept   ${item.file} (re-encode was no smaller)`);
      continue;
    }
    writeFileSync(absolute, output);
    before += item.bytes;
    after += output.length;
    console.log(
      `  ${item.width}px → ${MAX_WIDTH}px  ${kb(item.bytes)} → ${kb(output.length)}  ${item.file}`,
    );
  }

  if (before) {
    const saved = Math.round(((before - after) / before) * 100);
    console.log(`\noptimize-images: ${kb(before)} → ${kb(after)} (${saved}% smaller).`);
    console.log('Rebuild so the pages pick up the new dimensions.');
  }
}

/* Importable by the test guard without running the CLI. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
