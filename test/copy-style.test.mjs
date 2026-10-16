import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * No em dash (U+2014) in the English copy this project publishes.
 *
 * The house style uses commas, colons, full stops and plain hyphens. An em dash
 * is the most recognisable tell of generated prose, and nothing but a check
 * keeps one from coming back in a later edit.
 *
 * What is scanned: the documentation (`content/` and its snapshot in
 * `handbook/`), the Markdown at the repository root and the pull request template, and the
 * strings in `src/` and `worker/` that reach a reader or an agent (page titles,
 * feeds, MCP tool descriptions and replies). Code comments are skipped, and so
 * are stylesheets, tests and scripts: none of those is copy.
 *
 * A site built on this framework with its own `content/` in another language
 * should drop `content/` and `handbook/` from ROOTS rather than edit its prose.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
const EM_DASH = '—';

const DOC_ROOTS = ['content', 'handbook'];
const DOC_EXT = /\.mdx?$/;
const CODE_ROOTS = ['src', 'worker'];
const CODE_EXT = /\.(ts|astro)$/;
const ROOT_DOCS = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md', '.github/PULL_REQUEST_TEMPLATE.md'];

function walk(dir, ext) {
  const full = path.join(ROOT, dir);
  if (!existsSync(full)) return [];
  return readdirSync(full, { withFileTypes: true }).flatMap(item => {
    const rel = path.join(dir, item.name);
    if (item.isDirectory()) return item.name === 'node_modules' ? [] : walk(rel, ext);
    return ext.test(item.name) ? [rel] : [];
  });
}

/**
 * The lines of a source file that are not comment. Line-based on purpose: a
 * block comment opens at the start of a line (or after `{` in JSX), so a glob
 * such as `**\/*.md` inside a string is not mistaken for one.
 */
function withoutComments(source) {
  const lines = [];
  let block = null; // the closing token of the comment we are inside
  source.split('\n').forEach((line, index) => {
    let rest = line;
    if (block) {
      const end = rest.indexOf(block);
      if (end === -1) return;
      rest = rest.slice(end + block.length);
      block = null;
    }
    const trimmed = rest.trim();
    const open = trimmed.match(/^(\{?\/\*|<!--)/);
    if (open) {
      block = open[1].endsWith('!--') ? '-->' : '*/';
      const end = rest.indexOf(block, rest.indexOf(open[1]) + open[1].length);
      if (end === -1) return;
      rest = rest.slice(end + block.length);
      block = null;
    }
    rest = rest.replace(/(^|\s)\/\/.*$/, '$1');
    if (rest.includes(EM_DASH)) lines.push({ number: index + 1, text: rest.trim() });
  });
  return lines;
}

function offenders() {
  const found = [];
  const docs = [...ROOT_DOCS, ...DOC_ROOTS.flatMap(dir => walk(dir, DOC_EXT))];
  for (const file of docs) {
    if (!existsSync(path.join(ROOT, file))) continue;
    readFileSync(path.join(ROOT, file), 'utf8').split('\n').forEach((text, index) => {
      if (text.includes(EM_DASH)) found.push(`${file}:${index + 1}: ${text.trim()}`);
    });
  }
  for (const file of CODE_ROOTS.flatMap(dir => walk(dir, CODE_EXT))) {
    for (const line of withoutComments(readFileSync(path.join(ROOT, file), 'utf8'))) {
      found.push(`${file}:${line.number}: ${line.text}`);
    }
  }
  return found;
}

test('the published English copy has no em dash', () => {
  const found = offenders();
  assert.deepEqual(
    found,
    [],
    `${found.length} em dash(es) in published copy. Use a comma, a colon, a full stop or a hyphen:\n  ${found.join('\n  ')}`,
  );
});

test('the comment stripper keeps copy and drops comments', () => {
  const source = [
    '/* a block ' + EM_DASH + ' comment',
    '   continued ' + EM_DASH + ' here */',
    "const glob = '**/*.md'; const copy = 'one " + EM_DASH + " two';",
    '// a line comment ' + EM_DASH + ' skipped',
    'const url = "https://example.com"; // trailing ' + EM_DASH + ' skipped',
    '<!-- html ' + EM_DASH + ' comment -->',
    '<p>visible ' + EM_DASH + ' copy</p>',
  ].join('\n');
  assert.deepEqual(
    withoutComments(source).map(line => line.number),
    [3, 7],
  );
});
