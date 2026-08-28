/**
 * The relay between a WebMCP browser agent and this site's own MCP endpoint.
 *
 * This lives in a module rather than inline in `WebMcpBridge.astro` for one
 * reason: a test can import it. The bridge only runs inside a browser that ships
 * the WebMCP API, which no test here has, so the inline version was unverifiable
 * by construction — and it was in fact broken from the day the MCP endpoint
 * moved to the official SDK, silently, because nothing exercised it. What is
 * left in the component is the part that genuinely needs a browser: reading
 * `modelContext` and registering tools.
 *
 * Both defects came from assuming the transport was plain JSON-RPC over POST:
 *
 *   1. The specification requires a client to accept *both* `application/json`
 *      and `text/event-stream`, and the SDK enforces it with a 406. The bridge
 *      sent no `Accept` header at all, so every tool call was refused.
 *   2. Given that header, the SDK answers in SSE. `response.json()` throws on
 *      it. Fixing only the first defect would have moved the failure, not
 *      removed it.
 *
 * A third defect outlived both, for the same reason — no browser test — and was
 * found only by reading a fork's live HTML:
 *
 *   3. `/mcp/tools` and `/mcp` were written as bare absolute paths. At the empty
 *      `basePath` this repository ships they are correct, so duvlify.dev worked;
 *      under a subpath deployment they resolve against the origin root, where
 *      nothing answers. A fork serving its documentation from `/docs` registered
 *      zero tools while looking perfectly healthy. Both now go through
 *      `withBase`, and `test/publication.test.mjs` guards them there.
 */

/** A tool as published by `/mcp/tools`, in the shape `registerTool` expects. */
export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: unknown;
}

/**
 * What the endpoint requires, spelled out once.
 *
 * Both types, because "I accept either" is what the specification asks a client
 * to say, and the SDK reads it strictly.
 */
export const MCP_ACCEPT = 'application/json, text/event-stream';

/**
 * Reads a JSON-RPC response that may have arrived either way.
 *
 * The SDK picks the encoding, and it currently picks SSE. Handling both means a
 * future version that answers plain JSON — which the specification allows — does
 * not break the bridge again.
 *
 * In an SSE body the payload is the last `data:` line. There is only ever one
 * for a single request/response, but taking the last is what makes this correct
 * if the server ever sends progress notifications ahead of the result.
 */
export async function readRpcResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream')) return response.json();

  const payloads = (await response.text())
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim());

  if (!payloads.length) throw new Error('The stream carried no data.');
  return JSON.parse(payloads[payloads.length - 1]);
}

/**
 * The tool descriptors this site publishes, or none if the route is unreachable.
 *
 * `prefix` is everything that precedes `/mcp`: `site.basePath` in the browser,
 * so a subpath deployment reaches its own endpoint, and a whole origin in the
 * tests, which point this at a Worker running on a port.
 *
 * The empty list is deliberate — a documentation page still has to render when
 * its own MCP endpoint is down — but it used to be returned in complete silence,
 * which is how defect 3 above survived a full deployment. The warning costs
 * nothing in the browser that has no agent, because nothing calls this there.
 */
export async function loadTools(prefix = ''): Promise<ToolDescriptor[]> {
  const url = `${prefix}/mcp/tools`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    console.warn(`WebMCP bridge: ${url} answered ${response.status}, so no tools were registered.`);
    return [];
  }
  const body = (await response.json()) as { tools?: ToolDescriptor[] };
  return body.tools ?? [];
}

/**
 * Calls one tool and returns what the browser API wants: a string.
 *
 * An error comes back as its message rather than as a thrown exception, because
 * the caller here is a model reading text. A rejected promise is something the
 * agent runtime handles and the model never sees, which turns a fixable mistake
 * — a bad argument, a rate limit — into an unexplained silence.
 */
export async function callTool(
  name: string,
  args: Record<string, unknown>,
  prefix = '',
): Promise<string> {
  const response = await fetch(`${prefix}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: MCP_ACCEPT },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });

  const body = (await readRpcResponse(response)) as {
    result?: { content?: Array<{ text?: string }> };
    error?: { message?: string };
  };

  /* The text block already carries the JSON the model needs, so it is what gets
     returned — `structuredContent` has no place to go through a string API. */
  const text = body.result?.content?.map(part => part.text ?? '').join('\n');
  return text || body.error?.message || 'The tool returned nothing.';
}
