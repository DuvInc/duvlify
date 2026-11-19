import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  digestOf,
  isUnchanged,
  readConfigFromSource,
  selectPagesForIndex,
  stripVolatileFrontmatter,
} from '../scripts/index-sync.mjs';

describe('index-sync', () => {
  const samplePage = (updatedLine = 'updated: "2026-10-11"\n', body = '# Overview\n\nBody copy.\n') =>
    `---\ntitle: "Overview"\ndescription: "Docs overview"\ncanonical: "https://example.com/overview"\n${updatedLine}---\n\n${body}`;

  test('digest ignores frontmatter updated date and metadata.updated', () => {
    const metaA = { type: 'page', tab: 'Guides', locale: 'en', updated: '2026-10-11T00:00:00Z' };
    const metaB = { type: 'page', tab: 'Guides', locale: 'en', updated: '2026-11-19T00:00:00Z' };
    const metaNone = { type: 'page', tab: 'Guides', locale: 'en' };

    const a = digestOf(samplePage('updated: "2026-10-11"\n'), metaA);
    const b = digestOf(samplePage('updated: "2026-11-19"\n'), metaB);
    const c = digestOf(samplePage(''), metaNone);

    assert.equal(a, b);
    assert.equal(a, c);
  });

  test('digest reacts to prose, title, filter metadata, and body updated lines', () => {
    const base = digestOf(samplePage(), { type: 'page', tab: 'Guides', locale: 'en' });
    assert.notEqual(
      base,
      digestOf(samplePage('updated: "2026-10-11"\n', '# Overview\n\nupdated: "2026-11-19"\n'), {
        type: 'page',
        tab: 'Guides',
        locale: 'en',
      }),
    );
    assert.notEqual(base, digestOf(samplePage(), { type: 'page', tab: 'Reference', locale: 'en' }));
    assert.notEqual(base, digestOf(samplePage(), { type: 'api-endpoint', tab: 'Guides', locale: 'en' }));
    assert.notEqual(base, digestOf(samplePage(), { type: 'page', tab: 'Guides', locale: 'fr' }));
  });

  test('stripVolatileFrontmatter leaves body lines starting with updated: intact', () => {
    const md = samplePage('updated: "2026-10-11"\n', '# API\n\n```yaml\nupdated: "2026-01-01"\n```\n');
    const stripped = stripVolatileFrontmatter(md);
    assert.doesNotMatch(stripped.split('\n---\n')[0], /^updated:/m);
    assert.match(stripped.split('\n---\n')[1], /^updated: "2026-01-01"$/m);
  });

  test('isUnchanged skips completed, queued, and running items with matching digest', () => {
    const entry = { page: { id: 'guides/setup' }, digest: 'abc123' };

    for (const status of ['completed', 'queued', 'running']) {
      const indexed = new Map([
        ['guides/setup', { status, error: null, metadata: { version: 'abc123' } }],
      ]);
      assert.equal(isUnchanged(entry, indexed), true, `expected ${status} to be skipped`);
    }

    for (const status of ['error', 'outdated']) {
      const indexed = new Map([
        ['guides/setup', { status, error: null, metadata: { version: 'abc123' } }],
      ]);
      assert.equal(isUnchanged(entry, indexed), false, `expected ${status} to be re-uploaded`);
    }

    const withError = new Map([
      ['guides/setup', { status: 'completed', error: 'workers_ai_timeout_error', metadata: { version: 'abc123' } }],
    ]);
    assert.equal(isUnchanged(entry, withError), false);

    const staleDigest = new Map([
      ['guides/setup', { status: 'completed', error: null, metadata: { version: 'old999' } }],
    ]);
    assert.equal(isUnchanged(entry, staleDigest), false);

    const healthy = new Map([
      ['guides/setup', { status: 'completed', error: null, metadata: { version: 'abc123' } }],
    ]);
    assert.equal(isUnchanged(entry, healthy, { force: true }), false);
  });

  test('selectPagesForIndex restricts to defaultLocale by default', () => {
    const pages = [
      { id: 'overview', locale: 'en' },
      { id: 'fr/overview', locale: 'fr' },
      { id: 'de/overview', locale: 'de' },
      { id: 'untagged' },
    ];
    assert.deepEqual(
      selectPagesForIndex(pages, { aiSearchLocales: 'default', defaultLocale: 'en' }).map(p => p.id),
      ['overview', 'untagged'],
    );
    assert.deepEqual(
      selectPagesForIndex(pages, { aiSearchLocales: 'all', defaultLocale: 'en' }).map(p => p.id),
      ['overview', 'fr/overview', 'de/overview', 'untagged'],
    );
  });

  test('readConfigFromSource reads agents and i18n blocks without matching comments', () => {
    const source = `
/*
 * enabled: false,
 * defaultLocale: 'fr',
 */
export const i18n: I18nConfig = {
  locales: { en: {}, fr: {} },
  defaultLocale: 'en',
};
export const agents = {
  enabled: true,
  retrieval: 'ai-search' as 'lexical' | 'ai-search',
  aiSearchInstance: 'my-docs-search',
  aiSearchLocales: 'default' as 'default' | 'all',
};
`;
    assert.deepEqual(readConfigFromSource(source), {
      enabled: true,
      retrieval: 'ai-search',
      instance: 'my-docs-search',
      aiSearchLocales: 'default',
      defaultLocale: 'en',
    });
  });
});
