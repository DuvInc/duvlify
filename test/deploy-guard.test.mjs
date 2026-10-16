import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assess } from '../scripts/assert-deployable.mjs';

/**
 * `npm run deploy` publishes whatever the working tree holds. The guard turns
 * "deploy only from an up-to-date main" from a habit into a refusal, so both
 * halves are pinned here: the decision, and that every manual deploy script runs
 * the guard before it builds or uploads anything.
 */
const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const ready = { branch: 'main', production: 'main', dirty: [], head: SHA, remoteHead: SHA, hasOrigin: true };

describe('assess', () => {
  test('lets main, clean and equal to origin/main through', () => {
    assert.deepEqual(assess(ready), []);
  });

  test('refuses any other branch', () => {
    const problems = assess({ ...ready, branch: 'some-change' });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /not "main"/);
  });

  test('follows a different production branch when one is configured', () => {
    assert.deepEqual(assess({ ...ready, branch: 'production', production: 'production' }), []);
    assert.equal(assess({ ...ready, production: 'production' }).length, 1);
  });

  test('refuses a dirty tree and names the files', () => {
    const problems = assess({ ...ready, dirty: [' M src/a.ts', '?? new.ts'] });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /src\/a\.ts/);
  });

  test('refuses HEAD that differs from origin/main, ahead or behind', () => {
    const problems = assess({ ...ready, head: OTHER });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /not origin\/main/);
  });

  test('refuses when origin could not be fetched, rather than assuming it matches', () => {
    const problems = assess({ ...ready, remoteHead: null });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Could not fetch/);
  });

  test('has nothing to compare when there is no origin remote, and says nothing about it', () => {
    assert.deepEqual(assess({ ...ready, hasOrigin: false, remoteHead: null }), []);
  });

  test('reports every problem at once', () => {
    assert.equal(assess({ ...ready, branch: 'x', dirty: ['M a'], remoteHead: OTHER }).length, 3);
  });
});

describe('the manual deploy scripts run the guard first', () => {
  const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '..', 'package.json'), 'utf8'));

  for (const name of ['deploy', 'deploy:fast']) {
    test(`${name} starts with check:deployable, before the build`, () => {
      assert.match(pkg.scripts[name], /^npm run check:deployable && npm run build/);
    });
  }

  test('check:deployable runs the script', () => {
    assert.equal(pkg.scripts['check:deployable'], 'node scripts/assert-deployable.mjs');
  });
});
