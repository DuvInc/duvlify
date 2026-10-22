import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mdxToMarkdown } from '../src/lib/mdx-to-markdown.ts';
import { markdownUrl } from '../src/lib/markdown-url.ts';
import { addressKey } from '../worker/client-address.ts';
import { createRedirectResolver } from '../worker/redirects.ts';
import { getApiReference } from '../src/lib/openapi-reference.ts';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { assertRedirectTargets } from '../scripts/check-redirects.mjs';

test('changelog Markdown keeps the release date, title and summary', () => {
  const markdown = mdxToMarkdown('<Update title="Files API" label="2026-10-22" description="Upload a file as raw bytes.">\n\nRelease details.\n\n</Update>');
  assert.match(markdown, /^## 2026-10-22: Files API/m);
  assert.match(markdown, /Upload a file as raw bytes\./);
  assert.match(markdown, /Release details\./);
});

test('IPv6 rotation and equivalent spelling share one limit while separate networks do not', () => {
  const key = addressKey('2001:db8:abcd:1234::1');
  assert.equal(key, addressKey('2001:0DB8:ABCD:1234:0:0:0:ffff'));
  assert.notEqual(key, addressKey('2001:db8:abcd:1235::1'));
  assert.equal(addressKey('::1'), addressKey('0:0:0:0:0:0:0:1'));
  assert.equal(addressKey('::ffff:192.0.2.1'), addressKey('192.0.2.1'));
  assert.equal(addressKey(null), 'unknown');
});

test('page moves preserve Markdown, query strings and a deployment prefix', () => {
  for (const base of ['', '/docs']) {
    const redirectFor = createRedirectResolver({ '/old': '/guides/new', '/welcome': '/' }, base);
    for (const old of ['/old', '/old/']) assert.equal(redirectFor(old, '?from=bookmark'), `${base}/guides/new?from=bookmark`);
    for (const old of ['/old.md', '/old/index.md']) assert.equal(redirectFor(old), `${base}/guides/new.md`);
    assert.equal(redirectFor('/welcome.md'), `${base}/index.md`);
    assert.equal(redirectFor('/unknown'), null);
    assert.equal(redirectFor('/toString'), null);
    const explicitIndex = createRedirectResolver({ '/guide/index': '/guide/new' }, base);
    assert.equal(explicitIndex('/guide/index.md'), `${base}/guide/new.md`);
  }
});

test('invalid moves fail before serving rather than redirecting outside the site or looping', () => {
  for (const moves of [
    { '/old': '//outside.test/path' }, { '/old': 'https://outside.test/path' },
    { '/old': '/a/../outside' }, { '/old': '/new?query=1' }, { '/old': '/new#fragment' },
    { '/old': '/new.md' }, { '/old/': '/new' }, { '/old': '/old' },
    { '/old': '/middle', '/middle': '/new' }, { '/old': '/new', '/new': '/old' },
  ]) assert.throws(() => createRedirectResolver(moves, ''), /redirect/i);
});

test('a redirect may only target a page that was actually built', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'duvlify-redirects-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'guide'));
  await writeFile(join(directory, 'index.html'), '<h1>Home</h1>');
  await writeFile(join(directory, 'guide', 'index.html'), '<h1>Guide</h1>');
  const root = pathToFileURL(`${directory}/`);
  assert.doesNotThrow(() => assertRedirectTargets({ '/old': '/guide', '/welcome': '/' }, root));
  assert.throws(() => assertRedirectTargets({ '/old': '/guied' }, root), /missing page.*guied/);
  await mkdir(join(directory, 'draft.html'));
  assert.throws(() => assertRedirectTargets({ '/old': '/draft' }, root), /missing page.*draft/);
});

const document = content => ({
  servers: [{ url: 'https://api.example.test/v1' }],
  paths: { '/files': { put: { requestBody: { content }, responses: { 204: { description: 'File stored.' } } } } },
});
const endpoint = { apiMethod: 'PUT', apiPath: '/files', description: 'Upload local bytes.' };

test('binary API examples send file bytes instead of serializing JSON', () => {
  const api = getApiReference(endpoint, document({ 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } }));
  assert.deepEqual(api.requests.map(item => item.id), ['curl', 'javascript']);
  assert.match(api.requests[0].code, /--data-binary '@file\.bin'/);
  assert.match(api.requests[1].code, /body: await readFile\("file\.bin"\)/);
  for (const request of api.requests) {
    assert.match(request.code, /application\/octet-stream/);
    assert.doesNotMatch(request.code, /JSON\.stringify|Content-Type: application\/json/);
  }
});

test('operations that also accept JSON keep their JSON examples', () => {
  const api = getApiReference(endpoint, document({
    'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } },
    'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
  }));
  assert.equal(api.requests.length, 7);
  assert.match(api.requests.find(item => item.id === 'javascript').code, /JSON\.stringify/);
});

test('request examples preserve Bearer authentication without adding it to API-key headers', () => {
  for (const content of [
    { 'application/json': { schema: { type: 'object' } } },
    { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
  ]) {
    const spec = {
      ...document(content),
      security: [{ bearer: [], apiKey: [] }],
      components: { securitySchemes: {
        bearer: { type: 'http', scheme: 'Bearer' },
        apiKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
      } },
    };
    const api = getApiReference(endpoint, spec);
    for (const request of api.requests) {
      assert.match(request.code, /Bearer <api-key>/, request.id);
      assert.doesNotMatch(request.code, /X-Api-Key[^\n]*Bearer/, request.id);
    }
  }
});

test('the generated Node.js upload sends the original bytes and accepts an empty 204 response', async t => {
  const bytes = Buffer.from([0, 1, 127, 128, 255]);
  let received;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = { method: request.method, type: request.headers['content-type'], bytes: Buffer.concat(chunks) };
    response.writeHead(204).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const directory = await mkdtemp(join(tmpdir(), 'duvlify-upload-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'file.bin'), bytes);
  const spec = document({ 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } });
  spec.servers[0].url = `http://127.0.0.1:${server.address().port}`;
  const api = getApiReference(endpoint, spec);
  const code = api.requests.find(item => item.id === 'javascript').code;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], { cwd: directory, timeout: 10000 });
  assert.deepEqual(received, { method: 'PUT', type: 'application/octet-stream', bytes });
});

test('Markdown links resolve the configured homepage with and without a trailing slash', () => {
  for (const home of ['/docs', '/docs/']) {
    assert.equal(markdownUrl(home, '/docs'), '/docs/index.md');
    assert.equal(markdownUrl(`https://example.test${home}`, '/docs'), 'https://example.test/docs/index.md');
  }
  assert.equal(markdownUrl('/', ''), '/index.md');
  assert.equal(markdownUrl('/guides/setup', ''), '/guides/setup.md');
  assert.equal(markdownUrl('/docs/guides/setup', '/docs'), '/docs/guides/setup.md');
});
