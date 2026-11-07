/** Mobile navigation drawer, and the sidebar's overlay scrollbar. */
import { storageKey } from '../docs.config';
import { $, $$ } from './dom';

export function initMobileNav() {
  const sidebar = $('[data-sidebar]');
  const overlay = $('[data-mobile-overlay]');

  const setOpen = (open: boolean) => {
    sidebar?.classList.toggle('open', open);
    overlay?.classList.toggle('open', open);
    document.documentElement.classList.toggle('nav-open', open);
  };

  $$('[data-menu-toggle]').forEach(button => button.addEventListener('click', () => setOpen(true)));
  $$('[data-menu-close]').forEach(button => button.addEventListener('click', () => setOpen(false)));
  overlay?.addEventListener('click', () => setOpen(false));

  return { close: () => setOpen(false) };
}

/**
 * A minimal overlay scrollbar for the sidebar: the rail has no border by
 * default and reveals a thin thumb only on hover or while scrolling. The
 * native scrollbar is hidden (see .sidebar-viewport in shell.css) and this one
 * is drawn on top, sized and positioned from scroll metrics.
 */
export function initSidebarScrollbar() {
  const viewport = $('[data-sidebar-viewport]');
  const track = $('[data-sidebar-scrollbar]');
  const thumb = $('[data-sidebar-thumb]');
  if (!viewport || !track || !thumb) return;

  let hideTimer: number | undefined;
  const revealWhileScrolling = () => {
    track.classList.add('scrolling');
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => track.classList.remove('scrolling'), 800);
  };

  const syncThumb = () => {
    const trackHeight = track.clientHeight;
    const scrollable = viewport.scrollHeight - viewport.clientHeight;
    if (scrollable <= 0) {
      track.style.display = 'none';
      return;
    }
    track.style.display = '';
    const ratio = viewport.clientHeight / viewport.scrollHeight;
    const thumbHeight = Math.max(trackHeight * ratio, 24);
    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${(trackHeight - thumbHeight) * (viewport.scrollTop / scrollable)}px)`;
  };

  viewport.addEventListener('scroll', () => { syncThumb(); revealWhileScrolling(); }, { passive: true });
  /* Observing the viewport alone misses content-height changes that don't
     resize the viewport's own box, like a nav folder collapsing. */
  new ResizeObserver(syncThumb).observe(viewport);
  $$('details', viewport).forEach(details => details.addEventListener('toggle', syncThumb));
  addEventListener('resize', syncThumb);
  syncThumb();

  let dragStartY = 0;
  let dragStartScrollTop = 0;
  let dragging = false;

  thumb.addEventListener('pointerdown', event => {
    dragging = true;
    dragStartY = event.clientY;
    dragStartScrollTop = viewport.scrollTop;
    thumb.setPointerCapture(event.pointerId);
    track.classList.add('scrolling');
  });
  thumb.addEventListener('pointermove', event => {
    if (!dragging) return;
    const scrollable = viewport.scrollHeight - viewport.clientHeight;
    const travel = track.clientHeight - thumb.offsetHeight;
    viewport.scrollTop = dragStartScrollTop + ((event.clientY - dragStartY) / travel) * scrollable;
  });
  const endDrag = () => {
    dragging = false;
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => track.classList.remove('scrolling'), 800);
  };
  thumb.addEventListener('pointerup', endDrag);
  thumb.addEventListener('pointercancel', endDrag);
}

/**
 * Keeps the active sidebar link in view on load. With a long sidebar, the
 * current page can otherwise be scrolled out of sight on arrival.
 *
 * Only when the link is entirely out of view. A link half-hidden at the bottom
 * edge is the one the reader just clicked, so scrolling to centre it moved the
 * sidebar under the pointer on every such click.
 */
export function revealActiveNavLink() {
  const viewport = $('[data-sidebar-viewport]');
  const active = $('.sidebar nav a.active');
  if (!viewport || !active) return;
  const link = active.getBoundingClientRect();
  const frame = viewport.getBoundingClientRect();
  if (link.bottom > frame.top && link.top < frame.bottom) return;
  viewport.scrollTop += link.top - frame.top - frame.height / 3;
}

/**
 * Saves the sidebar's scroll and open folders as the page is left, for
 * SidebarRestore to put back before the next page paints. Folders are saved by
 * position: the tree is the same on every page of a tab, and the tab is saved
 * alongside so another tab's tree never reads them.
 */
export function rememberSidebar() {
  const viewport = $('[data-sidebar-viewport]');
  if (!viewport) return;
  const save = () => {
    const open: number[] = [];
    viewport.querySelectorAll<HTMLDetailsElement>('nav details').forEach((folder, index) => { if (folder.open) open.push(index); });
    try {
      sessionStorage.setItem(storageKey('sidebar'), JSON.stringify({ tab: viewport.dataset.sidebarTab, top: viewport.scrollTop, open }));
    } catch { /* storage blocked: the next page starts at the top */ }
  };
  addEventListener('pagehide', save);
}
