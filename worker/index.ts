/**
 * The edge Worker that sits in front of the static build.
 *
 * The site is a static build and stays one: every byte this Worker serves comes
 * out of `dist` through the ASSETS binding, and none of it is rendered at
 * runtime. What the Worker adds is the two things a file on disk cannot do,
 * both of them for automated readers rather than people:
 *
 *   1. Discovery headers. A page announces its Markdown twin and the site's
 *      llms.txt in `Link` headers, so an agent that issues a HEAD — or reads
 *      the headers of a GET it already made — finds them without parsing HTML.
 *      The `<link rel="alternate">` tags in the document head say the same
 *      thing, and are invisible to anything that does not render the page.
 *
 *   2. Content negotiation. `Accept: text/markdown` on an ordinary page URL
 *      returns that page's Markdown. This is the convention Cloudflare's own
 *      documentation serves agents with, and it means a client needs to know
 *      only the page URL — not that this site happens to spell the Markdown
 *      twin `<page>.md`. Both spellings work; neither is privileged.
 *
 * Removing this Worker is supported and reversible: delete `main` and
 * `assets.binding` from wrangler.jsonc and the site serves as pure static
 * assets again, losing the two behaviours above and nothing else. That is why
 * nothing here is load-bearing for a human visitor.
 *
 * `run_worker_first` in wrangler.jsonc keeps fingerprinted assets, images and
 * share cards on the plain asset path, so this code runs for documents only.
 *
 * It also carries the agent surfaces — /mcp and /api/docs/ — because they must
 * live on this origin rather than a Worker of their own. Cloudflare's WebMCP
 * bridge discovers a site's MCP server at `<origin>/mcp`, so splitting them
 * would make the in-browser agent find nothing, and would add CORS and a second
 * deploy on every content change. See worker/agent/.
 */

import { agents, site } from '../src/docs.config';
import { API_CATALOG_PATH, handleApiCatalog } from './agent/catalog';
import type { Env } from './agent/corpus';
import { handleApi } from './agent/http';
import { handleMcp, handleServerCard, handleToolList, type McpExecutionContext } from './agent/mcp';

/**
 * Where the corpus index lives. Mirrors src/pages/llms.txt.ts.
 *
 * Prefixed, because this one is published in a `Link` header rather than looked
 * up: it has to name a URL a client can actually fetch.
 */
const LLMS_TXT = `${site.basePath}/llms.txt`;

/**
 * Crawlers worth counting in the Worker logs.
 *
 * Cloudflare's AI Crawl Control reports this far better, but it is a zone-level
 * feature: it needs the domain onboarded to Cloudflare, and reports nothing for
 * a workers.dev hostname. This is the portable floor — one structured log line
 * per AI crawler hit, visible in `wrangler tail` and in Workers Logs, which
 * `observability` in wrangler.jsonc already enables.
 */
const AI_CRAWLERS =
  /(GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-User|Claude-SearchBot|PerplexityBot|Perplexity-User|Google-Extended|Applebot-Extended|meta-externalagent|Amazonbot|CCBot|cohere-ai|Bytespider)/i;

/**
 * The quality value this Accept header gives a media type, 0 when absent.
 *
 * Substring matching on `text/markdown` would be wrong in the direction that
 * matters: a client listing `text/markdown;q=0.1` after `text/html` is saying
 * it would rather have HTML, and would still match. Only the relative q values
 * decide, which is also why a browser — whose Accept never names Markdown at
 * all — scores zero here and always gets the page.
 */
function quality(accept: string, type: string): number {
  for (const entry of accept.split(',')) {
    const [media, ...parameters] = entry.split(';');
    if (media.trim().toLowerCase() !== type) continue;
    const q = parameters.map(p => p.trim()).find(p => p.startsWith('q='));
    if (!q) return 1;
    const value = Number.parseFloat(q.slice(2));
    return Number.isFinite(value) ? value : 0;
  }
  return 0;
}

const prefersMarkdown = (accept: string | null) =>
  Boolean(accept) && quality(accept!, 'text/markdown') > quality(accept!, 'text/html');

/**
 * A document is a page, as opposed to an asset: no file extension, or the `.md`
 * twin of one. Everything else — fonts, scripts, images, sitemap.xml — passes
 * straight through.
 */
const isDocument = (pathname: string) => !/\.[^/]+$/.test(pathname) || pathname.endsWith('.md');

/** Mirrors src/lib/markdown-url.ts, which builds the same pair at build time. */
const markdownPathFor = (pathname: string) =>
  pathname.endsWith('/') ? `${pathname}index.md` : `${pathname}.md`;

/**
 * The two halves of a subpath deployment.
 *
 * When `site.basePath` is `/docs`, the browser asks for `/docs/getting-started`
 * but `dist/` holds the page at `getting-started` — nothing in the build tree
 * moves, only the URLs the build prints. So the prefix comes off before any
 * lookup and goes back on before anything is published in a header.
 *
 * `internal` is what the routing and the ASSETS binding see. `published` is what
 * the outside world sees. Getting these two backwards is the whole class of bug
 * this pair exists to prevent, which is why they are named for their audience
 * rather than for what they do to the string.
 *
 * Both are the identity function when `basePath` is empty, so a root deployment
 * pays nothing for this.
 */
const internal = (pathname: string) =>
  site.basePath && pathname.startsWith(site.basePath)
    ? pathname.slice(site.basePath.length) || '/'
    : pathname;

const published = (pathname: string) => `${site.basePath}${pathname}`;

/**
 * An asset request, addressed the way the ASSETS binding expects.
 *
 * The original `Request` is passed through untouched at the root, because
 * rebuilding one needlessly would drop nothing today but is one more thing to
 * keep correct.
 */
const assetRequest = (request: Request, url: URL, pathname: string) =>
  site.basePath ? new Request(new URL(pathname, url.origin), request) : request;

const pagePathFor = (markdownPath: string) =>
  markdownPath.endsWith('/index.md')
    ? markdownPath.slice(0, -'index.md'.length)
    : markdownPath.slice(0, -'.md'.length);

/**
 * Re-emit a response with the discovery headers attached.
 *
 * A response from the ASSETS binding has immutable headers, so it has to be
 * rebuilt rather than mutated. `Link` is appended rather than set: the relations
 * are independent statements about the same resource and each gets its own line.
 */
function annotate(
  response: Response,
  { origin, pagePath, asMarkdown }: { origin: string; pagePath: string; asMarkdown: boolean },
): Response {
  const headers = new Headers(response.headers);
  const absolute = (path: string) => new URL(path, origin).href;

  headers.append('Link', `<${absolute(LLMS_TXT)}>; rel="llms-txt"`);
  headers.append(
    'Link',
    `<${absolute(markdownPathFor(pagePath))}>; rel="alternate"; type="text/markdown"`,
  );
  headers.set('X-Llms-Txt', absolute(LLMS_TXT));

  /* Both spellings of the Markdown — the `.md` URL and a negotiated response at
     the page URL — declare the HTML page as the original. This is the header
     form of the `canonical:` key the Markdown's own YAML front matter carries,
     and it is what lets search crawlers read the Markdown without treating it
     as a duplicate competing with the page. */
  if (asMarkdown) {
    headers.append('Link', `<${absolute(pagePath)}>; rel="canonical"`);
    headers.set('Content-Type', 'text/markdown; charset=utf-8');
  }

  /* The page URL can answer with either representation, so caches must key on
     the request's Accept. Set on both branches: a cached HTML response without
     it would be replayed to an agent that asked for Markdown. */
  headers.append('Vary', 'Accept');

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * Who a rate limit is counted against.
 *
 * `CF-Connecting-IP` is set by the edge and cannot be spoofed by the client,
 * unlike `X-Forwarded-For`. Absent only in local development, where the limit
 * is not the point.
 */
const clientKey = (request: Request) =>
  request.headers.get('cf-connecting-ip') ?? 'local';

export default {
  async fetch(request: Request, env: Env, ctx: McpExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    /* Everything below routes on the internal path — see `internal` above.
       Only `annotate` and the server card put the prefix back on. */
    const path = internal(url.pathname);

    /*
     * The agent handlers match on the URL they are given: the MCP SDK is
     * configured with `route: '/mcp'`, and the API router compares against
     * `/api/docs/…`. Under a subpath they would each be handed `/docs/mcp` and
     * match nothing, so they receive a request addressed internally, exactly
     * like the ASSETS binding does.
     */
    const routed = assetRequest(request, url, `${path}${url.search}`);
    const routedUrl = site.basePath ? new URL(routed.url) : url;

    const agent = request.headers.get('user-agent') ?? '';
    const crawler = agent.match(AI_CRAWLERS)?.[1];
    if (crawler) console.log(JSON.stringify({ event: 'ai-crawler', crawler, path }));

    /* The agent surfaces, before anything else: they are not documents and
       must not pick up the Markdown negotiation below. */
    if (agents.enabled) {
      if (path === '/mcp' || path === '/mcp/') return handleMcp(routed, env, ctx);
      if (path === '/mcp/tools') return handleToolList(env);

      /*
       * Discovery, before a client commits to connecting. Both spellings are
       * served while the proposal settles — see handleServerCard.
       *
       * Matched against the *unprefixed* path as well, because `/.well-known/`
       * is defined relative to the origin and a client will never look for it
       * under `/docs`. On a subpath deployment those requests do not reach this
       * Worker at all — the route does not cover them — which is one of the
       * three things /guides/deployment says a subpath cannot have.
       */
      const wellKnown = url.pathname;
      if (wellKnown === '/.well-known/mcp.json' || wellKnown === '/.well-known/mcp/server-card/mcp') {
        return handleServerCard(`${url.origin}${site.basePath}`, env);
      }
      /* RFC 9727. Same origin-relative reasoning as the server card above, and
         the same subpath caveat. */
      if (wellKnown === API_CATALOG_PATH) {
        return handleApiCatalog(`${url.origin}${site.basePath}`, { http: agents.http });
      }

      if (agents.http) {
        const api = await handleApi(routed, env, routedUrl, clientKey(request));
        if (api) return api;
      }
    }

    if (!isDocument(path)) return env.ASSETS.fetch(assetRequest(request, url, path));

    if (path.endsWith('.md')) {
      const response = await env.ASSETS.fetch(assetRequest(request, url, path));
      if (!response.ok) return response;
      return annotate(response, {
        origin: url.origin,
        pagePath: published(pagePathFor(path)),
        asMarkdown: true,
      });
    }

    if (prefersMarkdown(request.headers.get('accept'))) {
      const markdown = await env.ASSETS.fetch(new URL(markdownPathFor(path), url.origin));
      /* A page with no Markdown twin — the 404, a redirect stub — falls through
         to HTML rather than answering 404 to a request the site can satisfy. */
      if (markdown.ok) {
        return annotate(markdown, { origin: url.origin, pagePath: published(path), asMarkdown: true });
      }
    }

    const response = await env.ASSETS.fetch(assetRequest(request, url, path));
    /* Only a page that exists has a Markdown twin to advertise. */
    if (response.status !== 200) return response;
    return annotate(response, { origin: url.origin, pagePath: published(path), asMarkdown: false });
  },
};
