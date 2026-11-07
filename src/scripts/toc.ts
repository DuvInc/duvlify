/**
 * Scroll-spy for the table of contents.
 *
 * Rather than reacting to intersection events — which skip headings that are
 * scrolled past quickly, and go blank when no heading is in the observed band —
 * this resolves the active entry from scroll position on every frame: the last
 * heading whose top has crossed the reading line, or the last heading overall
 * once the page is scrolled to the bottom.
 *
 * The reading line is never above where an anchor lands a heading (the root's
 * scroll-padding-top, which clears the fixed bars). It was 28% of the window
 * alone, and a heading jumped to from this very list landed below it, so the
 * list lit the heading before the one just clicked.
 *
 * A heading reached by a link (this list, an in-page anchor, a URL with a
 * hash) stays lit while it is on screen, until the reader scrolls. Position
 * alone cannot say it: the line sits below where a heading lands, so a short
 * next section crossed it too and lit the entry after the one clicked, and near
 * the end of a page a heading that cannot scroll up to the bars never reaches
 * the line. (Found on docs.softr.io, softr-io/softr-docs#62.)
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
  /* The entry a link jumped to, lit while it is on screen and the reader has
     not scrolled since. */
  let pinned: (typeof targets)[number] | null = null;
  const pinTo = (hash: string) => {
    const id = decodeURIComponent(hash.slice(1));
    pinned = targets.find(entry => entry.target.id === id) ?? null;
  };
  const unpin = () => { pinned = null; };

  /* Where an anchor jump puts a heading's top. Read once, and again on resize:
     the bars it clears can change height with the window. */
  let landing = 0;
  const measureLanding = () => {
    landing = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  };
  measureLanding();

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
    const line = Math.max(window.innerHeight * 0.28, landing + 24);
    const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
    let current = visibleTargets[0];
    const pin = pinned && visibleTargets.includes(pinned) ? pinned.target.getBoundingClientRect() : null;
    if (pinned && pin && pin.bottom > 0 && pin.top < window.innerHeight) {
      current = pinned;
    } else if (atBottom) {
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
  links.forEach(link => link.addEventListener('click', () => { pinTo(link.hash); onScroll(); }));
  for (const type of ['wheel', 'touchmove', 'keydown'] as const) addEventListener(type, unpin, { passive: true });
  if (location.hash) pinTo(location.hash);

  /*
   * An anchor jump lands where the page was when it started. Content drawn on
   * the way (a Mermaid diagram the scroll passes) can grow above the heading
   * and leave it a few hundred pixels low, under the next entry. Once the
   * scroll settles, put it back where an anchor lands a heading, once.
   */
  addEventListener('hashchange', () => {
    pinTo(location.hash);
    onScroll();
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (!target) return;
    let done = false;
    /* The reader scrolling on their own cancels it: never pull the page back. */
    const cancel = () => { done = true; };
    const input = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    input.forEach(type => addEventListener(type, cancel, { once: true, passive: true }));
    const settle = () => {
      if (done) return;
      done = true;
      removeEventListener('scrollend', settle);
      input.forEach(type => removeEventListener(type, cancel));
      const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
      if (!atBottom && Math.abs(target.getBoundingClientRect().top - landing) > 4) target.scrollIntoView({ block: 'start' });
    };
    addEventListener('scrollend', settle);
    setTimeout(settle, 1500);
  });
  /* A resize can reflow link heights (label wrapping) without changing which
     heading is active, so re-place the marker even when sync() no-ops. */
  addEventListener('resize', () => { measureLanding(); onScroll(); if (active) moveMarker(active.link); });
  /* Frames are not scheduled while the tab is hidden, so scrolling in a
     background tab leaves the marker stale. Resync when it comes back. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync();
  });
  document.addEventListener('docs:view-change', () => {
    active = null;
    sync();
  });
  sync();
}
