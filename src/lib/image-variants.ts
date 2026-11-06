/**
 * A narrower copy of every wide content image, offered to phones through
 * `srcset`, so a phone stops downloading the 1600px screenshot a laptop needs.
 *
 * Measured on the homepage screenshot: 74 KB at 1600px, 23 KB at 800px. A
 * mid-range Android phone (412px wide, 1.75 device pixel ratio) needs 721px,
 * so it takes the 800px copy. A 3x iPhone needs about 1170px and still takes
 * the original, which is right: it can show those pixels. The lightbox always
 * opens the original (see initLightbox in src/scripts/copy.ts), because it
 * exists so a reader can zoom in and read the interface in the screenshot.
 *
 * Two halves, kept in one file so they cannot disagree on the naming:
 *
 *   `responsiveAttributes`  called by rehype-images while pages render. It only
 *                           names the copy; it never touches the disk.
 *   `imageVariants`         an integration that runs after the build, finds
 *                           every copy the HTML asks for, and writes the
 *                           missing ones from the original in `dist/`.
 *
 * Generated rather than committed: the copies are derived bytes, and a site
 * that migrates two thousand screenshots should not have to commit two
 * thousand more. They are cached under node_modules/.cache, keyed by the
 * original's bytes, so a rebuild only encodes images that changed.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import sharp from 'sharp';

/** The copy's width, in pixels. */
export const VARIANT_WIDTH = 800;

/**
 * Below this, the original is close enough to the copy that a second file
 * saves too little to be worth a request's worth of bookkeeping.
 */
const MIN_ORIGINAL_WIDTH = 1000;

const RESIZABLE = /\.(webp|png|jpe?g|avif)$/i;

/**
 * The reading column is 712px wide (`--content` in tokens.css); under 760px
 * the article takes the whole viewport. Overstating a little is harmless: the
 * browser just picks the next size up.
 */
const SIZES = '(max-width: 760px) 100vw, 712px';

/** `/screenshots/x.webp` → `/screenshots/x.800w.webp`. */
export const variantSrc = (src: string) => src.replace(RESIZABLE, `.${VARIANT_WIDTH}w$&`);

const VARIANT = new RegExp(`\\.${VARIANT_WIDTH}w(\\.(?:webp|png|jpe?g|avif))$`, 'i');

/**
 * `srcset` and `sizes` for a local image of a known width, or null when a copy
 * would not help: a remote image, a vector, or one already narrow enough.
 */
export function responsiveAttributes(src: string, width: number | undefined) {
  if (!src.startsWith('/') || !RESIZABLE.test(src) || !width || width < MIN_ORIGINAL_WIDTH) return null;
  return {
    srcset: `${variantSrc(src)} ${VARIANT_WIDTH}w, ${src} ${width}w`,
    sizes: SIZES,
  };
}

/** Every file under `dir`, recursively. */
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const full = path.join(dir, item.name);
    return item.isDirectory() ? files(full) : [full];
  });
}

/** Quality per format, matching scripts/optimize-images.mjs for WebP. */
const ENCODE = {
  webp: { quality: 82 },
  avif: { quality: 60 },
  jpeg: { quality: 82, mozjpeg: true },
  png: { compressionLevel: 9 },
} as const;

export function imageVariants({ basePath = '' }: { basePath?: string } = {}): AstroIntegration {
  return {
    name: 'image-variants',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const dist = fileURLToPath(dir);
        const cache = path.resolve('node_modules/.cache/image-variants');

        /* What the pages ask for, read back from the HTML, so a copy exists if
           and only if something references it. */
        const wanted = new Set<string>();
        for (const file of files(dist).filter(name => name.endsWith('.html'))) {
          for (const [, set] of readFileSync(file, 'utf8').matchAll(/srcset="([^"]+)"/g)) {
            for (const candidate of set.split(',')) {
              const url = candidate.trim().split(/\s+/)[0];
              if (VARIANT.test(url)) wanted.add(basePath && url.startsWith(`${basePath}/`) ? url.slice(basePath.length) : url);
            }
          }
        }
        if (!wanted.size) return;

        mkdirSync(cache, { recursive: true });
        let encoded = 0;
        const missing: string[] = [];

        for (const url of wanted) {
          const target = path.join(dist, url);
          const original = target.replace(VARIANT, '$1');
          if (!existsSync(original)) {
            missing.push(url);
            continue;
          }
          const bytes = readFileSync(original);
          const ext = path.extname(original).slice(1).toLowerCase();
          const key = createHash('sha256').update(bytes).update(String(VARIANT_WIDTH)).digest('hex').slice(0, 32);
          const cached = path.join(cache, `${key}.${ext}`);

          if (!existsSync(cached)) {
            const format = ext === 'jpg' ? 'jpeg' : (ext as keyof typeof ENCODE);
            writeFileSync(
              cached,
              await sharp(bytes)
                .resize({ width: VARIANT_WIDTH, withoutEnlargement: true })
                .toFormat(format, ENCODE[format])
                .toBuffer(),
            );
            encoded++;
          }
          copyFileSync(cached, target);
        }

        /* A copy the HTML names but that cannot be made would be a broken
           image on every phone, so the build stops rather than ship it. */
        if (missing.length) {
          throw new Error(`image-variants: no original for ${missing.slice(0, 5).join(', ')}`);
        }
        logger.info(`${wanted.size} narrow copies (${encoded} encoded, ${wanted.size - encoded} from cache)`);
      },
    },
  };
}
