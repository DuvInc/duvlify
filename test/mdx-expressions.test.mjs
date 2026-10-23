import assert from 'node:assert/strict';
import test from 'node:test';

import { mdxToMarkdown, stringLiteral } from '../src/lib/mdx-to-markdown.ts';

test('a lone string literal is a string; anything computed is not', () => {
  assert.equal(stringLiteral('"https://<name>.example.com"'), 'https://<name>.example.com');
  assert.equal(stringLiteral(" 'it\\'s' "), "it's");
  assert.equal(stringLiteral('`plain`'), 'plain');
  assert.equal(stringLiteral('"a" + "b"'), undefined);
  assert.equal(stringLiteral('`${x}`'), undefined);
  assert.equal(stringLiteral('/* a comment */'), undefined);
  assert.equal(stringLiteral('PAGE'), undefined);
});

test('the twin keeps the text an author wrote as a string expression', () => {
  const md = mdxToMarkdown('Your host is **{"https://<name>.example.com"}** and {/* hidden */} stays out.');
  /* Escaped the way Markdown escapes it, which a reader of the twin sees as the
     same text. */
  assert.equal(md.replace(/\\(.)/g, '$1').includes('https://<name>.example.com'), true, md);
  assert.doesNotMatch(md, /hidden/);
});
