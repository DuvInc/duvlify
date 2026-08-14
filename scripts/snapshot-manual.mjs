#!/usr/bin/env node
/**
 * Copies the framework's own documentation out of the build and into handbook/.
 *
 * The problem this solves: content/ is both this site's documentation and the
 * demo every fork is told to delete. README.md says "Replace content/ with your
 * pages", and the moment someone does, every explanation of how this framework
 * works leaves their repository — the README's own Documentation table links to
 * duvlify.dev, a host they do not control, describing a version they have not
 * forked. handbook/ is the copy that survives that deletion.
 *
 * Not a second set of prose. These are the exact bytes already served at
 * <page>.md, which the build generates from content/ and the test suite already
 * asserts against. Writing the manual twice would guarantee the two drift; this
 * way there is one source and a snapshot of it.
 *
 * Snapshot, not mirror. handbook/ changes only when this script runs, and that
 * is the point: a fork gets the manual for the commit it forked, not whatever
 * duvlify.dev says a year later. Re-run it after editing content/ and before
 * cutting a release.
 *
 * This script is for whoever maintains the framework, and for nobody else. Run
 * in a repository whose content/ has been replaced — which is every repository
 * using this framework for its own documentation — it would overwrite the manual
 * with those pages and delete what no longer matches. So it does not simply
 * write: it first checks that handbook/ and the build still describe the same
 * documentation set, and refuses when they do not. See `sameDocumentation` below
 * for what that check can and cannot see.
 *
 *   Usage:  npm run manual:snapshot
 *           npm run manual:snapshot -- --check    (CI: fail if stale)
 *           npm run manual:snapshot -- --force    (bypass the guard; read it first)
 *
 * Reads dist/, so it needs a build first. `npm run manual:snapshot` chains one.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'handbook');
const CHECK = process.argv.includes('--check');
const FORCE = process.argv.includes('--force');

/**
 * Pages that document this deployment rather than the framework.
 *
 * The landing page and `why` sell the product; the Example API tab is a
 * deliberately fictional walkthrough whose mechanism is already explained in
 * guides/api-reference. None of them helps someone who has replaced content/
 * with their own pages, and shipping them would make handbook/ read like a copy
 * of the marketing site rather than a manual.
 */
const EXCLUDE = new Set(['index', 'why']);
const EXCLUDE_PREFIX = ['example-api/'];

function fail(message) {
  console.error(`snapshot-manual: ${message}`);
  process.exit(1);
}

const manifestPath = path.join(DIST, 'agent-manifest.json');
if (!existsSync(manifestPath)) {
  fail('dist/agent-manifest.json is missing — run `npm run build` first.');
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const pages = manifest.pages.filter(
  page => !EXCLUDE.has(page.id) && !EXCLUDE_PREFIX.some(prefix => page.id.startsWith(prefix)),
);

if (!pages.length) fail('no pages left to snapshot after exclusions.');

/*
 * Each copied page carries a `canonical:` line pointing back at the live URL,
 * which comes from `site` in astro.config.ts — and that falls back to a
 * placeholder host when SITE_URL is unset. A snapshot is the one output where
 * that matters more than usual: these files are read after content/ is gone,
 * so a canonical naming example.com sends the reader somewhere that does not
 * answer, with nothing else on the page to correct it.
 */
if (pages.some(page => /\/\/[^/]*example\.com/.test(page.url))) {
  console.warn(
    'snapshot-manual: warning — pages still carry the placeholder origin.\n' +
      '  Every `canonical:` line in handbook/ will name example.com.\n' +
      '  Re-run with the real origin:  SITE_URL=https://your-host npm run manual:snapshot',
  );
}

/* One index, written by hand rather than generated, because it has to say what
   this folder is for — which is the one thing the copied pages cannot say about
   themselves. */
const readme = `# The framework's manual

These pages describe **the framework**, not this site's content: how to
configure it, write pages, deploy it, and serve AI agents.

They exist so that this folder survives the step every fork is told to take.
[\`README.md\`](../README.md) says to replace \`content/\` with your own pages, and
\`content/\` is where this documentation is published from. Without a copy here, a
fork loses every explanation of how the thing it forked works, and the README's
own links point at duvlify.dev — a host you do not control, describing a version
you have not forked.

Nothing here is published. The site is built from \`content/\` into \`dist/\`, and
\`dist/\` is what gets deployed, so these files never reach a visitor.

## If this is your own documentation repository

This folder is frozen, and it stays correct whatever you do to \`content/\`. That
is the whole reason it exists.

**Do not run \`npm run manual:snapshot\`.** That command regenerates this folder
from whatever \`content/\` currently holds — in your repository, your own pages —
and deletes the files that no longer match. The manual you are reading would be
what it deleted. The script refuses when it can tell that this has happened, but
the protection you should rely on is not asking it to.

\`npm run manual:check\`, which CI runs, is safe: it writes nothing, and it exits
quietly once it sees that this folder describes a different documentation set
than your build.

Delete the folder when you no longer need it. Nothing reads it — no build step,
no test, no route — and the check passes on its absence.

## If you maintain the framework itself

Each file is a copy of the Markdown that page serves at \`<page>.md\`, taken by
[\`scripts/snapshot-manual.mjs\`](../scripts/snapshot-manual.mjs). They are the
exact bytes the build already generates and the test suite already checks, so
there is no second copy of the prose to keep in step.

They update only when the script runs:

\`\`\`bash
npm run manual:snapshot
\`\`\`

That is deliberate. A fork keeps the manual for the commit it forked, rather
than tracking a site that keeps moving. Re-run the script after editing
\`content/\`, and before cutting a release.

The live version of these pages, always current, is at
[duvlify.dev](https://duvlify.dev).

## Contents

${(() => {
  const byTab = new Map();
  for (const page of pages) {
    if (!byTab.has(page.tab)) byTab.set(page.tab, []);
    byTab.get(page.tab).push(page);
  }
  return [...byTab.entries()]
    .map(
      ([tab, group]) =>
        `### ${tab}\n\n` +
        group.map(page => `- [${page.title}](./${page.id}.md)`).join('\n'),
    )
    .join('\n\n');
})()}
`;

/* Rebuilt from scratch each run, so a page deleted from content/ does not live
   on here — the same reason index-sync reconciles rather than only uploading. */
const wanted = new Map([['README.md', readme]]);

for (const page of pages) {
  const source = path.join(DIST, `${page.id}.md`);
  if (!existsSync(source)) fail(`dist/${page.id}.md is missing — is the build current?`);
  wanted.set(`${page.id}.md`, readFileSync(source, 'utf8'));
}

const listExisting = (dir, prefix = '') => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    return statSync(full).isDirectory() ? listExisting(full, rel) : [rel];
  });
};

const existing = listExisting(OUT);

/*
 * Does handbook/ still hold a snapshot of the pages this build produces?
 *
 * The question this is really asking is "has content/ been replaced?", and the
 * honest answer is that no identity string can tell us. A repository cloned from
 * upstream keeps `DuvInc/duvlify` as its git remote, so the remote proves
 * nothing; `site.name` in docs.config.ts is one of the first things a new site
 * changes, and one of the last a lazy one does, so it proves nothing either.
 *
 * What does distinguish the two cases is the pages themselves. Editing this
 * framework's own documentation moves one or two files at a time out of sixteen.
 * Replacing content/ moves all of them. So compare the page ids already on disk
 * against the ones this build would write, and treat a near-total mismatch as
 * what it almost certainly is: someone else's documentation, about to overwrite
 * this manual.
 *
 * The threshold is deliberately generous — a majority has to survive, not
 * everything — so that a real restructure upstream still runs. A restructure
 * larger than that is the one case where a maintainer sees this refusal and is
 * right to pass --force.
 */
const existingPages = existing.filter(file => file !== 'README.md');
const carriedOver = existingPages.filter(file => wanted.has(file)).length;
const sameDocumentation = existingPages.length > 0 && carriedOver / existingPages.length >= 0.5;

if (!sameDocumentation && !FORCE) {
  /* Nothing to protect and nothing to compare against: either this folder was
     deleted, which is a supported thing for a fork to do, or the manual is being
     created for the first time. Only the second case wants to write. */
  const empty = existingPages.length === 0;

  if (CHECK) {
    console.log(
      empty
        ? 'snapshot-manual: handbook/ holds no snapshot — nothing to keep in step. Skipping.'
        : `snapshot-manual: handbook/ describes a different documentation set than this build\n` +
            `  (${carriedOver} of ${existingPages.length} pages in common). It is a frozen copy of the\n` +
            `  framework's manual, not a snapshot of your content/, so there is nothing to check.\n` +
            `  Delete handbook/ if you no longer need it. Skipping.`,
    );
    process.exit(0);
  }

  console.error(
    empty
      ? 'snapshot-manual: handbook/ is empty, so there is no way to tell whether this build is\n' +
          "  the framework's own documentation or your replacement for it.\n" +
          '  If you maintain the framework and are creating the snapshot from scratch:\n' +
          '    npm run manual:snapshot -- --force'
      : `snapshot-manual: refusing to write. handbook/ and this build describe different\n` +
          `  documentation sets (${carriedOver} of ${existingPages.length} pages in common).\n` +
          `\n` +
          `  handbook/ is a frozen copy of the framework's manual, kept so that it survives\n` +
          `  content/ being replaced. Running this script here would overwrite it with the\n` +
          `  pages in content/ and delete the rest — which is the exact loss it exists to\n` +
          `  prevent. You do not need to run it: nothing reads handbook/, and\n` +
          `  \`npm run manual:check\` passes whether it is present or deleted.\n` +
          `\n` +
          `  If you maintain the framework itself and this really is a restructure:\n` +
          `    npm run manual:snapshot -- --force`,
  );
  process.exit(1);
}

const stale = existing.filter(file => !wanted.has(file));
const changed = [...wanted].filter(
  ([file, body]) =>
    !existsSync(path.join(OUT, file)) || readFileSync(path.join(OUT, file), 'utf8') !== body,
);

if (CHECK) {
  if (!changed.length && !stale.length) {
    console.log(`snapshot-manual: handbook/ matches the build (${wanted.size} files).`);
    process.exit(0);
  }
  for (const [file] of changed) console.error(`  stale  ${file}`);
  for (const file of stale) console.error(`  orphan ${file}`);
  fail('handbook/ is out of date. Run `npm run manual:snapshot`.');
}

for (const file of stale) {
  rmSync(path.join(OUT, file));
  console.log(`  ⌫ ${file}`);
}
for (const [file, body] of wanted) {
  const target = path.join(OUT, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, body);
  console.log(`  ${changed.some(([name]) => name === file) ? '✓' : '·'} ${file}`);
}

console.log(
  `snapshot-manual: ${wanted.size} files in handbook/ (${changed.length} written, ${stale.length} removed).`,
);
