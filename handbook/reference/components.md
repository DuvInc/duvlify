---
title: "Components"
description: "The complete component vocabulary, rendered on the page that documents it, including callouts, cards, steps, tabs, and trees."
canonical: "https://duvlify.dev/reference/components"
updated: "2026-08-14"
---

# Components

Prefer a semantic PascalCase tag over styling content with `className`. The
complete vocabulary is declared in
[`src/components/mdx-components.ts`](https://github.com/DuvInc/duvlify/blob/main/src/components/mdx-components.ts),
with one line per author-facing name. An unknown tag fails the build and names
itself in the error.

Everything on this page is live. Each example shows exactly what the
component does.

## The vocabulary

| Group                  | Tags                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Structure              | `Tabs`, `Tab`, `CodeGroup`, `CodeBlock`, `Steps`, `Step`, `Columns`, `Column`, `Panel`, `Frame`                    |
| Emphasis               | `Callout`, `Note`, `Warning`, `Info`, `Tip`, `Check`, `Danger`, `Banner`, `Badge`, `Update`, `Tooltip`             |
| Content and API        | `Prompt`, `ParamField`, `ResponseField`, `RequestExample`, `ResponseExample`, `Examples`, `Endpoint`               |
| Disclosure             | `Accordion`, `AccordionGroup`, `Expandable`                                                                        |
| Audience and variants  | `View`, `Visibility`                                                                                               |
| Navigation and visuals | `Card`, `CardGroup`, `Tile`, `Tree`, `TreeFolder`, `TreeFile`, `Icon`, `Mermaid`, `Color`, `ColorRow`, `ColorItem` |
| Actions                | `CTA`, `Button`                                                                                                    |

Some tags have shorter aliases. Duvlify keeps them because they match the
notation most documentation already uses: `FileTree`/`Folder`/`File` for the
tree, `Response` for `ResponseField`, `LinkButton` for `Button`, and
`Color.Row`/`Color.Item` and `Tree.Folder`/`Tree.File` as member expressions of
their parent. Each alias is the same component as its full name.

## Callouts

A callout is one bordered, tinted aside. The `tone` prop selects both the tint
and the icon. `Note`, `Tip`, `Info`, `Check`, `Warning`, and `Danger` are
one-line wrappers that each pick a tone, so a page never has to name a colour
directly.

> **Info: A callout with a title**
>
> Use a callout when the statement is true of one passage. Use
> [`<Banner>`](#banners) when it is true of the whole page.

> **Tip**
>
> A tip, written as `<Tip>` rather than `<Callout tone="tip">`.

> **Warning**
>
> A warning. The reader can still proceed, but should know something first.

> **Danger**
>
> A danger, for consequences that cannot be undone.

```mdx
<Callout title="A callout with a title" tone="info">
  Reach for a callout when the statement is true of one passage.
</Callout>

<Tip>A tip, written as `<Tip>` rather than `<Callout tone="tip">`.</Tip>
```

Available tones: `info`, `note`, `success`, `tip`, `check`, `warning`, `danger`.

## Cards and tiles

[**A linked card**](/getting-started)

With `href` set, the card renders as an anchor and grows an arrow.

**An unlinked card**

Without `href`, the card is a plain titled block.

```mdx
<CardGroup cols={2}>
  <Card title="A linked card" href="/getting-started">
    <Icon slot="icon" name="rocket" size={22} />
    Given `href` it renders as an anchor and grows an arrow.
  </Card>
</CardGroup>
```

### Two meanings of `cols`

Both `<Columns>` and `<CardGroup>` take `cols`, but the prop means different
things for each. Knowing this helps explain why a group can show three cards
when four were asked for.

|             | `cols` means      | `cols={1}`          | `cols={4}` in the reading column   |
| ----------- | ----------------- | ------------------- | ---------------------------------- |
| `Columns`   | exactly this many | one full-width cell | four narrow cells                  |
| `CardGroup` | at most this many | one full-width card | three, then four in a wider layout |

`CardGroup` packs as many \~210px cards as fit and stops at `cols`. This keeps
each card at a readable width, and no page needs its own breakpoint. `Columns`
follows the exact layout the author wrote. Both props take values 1 to 4 and
collapse to one column on a phone.

## Steps

1. **Numbered automatically**

   The marker counts steps for you. Pass `icon` to replace the number. Pass
   `stepNumber` to continue a sequence that started elsewhere.
2. **Any content inside**

   Including code fences, callouts and tables.

```mdx
<Steps>
  <Step title="Numbered automatically">The marker counts for you.</Step>
  <Step title="Any content inside">Including code fences and callouts.</Step>
</Steps>
```

## Tabs

**First**

Tab panels can hold anything a page can.

**Second**

Including fences, callouts and tables.

**Third**

Three panels here.

Tab groups **synchronize when they offer the same labels in the same order**.
For example, every "npm / pnpm / yarn" group on a site moves together, and the
site remembers the choice for the next page. Groups that share only one label
do not synchronize. A group offering "REST" alongside two other options is a
different group from one offering "REST" alongside four options. Treating them
as the same group made unrelated sections jump together.

| Prop                  | Effect                                                                          |
| --------------------- | ------------------------------------------------------------------------------- |
| `sync={false}`        | Keeps this group local, on `Tabs`, `CodeGroup` or `RequestExample`              |
| `defaultTabIndex={1}` | Starts on the second panel. A reader's remembered choice takes priority over it |
| `dropdown`            | On `CodeGroup`, for when a horizontal language strip would be crowded           |

## Disclosure

**An accordion**

Closed by default. Pass `defaultOpen` to start it open. Pass `icon` for a
glyph beside the label.

**A second one**

Grouped in an `<AccordionGroup>`, so the accordions share one border.

`<Expandable>` is the lighter variant. Use it to reveal a nested object's
fields inside a parameter list, rather than a section of prose.

## Parameter fields

**`page_id`** (`string`, required)

The page identifier. `path`, `query`, `header`, and `body` each set where
the parameter lives, and the label reflects the choice.

**`limit`** (`integer`, 20)

Records per page. The API clamps requests above the maximum instead of
rejecting them.

```mdx
<ParamField path="page_id" type="string" required>
  The page identifier.
</ParamField>
```

On an [OpenAPI endpoint page](/guides/api-reference) you do not write these by
hand. The framework generates them from the spec. Write them yourself only for
an API this framework does not drive, or for a configuration object.

## Badges, updates and tooltips

A badge is filled by default, takes a colour, and can be outlined or carry an
icon: Default, green,
outlined, and
with an icon.

A tooltip wraps inline text.

**What changed**

`<Update>` is the changelog entry: a dated block with optional tags, meant
to stack down a release-notes page. The label becomes the anchor, in
slugified form. This gives a date written for a reader a usable permalink
too.

## Banners

`<Banner>` states something true of one page, in the reading column:

> **Warning: Superseded**
>
> This section is kept for reference.

For an announcement on **every** page, set `site.banner` in
`src/docs.config.ts` instead. This creates the strip fixed above the navbar,
which this site is using right now. There is deliberately no per-page
equivalent of that strip. A fixed bar states something true of the whole
documentation set. Something true of one page belongs in the page instead.

The site remembers a dismissal against the exact text of the banner.
Publishing new wording shows the banner again to everyone who dismissed the
previous version. This same behaviour makes the strip unsuitable for anything
a reader must not be able to hide.

## Calls to action

`<CTA>` is a block asking the reader to do one thing. The default layout puts
the headline and its supporting line on the left and the action on the right:

**Ready to deploy?**

One command puts this site on Cloudflare, with the Worker and the MCP server included.

[Deploy it](/guides/deployment)

```mdx
<CTA
  title="Ready to deploy?"
  description="One command puts this site on Cloudflare."
  href="/guides/deployment"
  label="Deploy it"
/>
```

### Three layouts

Each answers a different question about where the block sits.

`row` is the default and belongs mid-page: it costs about the height of a
paragraph and reads as one line of intent. A mark can sit at its left:

_For agents_

**Your docs as callable tools**

An MCP server at /mcp, with search, fetch and `list_pages.`

[Serve agents](/agents/overview)

`stack` centres everything for the end of a page, where the reader has finished
and the block is the next step rather than an aside:

_Get started_

**Build your documentation on your own terms**

Clone it, write Markdown, and own every file the build produces. No per-seat bill, no vendor between you and your readers.

[Start in one command](/getting-started)

`split` gives an image half the block, with the text and action in the other
half. Use it when the picture is doing part of the persuading:

_Reference_

**Every component, on one page**

This page. Copy any example straight into your own content.

[Browse components](/reference/components)

This one carries `actionWidth="auto"`, so narrow the window and its button stays
at its own size, flush with the text, rather than stretching. Every other block
on this page keeps the default. See [how wide the action
goes](#how-wide-the-action-goes) for when each is right.

### Variants

`surface` is the default sunken panel, `accent` fills with the brand colour for
the one call to action on a landing page, and `outline` is a hairline and
nothing else for a quiet nudge in a long page:

**Prefer to read the source?**

Duvlify is MIT-licensed.

[Read the source](https://github.com/DuvInc/duvlify)

### More than one action

Pass buttons to the `actions` slot instead of using `href` and `label`. The
slot takes `<Button>`, so each action chooses its own weight:

**Two ways in**

Start from the template, or read how the build works first.

[Get started](/getting-started)

[How it works](/reference/architecture)

```mdx
<CTA variant="accent" title="Two ways in" description="…">
  <Fragment slot="actions">
    <Button href="/getting-started">Get started</Button>
    <Button href="/reference/architecture" variant="secondary">How it works</Button>
  </Fragment>
</CTA>
```

### Buttons on their own

`<Button>` works outside a CTA. It is always a link: a `<button>` in static
documentation would need JavaScript to mean anything, and a control that looks
pressable and does nothing is worse than prose. Three variants and three sizes:

[Primary, large](/getting-started)

[Secondary](/guides/authoring)

[Ghost, small](/why)

### How wide the action goes

Once the block stacks (on a phone, or in `stack`), the action takes the full
width by default, because a 36px pill alone on a narrow line reads as orphaned
rather than as the thing to tap. `actionWidth="auto"` keeps it at its natural
size, aligned with the text above it, which is right for a block that is an
aside rather than the point:

**Curious about the trade-offs?**

What Duvlify gives up to stay a framework rather than a product.

[Read why](/why)

```mdx
<CTA actionWidth="auto" title="…" href="/why" label="Read why" />
```

### Colours outside the theme

`background` takes any CSS colour, for a block that has to match something the
theme does not know about.

**A colour of its own**

Borders inside redraw from the text colour, so they stay correct on any fill.

[Theming](/reference/theming)

> **Warning: Pass foreground with background**
>
> Nothing derives a readable text colour from an arbitrary background. CSS cannot
> do it portably, and guessing would give a block that is legible on the palette
> it was tested against and not on the next one. Left unset, the text stays the
> theme's: right for a pale tint, wrong for a saturated fill, and wrong in a way
> you see immediately rather than on someone else's screen.

On a filled block the button is the topbar's secondary button, `--surface`
behind `--text`. Those two invert together with the colour mode, so the pill is
light with dark text on a light page and dark with light text on a dark one,
which a literal grey could not do.

That pairing holds against the theme's own colours, and cannot hold against one
it has never seen: a fixed `background` stays put while `--surface` flips, so a
dark custom fill that reads well in light mode gets a near-black pill on it in
dark mode. Measured on the block above before its action colours were set:
1.26:1, a button you could lose against its own block. So a custom `background`
is a commitment to `actionBackground` and `actionForeground` as well: the same
bargain as `foreground`, for the same reason.

## File trees

- `app/`
  - `index.mdx`
  - `guides/`
    - `authoring.mdx`
- `astro.config.ts`

```mdx
<Tree>
  <TreeFolder name="app">
    <TreeFile name="index.mdx" />
  </TreeFolder>
</Tree>
```

`FileTree`, `Folder`, and `File` are aliases for the same three components.
`Tree.Folder` and `Tree.File` are the same components again, written as member
expressions of their parent. The tree above uses this member-expression form.
All three notations leave identical Markdown in the page's twin, so an agent
reading it sees a folder listing rather than component syntax.

## Colours

- **Accent** — `{ light: '#16866a', dark: '#68b09e' }`
- **Accent strong** — `#0f5e4a`

`<Color.Item>` takes either one value or a `{ light, dark }` pair. It captions
the swatch with exactly what you wrote, not a sanitised version of it. Use
`variant="table"` for a labelled palette. Leave it off for a compact row.

## Columns

Exactly two cells. `Columns` follows the layout you drew.
Collapses to one column on a phone.

## The right rail

Top-level `Panel`, `RequestExample`, and `ResponseExample` content can occupy the
sticky right rail instead of the reading column. The `rightRail` field in
frontmatter decides. A panel placed on an ordinary page stays inline, which is
the default rather than a special case:

**A panel, inline.** This page keeps its table of contents, so the build
leaves this panel where it was written. See
[Page layouts](/reference/page-layouts), which uses the other setting and
therefore shows this same component in the rail.

## Page-wide variants

Use `<View>` for one page-wide language or framework selector. Use `<Tabs>`
for alternatives local to one passage. Two or more views make the selector
appear. One view on its own renders as an ordinary section. This is what
makes it safe to write a page one view at a time.

**TypeScript**

With two or more views on a page, a single selector appears above them and
switches the whole page at once. This is the TypeScript variant.

**Python**

This is the Python variant. Only one view is visible at a time. The
selector is the platform's own `<select>` element, so an option cannot
carry an icon. This is why a `View` is labelled by its `title` alone.

For content that differs between readers and models, rather than between
frameworks, use `<Visibility>`:

You are reading the Markdown twin, so this paragraph appears. The rendered
page carries a different paragraph in its place.

Full explanation in [Authoring](/guides/authoring#content-for-humans-content-for-agents).

## Diagrams

`<Mermaid>` is the component form of a diagram. A fenced ` ```mermaid ` block
is the usual way to write one, and
[Code and diagrams](/reference/code-and-diagrams#diagrams) covers both. Use the
component for a one-liner, or for the interactive controls:

```mermaid
`flowchart LR
A["content/page.mdx"] --> B["HTML"]
A --> C["page.md"]
A --> D["share card"]
C --> E["fetch tool"]`
```

`actions={true}` adds pan, zoom, reset, and a fullscreen viewer on hover or
keyboard focus. `placement` positions the inline controls. Set
`actions={false}` to make a deliberately static diagram.

## Icons

`<Icon>` places any icon the site knows about, and every `icon` slot on a
`Card` or a `Tile` takes the same names:

```mdx
<Icon name="rocket" size={20} />
```

[Code and diagrams](/reference/code-and-diagrams#icons) explains where the names
come from, and why a page should never use a raw emoji instead.

> **Note: One tag you rarely write**
>
> `ApiResponseDetails` renders the response documentation for an OpenAPI
> operation. Endpoint pages get it from the generated layout. It is in the
> vocabulary so a hand-written page can place it, but a hand-written page
> usually should not.
