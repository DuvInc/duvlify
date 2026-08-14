/**
 * Every behaviour on a documentation page, wired once.
 *
 * Astro bundles and minifies this into a single fingerprinted file shared by
 * the whole site, so a reader downloads it once and navigates for free.
 *
 * Startup runs in two phases, deliberately.
 *
 * Phase one mutates the DOM: injecting copy buttons, building tab strips,
 * binding listeners. Phase two measures it: the sidebar's scroll metrics, where
 * the active nav link sits, where the table-of-contents marker belongs.
 *
 * Interleaving the two is what produces a forced reflow — a geometry read after
 * a write makes the browser lay the page out synchronously, and doing that
 * repeatedly cost ~90ms of blocking time here. Separated by one animation
 * frame, every write lands in a single natural layout and the reads that follow
 * are free.
 */
import { site } from '../docs.config';
import { initAgentAccess } from './agent';
import { initApiReference } from './api-reference';
import { initCodeBlocks } from './code';
import { initAssistantLinks, initCopyButtons, initCopyPage, initLightbox, initPageMenu } from './copy';
import { initMermaid } from './mermaid';
import { initMobileNav, initSidebarScrollbar, revealActiveNavLink } from './nav';
import { initSearch } from './search';
import { initTabs } from './tabs';
import { initTheme } from './theme';
import { initToc } from './toc';
import { initRichComponents } from './rich-components';

/* ── Phase one: mutate and bind, no geometry reads ───────────────────────── */

const theme = initTheme(site.themeStorageKey);
const mobileNav = initMobileNav();
const pageMenu = initPageMenu();
const search = initSearch(site.searchIndexPath);

initCodeBlocks();
initApiReference();
initCopyButtons();
initCopyPage(pageMenu.close);
initAgentAccess(pageMenu.close);
initAssistantLinks();
initLightbox();
initTabs();
initRichComponents();

document.addEventListener('click', event => {
  const target = event.target as HTMLElement;
  if (!target.closest('[data-page-actions]')) pageMenu.close();
  if (!target.closest('.theme-menu')) theme.close();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    mobileNav.close();
    pageMenu.close();
    theme.close();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    search.open();
  }
});

/* ── Phase two: measure, once the writes above have been laid out ────────── */

/*
 * A task, not an animation frame. `requestAnimationFrame` never fires while the
 * document is hidden — a page opened in a background tab, restored from a
 * session, or prerendered would run phase one and then wait indefinitely,
 * leaving the table of contents inert and diagrams unrendered for the whole
 * visit. A timer still yields past the mutation task above, which is all the
 * separation the reads below need, and it always runs.
 */
setTimeout(() => {
  initSidebarScrollbar();
  revealActiveNavLink();
  initToc();
  /* Only registers an observer; the library itself is fetched when a diagram
     nears the viewport. */
  initMermaid();
}, 0);
