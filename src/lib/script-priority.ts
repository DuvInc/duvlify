/**
 * Asks the browser to fetch the page's JavaScript after what paints it.
 *
 * Every script Astro emits is `type="module"`, so none of them blocks
 * rendering: they run once the document is parsed. But Chrome still fetches
 * them at High priority, alongside the stylesheet, the font and the opening
 * image, and on a slow phone connection they share the same bandwidth. The
 * text of the page then waits for bytes it does not need yet.
 *
 * `fetchpriority="low"` changes the order of downloads and nothing else: the
 * scripts still run, in the same order, as soon as they arrive. Measured on
 * the homepage under Lighthouse's mobile throttling: first paint 1.37s → 1.14s.
 *
 * Astro has no option for this attribute on the scripts it bundles, so it is
 * added to the built HTML. A script that already sets a priority is left as
 * written, and so is an inline script, which has nothing to fetch.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';

const MODULE_SCRIPT = /<script type="module"(?![^>]*\bfetchpriority=)(?=[^>]*\bsrc=)/g;

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) return htmlFiles(full);
    return item.name.endsWith('.html') ? [full] : [];
  });
}

export const lowerScriptPriority = (html: string) =>
  html.replace(MODULE_SCRIPT, '<script type="module" fetchpriority="low"');

export function lowPriorityScripts(): AstroIntegration {
  return {
    name: 'low-priority-scripts',
    hooks: {
      'astro:build:done': ({ dir }) => {
        for (const file of htmlFiles(fileURLToPath(dir))) {
          const html = readFileSync(file, 'utf8');
          const lowered = lowerScriptPriority(html);
          if (lowered !== html) writeFileSync(file, lowered);
        }
      },
    },
  };
}
