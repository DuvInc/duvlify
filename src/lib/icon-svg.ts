/**
 * Iconify lookup for the icon names the curated map does not carry.
 *
 * Lives in a module rather than inside `Icon.astro` for one reason: an Astro
 * component's frontmatter is its render function, so anything declared there is
 * rebuilt for every instance. A cache has to sit at module scope to survive
 * between them, and this is that scope.
 *
 * The saving is not subtle at documentation scale. Most of these names are
 * navigation icons, so each one is resolved once per page rather than once:
 * with a few hundred pages, the same handful of lookups runs tens of thousands
 * of times, and every one of them walks three icon sets and re-runs the same
 * SVG conversion to produce the same string.
 *
 * Safe by construction — the function is pure. Same name and size in, same
 * markup out, so memoising it cannot change a single byte of the build.
 */
import { getIconData, iconToSVG } from '@iconify/utils';
import faBrands from '@iconify-json/fa6-brands/icons.json';
import faSolid from '@iconify-json/fa6-solid/icons.json';
import lucideSet from '@iconify-json/lucide/icons.json';
import { iconAliases } from '../icon-aliases';

export interface InlineIcon {
  body: string;
  attributes: Record<string, string>;
}

const cache = new Map<string, InlineIcon | null>();

/**
 * Looks a name up across the Iconify sets and returns ready-to-inline SVG.
 * `body` already carries its own fill or stroke — Lucide's is stroked, Font
 * Awesome's is filled — so both render correctly against `currentColor`
 * without this having to know which is which.
 *
 * A miss is cached too. An unknown name renders nothing by design, and without
 * caching the negative result that decision would be re-derived from three full
 * icon sets on every page that mentions it.
 */
export function resolveIcon(name: string, px: number): InlineIcon | null {
  const key = `${name}|${px}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const alias = iconAliases[name];
  const sets: Record<string, unknown> = { lucide: lucideSet, 'fa6-solid': faSolid, 'fa6-brands': faBrands };

  const candidates: Array<[unknown, string]> = alias
    ? [[sets[alias.split(':')[0]], alias.split(':')[1]]]
    : [[lucideSet, name], [faSolid, name], [faBrands, name]];

  let resolved: InlineIcon | null = null;
  for (const [set, key2] of candidates) {
    if (!set) continue;
    const data = getIconData(set as never, key2);
    if (!data) continue;
    const { body, attributes } = iconToSVG(data, { height: String(px) });
    resolved = { body, attributes: attributes as Record<string, string> };
    break;
  }

  cache.set(key, resolved);
  return resolved;
}
