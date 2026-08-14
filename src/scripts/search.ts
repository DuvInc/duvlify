/**
 * Full-text search over the whole documentation set.
 *
 * The index is a single static JSON file built at compile time
 * (src/pages/search-index.json.ts) and fetched the first time the dialog opens
 * — it is never inlined into a page. That keeps every page the same size no
 * matter how many pages exist, and lets the index carry each page's *body*
 * text, so a reader can find a sentence and not just a title.
 *
 * Matching is a plain scored substring pass. It stays comfortably instant into
 * the low thousands of sections; past that, swap this module for a prebuilt
 * inverted index (Pagefind) without touching the markup or the styling.
 */
import { $, $$, escapeHtml } from './dom';

interface Section {
  /** Heading anchor, so a result can deep-link into the page. */
  a?: string;
  /** Heading text. Absent for a page's opening prose. */
  h?: string;
  /** Plain-text body under that heading. */
  t: string;
}
interface Page {
  h: string;
  t: string;
  s: string;
  d: string;
  k: 'page' | 'endpoint';
  m?: string;
  b: Section[];
}
interface QuickLink {
  h: string;
  t: string;
  s: string;
  k: 'page' | 'endpoint';
  m?: string;
}
interface Index {
  quick: QuickLink[];
  pages: Page[];
}

interface Hit {
  href: string;
  title: string;
  /** The second line of the result row: where it is, and/or what it says. */
  meta: string;
  score: number;
  kind: 'page' | 'endpoint' | 'heading';
  method?: string;
}

const MAX_RESULTS = 20;
/**
 * A result line is one row of clipped text, so the match has to appear early in
 * it — enough words before to give context, and the rest of the budget after.
 * Centring the match instead pushes it past the clip on a narrow dialog.
 */
const SNIPPET_LEAD = 34;
const SNIPPET_TRAIL = 150;

/** Wraps every occurrence of `query` in <mark>, on already-escaped text. */
function highlight(text: string, query: string) {
  const escaped = escapeHtml(text);
  if (!query) return escaped;
  const pattern = new RegExp(escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return escaped.replace(pattern, match => `<mark>${match}</mark>`);
}

/** A window of body text opening just before the match, cut at word boundaries. */
function snippetAround(text: string, at: number) {
  let start = Math.max(0, at - SNIPPET_LEAD);
  let end = Math.min(text.length, at + SNIPPET_TRAIL);
  if (start > 0) start = text.indexOf(' ', start) + 1 || start;
  if (end < text.length) end = text.lastIndexOf(' ', end) + 1 || end;
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

function search(index: Index, rawQuery: string): Hit[] {
  const query = rawQuery.toLowerCase();
  const hits: Hit[] = [];

  for (const page of index.pages) {
    const title = page.t.toLowerCase();
    let best: Hit | null = null;

    /* A title match always wins, and points at the page itself. */
    if (title.includes(query)) {
      best = {
        href: page.h,
        title: page.t,
        meta: `${page.s} · ${page.d}`,
        score: title.startsWith(query) ? 100 : 80,
        kind: page.k,
        method: page.m,
      };
    }

    for (const part of page.b) {
      const heading = part.h?.toLowerCase() ?? '';
      const anchor = part.a ? `${page.h}#${part.a}` : page.h;

      if (heading.includes(query)) {
        const score = heading.startsWith(query) ? 60 : 50;
        if (!best || score > best.score) {
          best = { href: anchor, title: part.h!, meta: `${page.t} · ${page.s}`, score, kind: 'heading' };
        }
        continue;
      }

      const at = part.t.toLowerCase().indexOf(query);
      if (at >= 0 && (!best || best.score < 30)) {
        best = {
          href: anchor,
          title: part.h ? `${page.t} · ${part.h}` : page.t,
          /* The title line already says where this is, so the whole second line
             goes to the sentence that matched. */
          meta: snippetAround(part.t, at),
          score: 30,
          kind: page.k,
          method: page.m,
        };
      }
    }

    if (best) hits.push(best);
  }

  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, MAX_RESULTS);
}

export function initSearch(indexUrl: string) {
  const dialog = $<HTMLDialogElement>('[data-search-dialog]');
  const input = $<HTMLInputElement>('[data-search-input]');
  const results = $('[data-search-results]');
  if (!dialog || !input || !results) return { open: () => {} };

  let index: Index | null = null;
  let loading: Promise<Index | null> | null = null;
  let activeIndex = -1;

  const items = () => $$<HTMLAnchorElement>('[data-search-item]', results);

  const setActive = (next: number) => {
    const all = items();
    all.forEach(item => item.classList.remove('active'));
    if (!all.length) {
      activeIndex = -1;
      return;
    }
    activeIndex = Math.max(0, Math.min(next, all.length - 1));
    const active = all[activeIndex];
    active.classList.add('active');
    active.scrollIntoView({ block: 'nearest' });
  };

  /* The row's icons come from a server-rendered <template> in the dialog, so
     the SVGs still have exactly one source (Icon.astro) — this module never
     hand-writes markup that a component already owns. */
  const template = $<HTMLTemplateElement>('[data-search-row]');

  const row = (
    href: string,
    title: string,
    meta: string,
    query: string,
    kind: 'page' | 'endpoint' | 'heading',
    method?: string,
  ) => {
    const node = template!.content.firstElementChild!.cloneNode(true) as HTMLAnchorElement;
    node.href = href;
    node.dataset.searchKind = kind;
    $('[data-search-title]', node)!.innerHTML = highlight(title, query);
    const badge = $('[data-search-method]', node)!;
    badge.hidden = !method;
    badge.textContent = method ?? '';
    if (method) badge.dataset.method = method;
    $('small', node)!.innerHTML = highlight(meta, query);
    return node;
  };

  const paint = (label: string, rows: Node[]) => {
    const heading = document.createElement('p');
    heading.className = 'search-label';
    heading.textContent = label;
    results.replaceChildren(heading, ...rows);
    setActive(0);
  };

  const message = (html: string) => {
    const paragraph = document.createElement('p');
    paragraph.className = 'search-empty';
    paragraph.innerHTML = html;
    results.replaceChildren(paragraph);
    activeIndex = -1;
  };

  const render = () => {
    const query = input.value.trim();
    if (!index || !template) {
      message('Loading the index…');
      return;
    }
    if (!query) {
      paint('Quick links', index.quick.map(link => row(link.h, link.t, link.s, '', link.k, link.m)));
      return;
    }
    const hits = search(index, query);
    if (!hits.length) {
      message(`No results for <strong>${escapeHtml(query)}</strong>.`);
      return;
    }
    paint(
      `${hits.length} result${hits.length === 1 ? '' : 's'}`,
      hits.map(hit => row(hit.href, hit.title, hit.meta, query, hit.kind, hit.method)),
    );
  };

  const load = () => {
    loading ??= fetch(indexUrl)
      .then(response => (response.ok ? (response.json() as Promise<Index>) : null))
      .catch(() => null)
      .then(loaded => {
        index = loaded;
        if (!index) message('Search is unavailable right now.');
        else render();
        return index;
      });
    return loading;
  };

  const open = () => {
    dialog.showModal();
    void load();
    setTimeout(() => { input.focus(); render(); }, 0);
  };

  $$('[data-search-open]').forEach(button => {
    button.addEventListener('click', open);
    /*
     * Start the download before the dialog is asked for.
     *
     * The index is the largest thing this site serves, and until it arrives the
     * dialog can only say "Loading the index…" at someone who is already
     * typing. Fetching it when a pointer settles on the trigger, or when the
     * trigger takes focus, turns most of that wait into time the reader was
     * spending anyway on the gesture itself.
     *
     * On intent rather than on load, deliberately. Prefetching for every
     * visitor would push a few hundred kilobytes at the majority who never open
     * search, and on a metered connection that is a real cost paid for nothing.
     * `load` is idempotent, so firing on both signals costs one request.
     *
     * Touch devices have no hover and go straight from tap to open, so they
     * gain nothing here. That is a limit of the signal, not a reason to
     * prefetch blindly for everyone.
     */
    button.addEventListener('pointerenter', () => void load(), { once: true });
    button.addEventListener('focus', () => void load(), { once: true });
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });

  input.addEventListener('input', render);
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(activeIndex + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(activeIndex - 1); }
    else if (event.key === 'Enter') { event.preventDefault(); items()[activeIndex]?.click(); }
  });
  results.addEventListener('mouseover', event => {
    const item = (event.target as HTMLElement).closest<HTMLAnchorElement>('[data-search-item]');
    if (item) setActive(items().indexOf(item));
  });

  return { open };
}
