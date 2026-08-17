---
title: "Theming"
description: "Accent, font, and radius are one line each in docs.config.ts, and the neutral palette derives from a single background colour."
canonical: "https://duvlify.dev/reference/theming"
updated: "2026-08-18"
---

# Theming

Brand-level settings live in the `theme` block of `src/docs.config.ts`.
`ThemeTokens.astro` turns them into CSS custom properties, and
`astro.config.ts` hands the same font config to Astro's fonts API. Changing
the accent or the font is therefore a single edit, and no stylesheet needs
touching.

```ts title="src/docs.config.ts"
export const theme = {
  font: { sans: 'Inter', sansWeights: ['400 800'], mono: 'ui-monospace, …' },
  accent: { base: '#16866a', strong: '#0f5e4a', strongDark: '#68b09e', contrast: '#ffffff' },
  headerPrimary: { background: '', foreground: '' },
  radius: { lg: '16px', md: '12px', sm: '8px', xs: '6px', smoothing: 'subtle' },
} as const;
```

## The accent has four values, not one

This section explains a detail that often causes confusion.

| Field        | Role                                                         |
| ------------ | ------------------------------------------------------------ |
| `base`       | Fills and tints                                              |
| `strong`     | Text, borders, and active states, in light mode              |
| `strongDark` | The same role in dark mode, where `strong` would be too dark |
| `contrast`   | Text placed on top of a solid `base` fill                    |

`strong` exists because `base` usually cannot clear a 4.5:1 contrast ratio
against the accent _tints_ used behind badges, method pills, and changelog
labels. It can only clear that ratio against the page background. Those
tints are the accent at 12 to 24% over the background. A plausible-looking
accent often fails contrast specifically at the tint.

> **Warning: Measure both, not just the background**
>
> A colour picker shows you contrast against the page. Check the tint too.
> This site's `strong` clears 7.72:1 on the background and 5.64:1 on the
> densest tint. A shade one step lighter passed the first test and failed
> the second.

`contrast` has its own risk. A mid-tone accent is the worst case. If you
lighten `base` much past a 500-weight, neither white nor a dark shade of the
same hue clears 4.5:1 on it, because the fill then sits halfway between the
two. If nothing works, move `base` instead of searching for a text colour.

### An unrelated call-to-action colour

The topbar's filled primary button takes the accent colour by default. Set
either field of `headerPrimary` to break that link. A brand's call-to-action
colour is sometimes fixed and unrelated to the site's accent, and it should
not move whenever the accent does. Many brands use a black call-to-action
colour.

Leaving both `''` keeps the default, `accent.base` over `accent.contrast`.

## Changing the page background

`--bg` in
[`src/styles/tokens.css`](https://github.com/DuvInc/duvlify/blob/main/src/styles/tokens.css)
is the one colour a site most often wants to move, for example to a light
grey canvas that matches a marketing site. Change only this value. The raised
surfaces follow it automatically.

`--surface-2` (hover) and `--surface-active` (the current item) are not fixed
colours. Each is `--bg` mixed a measured distance toward `--text` in OKLab.
This holds the same perceptual separation from whatever background you set,
in both colour modes. The percentages differ by mode because perceived
contrast differs by mode: dark mode needs roughly twice the lightness step to
read the same as light mode.

> **Note: Why that is written down**
>
> These values used to be absolute colours, which worked only while `--bg`
> stayed white. One site set `--bg: #f5f5f5` and got a `--surface-2` of
> `#f5f5f5` too. The selected sidebar item then rendered in exactly the page
> colour and disappeared. Nothing was misconfigured. The tokens simply did
> not know the background had moved. If you find yourself hand-picking a
> second colour after changing `--bg`, that is the same bug returning.

## Fonts

```ts
font: {
  sans: 'Inter',
  sansWeights: ['400 800'],
  sansVariable: '--font-brand',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
}
```

The site uses `sans` for all interface and prose text. Astro downloads the
family at build time and emits the `@font-face` rules and preloads. This
avoids a render-blocking round trip to a font CDN, and it stops any third
party from learning your readers' IP addresses.

A single entry like `'400 800'` requests that weight range from a variable
font, which is one file instead of five. `mono` is a plain CSS stack: code is
set in whatever font the reader's system already has. This is both faster and
what most developers prefer.

> **Warning: A self-hosted font is a redistributed font**
>
> Because the font family ends up in `dist/`, deploying the site means
> serving those files from your own origin, and the font's licence travels
> with them. Inter is under the SIL Open Font License. Keep the licence
> available. Note also that the OFL reserves the name: a modified version may
> not be distributed as "Inter". Set `sans` to a system stack to opt out of
> self-hosting entirely. See the repository's `NOTICE`.

## Radius, and continuous corners

Radii step down as elements nest: shells use `lg`, then wells use `md`, then
controls use `sm` or `xs`.

`smoothing` turns on iOS-style continuous corners. The curve blends smoothly
into each straight edge, instead of the abrupt transition of an ordinary
circular radius. This uses native CSS, the `corner-shape` property, applied
once and globally in `shell.css`. Nothing here is a JavaScript or mask
polyfill. A browser that does not yet know the property simply keeps the
plain radius, because an unrecognised CSS property is inert and does not
break anything.

| Value      | Result                                                 |
| ---------- | ------------------------------------------------------ |
| `none`     | Ordinary round corners                                 |
| `subtle`   | A light continuous curve, what this site uses          |
| `standard` | A clearly continuous curve                             |
| `ios`      | The spec's own `squircle` keyword, the strongest curve |

## Where the rest lives

The neutral palette and the component styling are in
[`src/styles/tokens.css`](https://github.com/DuvInc/duvlify/blob/main/src/styles/tokens.css)
and
[`components.css`](https://github.com/DuvInc/duvlify/blob/main/src/styles/components.css).
The site designs both colour modes directly, rather than deriving one mode
from the other by inversion.

If you find yourself editing a stylesheet to change a brand value, treat that
as a gap in the `theme` block, not something to work around.
