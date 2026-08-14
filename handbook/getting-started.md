---
title: "Getting started"
description: "Clone Duvlify, run it locally, and understand the four things you will edit (content, navigation, identity and theme) before you deploy."
canonical: "https://duvlify.dev/getting-started"
updated: "2026-08-14"
---

# Getting started

Duvlify is a documentation framework: Astro, static output, no framework runtime
in the browser. You write Markdown in `content/`, describe the shape of the site
in one config file, and the build produces HTML along with everything that has to
agree with it: search index, share cards, sitemap, Markdown twins, and the tools
an AI agent calls.

## Run it

1. **Clone and install**

   Node 20 or newer. Dependency versions are pinned exactly, so a clone builds
   the same way tomorrow as it does today.

   ```bash
   git clone https://github.com/DuvInc/duvlify.git my-docs
   cd my-docs
   npm install
   ```
2. **Start the development server**

   ```bash
   npm run dev
   ```

   Open `http://localhost:4321`. Content changes appear as you save.
3. **Confirm the build is clean**

   ```bash
   npm test
   ```

   This runs a real build, then asserts the publication rules across every
   output and exercises the agent surfaces over HTTP. It should pass on a fresh
   clone with nothing configured.

> **Check: Nothing to sign up for**
>
> A fresh clone works offline. Search runs off an index built at compile time,
> the agent tools answer from that same index, and every external integration
> defaults to off. You will not hit an account wall before you see the site.

## The four things you will edit

Everything below lives in [`src/docs.config.ts`](https://github.com/DuvInc/duvlify/blob/main/src/docs.config.ts)
except the pages themselves. Nothing in `src/components/`, `src/styles/` or
`worker/` needs touching to rebrand or restructure. If you find yourself editing
those to change a string, that is a gap in the config rather than something to
work around.

[**Pages**](/guides/authoring)

Markdown and MDX files in `content/`. A file's path is its URL.

[**Navigation**](/reference/configuration)

Tabs, groups and page order: the `navigation` export.

[**Identity**](/reference/configuration)

Name, description, header and footer links: the `site` export.

[**Theme**](/reference/theming)

Accent, font and radius. One line each.

## Add your first page

Create the file at the path you want it served from. There is no `path` field.
The location _is_ the URL.

```mdx title="content/guides/my-page.mdx"
---
title: My page
description: A clear sentence explaining what the reader will learn here.
---

## Overview

Ordinary Markdown works. So do **bold text**, links, tables and code fences.
```

Then list it in a navigation group. The id is the path under `content/` without
the extension:

```ts title="src/docs.config.ts"
{ label: 'Start here', icon: 'zap', pages: ['getting-started', 'guides/my-page'] }
```

Position in that array is the sidebar order. The label, icon and badge come from
the page's own frontmatter, so nothing is restated here.

> **Tip: The build is the reviewer**
>
> A page id with no file fails the build and names the group that referenced it.
> A published page in no group fails the build and lists every orphan. You will
> not ship a page that quietly has no way to reach it.

## Make it yours

1. **Replace the content**

   Delete `content/` and write your own pages, then rewrite `navigation` in
   `src/docs.config.ts` to match. The build will tell you what is inconsistent.

   The pages you just deleted were this framework's manual. `handbook/` is a
   plain-Markdown copy of them, kept for exactly this moment, so nothing is lost.
   Read it there. Treat it as frozen: never run `npm run manual:snapshot` in
   your own repository, which would rebuild it from your pages and delete the
   manual. Delete the folder when you no longer need it.
2. **Set the identity and theme**

   Fill in `site`, `seo` and `theme` in the same file, and replace
   `src/logo.svg` and `public/favicon.svg`. See
   [Configuration](/reference/configuration) for every field and
   [Theming](/reference/theming) for the colour rules that matter.
3. **Clear out what belongs to this project**

   This repository is also this framework's own showcase, so a clone carries
   files that serve _it_: a Sponsor button, issue templates pointing at its
   Discussions, its `SECURITY.md`, a Worker name. They keep working while
   pointing at the wrong place, and no build error mentions any of them.

   [Configuration](/reference/configuration) has the full list, and a `grep` to
   catch what the list misses.
4. **Point it at your origin**

   Set `SITE_URL` rather than editing the fallback in `astro.config.ts`, so a
   preview build and a production build cannot disagree about the canonical host.
   Either an environment variable or one line in `.env` works, and the
   environment wins.

   ```bash
   SITE_URL=https://docs.your-domain.com npm run deploy
   ```

   Do this before you publish anything. It is the one setting whose failure is
   invisible: the site renders perfectly while pointing every crawler and agent
   at a host that is not yours. So `npm run deploy` refuses to upload without
   it, and every other build warns. See
   [Set the origin first](/guides/deployment#set-the-origin-first).
5. **Deploy**

   Cloudflare is the intended host and the only one where every feature works
   without substitution, but `dist/` is ordinary static output and any host will
   serve it. See [Deploying](/guides/deployment).

## Commands

|                       |                                                       |
| --------------------- | ----------------------------------------------------- |
| `npm run dev`         | development server                                    |
| `npm run build`       | typecheck, then build to `dist/`                      |
| `npm run preview`     | serve the built output                                |
| `npm test`            | build, then assert the outputs and the agent surfaces |
| `npm run deploy`      | build, sync the semantic index, then deploy           |
| `npm run deploy:fast` | build and deploy without reindexing                   |
| `npm run index:dry`   | show what the semantic indexer would upload           |

## Where to go next

[**Authoring pages**](/guides/authoring)

Frontmatter, drafts, and pages that must not be found.

[**Components**](/reference/components)

The full vocabulary, rendered on the page that documents it.

[**Serving agents**](/agents/overview)

What an agent can call, and what it gets back.

[**Example API**](/example-api/introduction)

A fictional API, to show what the endpoint layout renders.

[**Page layouts**](/reference/page-layouts)

The table of contents, or a panel in its place.
