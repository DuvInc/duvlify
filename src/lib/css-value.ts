/**
 * Sanitisers for author-supplied values that end up inside a `style` attribute.
 *
 * Several components let a page choose a colour — `<Callout color>`,
 * `<Card color>`, `<Icon color>`, `<ColorItem value>`, the global banner — and
 * the only way to hand a colour to CSS is to build a declaration string. Astro
 * escapes the attribute, so nothing can break out of it into markup; what it
 * does not stop is a value carrying a `;`, which ends the declaration and lets
 * the next one be anything at all. `red;position:fixed;inset:0` is a defaced
 * page, and `url(https://…)` in a colour slot is a request to somebody else's
 * server made from the reader's browser.
 *
 * These are not a defence against a hostile author — an author can already
 * write raw HTML in MDX. They are a defence against *imported* and generated
 * content, which is where a value nobody wrote by hand can arrive, and they
 * make the failure mode "the colour is ignored" rather than "the layout is
 * someone else's".
 */

/*
 * Everything a colour can legitimately need: hex, a named colour, `var(--x)`,
 * and the functional notations — rgb(), hsl(), oklch(), color-mix(in srgb, …).
 * Notably absent are `;` and `:`, which is what makes a value unable to become
 * a second declaration, and quotes and braces, which keep it out of any other
 * syntactic position.
 */
const SAFE_COLOUR = /^[a-z0-9#%.,()/\s_-]+$/i;

/** Rejected outright: a colour is never a request to another server. */
const FETCHES = /\burl\s*\(/i;

/**
 * Returns the value if it can only be read as a colour, otherwise undefined —
 * so a caller can fall back to the token-derived default with `??`.
 */
export function cssColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return undefined;
  if (FETCHES.test(trimmed)) return undefined;
  return SAFE_COLOUR.test(trimmed) ? trimmed : undefined;
}

/**
 * A whole-number count for a grid, clamped into a range.
 *
 * `<Columns cols>` and `<CardGroup cols>` both feed a custom property, and a
 * count arriving from MDX is a string like any other prop — `cols="2;position:fixed"`
 * set two columns and moved the element. Clamping is also the useful behaviour:
 * a layout has a range that works, and asking for eleven columns should give
 * the widest that does rather than an unreadable row.
 */
export function cssCount(value: unknown, fallback: number, max: number): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

/**
 * A `content:` value for the step counter: an integer, quoted, or undefined.
 *
 * `<Step stepNumber>` overrides the CSS counter, and `content` takes a string,
 * so the number has to arrive already quoted. Anything not a finite number is
 * dropped and the automatic counter stands.
 */
export function cssCounter(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `'${Math.trunc(parsed)}'` : undefined;
}

/**
 * Builds a `style` attribute from `{ property: value }`, dropping any pair
 * whose value is not a safe colour. Used where a component accepts a small map
 * of custom properties, such as `<Tree style={{ '--tree-highlight': '#8b5cf6' }}>`.
 *
 * Returns undefined rather than an empty string, so `style={…}` renders no
 * attribute at all when nothing survives.
 */
export function cssCustomProperties(value: unknown): string | undefined {
  const pairs: [string, unknown][] =
    typeof value === 'string'
      ? value.split(';').map(part => {
          const at = part.indexOf(':');
          return [part.slice(0, at).trim(), part.slice(at + 1)] as [string, unknown];
        })
      : value && typeof value === 'object'
        ? Object.entries(value as Record<string, unknown>)
        : [];

  const declarations = pairs
    .filter(([property]) => /^--[a-z0-9-]+$/i.test(property))
    .map(([property, raw]) => {
      const colour = cssColor(raw);
      return colour ? `${property}:${colour}` : '';
    })
    .filter(Boolean);
  return declarations.length ? declarations.join(';') : undefined;
}
