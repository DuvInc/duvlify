import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
/* The bridge's own relay, imported so the WebMCP tests exercise the shipped
   code rather than a copy of it. Node strips the types on import. */
import { callTool, loadTools, readRpcResponse } from '../src/lib/webmcp.ts';

/**
 * The agent surfaces, exercised against a real Worker.
 *
 * These boot `wrangler dev` and talk to it over HTTP rather than importing the
 * handlers directly, because the things most likely to break are not the pure
 * functions — they are the parts that only exist at runtime: the ASSETS
 * binding, the manifest fetch, the routing that has to keep /mcp away from the
 * Markdown content negotiation. A unit test of `consolidate()` would pass while
 * the endpoint 404s.
 *
 * Requires a build first; `npm test` does that.
 */

const ROOT = path.resolve(import.meta.dirname, '..');
/* Overridable because a fixed port is only free until it is not. Anything else
   listening on it — another project's `wrangler dev` is the likely one, since
   they all pick from the same small range — makes every suite below fail with a
   60 second timeout, and the cause is not visible in the result. */
const PORT = Number(process.env.AGENT_TEST_PORT ?? 8791);
/* The Worker only answers under `site.basePath`, because that is where its
   route is mounted. Reading it here keeps the suite valid for both topologies
   instead of encoding the root deployment as the only one. */
const BASE_PATH =
  readFileSync(path.join(ROOT, 'src', 'docs.config.ts'), 'utf8')
    .match(/^export const basePath = '([^']*)'/m)?.[1] ?? '';
const BASE = `http://127.0.0.1:${PORT}${BASE_PATH}`;
/** The origin itself, for the handful of paths that are never prefixed. */
const ORIGIN = `http://127.0.0.1:${PORT}`;

let server;
/** Pages picked out of the built manifest, so the suite fits any distribution. */
let manifest, samplePage, otherPage, sampleTab;

/**
 * The id of a page that sets `draft: true`, read from content/ rather than named.
 *
 * This used to be the literal `guides/versioning`, a page from the demo content
 * this site replaced. Once that file was gone the draft assertions did not fail
 * — they stopped meaning anything. One skipped itself, and the `list_pages` one
 * went on asserting that a page which cannot exist was absent. Deriving the id
 * keeps both honest on any distribution, and returns null only when a site
 * genuinely ships no draft.
 */
const findDraftId = (dir = path.join(ROOT, 'content'), prefix = '') => {
  if (!existsSync(dir)) return null;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const id = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const found = findDraftId(path.join(dir, entry.name), id);
      if (found) return found;
      continue;
    }
    if (!/\.mdx?$/.test(entry.name)) continue;
    const frontmatter = readFileSync(path.join(dir, entry.name), 'utf8').split(/^---$/m)[1] ?? '';
    if (/^\s*draft:\s*true\s*$/m.test(frontmatter)) return id.replace(/\.mdx?$/, '');
  }
  return null;
};
const draftId = findDraftId();

/**
 * Streamable HTTP requires a client to accept *both* content types — the SDK
 * answers 406 otherwise — and it replies with SSE, so the frame has to be
 * unwrapped before the JSON-RPC body is readable.
 */
const MCP_ACCEPT = 'application/json, text/event-stream';

const unwrap = text => {
  const marker = text.indexOf('data: ');
  return JSON.parse(marker === -1 ? text : text.slice(marker + 6));
};

const rpc = async (method, params) => {
  const response = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: MCP_ACCEPT },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  assert.equal(response.status, 200, `${method} returned ${response.status}`);
  return unwrap(await response.text());
};

const call = async (name, args) => {
  const body = await rpc('tools/call', { name, arguments: args });
  assert.ok(body.result, `tools/call ${name} returned no result`);
  return body.result;
};

before(async () => {
  assert.ok(
    existsSync(path.join(ROOT, 'dist', 'agent-manifest.json')),
    'dist/agent-manifest.json is missing — run `npm run build` first (npm test does this).',
  );

  server = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--local', '--log-level', 'error'], {
    cwd: ROOT,
    stdio: 'ignore',
  });

  manifest = JSON.parse(readFileSync(path.join(ROOT, 'dist', 'agent-manifest.json'), 'utf8'));
  /*
   * Chosen from the build rather than named: the same suite runs against every
   * distribution on this engine, and none of them share page ids.
   *
   * Excludes the configured homepage, if one exists: `hrefFor` serves it at
   * `${basePath}/` rather than `${basePath}/${id}` (see src/lib/navigation.ts),
   * so its URL does not end with its own id and every round-trip assertion below
   * that checks `url.endsWith(id)` would fail on it — not because anything is
   * broken, but because the homepage is the one page this site deliberately
   * reaches by a different URL than its id.
   */
  const isRegularPage = page => page.url.replace(/\/$/, '').endsWith(page.id);
  samplePage =
    manifest.pages.find(page => isRegularPage(page) && page.headings.length >= 3) ??
    manifest.pages.find(isRegularPage) ??
    manifest.pages[0];
  otherPage =
    manifest.pages.find(page => page.id !== samplePage.id && isRegularPage(page)) ??
    manifest.pages.find(page => page.id !== samplePage.id) ??
    samplePage;
  sampleTab = samplePage.tab;

  /* Poll rather than sleep: the boot time varies with how warm the toolchain
     is, and a fixed wait is either flaky or slow. */
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const probe = await fetch(`${BASE}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: MCP_ACCEPT },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      if (probe.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      throw new Error(
        `wrangler dev did not start within 60s on port ${PORT}.\n` +
          `  If something else is already listening there, this is what it looks like:\n` +
          `    lsof -nP -iTCP:${PORT} -sTCP:LISTEN\n` +
          `  Then either stop it, or run the suite elsewhere:\n` +
          `    AGENT_TEST_PORT=8892 npm test`,
      );
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
});

after(() => server?.kill());

describe('MCP protocol', () => {
  test('initialize negotiates a protocol version', async () => {
    const { result } = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    assert.ok(result.protocolVersion, 'no protocol version negotiated');
    assert.ok(result.capabilities.tools, 'no tools capability advertised');
    assert.ok(result.serverInfo.name, 'no server name');
  });

  test('an unknown method is a JSON-RPC error, not a crash', async () => {
    const body = await rpc('does/not/exist', {});
    assert.equal(body.error.code, -32601);
  });

  test('a client that accepts both content types is served', async () => {
    /* The specification requires both; the SDK enforces it. This is the
       handshake every real client performs. */
    const response = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: MCP_ACCEPT },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(response.status, 200);
    assert.ok(unwrap(await response.text()).result.tools.length > 0);
  });

  test('a client accepting only JSON is refused, per the specification', async () => {
    /* Not a courtesy failure: Streamable HTTP obliges the client to accept a
       stream, because the server may answer with one. */
    const response = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(response.status, 406);
  });

  test('a browser GET gets a human-readable description rather than 405', async () => {
    /* The SDK answers 405, which is right for a client and useless for a
       person pasting the URL. worker/agent/mcp.ts intercepts that one case. */
    const response = await fetch(`${BASE}/mcp`, { headers: { Accept: 'text/html' } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.protocol, 'mcp');
    assert.ok(body.tools.includes('search'));
  });

  test('the server card is served at both discovery paths', async () => {
    /* Always at the origin root, never under `site.basePath`: `/.well-known/`
       is defined relative to the origin and no client looks for it anywhere
       else. On a subpath deployment these requests never reach this Worker —
       see the limitations in content/guides/deployment.mdx. */
    for (const path of ['/.well-known/mcp.json', '/.well-known/mcp/server-card/mcp']) {
      const response = await fetch(`${ORIGIN}${path}`);
      assert.equal(response.status, 200, `${path} returned ${response.status}`);
      const card = await response.json();
      assert.equal(
        card.remotes?.[0]?.url,
        `${ORIGIN}${BASE_PATH}/mcp`,
        `${path}: the card points somewhere the server does not answer`,
      );
    }
  });

  test('tools/list advertises search, fetch and list_pages', async () => {
    const { result } = await rpc('tools/list');
    const names = result.tools.map(tool => tool.name);
    assert.deepEqual(names.slice(0, 3), ['search', 'fetch', 'list_pages']);
    for (const tool of result.tools) {
      assert.ok(tool.description.length > 60, `${tool.name}: description too thin to guide a model`);
      assert.equal(tool.inputSchema.type, 'object');
    }
  });

  test('report_issue is hidden unless a feedback webhook is configured', async () => {
    const config = readFileSync(path.join(ROOT, 'src', 'docs.config.ts'), 'utf8');
    const configured = /webhook:\s*'https?:/.test(config);
    const { result } = await rpc('tools/list');
    const present = result.tools.some(tool => tool.name === 'report_issue');
    assert.equal(present, configured, 'report_issue visibility does not match the config');
  });
});

describe('search', () => {
  test('groups passages under the page they came from', async () => {
    const { structuredContent } = await call('search', { query: 'deployment custom domain' });
    assert.ok(structuredContent.pages.length > 0, 'no results at all');

    for (const page of structuredContent.pages) {
      for (const key of ['url', 'title', 'description', 'type', 'tab', 'totalLines']) {
        assert.ok(page[key] !== undefined, `page is missing ${key}`);
      }
      assert.ok(page.chunks.length > 0, `${page.url}: page with no passages`);
      assert.equal(page.id, undefined, 'an id leaked into the response — pages are identified by url');
      /* No score anywhere: the ordering is the ranking. */
      assert.equal(page.score, undefined, 'a page score leaked into the response');
      for (const chunk of page.chunks) {
        assert.equal(chunk.score, undefined, 'a chunk score leaked into the response');
        assert.equal(chunk.url, undefined, 'a chunk url leaked into the response');
        assert.ok(chunk.text.length > 0, 'empty passage');
        assert.ok(chunk.lines[0] >= 1 && chunk.lines[1] >= chunk.lines[0], 'nonsensical line range');
        assert.ok(chunk.lines[1] <= page.totalLines, 'line range runs past the end of the page');
      }
    }
  });

  test('passages within a page are in reading order', async () => {
    const { structuredContent } = await call('search', { query: 'page component frontmatter' });
    for (const page of structuredContent.pages) {
      const starts = page.chunks.map(chunk => chunk.lines[0]);
      assert.deepEqual(starts, [...starts].sort((a, b) => a - b), `${page.url}: passages out of order`);
    }
  });

  test('line ranges point at the real text of the real page', async () => {
    const { structuredContent } = await call('search', { query: samplePage.title });
    assert.ok(structuredContent.pages.length, 'a page title matched nothing');
    const page = structuredContent.pages[0];
    const chunk = page.chunks[0];

    /* The page URL is absolute against the deployed origin; the test server is
       local, so only the path carries over. Against ORIGIN rather than BASE:
       the pathname already carries `site.basePath`, and BASE would repeat it. */
    const markdown = await (await fetch(`${ORIGIN}${new URL(page.url).pathname}.md`)).text();
    const lines = markdown.split('\n');
    assert.equal(lines.length, page.totalLines, 'totalLines disagrees with the served Markdown');

    const quoted = lines.slice(chunk.lines[0] - 1, chunk.lines[1]).join('\n').trim();
    assert.ok(quoted.startsWith(chunk.text.split('\n')[0]), 'the line range does not contain the passage');
  });

  test('limit is honoured and clamped', async () => {
    const one = await call('search', { query: 'documentation', limit: 1 });
    const total = one.structuredContent.pages.reduce((sum, page) => sum + page.chunks.length, 0);
    assert.equal(total, 1, 'limit: 1 returned more than one passage');

    /* Above the ceiling: clamped, not rejected. */
    const many = await call('search', { query: 'documentation', limit: 9999 });
    assert.ok(many.structuredContent.pages.length > 0);
  });

  test('a query matching nothing returns an empty list, not an error', async () => {
    const { structuredContent, isError } = await call('search', { query: 'zzqqxx nonexistent gibberish' });
    assert.ok(!isError);
    assert.deepEqual(structuredContent.pages, []);
  });

  test('an empty query is a tool error the model can read', async () => {
    const result = await call('search', { query: '   ' });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /query/i);
  });
});

describe('fetch', () => {
  test('returns the same bytes as the page Markdown route', async () => {
    const { structuredContent } = await call('fetch', { url: `${BASE}/${samplePage.id}` });
    const direct = await (await fetch(`${BASE}/${samplePage.id}.md`)).text();
    assert.equal(structuredContent.text, direct, 'fetch and <page>.md disagree');
    assert.ok(structuredContent.url.endsWith(samplePage.id));
    assert.equal(structuredContent.id, undefined, 'fetch still returns an id');
  });

  test('accepts a URL as well as an id', async () => {
    const path = new URL(otherPage.url).pathname;
    const { structuredContent } = await call('fetch', { url: path });
    assert.equal(new URL(structuredContent.url).pathname, path, 'a bare path was not accepted');
  });

  test('an unknown id is a tool error naming the way out', async () => {
    const result = await call('fetch', { url: 'no/such/page' });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /list_pages/);
  });

  test('a draft page cannot be fetched', async t => {
    /* Only meaningful where the distribution actually ships a draft. */
    if (!draftId) return t.skip('no page in content/ sets draft: true');

    const result = await call('fetch', { url: draftId });
    assert.equal(result.isError, true, `the draft ${draftId} was reachable through the MCP`);
  });
});

describe('list_pages', () => {
  test('lists every published page and no drafts', async () => {
    const { structuredContent } = await call('list_pages', {});
    assert.equal(structuredContent.total, manifest.pages.length);
    if (draftId) {
      assert.ok(
        !structuredContent.pages.some(page => page.url.endsWith(draftId)),
        `the draft ${draftId} was listed`,
      );
    }
  });

  test('filters compose', async () => {
    const { structuredContent } = await call('list_pages', { tab: sampleTab, type: samplePage.type });
    assert.ok(structuredContent.pages.length > 0, `no page in tab ${sampleTab}`);
    for (const page of structuredContent.pages) {
      assert.equal(page.tab, sampleTab);
      assert.equal(page.type, samplePage.type);
    }
  });
});

describe('HTTP API parity', () => {
  test('every tool answers identically over MCP and over HTTP', async () => {
    const cases = [
      ['search', { query: samplePage.title }, `search?query=${encodeURIComponent(samplePage.title)}`],
      ['list_pages', { tab: sampleTab }, `list_pages?tab=${encodeURIComponent(sampleTab)}`],
      ['fetch', { url: otherPage.id }, `fetch?url=${encodeURIComponent(otherPage.id)}`],
    ];

    for (const [name, args, query] of cases) {
      const viaMcp = (await call(name, args)).structuredContent;
      const viaHttp = await (await fetch(`${BASE}/api/docs/${query}`)).json();
      assert.deepEqual(viaHttp, viaMcp, `${name}: MCP and HTTP responses differ`);
    }
  });

  test('the generated OpenAPI describes exactly the live tools', async () => {
    const spec = await (await fetch(`${BASE}/api/docs/openapi.json`)).json();
    const { result } = await rpc('tools/list');

    assert.equal(spec.openapi, '3.1.0');
    assert.match(spec.info.title, /Docs Search API/, 'the spec title does not distinguish it from the product API');

    const described = Object.keys(spec.paths).map(route => route.split('/').pop()).sort();
    const live = result.tools.map(tool => tool.name).sort();
    assert.deepEqual(described, live, 'the OpenAPI paths and the tool list disagree');

    /*
     * `servers[0].url` combines with each key in `paths` to form the URL a
     * client actually calls. An origin never carries a path, so under a
     * subpath deployment this has to add `site.basePath` by hand — and it did
     * not, for a while: the spec served fine, but described itself as living
     * one level higher than it does. Checked by reconstructing the call the
     * way a client would, against the server this suite is actually running.
     */
    /* `route` is already `/api/docs/<tool>` — the key includes the prefix,
       the spec does not repeat it in `servers[0].url`. */
    const [route] = Object.keys(spec.paths);
    assert.equal(
      `${spec.servers[0].url}${route}`,
      `${BASE}${route}`,
      'the spec, combined with its own servers entry, does not name a URL this server answers',
    );
  });

  test('the API index points at both surfaces', async () => {
    const index = await (await fetch(`${BASE}/api/docs`)).json();
    assert.ok(index.mcp.endsWith('/mcp'));
    assert.ok(index.openapi.endsWith('/api/docs/openapi.json'));
  });

  test('a bad endpoint 404s and a bad method 405s', async () => {
    assert.equal((await fetch(`${BASE}/api/docs/nope`)).status, 404);
    assert.equal((await fetch(`${BASE}/api/docs/search`, { method: 'POST' })).status, 405);
  });

  test('API responses are not indexable', async () => {
    const response = await fetch(`${BASE}/api/docs/search?query=deployment`);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex');
  });
});

describe('the agent routes do not disturb the site', () => {
  test('/mcp is not treated as a document', async () => {
    const response = await fetch(`${BASE}/mcp`, { headers: { Accept: 'text/markdown' } });
    assert.equal(response.headers.get('content-type')?.split(';')[0], 'application/json');
  });

  test('pages still negotiate Markdown', async () => {
    const response = await fetch(`${BASE}/${samplePage.id}`, { headers: { Accept: 'text/markdown' } });
    assert.equal(response.headers.get('content-type')?.split(';')[0], 'text/markdown');
  });

  test('the manifest is served and matches the built pages', async () => {
    const manifest = await (await fetch(`${BASE}/agent-manifest.json`)).json();
    assert.equal(manifest.version, 1);
    assert.ok(manifest.pages.every(page => page.headings.every(h => h.start <= h.end)));
  });
});

/**
 * The API catalog (RFC 9727), checked as a linkset rather than as a file that
 * exists.
 *
 * Every assertion here is a structural rule from RFC 9264 §4.2 or RFC 9727 §3.
 * They are worth stating because the document is only useful if a *generic*
 * linkset client can read it: a catalog with `service-desc` as an object rather
 * than an array of objects, or served as `application/json`, is well-formed JSON
 * that no consumer will parse.
 */
describe('API catalog', () => {
  /*
   * Loaded lazily rather than in a `before` hook, because a hook cannot skip:
   * under a subpath deployment the origin root belongs to another Worker and
   * there is nothing here to assert — the same condition the server-card test
   * above guards. At the origin root, never under `site.basePath`.
   */
  let loaded;
  const load = () => (loaded ??= (async () => {
    const response = await fetch(`${ORIGIN}/.well-known/api-catalog`);
    return { response, catalog: await response.json() };
  })());

  const SUBPATH_SKIP = 'origin-root discovery belongs to the marketing Worker under a subpath deployment';

  test('is served as a linkset, not as generic JSON', async t => {
    if (BASE_PATH) return t.skip(SUBPATH_SKIP);
    const { response } = await load();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type')?.split(';')[0], 'application/linkset+json');
  });

  test('has a linkset array of link context objects', async t => {
    if (BASE_PATH) return t.skip(SUBPATH_SKIP);
    const { catalog } = await load();
    assert.ok(Array.isArray(catalog.linkset), 'the top-level `linkset` member is not an array');
    assert.ok(catalog.linkset.length > 0, 'this distribution catalogs no API at all');
    for (const context of catalog.linkset) {
      assert.equal(typeof context.anchor, 'string', 'a link context object has no `anchor`');
      assert.doesNotThrow(() => new URL(context.anchor), `anchor is not absolute: ${context.anchor}`);
    }
  });

  test('every relation is an array of targets, each with an absolute href', async t => {
    if (BASE_PATH) return t.skip(SUBPATH_SKIP);
    const { catalog } = await load();
    for (const context of catalog.linkset) {
      for (const [relation, targets] of Object.entries(context)) {
        if (relation === 'anchor') continue;
        assert.ok(Array.isArray(targets), `${relation} is not an array of link targets`);
        for (const target of targets) {
          assert.equal(typeof target.href, 'string', `${relation} has a target with no href`);
          assert.doesNotThrow(() => new URL(target.href), `${relation} href is not absolute`);
        }
      }
    }
  });

  test('distinguishes the documented API from this documentation\'s own', async t => {
    if (BASE_PATH) return t.skip(SUBPATH_SKIP);
    const { catalog } = await load();
    const anchors = catalog.linkset.map(context => context.anchor);
    const own = anchors.filter(anchor => anchor.startsWith(BASE));

    assert.equal(own.length, 1, 'expected exactly one entry anchored on this origin');
    assert.ok(own[0].endsWith('/api/docs'), `the documentation's own API is not anchored at /api/docs: ${own[0]}`);

    /* A product entry appears only when an OpenAPI document is configured, and a
       site documenting something that is not a web API configures none — this
       one included. Asserting it is always present would make the catalog's
       correct behaviour look like a regression. What must hold either way is
       that nothing foreign is anchored on this origin: the entry above is the
       documentation's own API, and a product API is by definition somewhere
       else. */
    const foreign = anchors.filter(anchor => !anchor.startsWith(BASE));
    const documentsAnApi = existsSync(path.join(ROOT, 'dist', 'openapi.json'));
    assert.equal(
      foreign.length,
      documentsAnApi ? 1 : 0,
      documentsAnApi
        ? 'a spec is configured but the product API is missing from the catalog'
        : `no spec is configured, so nothing should be anchored off-origin: ${foreign.join(', ')}`,
    );
  });

  test('the links it publishes are reachable', async t => {
    if (BASE_PATH) return t.skip(SUBPATH_SKIP);
    const { catalog } = await load();
    const entry = catalog.linkset.find(context => context.anchor.startsWith(BASE));
    for (const relation of ['service-desc', 'service-doc', 'status']) {
      const href = entry[relation]?.[0]?.href;
      assert.ok(href, `the documentation's own API entry has no ${relation}`);
      const probe = await fetch(href);
      assert.equal(probe.status, 200, `${relation} points at ${probe.status}: ${href}`);
    }
  });
});

/**
 * The in-browser bridge, exercised through the module the browser actually runs.
 *
 * The point of importing `src/lib/webmcp.ts` rather than re-implementing the
 * request here is that a re-implementation is what let the bridge rot: this file
 * already spelled out the 406 and the SSE frame at the top, and the bridge still
 * sent neither. A test that builds its own request would have stayed green
 * through both defects.
 *
 * There is no `modelContext` in Node, so what is not covered is the handful of
 * lines left in the component — reading the global and calling `registerTool`.
 */
describe('WebMCP bridge', () => {
  test('publishes descriptors in the shape registerTool requires', async () => {
    const tools = await loadTools(BASE);
    assert.ok(tools.length >= 3, `expected the toolset, got ${tools.length}`);
    for (const tool of tools) {
      assert.equal(typeof tool.name, 'string');
      assert.ok(tool.description, `${tool.name} has no description`);
      assert.equal(tool.inputSchema?.type, 'object', `${tool.name} has no object schema`);
    }
  });

  test('a relayed call reaches the endpoint and comes back as text', async () => {
    const answer = await callTool('list_pages', { limit: 1 }, BASE);
    assert.doesNotThrow(() => JSON.parse(answer), 'the relay returned something unparseable');
    assert.ok(JSON.parse(answer).total > 0);
  });

  test('every advertised tool is callable through the relay', async () => {
    for (const tool of await loadTools(BASE)) {
      const answer = await callTool(tool.name, {}, BASE);
      /* Several tools reject empty arguments, which is correct — what matters
         is that the relay surfaces the reason as readable text rather than
         throwing or returning its "nothing" placeholder. */
      assert.ok(answer.length > 0, `${tool.name} relayed nothing`);
      assert.notEqual(answer, 'The tool returned nothing.', `${tool.name} produced no content`);
    }
  });

  test('a failing call is returned as a message, not thrown', async () => {
    const answer = await callTool('fetch', { url: 'https://example.com/nope' }, BASE);
    assert.match(answer, /list_pages|not found|no page/i);
  });

  test('reads a plain JSON reply as well as an SSE one', async () => {
    const payload = { jsonrpc: '2.0', id: 1, result: { ok: true } };
    const asJson = new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json' },
    });
    const asStream = new Response(`event: message\ndata: ${JSON.stringify(payload)}\n\n`, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
    assert.deepEqual(await readRpcResponse(asJson), payload);
    assert.deepEqual(await readRpcResponse(asStream), payload);
  });
});
