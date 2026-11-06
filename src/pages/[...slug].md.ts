import type { CollectionEntry } from 'astro:content';
import type { APIRoute } from 'astro';
import { pageMarkdown } from '../lib/agent-manifest';
import { hrefFor } from '../lib/navigation';
import { getPublishedDocs } from '../lib/published';
import { headersFor } from '../lib/route-headers';

/**
 * Serves the Markdown source behind every docs page at `<page>.md` — the
 * "View as Markdown" link, and what "Copy page" copies. One route per entry,
 * generated at build time like the HTML page itself; no runtime rendering.
 *
 * Its headers apply in `astro dev` only. A static build writes the body to
 * disk, so in production they come from the `/*.md` rule that
 * src/lib/route-headers.ts writes into dist/_headers (and from the Worker).
 */
export async function getStaticPaths() {
  const entries = await getPublishedDocs();
  /* The homepage's Markdown twin retains its content id (e.g. /index.md): a
     bare `/.md` is not a path, but its canonical still points at `/`. */
  return entries.map(entry => ({ params: { slug: entry.id }, props: { entry } }));
}

interface Props { entry: CollectionEntry<'docs'> }

/**
 * Routed through `pageMarkdown` rather than calling `toPageMarkdown` directly:
 * these exact bytes are also what the `fetch` tool returns, what the indexer
 * uploads, and what agent-manifest.ts counts lines against. One function keeps
 * the four in step — see src/lib/agent-manifest.ts.
 *
 * The YAML header it emits carries `canonical`, pointing back at the HTML page:
 * the standard way to say "this file is a copy, that one is the page". See
 * src/pages/robots.txt.ts for the other half of that arrangement.
 */
export const GET: APIRoute = ({ props, site }) => {
  const { entry } = props as Props;
  const url = site ? new URL(hrefFor(entry.id), site).href : hrefFor(entry.id);
  return new Response(pageMarkdown(entry, url), {
    headers: headersFor('/*.md'),
  });
};
