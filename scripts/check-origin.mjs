#!/usr/bin/env node
/**
 * Refuses to deploy a build that still names the placeholder origin.
 *
 * This exists because it happened. `.env` held the right SITE_URL, `astro.config.ts`
 * read only `process.env`, and nothing connected the two — so `npm run deploy`
 * built a site whose every canonical tag, all 22 sitemap rows, `llms.txt` and the
 * agent manifest named docs.example.com, uploaded it, and printed a deploy log
 * with nothing wrong in it. The site looked perfect and pointed every crawler and
 * every agent at a host nobody owns.
 *
 * scripts/env-file.mjs fixed the cause. This is the check that would have caught
 * it anyway, and still catches the next way in: a CI job that forgets the
 * variable, a shell that exports an empty string, a fork that never set it.
 *
 * It reads the built sitemap rather than `process.env`, because the sitemap is the
 * output and the variable is only one route into it. `sitemap.xml` holds nothing
 * but URLs, which is what makes it the right file to look at — the placeholder
 * appears legitimately in the prose of the deployment guide, so a check over pages
 * would have to tell documentation from configuration. This one does not.
 *
 *   Usage:  node scripts/check-origin.mjs      (runs inside `npm run deploy`)
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The fallback in astro.config.ts, which imports it from here so that the value
 * this check looks for and the value the build emits cannot drift apart.
 */
export const PLACEHOLDER_ORIGIN = 'https://docs.example.com';

/**
 * Warns at the end of every build that still resolves to the placeholder.
 *
 * The deploy guard below is not enough on its own, because `npm run deploy` is
 * only one way out of this repository. The deployment guide documents five others
 * — Netlify, Vercel, Cloudflare Pages, S3, any origin you run — and every one of
 * them is `npm run build` followed by uploading `dist/`. That path never reaches
 * the guard, so without this the most portable way to publish is also the only
 * one with nothing watching it.
 *
 * A warning rather than an error, deliberately. A fresh clone has to build and
 * pass its tests with nothing configured — that promise is in README.md and it is
 * worth keeping — so this cannot be fatal. It is printed last, after the build
 * summary, because a warning in the middle of 127 asset lines is a warning nobody
 * reads.
 */
export function warnOnPlaceholderOrigin() {
  let site;
  return {
    name: 'duvlify:check-origin',
    hooks: {
      'astro:config:done': ({ config }) => {
        site = config.site;
      },
      'astro:build:done': ({ logger }) => {
        if (String(site ?? '').replace(/\/$/, '') !== PLACEHOLDER_ORIGIN) return;
        logger.warn(
          `this build names the placeholder origin, ${PLACEHOLDER_ORIGIN}\n` +
            `  Every canonical tag, sitemap URL, llms.txt entry and share-card link in\n` +
            `  dist/ points there. Uploading it publishes a site that looks healthy and\n` +
            `  sends every crawler and every agent to a host nobody owns.\n` +
            `  Set the real origin in .env or in your host's build environment:\n` +
            `    SITE_URL=https://docs.your-domain.com\n` +
            `  \`npm run deploy\` refuses to upload without it. Uploading dist/ by hand,\n` +
            `  or through a git-connected build, does not — so this is the only notice.`,
        );
      },
    },
  };
}

/* Only run the check when invoked as a script, so astro.config.ts can import the
   constant above without a build turning into a deploy gate. */
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const root = path.resolve(import.meta.dirname, '..');
  const sitemap = path.join(root, 'dist', 'sitemap.xml');

  if (!existsSync(sitemap)) {
    console.error('check-origin: dist/sitemap.xml is missing — run `npm run build` first.');
    process.exit(1);
  }

  const host = new URL(PLACEHOLDER_ORIGIN).host;
  const rows = readFileSync(sitemap, 'utf8').match(new RegExp(`<loc>[^<]*${host}[^<]*</loc>`, 'g'));

  if (rows) {
    console.error(
      `check-origin: refusing to deploy. ${rows.length} sitemap URL${rows.length === 1 ? '' : 's'} still name ${host}.\n` +
        `  ${rows[0].replace(/<\/?loc>/g, '')}\n` +
        `\n` +
        `  Every canonical tag, llms.txt entry and agent manifest URL in this build\n` +
        `  names that host too. Deploying it publishes a site that points crawlers and\n` +
        `  agents somewhere nobody owns, and it looks entirely healthy while doing it.\n` +
        `\n` +
        `  Set the real origin, then rebuild:\n` +
        `    SITE_URL=https://docs.your-domain.com npm run deploy\n` +
        `  or put the same line in .env, which the build now reads.`,
    );
    process.exit(1);
  }

  console.log('check-origin: the build names a real origin.');
}
