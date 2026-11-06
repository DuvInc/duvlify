---
title: "Migrating an existing site"
description: "Bringing a documentation set over from Mintlify, Docusaurus, or Starlight, with what carries across, what to convert, and how to brief an agent to do it."
canonical: "https://duvlify.dev/guides/migrating"
updated: "2026-10-23"
---

# Migrating an existing site

## What already carries across

Two pieces of compatibility are deliberate and already shipped. A migration
that requires touching every page is a migration nobody finishes.

**Component names.** The MDX vocabulary accepts the tags most documentation is
already written with: `Card`, `CardGroup`, `Steps`, `Tabs`, `Accordion`,
`ParamField`, `ResponseField`, `Frame`, plus aliases like
`FileTree`/`Folder`/`File` and `RequestExample`/`ResponseExample`. A page
authored for Mintlify usually renders unedited.

**Icon names.** Content written for other platforms names Font Awesome icons,
while this site draws from Lucide. `src/icon-aliases.ts` maps the common ones,
so `icon="rocket"` resolves either way.

## What to check on an imported corpus

A corpus written elsewhere hits a few rules that a hand-written one never does.

- **URLs.** A file path becomes a lowercase URL by default, so `Start/Intro.mdx`
  moves to `/start/intro`. Set `contentIds: 'preserved'` in `docs.config.ts` to
  keep the path exactly. `folder/index.mdx` is the page `folder` either way.
- **Pages with no sidebar entry.** The build fails on a published page that the
  navigation does not list. If the old site published such pages by their link
  only, give them `hidden: true`: they stay routed and noindexed and leave the
  sidebar, search and sitemap.
- **Deep sidebars.** `depth` nests groups, so a four-level tree carries across.
- **Frontmatter limits.** `description` is capped at 170 characters and `title`
  needs two. An imported page that runs over fails with the file named. Shorten
  it at the source; the cap is what keeps search snippets from being cut.
- **Descriptions and titles.** `description` is optional, so a page that never
  had one needs none; `metaTitle` keeps a custom `<title>` as it was. A `#`
  heading in the body is listed in "On this page" as a section, with `##` as its
  subsection.
- **Undefined expressions.** MDX evaluates `{PAGE}` in prose, and fails the build
  where another tool printed it as nothing. Escape it as `\{PAGE\}`.
- **Icons.** An unknown icon name renders nothing, and the build now logs it.
  Map the common Font Awesome Pro names in `src/icon-aliases.ts`.
- **Images.** Content that points at `/images/x.png` in `public/` bypasses the
  image pipeline. `npm run images:optimize` shrinks anything wider than 1,600px
  and `npm run images:check` also fails on a file over 25 MiB, which Workers
  assets refuse and the deploy reports poorly.
- **Screen recordings.** Convert each GIF to MP4, which is often ten times
  smaller, and embed it as a `<video>`. The build reads its width and height
  from the file, as it does for an image, so the page does not jump when it
  loads:

  ```bash
  ffmpeg -i demo.gif -movflags +faststart -pix_fmt yuv420p \
    -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" demo.mp4
  ```

  ```mdx
  <video src="/images/demo.mp4" autoPlay muted loop playsInline />
  ```
- **Alt text.** An importer often fills `alt` with a file name or a word like
  "image". Search for those and write real ones, or leave `alt=""` on a purely
  decorative image.
- **House style.** `test/copy-style.test.mjs` fails on any em dash in
  `content/`. If your corpus does not follow that rule, set `DOC_ROOTS` to `[]`
  in that file. Keep the test: it still checks the framework's own strings.

## Frontmatter from Mintlify

`title`, `description`, `sidebarTitle`, `icon`, `noindex` and `hidden` mean the
same thing in both. The rest converts or goes:

| Mintlify                       | Here                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `openapi: "GET /widgets"`      | `pageType: api-endpoint`, `apiMethod: GET`, `apiPath: /widgets`                                                    |
| `tag: "New"`                   | `badge: "New"`                                                                                                     |
| `og:*`, `twitter:*`            | Delete. The build writes every social tag and a share card per page. Use `image` and `imageAlt` for a custom card. |
| `mode`, `iconType`, `keywords` | Delete. Nothing reads them.                                                                                        |

The build ignores a key it does not know, so leftover keys never fail it: they
just stay in every file, and the next person reads them as configuration.
Remove them in one commit with a `Page-dates: keep` line in its message, so
the change does not mark every page as updated that day (see
[Frontmatter](/reference/frontmatter#dates)).

## Navigation and styling

- **Navigation.** The old site's sidebar becomes the `navigation` export: its
  tabs become `NavTab` entries and its groups nest inside them, with pages
  named by content id. There is no importer yet. See
  [Configuration](/reference/configuration#navigation-structure).
- **Custom CSS.** A stylesheet written against another theme's class names has
  nothing to apply to. Restyle through `theme` and its tokens instead.

## Redirects

Map every old URL in `redirects` in `docs.config.ts`, or in `src/redirects.ts`
on a large site (see [Configuration](/reference/configuration#long-lists-in-their-own-files)).
Mintlify's `redirects` list converts one to one: `source` becomes the key and
`destination` the value. Two differences:

- **No wildcards.** A source such as `/old/:slug*` has to become one entry per
  page.
- **No chains.** Each old path points straight at its final page. The build
  fails on a chain, a loop, an external destination or a target that does not
  exist.

## Migrate with an agent

Most migrations are now run by a coding agent. A 360-page Mintlify site,
migrated that way and then cleaned up, showed where an agent goes wrong when
nobody tells it otherwise. Put these points in its brief:

1. **One source from the cutover on.** While the old site is still edited, a
   sync script can copy from it. Once it is not, delete the sync, its generated
   files and their "do not edit" headers in the same change. A file marked
   "Generated, do not edit" that people edit by hand misleads everyone who
   opens it.
2. **Plain files, not generated ones.** The sidebar goes in `src/navigation.ts`
   and the redirects in `src/redirects.ts`, both re-exported from
   `docs.config.ts` as plain bindings. No `src/generated/` folder.
3. **One copy of the spec.** Import it as a JSON module, never read it from
   disk, and generate `/openapi.yaml` from it if old links point there (see
   [API reference pages](/guides/api-reference#point-the-build-at-a-spec)).
4. **No manifest for media.** The build measures PNG, WebP, SVG and MP4 files
   itself. A size list written by the importer goes stale the first time
   someone replaces a file.
5. **No comparisons in the code.** A comment that says "like Mintlify" or
   "Mintlify's order" describes a site that no longer exists. Say what the code
   does and why.
6. **Proof from the build, not from reading.** Run `npm test`, not only the
   build: it boots the Worker, and some failures only appear there. For a
   cleanup that should change nothing visible, build `main` and the branch and
   compare `dist/` file by file.

A brief that carries those points:

```text
Migrate the Mintlify docs in <old repo> into this Duvlify repository.
Read AGENTS.md, CONTRIBUTING.md and content/guides/migrating.mdx first.

- This repository becomes the only source. Leave no sync script, no
  src/generated/ folder, and no "do not edit" file.
- Sidebar in src/navigation.ts, redirects in src/redirects.ts, both
  re-exported from src/docs.config.ts. Expand wildcard redirects and point
  every old URL straight at its final page.
- The OpenAPI spec is src/openapi.json, imported as a JSON module.
- Convert frontmatter with the table in migrating.mdx and delete keys
  nothing reads. Convert GIFs to MP4. Write no image manifest.
- No comment or doc compares this code with Mintlify.
- Done means: npm test passes, every URL in the old sitemap answers 200 or
  a 301 to a page that does, and you list what you could not convert.
```

## Not automated yet

There is no importer yet: the navigation, the frontmatter pass and the redirect
map are done by you or your agent, with the points above. An importer that
fetches a published site and a check that every old URL still resolves are
planned. If you are migrating now and want to compare notes, open a
[discussion](https://github.com/DuvInc/duvlify/discussions).
