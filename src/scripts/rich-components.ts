import { $, $$ } from './dom';
import { createSelect } from './dropdown';

/**
 * Components that participate in the page shell rather than only their slot.
 *
 * Everything here has the same shape: Astro renders the markup in the article
 * where the author wrote it, and this moves it, labels it, or wires the keyboard
 * to it once the DOM exists. Nothing here renders content — a component whose
 * appearance is entirely its own belongs in a .astro file and styles/, not in
 * this file.
 */
export function initRichComponents() {
  initBanner();
  initRightRail();
  initViews();
  initPromptActions();
  initTrees();
}

/*
 * The desktop rail. One query, shared: a MediaQueryList fires on the crossing
 * rather than on every pixel of a window drag, so nothing below has to debounce
 * or re-read `matchMedia` per event.
 */
const desktopRail = matchMedia('(min-width: 1280px)');

function initBanner() {
  const banner = $('[data-global-banner]');
  if (!banner) return;
  const key = banner.dataset.bannerKey || '';

  /* Removing the attribute collapses --banner-h, which is what every fixed bar
     and the document's top padding are measured against — see tokens.css. The
     inline override below has to go with it, or the shell keeps reserving the
     height of a strip that is no longer there. */
  const dismiss = () => {
    banner.remove();
    document.documentElement.removeAttribute('data-has-global-banner');
    document.documentElement.style.removeProperty('--banner-h');
  };

  try {
    if (localStorage.getItem('duvlify-dismissed-banner') === key) return dismiss();
  } catch { /* Storage may be blocked; the banner simply stays dismissible. */ }

  /*
   * Keeps the token equal to the strip's real height.
   *
   * The stylesheet's 40px is right for the one-line announcement it was
   * designed around, and wrong the moment an author writes a longer one and it
   * wraps on a phone — the second line then sits over the navbar. A
   * ResizeObserver is the cheap way to know: it fires when the strip's box
   * actually changes, not on every resize event, and it is the only layout
   * read in this file.
   */
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--banner-h', `${Math.round(banner.offsetHeight)}px`);
  }).observe(banner);

  $('[data-banner-dismiss]', banner)?.addEventListener('click', () => {
    try { localStorage.setItem('duvlify-dismissed-banner', key); } catch { /* no-op */ }
    dismiss();
  });
}

/*
 * Top-level <Panel> and <RequestExample> move into the sticky right rail on a
 * wide screen and return to the article below it.
 *
 * A comment node is left where each one started, so the return trip is exact
 * even after the article's own scripts have moved siblings around. Only direct
 * children of the article qualify: a Panel inside <Columns> is part of a layout
 * the author built, and hoisting it would take it out of that layout.
 */
function initRightRail() {
  const slot = $('[data-right-rail-slot]');
  const article = $('.mdx-content');
  if (!slot || !article || document.body.dataset.rightRail !== 'custom') return;

  const candidates = $$<HTMLElement>(':scope > [data-right-rail-content]', article);
  if (!candidates.length) return;

  const anchors = candidates.map(node => {
    const anchor = document.createComment('right-rail-origin');
    node.before(anchor);
    return { node, anchor };
  });

  /* 1280px is where api-reference.css hides the rail column, so the two have to
     agree: below it the panel is not displayed and this is what puts the
     components back where the author wrote them. */
  const sync = () => {
    anchors.forEach(({ node, anchor }) => {
      if (desktopRail.matches) slot.append(node);
      else anchor.parentNode?.insertBefore(node, anchor.nextSibling);
    });
  };
  sync();
  desktopRail.addEventListener('change', sync);
}

/*
 * <View> turns a page into one selectable variant at a time — a language, a
 * framework — with a single control rather than a tab strip per section.
 *
 * The control is the shared selector from scripts/dropdown.ts, without icons.
 * It used to be a native <select>, which meant a page could show two different
 * kinds of dropdown side by side in the same rail — one of them drawn by the
 * operating system — for what is the same gesture.
 */
function initViews() {
  const views = $$<HTMLElement>('[data-content-view]');
  if (views.length < 2) return;
  const rail = document.body.dataset.rightRail === 'custom' ? $('[data-right-rail-slot]') : null;

  views.forEach((view, index) => { view.hidden = index !== 0; });
  let current = 0;

  /* A heading inside a hidden view must leave the table of contents with it, or
     the rail lists anchors that scroll nowhere. */
  const syncView = () => {
    views.forEach((view, index) => { view.hidden = index !== current; });
    $$<HTMLAnchorElement>('.toc-list > a').forEach(link => {
      const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
      link.hidden = Boolean(target?.closest<HTMLElement>('[data-content-view]')?.hidden);
    });
    document.dispatchEvent(new CustomEvent('duvlify:view-change'));
  };

  const select = createSelect({
    label: 'Content view',
    className: 'view-select',
    options: views.map((view, index) => ({
      value: String(index),
      label: view.dataset.viewTitle || `View ${index + 1}`,
    })),
    onSelect: value => { current = Number(value); syncView(); },
  });

  const origin = document.createComment('view-select-origin');
  views[0].before(origin);
  const place = () => {
    if (rail && desktopRail.matches) rail.prepend(select.element);
    else origin.parentNode?.insertBefore(select.element, origin.nextSibling);
  };
  place();
  desktopRail.addEventListener('change', place);
  syncView();
}

function initPromptActions() {
  $$<HTMLAnchorElement>('[data-prompt-cursor]').forEach(link => {
    const prompt = link.closest<HTMLElement>('.prompt');
    if (!prompt) return;
    const content = $('[data-prompt-content]', prompt)?.textContent?.trim() || '';
    link.href = `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(content)}`;
  });
}

/*
 * File trees, from either notation.
 *
 * <TreeFolder>/<TreeFile> render their own rows; a plain Markdown list inside
 * <Tree> does not, so the list is rewritten here into the same rows — same
 * icons, from the same template the components use, so the two notations are
 * indistinguishable once rendered. Both then share one roving-tabindex
 * keyboard model, which is what `role="tree"` promises a screen reader.
 */
function initTrees() {
  const icons = $<HTMLTemplateElement>('[data-tree-icons-template]')?.content;
  const iconFor = (kind: 'file' | 'folder') =>
    icons && $(`[data-tree-icon="${kind}"]`, icons)?.firstElementChild?.cloneNode(true);

  $$<HTMLElement>('[data-file-tree]').forEach(tree => {
    $$<HTMLLIElement>('li', tree).forEach(item => {
      if (item.hasAttribute('role')) return;
      const nested = Array.from(item.children).find(child => child.tagName === 'UL');
      const isFolder = Boolean(nested) || Boolean(item.textContent?.trim().endsWith('/'));

      const row = document.createElement('div');
      row.className = 'tree-row';
      const icon = iconFor(isFolder ? 'folder' : 'file');
      if (icon) row.append(icon);
      [...item.childNodes].filter(node => node !== nested).forEach(node => row.append(node));
      item.prepend(row);

      item.setAttribute('role', 'treeitem');
      item.tabIndex = -1;
      if (nested) {
        nested.classList.add('tree-branch');
        nested.setAttribute('role', 'group');
        item.setAttribute('aria-expanded', 'true');
      }
    });

    const items = $$<HTMLElement>('[role="treeitem"]', tree);
    if (!items.length) return;

    /* `aria-expanded` is the one thing a <details> does not announce for us
       once it is also a treeitem: the disclosure state is on the element, but
       the tree role overrides how it is read. Kept in step with the real
       state rather than set once. */
    items.filter((item): item is HTMLDetailsElement => item instanceof HTMLDetailsElement)
      .forEach(details => {
        const syncExpanded = () => details.setAttribute('aria-expanded', String(details.open));
        syncExpanded();
        details.addEventListener('toggle', syncExpanded);
      });

    items[0].tabIndex = 0;
    tree.addEventListener('keydown', event => {
      const current = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
      if (!current) return;
      const visible = items.filter(item => item.offsetParent !== null);
      const at = visible.indexOf(current);
      let next = at;
      if (event.key === 'ArrowDown') next = Math.min(at + 1, visible.length - 1);
      else if (event.key === 'ArrowUp') next = Math.max(at - 1, 0);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = visible.length - 1;
      else if (event.key === 'ArrowRight' && current instanceof HTMLDetailsElement) current.open = true;
      else if (event.key === 'ArrowLeft' && current instanceof HTMLDetailsElement) current.open = false;
      else return;
      event.preventDefault();
      items.forEach(item => { item.tabIndex = -1; });
      visible[next].tabIndex = 0;
      visible[next].focus();
    });
  });
}
