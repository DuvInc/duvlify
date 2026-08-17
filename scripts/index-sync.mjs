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
 * losing the five things we actually want to filter on — the page type, its
 * navigation tab, its real git date, its locale, its version — none of which
 * survive rendering.
 *
 *   Usage:  CLOUDFLARE_ACCOUNT_ID=… AI_SEARCH_TOKEN=… node scripts/index-sync.mjs
 *           node scripts/index-sync.mjs --dry-run
 *
 * The token needs AI Search:Edit and AI Search:Run, and is a different token
 * from the one `wrangler` holds — create it under AI → AI Search → Tokens.
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { loadEnvFile } from './env-file.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

/*
 * `.env` is not loaded by anything before this line. Node does not read it on
 * its own, and this script — a plain `node scripts/index-sync.mjs`, not a step
 * inside `astro build` — never passes through Vite. Without this, every variable
 * below reads as `undefined`, and this script's own request went out with
 * `undefined` in place of the account id — answered with a 404 that reads
 * exactly like an empty index, not like a credential that was never read.
 *
 * astro.config.ts needs the same thing for the same reason, so the parser moved
 * to scripts/env-file.mjs rather than being duplicated. See that file for why
 * having only one reader matters.
 */
loadEnvFile(ROOT);

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.AI_SEARCH_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN;

function fail(message) {
  console.error(`index-sync: ${message}`);
  process.exit(1);
}

/**
 * Reads the instance name and retrieval mode straight out of docs.config.ts.
 *
 * By regex rather than by import: this is a plain Node script and the config is
 * a TypeScript module that pulls in Astro types. Two string reads are a smaller
 * price than a build step for a script that runs once per deploy.
 */
function readConfig() {
  const source = readFileSync(path.join(ROOT, 'src', 'docs.config.ts'), 'utf8');
  const retrieval = source.match(/retrieval:\s*'([^']+)'/)?.[1] ?? 'lexical';
  const instance = source.match(/aiSearchInstance:\s*'([^']+)'/)?.[1];
  /*
   * `enabled: false` turns off every agent surface, so uploading a corpus that
   * nothing can query would be paying to index for no reader.
   *
   * Anchored to the start of a line and to a trailing comma, because the
   * config's own prose explains the flag by writing `enabled: false` inside a
   * comment — a substring match reads that as the setting and skips the upload
   * on a correctly configured repository. Comment lines open with `*`, which
   * the anchor excludes.
   */
  const enabled = !/^\s*enabled:\s*false\s*,/m.test(source);
  return { retrieval, instance, enabled };
}

const { retrieval, instance, enabled } = readConfig();

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
const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai-search/instances/${instance}/items`;

/**
 * The digest of everything one upload puts in the index, stored beside it as
 * `version`.
 *
 * The Markdown **and the metadata**, because half of what an item holds does not
 * come from the file. `tab`, `type` and `locale` are resolved from the manifest,
 * so moving a page to another navigation tab changes not one byte on disk — and
 * a digest of the file alone would skip it forever, leaving the index filtering
 * on a tab the site no longer puts it in.
 *
 * The metadata keys are sorted first. Otherwise reordering the object literal in
 * some future edit — a change to nothing at all — reads as a change to every
 * page and re-uploads the corpus.
 *
 * MD5 because this identifies a version, it does not defend against anyone:
 * both ends of the comparison are our own build output.
 *
 * Deliberately not the API's own `checksum` field, which looks like it would do
 * this and does not. Measured against a live instance of 198 items: it never
 * equals the digest of the uploaded file under any derivation, and 128 of them
 * reported the literal string "0" — precisely the items that run had *created*
 * rather than overwritten, a split that did not resolve minutes later with every
 * item reporting `status: "completed"`. A freshly created item simply has none,
 * which is worst exactly when it matters most: the moment after a sync is when
 * you most want to ask what the index holds.
 *
 * `file_size` does match, on every item including those. It is a weak signal —
 * an edit that preserves length slips through, and translation round trips
 * produce plenty of those — so it is not used here either.
 */
const versionOf = (markdown, metadata) => {
  const canonical = JSON.stringify(
    Object.fromEntries(Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b))),
  );
  return createHash('md5').update(markdown).update('\u0000').update(canonical).digest('hex');
};

/**
 * Every item the instance currently holds, or `null` if it cannot be listed.
 *
 * Read once, before anything is uploaded, and used twice: to skip the pages that
 * have not changed, and to delete the keys the manifest no longer claims.
 *
 * `null` is not a failure to stop on. It means this run cannot tell what changed
 * and cannot tell what is orphaned, so it uploads everything and skips the
 * cleanup — the behaviour this script had before it could ask.
 *
 * A run right after a large one re-sends part of it, and that is the guard
 * working rather than the digest failing. An item is only skipped once it is
 * `completed`, and chunking is asynchronous on Cloudflare's side: measured after
 * seeding 22 pages, 15 had completed within a couple of minutes while 7 sat in
 * `running` with no error for several more. Those 7 were re-uploaded on each run
 * until they finished, which is the safe direction — see `isUnchanged`.
 */
async function listIndexed() {
  const indexed = [];
  /* `per_page` caps at 50, so this pages through. The loop bound guards
     against a pagination bug spinning forever; it is not a real limit. */
  for (let page = 1; page <= 200; page += 1) {
    const response = await fetch(`${base}?page=${page}&per_page=50`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!response.ok) {
      console.error(
        `index-sync: could not list items (${response.status}); uploading everything and skipping cleanup.`,
      );
      return null;
    }
    const body = await response.json();
    indexed.push(...body.result);
    if (body.result.length < 50) break;
  }
  return indexed;
}

/**
 * Only what gets filtered or sorted on. Everything descriptive — title,
 * headings, line offsets — lives in the manifest instead, because AI Search
 * allows five custom fields per instance and they are per-page, so they could
 * never describe a passage anyway.
 *
 * Built outside `upload` because the digest of it decides whether that upload
 * happens at all.
 */
const metadataFor = page => ({
  type: page.type,
  tab: page.tab,
  locale: page.locale,
  ...(page.updated ? { updated: `${page.updated}T00:00:00Z` } : {}),
});

/**
 * One item per page, keyed by the page id.
 *
 * The key is what comes back on every search hit as `item.key`, and it is how
 * the Worker joins a passage to the manifest. It has to be exactly the page id
 * and nothing else.
 */
async function upload(page, markdown, metadata) {
  if (DRY_RUN) {
    console.log(`  would upload ${page.id.padEnd(46)} ${markdown.length} bytes  ${JSON.stringify(metadata)}`);
    return true;
  }

  /*
   * Retried, because this makes one request per page over hundreds of pages and
   * a single dropped connection would otherwise abort the run — leaving the
   * index half-updated, which is worse than not updating it at all. A network
   * error throws out of `fetch` rather than returning a status, so it has to be
   * caught rather than checked.
   *
   * Five attempts with exponential backoff. Three with a linear one was not
   * enough in practice: a run of 334 sequential uploads saw roughly 3% of
   * requests reset, and one page exhausted its attempts. Backing off further
   * each time is what lets a run survive a bad stretch rather than a single
   * bad request.
   */
  for (let attempt = 1; attempt <= 5; attempt += 1) {
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
      /* A 4xx is our own mistake — a bad key, a malformed payload — and
         retrying only repeats the same request three times. */
      if (response.status < 500 && response.status !== 429) {
        console.error(`  ✗ ${page.id}: ${response.status} ${detail}`);
        return false;
      }
      console.error(`  … ${page.id}: ${response.status}, retrying (${attempt}/5)`);
    } catch (error) {
      console.error(`  … ${page.id}: ${error.cause?.code ?? error.message}, retrying (${attempt}/5)`);
    }

    if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 2 ** attempt * 250));
  }

  console.error(`  ✗ ${page.id}: gave up after 5 attempts`);
  return false;
}

/*
 * The whole corpus is read before the first upload, not page by page during it.
 *
 * The run takes minutes — one sequential request per page, paced — and nothing
 * stops `dist/` being rebuilt underneath it in that window. A `npm test` in
 * another shell is enough. Reading during the run turns that into an ENOENT
 * partway through: the index is left half-fresh and the deploy never happens,
 * which is the worst of the two states.
 *
 * Reading first makes the failure clean. Either every page is in memory and the
 * upload proceeds against a consistent snapshot, or nothing has been sent yet
 * and the message names the missing file. A few hundred Markdown pages is a few
 * megabytes; the memory is not the consideration.
 */
let corpus;
try {
  corpus = manifest.pages.map(page => ({
    page,
    markdown: readFileSync(path.join(DIST, `${page.id}.md`), 'utf8'),
    metadata: metadataFor(page),
  }));
} catch (error) {
  fail(
    `could not read the built corpus: ${error.message}\n` +
      '  dist/ changed while this was running, or the build is incomplete. ' +
      'Re-run `npm run build`, and do not rebuild while a sync is in flight.',
  );
}

/*
 * What the index already holds, and therefore what does not need sending again.
 *
 * An item whose stored `version` equals the digest of the bytes we are about to
 * upload is byte-identical to what is already there, so uploading it would cost
 * a request and a re-chunk to produce the same result. The first run after this
 * field was introduced finds no versions at all and uploads everything, which is
 * correct and happens once.
 *
 * This is also where the run stops being minutes long on a large corpus. It
 * uploads sequentially with a deliberate gap, so the cost is proportional to
 * what changed rather than to how much exists.
 */
const indexed = DRY_RUN && (!ACCOUNT || !TOKEN) ? null : await listIndexed();
const indexedByKey = new Map((indexed ?? []).map(item => [item.key.replace(/\.md$/, ''), item]));

/**
 * Whether the index already holds exactly this, and holds it in a usable state.
 *
 * Every uncertainty resolves toward uploading, and the asymmetry is the whole
 * design: a page wrongly skipped is invisible until a reader gets a stale
 * answer, while a page wrongly uploaded costs two seconds. So an item that is
 * still chunking, one the API reports an error for, one absent from the listing,
 * and a listing that could not be read at all all mean "send it".
 */
const isUnchanged = ({ page, markdown, metadata }) => {
  if (FORCE) return false;
  const item = indexedByKey.get(page.id);
  if (!item || item.status !== 'completed' || item.error) return false;
  return item.metadata?.version === versionOf(markdown, metadata);
};

const changed = corpus.filter(entry => !isUnchanged(entry));
const unchanged = corpus.length - changed.length;

console.log(
  `index-sync: ${DRY_RUN ? 'dry run — ' : ''}${changed.length} of ${manifest.pages.length} pages changed` +
    `${unchanged ? `, ${unchanged} unchanged` : ''} → AI Search instance "${instance}"`,
);

let failures = 0;
for (const { page, markdown, metadata } of changed) {
  /* Sequential on purpose. This runs once per deploy over a few hundred small
     files; parallelising it would trade a few seconds for the risk of tripping
     a rate limit halfway through and leaving the index half-updated. */
  if (!(await upload(page, markdown, { ...metadata, version: versionOf(markdown, metadata) }))) failures += 1;
  /* A short gap between uploads. Without it, several hundred back-to-back
     connections draw a steady trickle of resets from the far end — cheaper to
     pace the run than to retry through them. */
  await new Promise(resolve => setTimeout(resolve, 60));
}

if (failures) fail(`${failures} of ${changed.length} pages failed to upload.`);
console.log(
  changed.length
    ? `index-sync: ${changed.length} pages uploaded.`
    : 'index-sync: nothing to upload — the index already holds this build.',
);

/*
 * Deleting what the manifest no longer claims.
 *
 * Uploading is an upsert, so on its own this script only ever grows the index.
 * A page that is unpublished, renamed, or marked `noindex` keeps its old
 * chunks, and search keeps retrieving them — content the site itself no longer
 * serves. That went unnoticed until three `noindex` pages left the manifest and
 * stayed in the index.
 *
 * The join is by key: the API stores `<page id>.md`, the manifest holds the
 * bare id. Anything indexed that the manifest does not list is stale by
 * definition, since the manifest is the whole published corpus.
 *
 * By key, and only by key. This can say that no page is indexed that should not
 * be; it cannot say that the indexed *text* is current, because it never
 * compares any. Immediately after an upload the distinction does not matter —
 * everything was just written. It matters when someone reads the last run's
 * output days later as a statement about today, which is exactly what happens on
 * a repository wired to Workers Builds: every push publishes the site without
 * running this script, and the page set stays stable while the content drifts.
 * So the message below says `keys`, and says nothing it did not check.
 * content/guides/deployment.mdx covers the two deploy paths.
 *
 * Answering the real question — "is the indexed text current?" — is worth doing
 * and is not done here. It would also remove the reason this run takes minutes:
 * with a way to tell which pages moved, it would upload the handful that did
 * instead of all of them, sequentially, at 60 ms apart.
 *
 * The listing endpoint returns a per-item `checksum`, which looks like the
 * obvious hook. It is not, or not yet: compared against an MD5 of the built
 * `.md` for a page whose content had not changed since its upload, the two did
 * not match. So the field means something other than "digest of what we
 * uploaded", and building a freshness check on it without pinning that down
 * would manufacture exactly the false confidence this comment is about. Either
 * establish what it is, or upload a hash of our own in the metadata — there are
 * five custom fields and four are in use.
 */
async function reconcile(indexed) {
  if (!indexed) return;

  const published = new Set(manifest.pages.map(page => page.id));
  const stale = indexed.filter(item => !published.has(item.key.replace(/\.md$/, '')));
  if (!stale.length) {
    /* Said after the uploads above, so it is a statement about now rather than
       about the listing this ran on. The count is the manifest's, because that
       is what the index holds once this run has finished. */
    console.log(`index-sync: the index holds this build (${manifest.pages.length} pages).`);
    return;
  }

  /*
   * A truncated manifest would make most of the index look stale, and this
   * would happily empty it. Removing a third of the corpus is never a routine
   * edit, so past that line the run reports and leaves the index alone.
   */
  if (stale.length > indexed.length / 3) {
    console.error(
      `index-sync: ${stale.length} of ${indexed.length} items look stale — too many to be an edit. ` +
        'Leaving the index alone; re-run with a verified manifest.',
    );
    return;
  }

  for (const item of stale) {
    if (DRY_RUN) {
      console.log(`  would delete ${item.key}`);
      continue;
    }
    const response = await fetch(`${base}/${item.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    console.log(response.ok ? `  ⌫ ${item.key}` : `  ✗ delete ${item.key}: ${response.status}`);
  }
}

await reconcile(indexed);
