import { createMcpHandler } from 'agents/mcp/server';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { site } from '../../src/docs.config';
import type { Env, RateLimiter } from './corpus';
import { toolByName, ToolError, toolset, type ToolContext, type ToolDefinition } from './tools';

/**
 * The MCP endpoint, served by the official SDK.
 *
 * This was hand-written JSON-RPC to begin with, on the reasoning that a
 * read-only server needs four methods and an SDK would be dead weight in a
 * Worker that runs in front of every page view. That reasoning was wrong, and
 * wrong in an instructive way: the protocol's surface is not the four methods,
 * it is everything around them. Three separate client-visible defects came out
 * of the hand-rolled version — no SSE response mode, a 200 where the spec wants
 * 405, and no HEAD support — and each was found by a client failing rather than
 * by reading the spec.
 *
 * `createMcpHandler` is Cloudflare's Workers adapter over
 * `@modelcontextprotocol/server`, the reference implementation. It owns the
 * parts that were getting silently wrong:
 *
 *   - Content negotiation between JSON and SSE, including the common
 *     `Accept: application/json, text/event-stream` case that means "either".
 *   - Protocol version negotiation across revisions.
 *   - Legacy transport compatibility (`legacy: "stateless"` by default), which
 *     is what lets older clients connect at all.
 *   - Origin and Host validation.
 *   - Input validation against the declared schema, before a handler runs.
 *
 * What stays ours is `tools.ts`: the tool definitions and their handlers know
 * nothing about MCP and are shared verbatim with the HTTP surface. Only the
 * protocol layer moved.
 */

/** Which limiter guards a tool, given what it costs to run. */
const limiterFor = (env: Env, tool: ToolDefinition): RateLimiter | undefined =>
  tool.cost === 'search' ? env.RL_SEARCH : tool.cost === 'write' ? env.RL_WRITE : env.RL_READ;

/**
 * Translates a tool's JSON Schema into the Zod shape `registerTool` expects.
 *
 * The definitions in tools.ts stay JSON Schema because that is what the HTTP
 * surface publishes as OpenAPI and what the WebMCP bridge hands the browser.
 * Converting here keeps one declaration rather than two that could disagree —
 * the alternative, authoring Zod and generating JSON Schema from it, would tie
 * the HTTP API's shape to a dependency it does not otherwise need.
 */
function zodShape(tool: ToolDefinition): Record<string, z.ZodTypeAny> {
  const schema = tool.inputSchema as {
    properties?: Record<string, { type?: string; enum?: string[]; description?: string }>;
    required?: string[];
  };
  const required = new Set(schema.required ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    let field: z.ZodTypeAny;
    if (property.enum?.length) {
      field = z.enum(property.enum as [string, ...string[]]);
    } else if (property.type === 'integer' || property.type === 'number') {
      field = z.number();
    } else {
      field = z.string();
    }
    if (property.description) field = field.describe(property.description);
    shape[name] = required.has(name) ? field : field.optional();
  }

  return shape;
}

/**
 * A fresh server per request — the stateless contract.
 *
 * Cloudflare documents the trap plainly: an `McpServer` held in module scope is
 * reused across requests, so anything it accumulates leaks between callers.
 * Building it inside the factory is what keeps that impossible.
 */
function buildServer(request: Request, env: Env) {
  const url = new URL(request.url);
  const context: ToolContext = {
    env,
    origin: url.origin,
    userAgent: request.headers.get('user-agent') ?? 'unknown',
  };
  const clientKey = request.headers.get('cf-connecting-ip') ?? 'local';

  const server = new McpServer({
    name: `${site.name} documentation`,
    version: '1.0.0',
  });

  for (const tool of toolset(env)) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: zodShape(tool) },
      async (input: Record<string, unknown>) => {
        const limiter = limiterFor(env, tool);
        if (limiter) {
          const { success } = await limiter.limit({ key: `${clientKey}:${tool.cost}` });
          if (!success) {
            /* Returned as a tool result rather than thrown, so the model reads
               it and backs off. A protocol error is handled by the client and
               never reaches the model, which then retries in a loop. */
            return {
              content: [
                { type: 'text' as const, text: 'Rate limited. Wait a minute before calling this tool again.' },
              ],
              isError: true,
            };
          }
        }

        try {
          const result = await toolByName(tool.name, env)!.handler(input, context);
          return {
            /* Both shapes: `structuredContent` is what a client parses, the
               JSON-encoded text block is what a client that only understands
               text shows the model. Sending one without the other loses half
               the audience. */
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            structuredContent: result as Record<string, unknown>,
          };
        } catch (error) {
          const message = error instanceof ToolError ? error.message : 'The tool failed.';
          return { content: [{ type: 'text' as const, text: message }], isError: true };
        }
      },
    );
  }

  return server;
}

/**
 * `allowedOriginHostnames: "*"` because this documentation is public and
 * read-only: every tool reads content that is already served unauthenticated at
 * a URL, so there is no state for a hostile page to change and nothing to
 * exfiltrate that a fetch could not already reach. Origin validation exists to
 * stop a browser being used as a confused deputy against an authenticated
 * server; there is no authentication here to abuse.
 */
/**
 * The SDK calls the factory with a single context object, not with the
 * Worker's `(request, env)` — `requestInfo` carries the HTTP request, and
 * `env` is not part of it. The bindings therefore have to be captured from the
 * surrounding `fetch` call, which is why the handler is built per request
 * rather than once at module scope.
 */
export const handleMcp = (request: Request, env: Env, ctx: McpExecutionContext) => {
  /*
   * A plain GET is a person pasting the URL into a browser. The SDK answers
   * 405 — correct for the protocol, useless for the human — so that one case is
   * intercepted here. Anything a client actually sends (POST, OPTIONS, or a GET
   * asking for a stream) goes to the SDK untouched.
   */
  if (request.method === 'GET' && !(request.headers.get('accept') ?? '').includes('text/event-stream')) {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          name: `${site.name} documentation`,
          protocol: 'mcp',
          transport: 'streamable-http (stateless)',
          hint: 'POST JSON-RPC here. Add this URL as a remote MCP server in your agent.',
          tools: toolset(env).map(tool => tool.name),
        }),
        { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' } },
      ),
    );
  }

  return createMcpHandler(
    factoryContext => buildServer((factoryContext.requestInfo as Request) ?? request, env),
    { route: '/mcp', allowedOriginHostnames: '*' },
  )(request, env, ctx as never);
};

/** The shape the runtime passes as the third argument to `fetch`. */
export interface McpExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/**
 * The MCP Server Card — a discovery document clients fetch before connecting.
 *
 * Served because clients already ask for it: Mistral's connector probes
 * `/.well-known/mcp/server-card/mcp` before it ever POSTs, and answering the
 * site's HTML 404 page tells it nothing. Both the path it uses and the
 * `/.well-known/mcp.json` from the proposal are served, since the two are still
 * settling.
 *
 * The format follows the registry's `server.json` shape, which the working
 * group's charter names as the thing a card should stay a subset of. SEP-2127
 * is still a draft, so this is a best-effort document rather than a conformant
 * one — cheap to serve, cheap to correct when the spec lands.
 */
/** `base` is the origin plus `site.basePath`: where this documentation answers. */
export const handleServerCard = (base: string, env: Env) =>
  new Response(
    JSON.stringify(
      {
        name: `${site.name.toLowerCase().replace(/\s+/g, '-')}-docs`,
        title: `${site.name} documentation`,
        description: site.description,
        version: '1.0.0',
        remotes: [{ type: 'streamable-http', url: `${base}/mcp` }],
        capabilities: { tools: {} },
        tools: toolset(env).map(tool => ({ name: tool.name, description: tool.description })),
      },
      null,
      2,
    ),
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    },
  );

/**
 * A plain list of the tools, for the in-browser WebMCP bridge.
 *
 * Not part of MCP. The bridge needs the descriptors before it can register
 * anything, and making it speak JSON-RPC just to read a static list would be
 * ceremony for its own sake.
 */
export const handleToolList = (env: Env) =>
  new Response(
    JSON.stringify({
      tools: toolset(env).map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    }),
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
