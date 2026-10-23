/**
 * What an endpoint page learns from the OpenAPI document: its parameters, its
 * request body, the constraints on both, and a schema that contains itself.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { getApiReference } from '../src/lib/openapi-reference.ts';

const endpoint = { apiMethod: 'POST', apiPath: '/search/{index}', description: 'Search.' };

const spec = {
  servers: [{ url: 'https://api.example.test' }],
  security: [{ key: [] }],
  components: {
    securitySchemes: { key: { type: 'apiKey', in: 'header', name: 'X-Key' } },
    schemas: {
      /* A filter holds a list of filters: the shape that overflowed the stack. */
      Filter: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          and: { type: 'array', items: { $ref: '#/components/schemas/Filter' } },
          not: { $ref: '#/components/schemas/Filter' },
        },
      },
      Node: { type: 'array', items: { $ref: '#/components/schemas/Node' } },
    },
  },
  paths: {
    '/search/{index}': {
      parameters: [{ name: 'index', in: 'path', schema: { type: 'string' } }],
      post: {
        parameters: [
          { name: 'limit', in: 'query', description: 'Page size.', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } },
          { name: 'X-Trace', in: 'header', deprecated: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Filter' } } },
        },
        responses: {
          200: { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Filter' } } } },
          201: { description: 'nested', content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } },
        },
      },
    },
  },
};

test('a schema that contains itself does not overflow the stack', () => {
  const api = getApiReference(endpoint, spec);
  const depth = field => 1 + Math.max(0, ...field.children.map(depth));
  for (const field of [...api.body.fields, ...api.responses[0].fields]) {
    assert.ok(depth(field) <= 3, `${field.name} nests ${depth(field)} levels`);
  }
});

test('an array that contains itself still gets a type name', () => {
  const api = getApiReference(endpoint, spec);
  assert.match(api.responses[1].status, /201/);
});

test('parameters are grouped path, query, header, with the path one required', () => {
  const api = getApiReference(endpoint, spec);
  assert.deepEqual(api.parameters.map(p => `${p.location}:${p.name}`), [
    'path:index', 'query:limit', 'query:sort', 'header:X-Trace',
  ]);
  assert.equal(api.parameters[0].required, true);
  assert.equal(api.parameters.at(-1).deprecated, true);
});

test('defaults, allowed values and ranges are carried', () => {
  const { parameters } = getApiReference(endpoint, spec);
  const limit = parameters.find(p => p.name === 'limit');
  assert.deepEqual(limit.constraints, [
    { label: 'default', value: '20' },
    { label: 'range', value: '1–100' },
  ]);
  assert.equal(parameters.find(p => p.name === 'limit').description, 'Page size.');
  assert.deepEqual(parameters.find(p => p.name === 'sort').constraints, [{ label: 'one of', value: 'asc, desc' }]);
});

test('the request body is described, and an endpoint without one has none', () => {
  const api = getApiReference(endpoint, spec);
  assert.equal(api.body.required, true);
  assert.equal(api.body.contentType, 'application/json');
  assert.deepEqual(api.body.fields.map(f => f.name), ['field', 'and', 'not']);
  const noBody = { paths: { '/x': { get: { responses: {} } } } };
  assert.equal(getApiReference({ apiMethod: 'GET', apiPath: '/x', description: '' }, noBody).body, undefined);
});

test('authorizations are still resolved', () => {
  const [auth] = getApiReference(endpoint, spec).authorizations;
  assert.equal(auth.name, 'X-Key');
});
