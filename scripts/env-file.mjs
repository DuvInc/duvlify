/**
 * Loads `.env` into `process.env`, for the code that runs before Vite does.
 *
 * Node does not read `.env` on its own, and Vite — which does — only applies it
 * to the module graph it compiles. `astro.config.ts` is evaluated to build that
 * graph, so it is outside it; `scripts/*.mjs` never enter it at all. Both need
 * this, which is why it lives here rather than inline in either.
 *
 * A real environment variable — the shell, or a CI secret — always wins over a
 * line in the file, so existing values are never overwritten. That ordering is
 * what lets CI set SITE_URL without a developer's local `.env` overriding it.
 *
 * No dependency: the format is a few lines to parse, and a documentation
 * framework should not add one to read five keys.
 *
 * This used to be inline in scripts/index-sync.mjs, whose comment claimed it was
 * "the one place in this codebase that understands `.env` files". That was true
 * and it was the bug: `.env.example` tells the reader to put SITE_URL in `.env`,
 * and the build never read it, so `npm run deploy` published a whole site
 * canonicalised to the placeholder host — 22 sitemap rows and every canonical tag
 * naming docs.example.com — while the deploy log looked perfect. Two readers of
 * one file disagreeing is a bug waiting for a quiet day; one function is not.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Reads `<root>/.env` if it exists. Absent file is not an error. */
export function loadEnvFile(root) {
  const file = path.join(root, '.env');
  if (!existsSync(file)) return;

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!match) continue;
    const [, key, rawValue = ''] = match;
    if (process.env[key] !== undefined) continue;
    const trimmed = rawValue.trim();
    const quoted = /^"(.*)"$|^'(.*)'$/.exec(trimmed);
    process.env[key] = quoted ? (quoted[1] ?? quoted[2]) : trimmed;
  }
}
