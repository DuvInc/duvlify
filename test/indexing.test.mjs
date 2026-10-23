import assert from 'node:assert/strict';
import test from 'node:test';

import { DISALLOW_ALL, isIndexableHost, withNoindex } from '../worker/indexing.ts';

test('unset or empty, every host stays indexable', () => {
  assert.equal(isIndexableHost('preview-abc.workers.dev', undefined), true);
  assert.equal(isIndexableHost('preview-abc.workers.dev', ' , '), true);
});

test('set, only the named hosts are indexable', () => {
  const list = 'docs.example.com, www.example.com';
  assert.equal(isIndexableHost('docs.example.com', list), true);
  assert.equal(isIndexableHost('DOCS.example.com', list), true);
  assert.equal(isIndexableHost('abc123-duvlify-docs.workers.dev', list), false);
});

test('a non-indexable response says so, without overriding its own noindex', () => {
  assert.equal(withNoindex(new Response('x')).headers.get('X-Robots-Tag'), 'noindex, nofollow');
  const own = new Response('x', { headers: { 'X-Robots-Tag': 'noindex' } });
  assert.equal(withNoindex(own).headers.get('X-Robots-Tag'), 'noindex');
  assert.match(DISALLOW_ALL, /^User-agent: \*\nDisallow: \/\n$/);
});
