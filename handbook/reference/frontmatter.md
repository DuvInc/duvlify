---
title: "Frontmatter"
description: "Every field a page can declare, what it controls, and which fields the build requires, as defined and enforced in src/content.config.ts."
canonical: "https://duvlify.dev/reference/frontmatter"
updated: "2026-08-18"
---

# Frontmatter

A page declares only what it is. `src/docs.config.ts` controls where the page
sits in the sidebar. That includes its category, its section label, and its
neighbours. The page URL is its path under `content/`.

The schema is [`src/content.config.ts`](https://github.com/DuvInc/duvlify/blob/main/src/content.config.ts).
The build enforces this schema. If frontmatter is invalid or incomplete, the
build stops and reports the file at fault.

## Required

| Field         | Type           | Purpose                                                             |
| ------------- | -------------- | ------------------------------------------------------------------- |
| `title`       | string, min 2  | Page title, browser title, and the `#` heading of the Markdown twin |
| `description` | string, 10–170 | Introductory summary and meta description                           |

> **Note: Why 170 is a hard ceiling**
>
> Search results truncate around 150 to 160 characters. A description cut off
> mid-clause reads worse than a shorter one. A description over 170 characters
> fails the build. This stops a page from shipping with an unfinished snippet.

## Presentation

| Field          | Type              | Purpose                                                                                                        |
| -------------- | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `sidebarTitle` | string            | Shorter label for the sidebar when the title is long                                                           |
| `icon`         | string            | Icon name, shown beside the sidebar label. See [icons](/reference/code-and-diagrams#icons)                     |
| `badge`        | string            | Small pill beside the sidebar label, e.g. `New`                                                                |
| `rightRail`    | `toc` \| `custom` | Defaults to `toc`. Set `custom` only when the page replaces the table of contents with rail-capable components |

## Publication

| Field     | Type    | Purpose                                                                                                      |
| --------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `draft`   | boolean | Keeps the page in the repository and out of every output. See [Drafts](/guides/authoring#drafts)             |
| `noindex` | boolean | Page stays reachable and in the sidebar, but out of search, the sitemap, the updates feed and the LLM corpus |

These two fields are different. A draft page does not exist on the site. A
`noindex` page exists, but the site never promotes it.

One file decides publication:
[`src/lib/published.ts`](https://github.com/DuvInc/duvlify/blob/main/src/lib/published.ts).
Every part of the code that lists pages reads the collection through this
file, instead of writing its own filter. This keeps the meaning of
"published" consistent across all eleven places that check it.

## Dates

| Field       | Type | Purpose                                                                             |
| ----------- | ---- | ----------------------------------------------------------------------------------- |
| `updated`   | date | Overrides the last-modified date, which otherwise comes from the file's last commit |
| `published` | date | First publication date, when it differs meaningfully from the last edit             |

Set `updated` when a change is substantial and the commit history does not
show that. A typo fix should not reset a page's freshness.

## Social

| Field      | Type   | Purpose                                     |
| ---------- | ------ | ------------------------------------------- |
| `image`    | string | Replaces the generated share card           |
| `imageAlt` | string | Alt text, when a custom `image` is supplied |

A page that sets neither still gets a full metadata set: a share card generated
from its title, a canonical URL, and structured data.

## API endpoint pages

Set these to render the three-column API reference layout for one operation in
your OpenAPI document. Normal prose pages are unaffected.

| Field            | Type                                            | Purpose                             |
| ---------------- | ----------------------------------------------- | ----------------------------------- |
| `pageType`       | `api-endpoint`                                  | Selects the endpoint layout         |
| `apiMethod`      | `GET` \| `POST` \| `PUT` \| `PATCH` \| `DELETE` | Must match an operation in the spec |
| `apiPath`        | string                                          | Must match that operation's path    |
| `apiOperationId` | string                                          | Optional override                   |
| `apiTag`         | string                                          | Optional override                   |

Full walkthrough in [API reference pages](/guides/api-reference).

## A complete example

```yaml
---
title: Progressive rollout
sidebarTitle: Rollouts
description: Increase a flag's exposure in stages that halt themselves when a guard metric moves.
icon: activity
badge: New
updated: 2026-08-01
---
```
