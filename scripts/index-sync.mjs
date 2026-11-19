#!/usr/bin/env node
/**
 * Pushes the built documentation into a Cloudflare AI Search instance.
 *
 * Runs after `astro build`, and only when `agents.retrieval` is `'ai-search'`.
 * The lexical retriever needs nothing from this script, which is why the site
 * ships working before anyone has provisioned anything.
 *
 * What it uploads is the same Markdown the site serves at `<page>.md` — the
 * bytes `dist/agent-manifest.json` counted lines against. That is not a detail:
 * the Worker recovers a passage's position by finding AI Search's chunk text
 * back inside that file, so uploading a different rendering would break every
 * line range silently.
 *
 * Deliberately not a crawler. Cloudflare can index a site by fetching it, and
 * for this site that would be a round trip through HTML we generated ourselves,
 * losing the fields we want to filter on — page type, navigation tab, git date,
 * locale, version — none of which survive rendering.
 *
 *   Usage:  CLOUDFLARE_ACCOUNT_ID=… AI_SEARCH_TOKEN=… node scripts/index-sync.mjs
 *           node scripts/index-sync.mjs --dry-run
 *           node scripts/index-sync.mjs --force     # re-upload every selected page
 *           node scripts/index-sync.mjs --prune     # allow deleting > 1/3 of indexed items
 *
 * The token needs AI Search:Edit and AI Search:Run, and is a different token
 * from the one `wrangler` holds — create it under AI → AI Search → Tokens.
 * A git-connected Cloudflare build needs neither configured: Workers Builds
 * supplies its own token to the build, which `TOKEN` picks up below.
 *
 * ── Only what changed ────────────────────────────────────────────────────────
 *
 * Each upload carries a digest of the page's content and filter metadata in the
 * `version` metadata field. The next run reads those back and skips any page
 * whose digest still matches, so a deploy that touched nine pages uploads nine
 * rather than the whole corpus.
 *
 * The digest deliberately excludes `updated` (both the metadata field and the
 * `updated:` line in the frontmatter block). AI Search never filters on it, and
 * excluding it prevents a date-only shift — such as a shallow CI checkout that
 * could not unshallow, or a history rewrite — from re-ingesting every page.
 *
 * Items already `queued` or `running` with the matching digest and no error are
 * also skipped: Cloudflare chunks and embeds asynchronously over several
 * minutes, so back-to-back deploys would otherwise re-upload and double-bill
 * identical content that is already in flight.
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadEnvFile } from './env-file.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
/* How many times one page is tried before the run gives up on it. Seven with
   the backoff below spends about a minute on a page the API keeps refusing,
   which is the length of dip we have actually seen — five attempts capped at
   four seconds gave up inside a twelve-second `503` stretch and failed a
   deploy. Only a failing page pays this; a healthy run never waits. */
const ATTEMPTS = 7;

/**
 * Reads retrieval and locale settings straight out of src/docs.config.ts.
 *
 * By regex rather than by import: this is a plain Node script and the config is
 * a TypeScript module that pulls in Astro types. Anchored to `export const`
 * declarations so examples in comments are never mistaken for live config.
 */
export function readConfigFromSource(source) {
  const agentsBlock = source.match(/^export const agents(?::\s*\w+)?\s*=\s*\{([\s\S]*?)\n\};/m)?.[1] ?? source;
  const retrieval = agentsBlock.match(/^\s*retrieval:\s*'([^']+)'/m)?.[1] ?? 'lexical';
  const instance = agentsBlock.match(/^\s*aiSearchInstance:\s*'([^']+)'/m)?.[1];
  const aiSearchLocales = agentsBlock.match(/^\s*aiSearchLocales:\s*'([^']+)'/m)?.[1] ?? 'default';
  const enabled = !/^\s*enabled:\s*false\s*,/m.test(agentsBlock);

  const i18nBlock = source.match(/^export const i18n(?::\s*\w+)?\s*=\s*\{([\s\S]*?)\n\};/m)?.[1] ?? '';
  const defaultLocale = i18nBlock.match(/^\s*defaultLocale:\s*'([^']+)'/m)?.[1] ?? 'en';

  return { retrieval, instance, aiSearchLocales, defaultLocale, enabled };
}

/**
 * Filters manifest pages down to the locales configured for AI Search.
 *
 * `'default'` keeps only the primary language so multilingual sites do not pay
 * an N-times ingestion multiplier; other locales use the built-in lexical index.
 */
export function selectPagesForIndex(pages, { aiSearchLocales = 'default', defaultLocale = 'en' } = {}) {
  if (aiSearchLocales === 'all') return pages;
  return pages.filter(page => (page.locale ?? defaultLocale) === defaultLocale);
}

/**
 * Removes the volatile `updated:` line from a page's leading YAML frontmatter
 * before hashing. Body prose and code blocks are untouched.
 */
export function stripVolatileFrontmatter(markdown) {
  return markdown.replace(/^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/, (_block, header) => {
    const stable = header
      .split(/\r?\n/)
      .filter(line => !/^updated:\s/.test(line))
      .join('\n');
    return `---\n${stable}\n---`;
  });
}

/**
 * Stable content + filter-metadata digest stored in `metadata.version`.
 *
 * Excludes `updated` and `version`, and sorts metadata keys so a reordering in
 * source never reads as a corpus-wide change.
 *
 * Deliberately not the API's own `checksum` field: freshly created items have
 * reported `"0"` on live instances rather than a digest of the uploaded bytes.
 */
export function digestOf(markdown, metadata) {
  const stableMetadata = Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => key !== 'updated' && key !== 'version')
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return createHash('md5')
    .update(stripVolatileFrontmatter(markdown))
    .update('\u0000')
    .update(JSON.stringify(stableMetadata))
    .digest('hex');
}

const HEALTHY_STATUSES = new Set(['completed', 'queued', 'running']);

/**
 * Whether this page can be left alone.
 *
 * Skips items that already hold this exact digest and are either completed or
 * actively being processed without error. Errored, outdated, or missing items
 * are always re-uploaded.
 */
export function isUnchanged(entry, indexedByKey, { force = false } = {}) {
  if (force) return false;
  const item = indexedByKey.get(entry.page.id);
  if (!item) return false;
  if (!HEALTHY_STATUSES.has(item.status) || item.error) return false;
  return item.metadata?.version === entry.digest;
}

/**
 * Run `task` over `items` with a bounded number in flight.
 *
 * A lane takes the next item when it finishes its own, so one slow upload does
 * not hold back the rest — which a chunked `Promise.all` would.
 */
async function inLanes(items, lanes, task) {
  const queue = [...items];
  const worker = async () => {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(lanes, items.length || 1)) }, worker));
}

async function main() {
  const DRY_RUN = process.argv.includes('--dry-run');
  const FORCE = process.argv.includes('--force');
  const PRUNE = process.argv.includes('--prune');

  /* `.env` is not loaded by Node on its own, and this plain script never passes
     through Vite. `loadEnvFile` fills in missing keys while letting real shell
     variables win. */
  loadEnvFile(ROOT);

  const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
  const TOKEN = process.env.AI_SEARCH_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN;

  function fail(message) {
    console.error(`index-sync: ${message}`);
    process.exit(1);
  }

  const configSource = readFileSync(path.join(ROOT, 'src', 'docs.config.ts'), 'utf8');
  const { retrieval, instance, aiSearchLocales, defaultLocale, enabled } = readConfigFromSource(configSource);

  if (!enabled) {
    console.log('index-sync: agent surfaces are disabled, nothing to upload. Skipping.');
    process.exit(0);
  }
  if (retrieval !== 'ai-search') {
    console.log(`index-sync: retrieval is '${retrieval}', nothing to upload. Skipping.`);
    process.exit(0);
  }
  if (!instance) fail('agents.aiSearchInstance is not set in src/docs.config.ts.');
  if (!DRY_RUN && (!ACCOUNT || !TOKEN)) {
    fail('CLOUDFLARE_ACCOUNT_ID and AI_SEARCH_TOKEN must be set (or pass --dry-run).');
  }

  const manifestPath = path.join(DIST, 'agent-manifest.json');
  if (!existsSync(manifestPath)) fail('dist/agent-manifest.json is missing — run `npm run build` first.');

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const selectedPages = selectPagesForIndex(manifest.pages, { aiSearchLocales, defaultLocale });
  const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai-search/instances/${instance}/items`;

  /* Every page, read and digested before the first request goes out, so a
     concurrent rebuild of `dist/` cannot fail a sync mid-corpus. */
  const corpus = selectedPages.map(page => {
    const file = path.join(DIST, `${page.id}.md`);
    if (!existsSync(file)) {
      fail(
        `dist/${page.id}.md is missing, though the manifest lists it. ` +
          'Re-run `npm run build`; nothing was uploaded.',
      );
    }
    const markdown = readFileSync(file, 'utf8');
    const metadata = {
      type: page.type,
      tab: page.tab,
      locale: page.locale ?? defaultLocale,
      ...(page.updated ? { updated: `${page.updated}T00:00:00Z` } : {}),
    };
    const digest = digestOf(markdown, metadata);
    return { page, markdown, metadata: { ...metadata, version: digest }, digest };
  });

  async function listItems() {
    const items = [];
    for (let page = 1; page <= 200; page += 1) {
      let response;
      try {
        response = await fetch(`${base}?page=${page}&per_page=50`, {
          headers: { Authorization: `Bearer ${TOKEN}` },
        });
      } catch (error) {
        console.error(`index-sync: could not list items (${error.cause?.code ?? error.message}).`);
        return null;
      }
      if (!response.ok) {
        console.error(`index-sync: could not list items (${response.status}).`);
        return null;
      }
      const body = await response.json();
      items.push(...body.result);
      if (body.result.length < 50) break;
    }
    return items;
  }

  async function upload({ page, markdown, metadata }) {
    if (DRY_RUN) {
      console.log(`  would upload ${page.id.padEnd(46)} ${markdown.length} bytes  ${JSON.stringify(metadata)}`);
      return true;
    }

    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const form = new FormData();
      form.append('file', new Blob([markdown], { type: 'text/markdown' }), `${page.id}.md`);
      form.append('key', page.id);
      form.append('metadata', JSON.stringify(metadata));

      try {
        const response = await fetch(base, {
          method: 'POST',
          headers: { Authorization: `Bearer ${TOKEN}` },
          body: form,
        });

        if (response.ok) {
          console.log(`  ✓ ${page.id}`);
          return true;
        }

        const detail = (await response.text()).slice(0, 200);
        if (response.status < 500 && response.status !== 429) {
          console.error(`  ✗ ${page.id}: ${response.status} ${detail}`);
          return false;
        }
        console.error(`  … ${page.id}: ${response.status}, retrying (${attempt}/${ATTEMPTS})`);
      } catch (error) {
        console.error(
          `  … ${page.id}: ${error.cause?.code ?? error.message}, retrying (${attempt}/${ATTEMPTS})`,
        );
      }

      if (attempt < ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, Math.min(2 ** attempt * 500, 30_000)));
      }
    }

    console.error(`  ✗ ${page.id}: gave up after ${ATTEMPTS} attempts`);
    return false;
  }

  const localeNote =
    selectedPages.length < manifest.pages.length
      ? ` (${defaultLocale} only, of ${manifest.pages.length} total)`
      : '';
  console.log(
    `index-sync: ${DRY_RUN ? 'dry run — ' : ''}${corpus.length} pages${localeNote} → AI Search instance "${instance}"`,
  );

  const indexed = DRY_RUN && (!ACCOUNT || !TOKEN) ? null : await listItems();
  const indexedByKey = new Map((indexed ?? []).map(item => [item.key.replace(/\.md$/, ''), item]));

  if (indexed === null && !FORCE) {
    console.error('index-sync: uploading everything, since the current index could not be read.');
  }

  const changed = corpus.filter(entry => !isUnchanged(entry, indexedByKey, { force: FORCE }));
  const skipped = corpus.length - changed.length;

  if (skipped) {
    console.log(`index-sync: ${skipped} page(s) already current, ${changed.length} to upload.`);
  } else if (indexed !== null && indexed.length && !FORCE) {
    console.log(`index-sync: ${changed.length} page(s) to upload.`);
  }

  const UPLOAD_LANES = Number(process.env.INDEX_SYNC_LANES ?? 6);

  let failures = 0;
  await inLanes(changed, UPLOAD_LANES, async entry => {
    if (!(await upload(entry))) failures += 1;
  });

  const TOLERATED = Math.max(3, Math.ceil(changed.length * 0.05));
  if (failures > TOLERATED) {
    fail(
      `${failures} of ${changed.length} pages failed to upload — too many to be a bad stretch. ` +
        'Check the token and that the instance still exists.',
    );
  }
  if (failures) {
    console.error(
      `index-sync: ${failures} of ${changed.length} page(s) failed to upload and are one version ` +
        'behind in the index. The site itself is unaffected, and the next deploy re-uploads them ' +
        'because their digests were never stored. Continuing.',
    );
  }
  console.log(
    changed.length
      ? `index-sync: ${changed.length - failures} page(s) uploaded${
          failures ? `, ${failures} failed` : ''
        }${skipped ? `, ${skipped} unchanged` : ''}.`
      : 'index-sync: nothing to upload — every page is already current.',
  );

  /* Deleting what the selected corpus no longer claims. */
  if (indexed === null) {
    console.error('index-sync: skipping cleanup, since the index could not be listed.');
    return;
  }

  const published = new Set(selectedPages.map(page => page.id));
  const stale = indexed.filter(item => !published.has(item.key.replace(/\.md$/, '')));
  if (!stale.length) {
    console.log(`index-sync: no stale items (${indexed.length} in the index).`);
    return;
  }

  if (!PRUNE && stale.length > indexed.length / 3) {
    console.error(
      `index-sync: ${stale.length} of ${indexed.length} items look stale — too many to be a routine edit. ` +
        'Leaving the index alone; re-run with --prune if this reduction is intentional.',
    );
    return;
  }

  await inLanes(stale, UPLOAD_LANES, async item => {
    if (DRY_RUN) {
      console.log(`  would delete ${item.key}`);
      return;
    }
    const response = await fetch(`${base}/${item.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    console.log(response.ok ? `  ⌫ ${item.key}` : `  ✗ delete ${item.key}: ${response.status}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
