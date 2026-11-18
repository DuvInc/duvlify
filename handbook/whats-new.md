---
title: "What's New"
description: "What changed in Duvlify, newest first. Each entry links to the pull request on GitHub."
canonical: "https://duvlify.dev/whats-new"
updated: "2026-11-18"
---

# What's New

## November 18, 2026: Single-page tabs drop the sidebar

- A tab that holds one page, like this one, has no sidebar: the page is
  centred instead. Set `sidebar` on a tab in `docs.config.ts` to force it
  either way. See [A tab with a single page](/reference/configuration#a-tab-with-a-single-page).

## November 18, 2026: Hover changes colour at once

- Links, buttons and menu options no longer fade their colours on hover. The
  fade made the sidebar flicker in Chrome while the pointer swept it.
  [#67](https://github.com/DuvInc/duvlify/pull/67)

## November 18, 2026: Tables that read at any width

- Columns of sentences keep a readable width, and a wide table scrolls
  sideways inside its frame. A short first column stays pinned.
- An empty header row, as Notion and GitBook exports write it, is dropped.
- Paragraphs inside `<View>` and `<Visibility>` keep the page's spacing.
  See [Tables](/reference/components#tables).
  [#64](https://github.com/DuvInc/duvlify/pull/64),
  [#65](https://github.com/DuvInc/duvlify/pull/65),
  [#66](https://github.com/DuvInc/duvlify/pull/66)

## November 17, 2026: Dividers

- A Markdown `---` draws the light hairline used under the page title, not a
  black rule. [#63](https://github.com/DuvInc/duvlify/pull/63)

## November 16, 2026: Previews stay out of search

- Only the hosts in `INDEXABLE_HOSTS` are indexable. A preview URL answers
  `noindex` and a disallowing `robots.txt`.
  [#61](https://github.com/DuvInc/duvlify/pull/61),
  [#62](https://github.com/DuvInc/duvlify/pull/62)

## November 7, 2026: Faster page changes

- Docs links are prerendered on hover, so the next page is ready on click.
- The sidebar keeps its scroll position between pages, and the bars stay
  still while the new page comes in.
- The table of contents lights the heading a link jumped to.
  [#52](https://github.com/DuvInc/duvlify/pull/52) to
  [#59](https://github.com/DuvInc/duvlify/pull/59)

## November 2, 2026: Search ranking

- One ranking for the search dialog and for agents, measured against Pagefind.
- "setup" finds "Set-up", and an exact phrase ranks first.
  [#29](https://github.com/DuvInc/duvlify/pull/29) to
  [#35](https://github.com/DuvInc/duvlify/pull/35)
