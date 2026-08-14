---
title: "Deploying"
description: "The build is static output. Deploy it to Cloudflare for every feature, or to any static host, with subdomain and subpath options and their costs."
canonical: "https://duvlify.dev/guides/deployment"
updated: "2026-08-14"
---

# Deploying

The build is static. `npm run build` writes `dist/`, and `dist/` is a complete
site: HTML, fingerprinted assets, Markdown twins, share cards, feeds, the
search index, and the agent manifest. Everything else in the repository stays
behind.

```bash
npm run build     # astro check && astro build
npm test          # builds, then asserts the outputs and the agent surfaces
npm run deploy       # build + index:sync + wrangler deploy
npm run deploy:fast  # build + wrangler deploy, no reindex
```

`deploy` runs the semantic index upload between the build and the deploy. This
way, a content change cannot ship with a stale index behind it. Two
consequences follow:

- With `agents.retrieval` set to `'lexical'`, the default, the upload step
  exits immediately and costs nothing.
- With `'ai-search'`, the upload step **requires `CLOUDFLARE_ACCOUNT_ID` and
  `AI_SEARCH_TOKEN` in the environment, and fails the whole command without
  them**. This is deliberate. Publishing code against an index that no longer
  matches it is worse than not publishing. Run `wrangler deploy` alone if you
  genuinely need to ship code without touching the index.

## Set the origin first

This is the one setting that has to be right before anything is published, and
the only one whose failure is invisible. Everything else on this page can be
fixed after the fact.

`SITE_URL` is the origin the build prints into everything absolute: every
`canonical` tag, every `sitemap.xml` row, `llms.txt` and `llms-full.txt`, the
Atom feed, the share-card URLs, and every URL in the agent manifest.

**Where it comes from**, in precedence order:

|                               |                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| An environment variable       | `SITE_URL=https://docs.your-domain.com npm run deploy`, or your host's build settings    |
| `.env` in the repository root | one `SITE_URL=` line. Read by the build and by the deploy scripts                        |
| Neither                       | the build falls back to `https://docs.example.com`, which is wrong everywhere it appears |

A real environment variable wins over `.env`, so a host's build settings or a CI
secret cannot be overridden by a developer's local file.

> **Warning: Why this one is guarded twice**
>
> A site canonicalised to a host nobody owns is not a visible failure. Every page
> renders, the search works, the build log is clean, and every crawler and every
> AI agent is quietly pointed somewhere else. There is nothing to notice.
>
> So two different things watch for it, because there are two ways out of this
> repository:
>
> - **`npm run deploy` and `npm run deploy:fast` refuse to upload.**
>   `npm run check:origin` runs between the build and the upload, reads the built
>   `sitemap.xml` (which contains nothing but URLs), and stops if any of them
>   still names the placeholder.
> - **Every other path gets a warning at the end of the build.** Uploading
>   `dist/` by hand, or letting Netlify, Vercel or Workers Builds run
>   `npm run build` for you, never reaches that check. So the build itself prints
>   a warning after its summary when the origin is still the placeholder.
>
> Neither is fatal at build time on purpose: a fresh clone has to build and pass
> its tests with nothing configured. The refusal happens at the moment of
> publishing, which is the moment it matters.
>
> Both exist because this shipped once. `.env` held the right value, the build
> read only the environment, and 22 sitemap rows went to production naming
> `docs.example.com`.

> **Note: A git-connected build indexes itself, and one `` `??` `` is why**
>
> Connect the repository to **Workers Builds** and a push publishes the site.
> That path can reach `index:sync` too, with no build variables and no secrets
> configured: Workers Builds supplies its own API token to the build, and the
> script reads `AI_SEARCH_TOKEN ?? CLOUDFLARE_API_TOKEN`. The fallback is the
> load-bearing half of that line: the token the platform provides arrives under
> the second name, and observed on a real account it carries enough scope for the
> AI Search API as well.
>
> So set the build command to `npm run build && npm run index:sync`, or to
> `npm run deploy` with a deploy command of `npx wrangler deploy`. Measured on a
> 198-page site: the index synced inside the build, then the deploy ran, with
> nothing configured beyond the commands.
>
> Do not take the scope on faith on a new account. If `index:sync` fails there
> for want of permission, set `AI_SEARCH_TOKEN` as a build variable and the
> first half of that `??` takes over.

## On Cloudflare

Cloudflare is the intended host. It is the only host where every feature works
without a substitution.

`wrangler.jsonc` declares a Worker in front of the static assets. Two settings
there matter most:

- **`html_handling: "drop-trailing-slash"`** must agree with
  `trailingSlash: 'never'` in `astro.config.ts`. Cloudflare's default treats
  `/page/` as canonical for a directory build, and it redirects `/page` to it
  with a 301. That would affect every internal link on the site, since Astro
  writes them all without a trailing slash.
- **`run_worker_first`** lists the paths the Worker sees. Fingerprinted
  bundles, fonts, share cards, and icons are excluded, so the build serves
  most requests straight off the asset path, at no invocation cost.

### What the Worker adds

The Worker renders nothing. Every byte still comes out of `dist` through the
`ASSETS` binding. It exists for the things a file on disk cannot do:

- It adds `Link` and `X-Llms-Txt` headers that announce the Markdown twin and
  `llms.txt`, so an agent issuing a `HEAD` request finds them without parsing
  HTML.
- It answers `Accept: text/markdown` on an ordinary page URL with that page's
  Markdown, plus a `Vary: Accept` header.
- It adds `Link: rel="canonical"` on every Markdown response, which lets
  search crawlers read the Markdown without treating it as a duplicate of the
  page.
- It provides the agent surfaces. See [Serving agents](/agents/overview).

You can remove the Worker. Delete `main`, `assets.binding`, and
`run_worker_first` from `wrangler.jsonc`, and the site serves as pure static
assets again. A human visitor sees no difference.

### Which deploy to run

`npm run deploy` reindexes the whole corpus between the build and the upload.
This is the right default. It is the only step that keeps semantic search in
step with the pages. Skipping it silently would leave search answering from a
version that no longer exists.

It used to be the slow half, and it is worth knowing why it no longer is. The
sync sends one request per page, sequentially and at a controlled pace, so a few
hundred pages took minutes. On a 198-page site the upload was **76 % of the
whole build**, almost all of it re-sending pages nobody had touched. It now
uploads only what changed, by reading back the digest it stored on each item last
time. A build where nothing moved makes no upload requests at all.

Do not rebuild while a sync is in flight: a `npm test` in another shell is
enough to do it. The script reads the whole corpus into memory before its first
request for exactly this reason, so a `dist/` that changes underneath it fails
before anything is sent rather than partway through. That is the difference
between a clean failure and an index left half-fresh with the deploy skipped.

`npm run index:sync -- --force` re-uploads everything regardless, for the cases
where the stored digests cannot be trusted: a hand-edited index, or a change to
what the upload puts in an item.

`npm run deploy:fast` skips this step. Use it when the change cannot affect
the corpus: styling, client-side behaviour, Worker code, or configuration. Use
the full deploy whenever content changed. When in doubt, use the full deploy;
a stale index is harder to notice than a slow deploy.

Neither variant is needed while `agents.retrieval` is `'lexical'`. The lexical
index is built into `dist/` and ships with the assets, so `index:sync` detects
that and exits immediately.

## Where the documentation lives under your domain

Two shapes, chosen with one setting:

```ts
// src/docs.config.ts
export const basePath = '';        // docs.example.com/getting-started
export const basePath = '/docs';   // example.com/docs/getting-started
```

Everything the build prints picks up that prefix: page links, canonical tags,
the sitemap, `llms.txt`, the agent manifest, the search index, and the MCP and
API endpoints. The Worker strips the prefix back off before looking anything
up. Nothing inside `dist/` moves; only the URLs change. Set it, rebuild,
deploy.

**Prefer the subdomain.** `docs.example.com` is one hostname, one Worker, and
one DNS record, with nothing to coordinate with whoever owns the marketing
site. Choose the subpath only when you need documentation and marketing to
share a domain for SEO, or because a design decision requires it.

### Subdomain: `docs.example.com`

This setup works whether or not the rest of the site is on Cloudflare, because
the sites share nothing but the registrable domain.

1. Leave `basePath` at `''`.
2. Deploy, then attach the hostname as a **Custom Domain** on the Worker
   (Workers & Pages → your Worker → Settings → Domains & Routes). Cloudflare
   creates the DNS record and issues the certificate.
3. Set `SITE_URL=https://docs.example.com` in the deploy environment.

If the apex domain is not on Cloudflare, add `docs` as a CNAME at your DNS
provider, pointing at the Worker's `workers.dev` hostname. Use a Route instead
of a Custom Domain in that case.

### Subpath: `example.com/docs/`

The mechanism is the same in every case: a **Worker Route** on
`example.com/docs/*`. Cloudflare's edge evaluates a route _before_ the request
reaches the origin, so the documentation Worker answers those paths, and
everything else carries on to wherever the marketing site actually lives. The
marketing platform never learns that `/docs` exists.

The requirement is therefore narrow. It is worth stating precisely, because it
is the thing people assume is impossible: **the domain's DNS has to be on
Cloudflare and proxied.** The marketing site itself does not.

| Where the marketing site runs                     | DNS on Cloudflare?          | What to do                                                                                                                                                           |
| ------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare Workers or Pages                       | yes                         | Add the route. Two Workers, one zone; the more specific route wins.                                                                                                  |
| Webflow, Framer, Squarespace, WordPress, anywhere | yes, proxied (orange cloud) | Add the route. The apex keeps resolving to that host; only `/docs/*` is intercepted.                                                                                 |
| Vercel, Netlify, Render                           | yes, proxied                | Add the route. Or use the platform's own rewrite (`vercel.json` `rewrites`, Netlify `_redirects` with `200`) pointing at the Worker, which keeps DNS wherever it is. |
| anywhere, DNS **not** on Cloudflare               | no                          | Move DNS to Cloudflare, or use a subdomain instead. There is no third option: without the proxy there is nothing at the edge to intercept the path.                  |

Setting it up:

1. Set `basePath` to `'/docs'` in `src/docs.config.ts` and rebuild.

2. `wrangler.jsonc` → add the route, and prefix the asset exclusions, which are
   matched against the incoming path:

   ```jsonc
   "routes": [{ "pattern": "example.com/docs/*", "zone_name": "example.com" }],
   "assets": {
     "run_worker_first": ["/docs/*", "!/docs/_astro/*", "!/docs/og/*", "…"]
   }
   ```

3. Set `SITE_URL=https://example.com`: the origin only, with no path. The
   prefix comes from `basePath`. Putting it in both gives you `/docs/docs/`.

About the route pattern: the wildcard is a suffix operator only, paths are
case-sensitive, and the build matches the pattern against the whole URL,
including the query string.

### What moves with the prefix, and what does not

`llms.txt` and `llms-full.txt` are ordinary build outputs, so they move like
every page. Under `basePath: '/docs'` the build serves them at
`example.com/docs/llms.txt` and `example.com/docs/llms-full.txt`. Every URL
_inside_ them also carries the prefix: the `.md` link for each page, and the
`## Optional` block pointing at the MCP server, the API, the sitemap, and the
feed. An agent that fetches one of these files gets a map whose links all
resolve.

This is the intended behaviour, and it is the correct one. The alternative
would be to hoist the corpus index to the origin root, where it would sit next
to a marketing site that neither owns it nor knows about it. Documentation
published under `/docs` is a section of someone else's site, so its index
belongs inside that section.

The same is true of `sitemap.xml`, `updates.xml`, `openapi.json`, the search
index, and the `.md` twin of every page. `robots.txt` is the exception; the
next section explains why.

Plan for two consequences:

- **Nothing at the origin root advertises the documentation.** An agent that
  guesses `example.com/llms.txt` finds the marketing site's file, or a 404.
  Point at it explicitly: add a `Sitemap:` line and a comment in the root
  `robots.txt`, and ideally add a
  `<link rel="alternate" type="text/plain" href="/docs/llms.txt">` in the
  marketing site's `<head>`.
- **`llms.txt` is a convention, not a standard.** No specification requires it
  to live at the origin root, and nothing enforces one location. Serving it
  beside the content it indexes is the defensible choice.

### What a subpath cannot have

Three things are defined relative to the _origin_, so they cannot move under a
prefix. None of these is fatal, but each needs a decision.

- **`robots.txt`.** Crawlers read `example.com/robots.txt` and nothing else.
  The build emits one at `/docs/robots.txt`, but no crawler will ever fetch
  it. Copy its directives, and the `Sitemap:` line pointing at
  `/docs/sitemap.xml`, into the marketing site's own `robots.txt`.
- **`/.well-known/mcp.json`**, the server-card path, and
  **`/.well-known/api-catalog`**. A client looks for these at the origin root,
  which is outside your route, so the build does not serve them there. The MCP
  endpoint and the APIs themselves still work fine; only the pre-flight
  discovery is lost, and the build omits the `rel="api-catalog"` link from the
  `<head>` rather than pointing it at a 404. Add a route for
  `example.com/.well-known/*` if you want these back.
- **Cloudflare's hosted WebMCP bridge.** The Agent Readiness pack discovers a
  site's MCP server at `<origin>/mcp`, but yours is at `<origin>/docs/mcp`. Set
  `agents.webmcpBridge` to `'on'`, and this repository registers the tools
  itself. See [Serving agents](/agents/overview).

### The failure mode to know about

`basePath` and Astro's own `base` in `astro.config.ts` must read from the same
constant. They cover different halves: `base` prefixes the URLs Astro
generates for the bundle, the fonts, and imported images; `basePath` prefixes
everything this codebase builds itself.

If you set only one, you get a site that builds cleanly, passes type checks,
renders its text, and is broken. With `base` alone, every stylesheet and
script 404s while page links still point at the root. With `basePath` alone,
the failure runs the other way. `npm test` asserts that every asset a page
references exists in the build. This turns the mismatch into a failure you see,
rather than one your readers do.

## On another host

`dist/` is ordinary static output, so any static host will serve the site. The
build command is `npm run build` and the publish directory is `dist`. Nothing
about Cloudflare is required to produce it, and `wrangler` is a development
dependency you can ignore.

Three things need attention, whichever host you pick.

**Trailing slashes.** The build writes `page/index.html` and links to `/page`.
Configure the host not to redirect between the two, or switch
`trailingSlash` in `astro.config.ts` and rebuild. A host that 301s every
internal link is slow and looks broken to crawlers.

**Headers.** `public/_headers` uses Cloudflare and Netlify syntax. On another
host, translate it: set a year of `Cache-Control: immutable` for `/_astro/*`,
and set the security headers for everything else. The file also documents why
each rule exists.

**Content types.** The host must serve `.md` as `text/markdown`, not download
it as an attachment. Most hosts get this right; some send
`application/octet-stream`, which turns "view as Markdown" into a download
prompt.

### What each host needs

Indications rather than recipes: these are the settings that differ, not full
walkthroughs.

| Host                                 | What to set beyond `dist`                                                                                                                                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Netlify**                          | Nothing. `public/_headers` and `public/_redirects` are that platform's own syntax and are copied into `dist/` unchanged.                                                                                                                                                                                                        |
| **Cloudflare Pages**                 | Nothing, and both files work here too. You lose the Worker, so read the note at the end of this section.                                                                                                                                                                                                                        |
| **Vercel**                           | `"trailingSlash": false` in `vercel.json`, so `/page` is not redirected. Translate `_headers` into that file's `headers` array, and `_redirects` into `redirects`. Neither file is read.                                                                                                                                        |
| **GitHub Pages**                     | See the callout below. It is the host with the most to configure and the one thing you cannot have.                                                                                                                                                                                                                             |
| **S3 + CloudFront**                  | Directory URLs need resolving: point CloudFront at the S3 _website_ endpoint, which appends `index.html` to a path, or attach a CloudFront Function that does it. Set `Content-Type` on upload: S3 does not infer it, so `.md` arrives as `application/octet-stream` without help. Headers belong in a response headers policy. |
| **nginx, Caddy, any origin you run** | `try_files $uri $uri/index.html =404;` or the equivalent, `types { text/markdown md; }`, and the headers from `_headers` by hand.                                                                                                                                                                                               |

> **Warning: GitHub Pages: two settings and one real loss**
>
> **A project page is served under a subpath.** `user.github.io/repo/` means
> `basePath` in `src/docs.config.ts` must be `'/repo'`. Both halves have to
> agree, which is the failure mode described above under
> [the failure mode to know about](#the-failure-mode-to-know-about). A user or
> organisation page, or any custom domain, is served at the root and needs
> neither.
>
> **Add an empty `public/.nojekyll`.** Deploying from a branch runs the output
> through Jekyll, which ignores directories starting with an underscore. That
> is `_astro/`, so every stylesheet and script 404s. Deploying with
> `actions/deploy-pages` does not run Jekyll at all, but the file costs nothing
> and removes the question.
>
> **You cannot set response headers.** GitHub Pages offers no equivalent of
> `_headers`, so nothing in that file applies: no `Strict-Transport-Security`,
> no `Referrer-Policy`, no `X-Frame-Options`, and no `immutable` caching on the
> fingerprinted bundle. The site is correct and fast enough; it is simply less
> hardened than the same build behind a host that lets you say so. Read
> `public/_headers` and decide whether you can accept that before choosing this
> host.

Losing the Worker costs you the header-based discovery and the `Accept`
negotiation. The `.md` URLs keep working, so agents that follow the documented
convention are unaffected. The MCP server and the HTTP API are Worker features
and do not survive the move. Set `agents.enabled: false` to turn them off
cleanly, rather than advertising endpoints that 404. Note that this also
removes the `report_issue` tool and the WebMCP registration, which have nothing
to serve without them.

## After the first deploy

- Confirm the origin is the real one: see [Set the origin first](#set-the-origin-first).
  Nothing else on this list matters until it is.
- Add `seo.verification` values once the property is registered in Google
  Search Console and Bing Webmaster Tools.
- Submit `/sitemap.xml`.
- If the domain is a Cloudflare zone, add a WAF rate limiting rule over
  `/api/docs/*` and `/mcp`. See [Serving agents](/agents/overview). AI Crawl
  Control and bot analytics also exist only for a zone. On a `workers.dev`
  hostname, the Worker's own log line for AI crawlers is all you get.

_Next_

**The site is live. Now let agents read it.**

The same deploy already published an MCP server, an HTTP API and a Markdown twin of every page. This is what they answer, and how to tell an agent they exist.

[Serve agents](/agents/overview)
