/**
 * Scroll-spy for the table of contents.
 *
 * Rather than reacting to intersection events — which skip headings that are
 * scrolled past quickly, and go blank when no heading is in the observed band —
 * this resolves the active entry from scroll position on every frame: the last
 * heading whose top has crossed the reading line, or the last heading overall
 * once the page is scrolled to the bottom.
 */
import { $, $$ } from './dom';

export function initToc() {
  const links = $$<HTMLAnchorElement>('.toc-list > a');
  const marker = $('.toc-marker');
  const targets = links
    .map(link => ({ link, target: document.getElementById(decodeURIComponent(link.hash.slice(1))) }))
    .filter((entry): entry is { link: HTMLAnchorElement; target: HTMLElement } => Boolean(entry.target));

  if (!targets.length) return;

  let active: (typeof targets)[number] | null = null;

  /* The marker lives inside the same scrolling list as the links (see
     .toc-list), so its offsetTop/offsetHeight are already in that shared
     coordinate space — no scroll-position math needed to place it. */
  const moveMarker = (link: HTMLElement, instant = false) => {
    if (!marker) return;
    if (instant) marker.style.transition = 'none';
    marker.style.transform = `translateY(${link.offsetTop}px)`;
    marker.style.height = `${link.offsetHeight}px`;
    marker.classList.add('visible');
    if (instant) {
      void marker.offsetHeight;
      marker.style.transition = '';
    }
  };

  const sync = () => {
    const visibleTargets = targets.filter(entry => !entry.link.hidden && entry.target.offsetParent !== null);
    if (!visibleTargets.length) return;
    const line = window.innerHeight * 0.28;
    const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
    let current = visibleTargets[0];
    if (atBottom) {
      current = visibleTargets[visibleTargets.length - 1];
    } else {
      for (const entry of visibleTargets) {
        if (entry.target.getBoundingClientRect().top <= line) current = entry;
        else break;
      }
    }
    if (current === active) return;
    const isFirst = active === null;
    active = current;
    links.forEach(link => link.classList.toggle('active', link === current.link));
    moveMarker(current.link, isFirst);
  };

  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; sync(); });
  };

  addEventListener('scroll', onScroll, { passive: true });
  /* A resize can reflow link heights (label wrapping) without changing which
     heading is active, so re-place the marker even when sync() no-ops. */
  addEventListener('resize', () => { onScroll(); if (active) moveMarker(active.link); });
  /* Frames are not scheduled while the tab is hidden, so scrolling in a
     background tab leaves the marker stale. Resync when it comes back. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync();
  });
  document.addEventListener('duvlify:view-change', () => {
    active = null;
    sync();
  });
  sync();
}
