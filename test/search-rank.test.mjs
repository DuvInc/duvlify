import assert from 'node:assert/strict';
import test from 'node:test';

import { rank } from '../src/scripts/search-rank.ts';
import { toSections } from '../src/lib/plain-text.ts';

const page = (h, t, s, d, b = []) => ({ h, t, s, d, k: 'page', b });
const index = {
  quick: [],
  pages: [
    page('/int/activecampaign', 'ActiveCampaign', 'Integrations', 'Connect ActiveCampaign.', [{ t: 'Sync contacts. Needs an api key from the settings.' }]),
    page('/int/apollo', 'Apollo', 'Integrations', 'Connect Apollo.', [{ t: 'Enrich leads with Stripe data.' }]),
    page('/int/stripe', 'Stripe', 'Integrations', 'Take payments with Stripe.', [{ t: 'Connect your account.' }]),
    page('/api/auth', 'API authentication', 'API', 'How to authenticate.', [{ h: 'Get an API key', a: 'get-an-api-key', t: 'Create a key in the dashboard.' }]),
    page('/data/fields', 'Field types', 'Database', 'Every field type.', [
      { h: 'Text', a: 'text', t: 'Plain text.' },
      { h: 'Formula', a: 'formula', t: 'Computed from other fields.' },
    ]),
    page('/data/formulas', 'Formulas guide', 'Database', 'Write formulas.', [{ t: 'A longer guide.' }]),
  ],
};

test('a page must contain every word, not some', () => {
  const urls = rank(index, 'api key').map(hit => hit.href.split('#')[0]);
  assert.ok(urls.includes('/api/auth'));
  assert.ok(!urls.includes('/int/apollo'), 'a page with neither word must not match');
  assert.ok(!urls.includes('/int/stripe'));
});

test('the page whose title is the query comes first, not the first alphabetically', () => {
  assert.equal(rank(index, 'stripe')[0].href, '/int/stripe');
});

test('a heading that answers the query deep-links to it', () => {
  const [top] = rank(index, 'api key');
  assert.equal(top.href, '/api/auth#get-an-api-key');
  assert.equal(top.kind, 'heading');
});

test('equal scores go to the shorter title', () => {
  const tied = { quick: [], pages: [page('/b', 'Longer title here', 's', 'd', [{ t: 'widget' }]), page('/a', 'Short', 's', 'd', [{ t: 'widget' }])] };
  assert.deepEqual(rank(tied, 'widget').map(hit => hit.href), ['/a', '/b']);
});

test('nothing matches an empty or unknown query', () => {
  assert.deepEqual(rank(index, '   '), []);
  assert.deepEqual(rank(index, 'zzzz'), []);
});

test('H3s and accordion titles are sections of their own', () => {
  const body = [
    '## Field types', 'Intro.',
    '### Formula', 'Computed.',
    '<Accordion title="Rollup">', 'Aggregates a linked field.', '</Accordion>',
    'Back under the heading.',
  ].join('\n');
  const headings = [
    { depth: 2, slug: 'field-types', text: 'Field types' },
    { depth: 3, slug: 'formula', text: 'Formula' },
  ];
  const sections = toSections(body, headings);
  assert.deepEqual(sections.map(s => [s.h, s.a]), [
    ['Field types', 'field-types'], ['Formula', 'formula'], ['Rollup', 'formula'], ['Formula', 'formula'],
  ]);
  assert.match(sections[2].t, /Aggregates/);
  assert.match(sections[3].t, /Back under/);
});
