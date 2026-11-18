import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Every breadcrumb Google reads is valid: each item but the last names a URL.
 *
 * Folders used to appear in the trail with a name and no URL, which Google
 * reports as an error on every page under a folder (357 pages on AI Glot's
 * docs, site audit 2026-11-18). Run over `dist`, after `npm run build`.
 */

const DIST = path.resolve(import.meta.dirname, '..', 'dist');

const htmlFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? htmlFiles(p) : e.name.endsWith('.html') ? [p] : [];
  });

test('breadcrumb items all carry a URL, except the last', { skip: !existsSync(DIST) && 'no dist: run npm run build' }, () => {
  const bad = [];
  let checked = 0;
  for (const file of htmlFiles(DIST)) {
    const html = readFileSync(file, 'utf8');
    for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      const graph = JSON.parse(json)['@graph'] ?? [];
      for (const node of graph.filter((n) => n['@type'] === 'BreadcrumbList')) {
        checked++;
        const items = node.itemListElement;
        items.slice(0, -1).forEach((item, i) => {
          if (!item.item) bad.push(`${path.relative(DIST, file)}: item ${i + 1} "${item.name}"`);
        });
      }
    }
  }
  assert.ok(checked > 0, 'no BreadcrumbList found in dist');
  assert.deepEqual(bad.slice(0, 10), []);
});
