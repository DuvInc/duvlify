---
title: "Page layouts"
description: "A page shows a table of contents by default, or gives its right rail to panels and examples instead. This page uses the second layout."
canonical: "https://duvlify.dev/reference/page-layouts"
updated: "2026-08-14"
---

# Page layouts

**You are looking at the rail.**

This panel is the whole point of the page. On a wide screen it sits in the
right column and scrolls with you, in place of the table of contents. Below
1280px the column disappears and the panel returns to the article, above the
next heading.

Narrow your window to see it move.

Every page has a third column on a wide screen. The `rightRail` field in
frontmatter decides what goes in it.

| Value    | The right column holds                                        |
| -------- | ------------------------------------------------------------- |
| `toc`    | The table of contents. This is the default.                   |
| `custom` | Your `Panel`, `RequestExample` and `ResponseExample` content. |

## When to use each

Leave `rightRail` unset on almost every page. A reader uses the table of
contents to find a section, and a long reference page without one is harder to
use.

Set `rightRail: custom` only when the page is built around examples that belong
beside the prose rather than inside it. An endpoint page is the clearest case:
the request and the response are a reference the reader checks while reading, not
a step in the text. This page is the other case, because it has to show you the
layout to describe it.

> **Note: The components still work either way**
>
> A `Panel` on a `toc` page is not an error. It renders inline, in the reading
> column, where you placed it. `rightRail: custom` only decides whether the
> build lifts it into the third column.

## What moves, and what does not

Only top-level rail-capable content moves. A `Panel` nested inside a `Step` or a
`Tab` stays where it is, because lifting it out would separate it from the step
it belongs to.

The three components that can move:

- `Panel`: free-form content, as on this page.
- `RequestExample`: a code group, labelled as a request.
- `ResponseExample`: the same, labelled as a response.

## The frame is wider

A page with `rightRail: custom` uses the same three-track frame as an
[endpoint page](/example-api/list-widgets): navigation, prose, and the rail. The
reading column is a little narrower than on a `toc` page, because the rail needs
more room than a contents list.

Both layouts share one set of widths on purpose. They are the same shape: prose
in the middle, reference material alongside. Keeping two sets would let them
drift apart for no reason.

## `Copy page` moves too

On a `toc` page the page actions sit under the title. Here they move to their own
right-aligned row above the article, because the space under the title now
belongs to the first panel.
