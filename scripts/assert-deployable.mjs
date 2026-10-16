#!/usr/bin/env node
/**
 * Refuses a manual deploy that is not the code on the production branch.
 *
 *   node scripts/assert-deployable.mjs        (runs first inside `npm run deploy`
 *                                              and `npm run deploy:fast`)
 *
 *   1. the branch is the production branch (`main`, or $DEPLOY_BRANCH);
 *   2. the working tree is clean, so no uncommitted or untracked file rides along
 *      into the upload;
 *   3. HEAD is exactly `origin/<branch>` after a fetch, so what ships is what was
 *      reviewed and merged, neither behind nor ahead.
 *
 * WHY. `main` is protected: a change reaches it through a pull request and a green
 * CI run. `wrangler deploy` run by hand from a feature branch or a dirty tree
 * publishes code that never went through either gate, and the deploy log looks
 * exactly like a good one. The rule "only main is deployed" is code here instead
 * of a habit.
 *
 * Using this framework for your own documentation? The same script protects your
 * deploys. If your production branch is not `main`, set it:
 *
 *   DEPLOY_BRANCH=production npm run deploy
 *
 * There is deliberately no "deploy anyway" flag. To ship from somewhere else, run
 * `npx wrangler deploy` yourself: that is a decision for a person, not an option
 * for a script.
 *
 * Skipped when `CI` or `WORKERS_CI` is set. Cloudflare Workers Builds (and any
 * other CI) checks out a detached commit and may run `npm run deploy` as its build
 * command, as the deployment guide describes; the branch to build is chosen in its
 * settings, and a laptop's working tree is not what it deploys.
 *
 * Skipped with a note outside a git repository (a downloaded archive), where there
 * is no branch to compare. A repository with no `origin` still has its branch and
 * working tree checked, but cannot be compared with a remote.
 */

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * Pure decision, so it can be tested without a git repository.
 * @param {{ branch: string, production: string, dirty: string[], head: string,
 *           remoteHead: string | null, hasOrigin: boolean }} state
 * @returns {string[]} one sentence per reason to refuse; empty means go.
 */
export function assess({ branch, production, dirty, head, remoteHead, hasOrigin }) {
  const problems = [];
  if (branch !== production) {
    problems.push(`HEAD is on "${branch}", not "${production}". Only ${production} may be deployed.`);
  }
  if (dirty.length) {
    const shown = dirty.slice(0, 5).join(', ');
    const more = dirty.length > 5 ? ` and ${dirty.length - 5} more` : '';
    problems.push(`The working tree is not clean (${shown}${more}). Commit or stash first.`);
  }
  if (hasOrigin) {
    if (remoteHead === null) {
      problems.push(
        `Could not fetch origin/${production}, so HEAD cannot be compared with it. Check the network and the remote.`,
      );
    } else if (head !== remoteHead) {
      problems.push(
        `HEAD (${head.slice(0, 8)}) is not origin/${production} (${remoteHead.slice(0, 8)}). ` +
          'Pull or push so they match: what ships must be exactly what was merged.',
      );
    }
  }
  return problems;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function readState(production) {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const dirty = git(['status', '--porcelain']).split('\n').filter(Boolean);
  const head = git(['rev-parse', 'HEAD']);
  const hasOrigin = git(['remote']).split('\n').includes('origin');
  let remoteHead = null;
  if (hasOrigin) {
    try {
      git(['fetch', '--quiet', 'origin', production]);
      remoteHead = git(['rev-parse', `origin/${production}`]);
    } catch {
      // reported by assess()
    }
  }
  return { branch, production, dirty, head, remoteHead, hasOrigin };
}

function main() {
  if (process.env.CI || process.env.WORKERS_CI) {
    console.log('assert-deployable: running in CI, the branch is chosen by the build settings. Skipping.');
    return;
  }
  const production = process.env.DEPLOY_BRANCH || 'main';

  let state;
  try {
    state = readState(production);
  } catch {
    console.log('assert-deployable: not a git repository, so there is no branch to check. Skipping.');
    return;
  }

  const problems = assess(state);
  if (problems.length) {
    console.error('\nDeploy refused:');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      `\nMerge through a pull request, then deploy from an up-to-date ${production}. ` +
        'There is no override; see the header of scripts/assert-deployable.mjs.',
    );
    process.exit(1);
  }
  console.log(
    `assert-deployable: on ${production}, clean` +
      (state.hasOrigin ? `, HEAD equals origin/${production}.` : ' (no origin remote to compare with).'),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
