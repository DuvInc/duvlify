---
title: "How the build works"
description: "Astro with static output and no framework runtime: the join between content and config, what publication means, and every file the build emits."
canonical: "https://duvlify.dev/reference/architecture"
updated: "2026-08-18"
---

# How the build works

Duvlify uses Astro with static output and no framework runtime. The site
ships HTML and one shared JavaScript bundle for the interface, and nothing
else. There is no hydration and no client-side router. Everything below
follows from this design.

## The layout

```
content/         the pages your site publishes.
handbook/        this framework's manual, as plain Markdown. Never published.
src/
  docs.config.ts identity, theme, navigation, agent settings
  content.config.ts   the frontmatter schema
  components/    the MDX component set and the page shell
  lib/           build-time logic: navigation, Markdown, manifest, SEO
  pages/         routes: HTML, .md twins, feeds, indexes, share cards
  scripts/       the interface's client-side code
  styles/        tokens, reset, shell, components
worker/          the edge Worker: headers, negotiation, agent surfaces
scripts/         build-time tooling (index-sync, snapshot-manual)
test/            assertions against a real build and a real Worker
```

`handbook/` exists because `content/` has two jobs that separate the moment
someone forks this repository. Here it holds the framework's own documentation.
In your site it holds your pages, and the framework's documentation is gone.

So the build snapshots those pages into `handbook/` as plain Markdown, and that
folder is committed. It is a snapshot rather than a mirror on purpose: a fork
keeps the manual for the commit it forked, not for whatever the upstream site
says later.

That design has one failure mode, and it is worth naming because it would be
silent. `npm run manual:snapshot` rebuilds the folder from whatever `content/`
currently holds. Run upstream, it refreshes the manual. Run in your repository,
it would replace the manual with your own documentation and delete the files that
no longer match. That destroys the one copy the folder exists to preserve.

No identity check can prevent that reliably: a repository cloned from upstream
keeps the same git remote, and `site.name` is among the first things a new site
changes. So the script compares page ids instead. Editing this framework's own
documentation moves one or two files out of sixteen; replacing `content/` moves
all of them. When most of the snapshot would not survive the rewrite, the script
refuses and says why, and `npm run manual:check` (the one CI runs) exits
quietly instead of failing a build that has done nothing wrong. `--force` is
there for the genuine upstream restructure that trips the same wire.

In your own repository, then: read `handbook/`, and delete it when you are done.
Nothing reads it: no build step, no test, no route. The check passes on its
absence.

Nothing in `handbook/` is published. The site is built from `content/` into
`dist/`, and `dist/` is what gets deployed.

## The join that holds everything together

A page declares _what it is_ in its frontmatter: its title, description, and
icon. `docs.config.ts` declares _where it sits_. `src/lib/navigation.ts`
joins the two at build time. Every consumer then reads that one resolved
tree: the sidebar, the tabs, the breadcrumb, previous/next, search, the
sitemap, `llms.txt`, and the agent manifest.

Because there is one join, a mismatch is a build failure rather than a silent
problem. The build reports the file or id at fault. Because there is one
tree, no two surfaces can disagree about what the site contains.

## Publication

`src/lib/published.ts` owns one question: does this page ship? `draft: true`
means the file stays in the repository and out of every output. There is no
route, no Markdown twin, no share card, no sidebar entry, no search result,
no sitemap row, no line in `llms.txt`, and nothing reachable through the MCP.

Every consumer reads the collection through that module, instead of
repeating the filter itself. This keeps the meaning of "published" consistent
across all eleven places that check it. The one time a filter gets written
out locally is the time a draft leaks into exactly one output, and that
output is usually one nobody checks.

`noindex` is a different switch. That page _is_ published, routed, and
linked from the sidebar. The build keeps it out of the surfaces that promote
a page: search results, the sitemap, the updates feed, and the `llms.txt`
corpus. The reasoning is that a page deliberately withheld from search should
not be handed to a model either. The page remains fetchable at its URL and as
Markdown.

## One page, several representations

The build emits each page as:

- **HTML**: `src/pages/[...slug].astro`, the canonical copy for people and
  search engines.
- **Markdown**: `src/pages/[...slug].md.ts`, with MDX components translated
  away, and a YAML header carrying `canonical`.
- **A share card**: `src/pages/og/[...slug].png.ts`, drawn as SVG and
  rasterised at build time.

A single function, `pageMarkdown()`, generates the Markdown. This matters
more than it looks. The same bytes are what `<page>.md` serves, what the
`fetch` tool returns, what the indexer uploads, and what the agent manifest
counts line numbers against. Four consumers share one source. Without this,
a passage's reported line range could silently point at the wrong paragraph.

## Build outputs

| Output                                          | Purpose                                                           |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| `dist/**/index.html`                            | one fully rendered page each                                      |
| `dist/_astro/*`                                 | fingerprinted CSS, one JS bundle, self-hosted fonts, lazy Mermaid |
| `dist/<page>.md`                                | each page as Markdown, with a canonical header                    |
| `dist/og/<page>.png`                            | a generated 1200×630 card per page                                |
| `dist/search-index.json`                        | full-text index, fetched on first search                          |
| `dist/agent-manifest.json`                      | per-page outline with line offsets                                |
| `dist/llms.txt`, `llms-full.txt`                | corpus map and corpus                                             |
| `dist/sitemap.xml`, `robots.txt`, `updates.xml` | discovery                                                         |
| `dist/openapi.json`                             | when a spec is configured                                         |
| `dist/_headers`, `_redirects`                   | host-level caching, security, redirects                           |

## Performance decisions worth knowing

**The search index is a separate file.** It carries every page's body text.
The build fetches it only the first time a reader opens search; it is never
inlined. Page weight therefore stays flat as the corpus grows.

**Fonts are self-hosted.** Astro downloads the family at build time and
emits the `@font-face` rules and preloads. This avoids a render-blocking
round trip to a font CDN.

**Both Shiki themes ship as CSS variables.** `defaultColor: false` stops
Shiki from inlining one theme's colours, which would override dark mode.
Switching themes then costs no re-render.

**There is deliberately no Content-Security-Policy.** A useful policy needs
a strict `script-src` alongside a permissive `style-src-elem`. This is
because Mermaid draws a diagram by injecting a `<style>` element and setting
`style` attributes on every shape. It generates these at runtime from the
current colour mode, so nothing here can be hashed ahead of time. Astro's
CSP API cannot express that split. Shipping a policy that breaks a documented
feature is worse than shipping no policy. A policy loose enough to work would
use `unsafe-inline` throughout, which blocks nothing. This choice is worth
revisiting if diagrams are ever pre-rendered to static SVG.

## The Worker

The Worker serves every byte from `dist` through the `ASSETS` binding, and it
renders nothing itself. It adds header-based discovery, `Accept:
text/markdown` negotiation, and the agent surfaces. See
[Deploying](/guides/deployment) and [Serving agents](/agents/overview).

## Testing

There are two test suites, and both run against a real build:

- `test/publication.test.mjs` derives its cases from `content/` and asserts
  the publication rules across every output: that a published page reaches
  all of them, a draft reaches none, and a `noindex` page is routed but
  unlisted. It runs over `dist` rather than calling the resolver directly,
  because the rule is an agreement between eleven outputs, and every past
  leak was one output disagreeing with the other ten.
- `test/agents.test.mjs` boots a Worker and exercises MCP and HTTP over the
  network, checking that the two return byte-identical responses.
