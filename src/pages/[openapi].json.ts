import type { APIRoute } from 'astro';
import { openapiSpec } from '../openapi.config';
import { hasOpenApiSpec } from '../lib/openapi-spec';

/**
 * The API description, served whole at /openapi.json.
 *
 * The endpoint pages render this spec as prose, tables and code samples, which
 * is the right shape for a person and the wrong one for an agent writing code
 * against the API: it wants the exact parameter names, the enum members and the
 * response schema, not a description of them. Publishing the source document
 * costs one route and removes the entire class of "the docs said the field was
 * optional" mistakes.
 *
 * A dynamic route with a single generated path, rather than a plain
 * `openapi.json.ts`, because a static endpoint always emits and this one must
 * not: a distribution with no spec returns no paths here and so writes no file.
 * See src/lib/openapi-spec.ts.
 */
export function getStaticPaths() {
  return hasOpenApiSpec ? [{ params: { openapi: 'openapi' } }] : [];
}

export const GET: APIRoute = () =>
  new Response(JSON.stringify(openapiSpec, null, 2), {
    headers: {
      /* The type registered for OpenAPI 3.1; agents sniffing for it look here
         before they look at the extension. */
      'Content-Type': 'application/openapi+json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
