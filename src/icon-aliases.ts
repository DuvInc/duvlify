/**
 * Icon names that need a translation.
 *
 * Imported documentation may name Font Awesome icons; this site draws Lucide.
 * Icon.astro resolves an unknown name against Lucide first, then Font
 * Awesome, so roughly two thirds of an imported corpus's names already land on
 * a sensible Lucide glyph with no help — `database`, `users`, `key`, `map` and
 * so on are spelled the same in both sets.
 *
 * This map is only the remainder: names that exist in both sets meaning
 * different things, and names with no Lucide counterpart where a substitute
 * reads better than falling through to the Font Awesome original. Falling
 * through is not a failure — a Font Awesome glyph renders correctly, it just
 * sits at a heavier weight than the Lucide line work around it, so it is worth
 * redirecting the ones that appear often.
 *
 * A name with no entry here and no match in any set renders nothing rather
 * than a placeholder, and the migration's verify step lists it.
 */
export const iconAliases: Record<string, string> = {
  /* Same idea, different name in Lucide. */
  'circle-question': 'lucide:circle-help',
  'circle-xmark': 'lucide:circle-x',
  'pen-to-square': 'lucide:square-pen',
  'arrow-up-right-from-square': 'lucide:external-link',
  'wand-magic-sparkles': 'lucide:wand-sparkles',
  'shield-halved': 'lucide:shield',
  'building-columns': 'lucide:landmark',
  'diagram-project': 'lucide:workflow',
  'file-lines': 'lucide:file-text',
  'file-signature': 'lucide:file-pen',
  'file-shield': 'lucide:file-lock',
  'building-shield': 'lucide:building',
  'user-graduate': 'lucide:graduation-cap',
  'layer-group': 'lucide:layers',
  'border-all': 'lucide:table',
  'fill-drip': 'lucide:paint-bucket',
  'hand-pointer': 'lucide:mouse-pointer-click',
  'pen-ruler': 'lucide:pencil-ruler',
  'address-book': 'lucide:contact',
  scroll: 'lucide:scroll-text',
  rotate: 'lucide:rotate-cw',
  child: 'lucide:baby',
  envelope: 'lucide:mail',
  bolt: 'lucide:zap',
  trash: 'lucide:trash-2',
  grid: 'lucide:grid-3x3',

  /*
   * Sidebar section icons that neither set knows. These three name Font Awesome
   * Pro glyphs, or names Font Awesome retired at v6 — `random` became `shuffle`
   * — so they resolve nowhere and their sections rendered with no icon at all.
   */
  'hand-wave': 'lucide:hand',
  random: 'lucide:shuffle',
  'table-layout': 'lucide:panels-top-left',

  /*
   * Nine sidebar section icons that resolve, but only by falling through to
   * Font Awesome Solid — a filled glyph at a visibly heavier weight than every
   * Lucide line icon around it in the same sidebar, tabs, and buttons. Each of
   * these has a perfectly good Lucide equivalent; the two vocabularies just use
   * different words for it.
   */
  'circle-info': 'lucide:info',
  'code-branch': 'lucide:git-branch',
  comments: 'lucide:messages-square',
  cube: 'lucide:box',
  'file-pdf': 'lucide:file-text',
  language: 'lucide:languages',
  'magnifying-glass': 'lucide:search',
  message: 'lucide:message-square',
  robot: 'lucide:bot',

  /* Brand marks have no line-art equivalent and should stay recognisable. */
  google: 'fa6-brands:google',
  microsoft: 'fa6-brands:microsoft',
  aws: 'fa6-brands:aws',
};
