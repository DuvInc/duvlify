import { site } from '../../src/docs.config';
import type { Env } from './corpus';
import { toolByName, ToolError, toolset, type ToolContext, type ToolDefinition } from './tools';

/**
 * The same tools over plain HTTP, at /api/docs/.
 *
 * An MCP client is not the only kind of caller. A developer wants `curl`, a
 * script wants a URL it can put in a cron job, and neither should have to speak
 * JSON-RPC to read public documentation. So every tool also answers as a GET,
 * with the query string mapped onto the same JSON Schema and passed to the same
 * handler — there is no second implementation, so the two surfaces cannot
 * disagree about what `search` means.
 *
 * The path segment is deliberate. A site that documents a product has two APIs
 * in play: the product's, described at /openapi.json, and this one, which only
 * reads the documentation. `/api/docs/` says which is which in the URL itself,
 * before anyone has read a description — and the two OpenAPI documents carry
 * titles that repeat the distinction.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export const API_PREFIX = '/api/docs';

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra },
  });

/**
 * Coerces a query string into the object the tool's schema describes.
 *
 * Query strings are all strings; the schema is what says otherwise. Only the
 * declared properties are read, so an unexpected parameter is ignored rather
 * than passed through to a handler that would not know what to do with it.
 */
function coerce(tool: ToolDefinition, params: URLSearchParams): Record<string, unknown> {
  const schema = tool.inputSchema as {
    properties?: Record<string, { type?: string; enum?: string[]; maxLength?: number }>;
  };
  const input: Record<string, unknown> = {};

  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const raw = params.get(name);
    if (raw === null) continue;

    if (property.type === 'integer' || property.type === 'number') {
      input[name] = Number(raw);
      continue;
    }

    /*
     * The schema's own constraints are enforced here, not just its property
     * names. The MCP surface gets this from the SDK's Zod validation; without
     * the equivalent, this path would hand a handler values its schema forbids
     * — and `report_issue` forwards what it is given to an external webhook,
     * so an unchecked enum is an open relay for arbitrary text.
     */
    if (property.enum?.length && !property.enum.includes(raw)) continue;
    input[name] = property.maxLength ? raw.slice(0, property.maxLength) : raw;
  }

  /* `q` is what people type; `query` is what the schema calls it. */
  if (!input.query && params.get('q')) input.query = params.get('q');

  return input;
}

/**
 * The OpenAPI description of this API, generated from the tool definitions.
 *
 * Generated rather than written, because a hand-maintained copy of four schemas
 * is a copy that will be wrong within two changes. Adding a tool adds a path
 * here with no further edit.
 */
function openapi(origin: string, env: Env) {
  const paths: Record<string, unknown> = {};

  for (const tool of toolset(env)) {
    const schema = tool.inputSchema as {
      properties?: Record<string, Record<string, unknown>>;
      required?: string[];
    };

    paths[`${API_PREFIX}/${tool.name}`] = {
      get: {
        operationId: tool.name,
        summary: tool.description.split('. ')[0],
        description: tool.description,
        parameters: Object.entries(schema.properties ?? {}).map(([name, property]) => ({
          name,
          in: 'query',
          required: (schema.required ?? []).includes(name),
          description: property.description,
          schema: Object.fromEntries(Object.entries(property).filter(([key]) => key !== 'description')),
        })),
        responses: {
          200: { description: 'Success', content: { 'application/json': {} } },
          400: { description: 'The request was rejected by the tool.' },
          429: { description: 'Rate limited. Honour `Retry-After`.' },
        },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      /* Names the documentation, not the product — see the module comment. */
      title: `${site.name} Docs Search API`,
      version: '1.0.0',
      description:
        `Read-only access to the ${site.name} documentation: search it, list its pages, and fetch a page as Markdown. ` +
        'This API does not touch product data and needs no authentication. ' +
        'The same tools are available over the Model Context Protocol at /mcp.',
    },
    /*
     * `origin` never carries a path — origins do not — so a subpath deployment
     * needs `site.basePath` added by hand here. Missing it does not break
     * serving the spec, which the Worker's own route resolves correctly; it
     * breaks *reading* it, because a client combines `servers[0].url` with each
     * key in `paths` and would call the marketing site's root instead of this
     * documentation.
     */
    servers: [{ url: `${origin}${site.basePath}` }],
    paths,
  };
}

/** Which limiter guards a tool, given what it costs to run. */
const limiterFor = (env: Env, tool: ToolDefinition) =>
  tool.cost === 'search' ? env.RL_SEARCH : tool.cost === 'write' ? env.RL_WRITE : env.RL_READ;

export async function handleApi(
  request: Request,
  env: Env,
  url: URL,
  clientKey: string,
): Promise<Response | null> {
  if (!url.pathname.startsWith(`${API_PREFIX}/`) && url.pathname !== API_PREFIX) return null;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const segment = url.pathname.slice(API_PREFIX.length).replace(/^\//, '');

  if (segment === 'openapi.json') return json(openapi(url.origin, env));

  /* The index: what this API is and what it can do, so a caller who guessed the
     prefix is not met with a 404. */
  if (segment === '' || segment === 'index.json') {
    /*
     * `url` here is the *routed* URL, with `site.basePath` already stripped, so
     * these self-links have to put it back — the same correction `openapi()`
     * above makes for `servers[0].url`, and for the same reason. Without it a
     * subpath deployment advertised its own endpoints at the origin root, which
     * is the marketing site.
     */
    const base = `${url.origin}${site.basePath}`;
    return json({
      name: `${site.name} Docs Search API`,
      description: `Read-only access to the ${site.name} documentation.`,
      openapi: `${base}${API_PREFIX}/openapi.json`,
      mcp: `${base}/mcp`,
      endpoints: toolset(env).map(tool => ({
        url: `${base}${API_PREFIX}/${tool.name}`,
        description: tool.description,
      })),
    });
  }

  const tool = toolByName(segment, env);
  if (!tool) return json({ error: `Unknown endpoint "${segment}".` }, 404);

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'Use GET.' }, 405, { Allow: 'GET, OPTIONS' });
  }

  const limiter = limiterFor(env, tool);
  if (limiter) {
    const { success } = await limiter.limit({ key: `${clientKey}:${tool.cost}` });
    if (!success) {
      return json(
        { error: 'Too many requests. Wait a minute and retry.' },
        429,
        { 'Retry-After': '60' },
      );
    }
  }

  const context: ToolContext = {
    env,
    origin: url.origin,
    userAgent: request.headers.get('user-agent') ?? 'unknown',
  };

  try {
    const result = await tool.handler(coerce(tool, url.searchParams), context);
    return json(result, 200, {
      /* Public, identical for everyone, and regenerated on deploy. Worth
         caching at the edge; a minute is enough to absorb a burst without
         serving yesterday's documentation. */
      'Cache-Control': 'public, max-age=60',
      'X-Robots-Tag': 'noindex',
    });
  } catch (error) {
    const message = error instanceof ToolError ? error.message : 'The request failed.';
    return json({ error: message }, error instanceof ToolError ? 400 : 500);
  }
}
