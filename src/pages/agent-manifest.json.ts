import type { APIRoute } from 'astro';
import { buildAgentManifest } from '../lib/agent-manifest';

/**
 * /agent-manifest.json — the build's description of itself, for the Worker.
 *
 * Served as a normal asset rather than bundled into the Worker for two reasons:
 * the Worker script has a size budget that a few hundred pages of outline would
 * eat into, and a content change must not require redeploying code. The Worker
 * fetches it through the ASSETS binding and holds it in module scope, so the
 * cost is one read per isolate rather than one per request.
 *
 * Public because everything in it is derived from public content, and because
 * it is genuinely useful on its own — it is the site's table of contents with
 * line offsets, which nothing else publishes.
 */
export const GET: APIRoute = async ({ site }) =>
  new Response(JSON.stringify(await buildAgentManifest(site)), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
