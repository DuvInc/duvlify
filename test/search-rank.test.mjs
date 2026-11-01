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

/* ---------------------------------------------------------------------------
 * The rules added after the Pagefind comparison (2026-11), each one measured on
 * this documentation and turned into a case here so a later change has to beat
 * it deliberately.
 * ------------------------------------------------------------------------- */

const docs = {
  quick: [],
  pages: [
    page('/reference/frontmatter', 'Frontmatter', 'Reference', 'Every page starts with it.', [
      { h: 'Required', a: 'required', t: 'title and description are required.' },
    ]),
    page('/guides/deployment', 'Deploying', 'Guides', 'Ship the site.', [
      { h: 'On Cloudflare', a: 'on-cloudflare', t: 'Use wrangler. Deploy the Worker.' },
      { h: 'After the first deploy', a: 'after-the-first-deploy', t: 'Check the Cloudflare dashboard, then deploy again.' },
    ]),
    page('/agents/mcp', 'The manifest, WebMCP and limits', 'Agents', 'The surfaces agents read.', [
      { h: 'WebMCP', a: 'webmcp', t: 'The in-browser bridge.' },
    ]),
    page('/guides/authoring', 'Authoring pages', 'Guides', 'Write pages.', [
      { h: 'Add a page', a: 'add-a-page', t: 'Create the file in content/.' },
    ]),
    page('/api', 'API reference', 'API', 'Call the endpoints.', [{ t: 'Every endpoint needs a token.' }]),
    page('/pricing', 'Pricing', 'Sales', 'Plans and invoices.', [{ t: 'Capital and revenue, per seat.' }]),
  ],
};

test('a question is searched on the words that carry meaning', () => {
  assert.equal(rank(docs, 'how do I add a page')[0].href, '/guides/authoring#add-a-page');
});

test('a word reaches its family through the stem', () => {
  assert.equal(rank(docs, 'deployment')[0].href.split('#')[0], '/guides/deployment');
});

test('a word matches inside a camelCase identifier, from either side', () => {
  assert.equal(rank(docs, 'mcp')[0].href, '/agents/mcp');
  assert.equal(rank(docs, 'webmcp')[0].href, '/agents/mcp');
});

test('a word does not match inside another word', () => {
  const urls = rank(docs, 'api').map(hit => hit.href.split('#')[0]);
  assert.ok(urls.includes('/api'));
  assert.ok(!urls.includes('/pricing'), '"api" must not match "capital"');
});

test('a mistyped word is corrected, and the hit says so', () => {
  const [top] = rank(docs, 'frontmatr');
  assert.equal(top.href.split('#')[0], '/reference/frontmatter');
  assert.equal(top.corrected, 'frontmatter');
});

test('a query with a word the corpus does not use still answers with the rest', () => {
  const hits = rank(docs, 'cloudflare wrangler kubernetes');
  assert.ok(hits.length, 'two words out of three should still be an answer');
  assert.equal(hits[0].href.split('#')[0], '/guides/deployment');
});

test('the deep link answers what the page title does not already say', () => {
  assert.equal(rank(docs, 'deploy to cloudflare')[0].href, '/guides/deployment#on-cloudflare');
});

test('the agent and the reader get the same page for the same query', async () => {
  const { passages } = await import('../src/scripts/search-rank.ts');
  const [reader] = rank(docs, 'deploy to cloudflare');
  const [agent] = passages(docs, 'deploy to cloudflare', 5);
  assert.equal(agent.page.h, reader.href.split('#')[0]);
  assert.ok(passages(docs, 'deploy to cloudflare', 5).some(passage => passage.section.a === 'on-cloudflare'));
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
