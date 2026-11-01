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
import type { Index } from './search-rank';

const MAX_RESULTS = 20;

/**
 * The ranking module, fetched with the index rather than bundled with every
 * page.
 *
 * The scorer is a few kilobytes that a reader who never opens search would
 * otherwise download on every page. It is not deferred to the first keystroke:
 * it rides along with the index, which is two orders of magnitude larger, so by
 * the time the dialog has something to show it is always there.
 *
 * The words to highlight are the ones the reader typed, which is not the same
 * question the ranker asks: it drops the words a question is made of, and the
 * highlight should still be honest about what was searched.
 */
const wordsOfQuery = (query: string) => [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];

/**
 * Wraps every query word in <mark>.
 *
 * Splits the raw text on the words and escapes each piece afterwards. Matching
 * on already-escaped text found "amp" inside `&amp;` and printed a broken
 * entity with half of it highlighted.
 */
function highlight(text: string, query: string) {
  const words = wordsOfQuery(query).sort((a, b) => b.length - a.length);
  if (!words.length) return escapeHtml(text);
  const pattern = new RegExp(`(${words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text
    .split(pattern)
    .map((piece, index) => (index % 2 ? `<mark>${escapeHtml(piece)}</mark>` : escapeHtml(piece)))
    .join('');
}

export function initSearch(indexUrl: string) {
  const dialog = $<HTMLDialogElement>('[data-search-dialog]');
  const input = $<HTMLInputElement>('[data-search-input]');
  const results = $('[data-search-results]');
  if (!dialog || !input || !results) return { open: () => {} };

  let index: Index | null = null;
  let ranking: typeof import('./search-rank') | null = null;
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
    if (!index || !template || !ranking) {
      message('Loading the index…');
      return;
    }
    if (!query) {
      paint('Quick links', (index.quick ?? []).map(link => row(link.h, link.t, link.s, '', link.k ?? 'page', link.m)));
      return;
    }
    const hits = ranking.rank(index, query, MAX_RESULTS);
    if (!hits.length) {
      message(`No results for <strong>${escapeHtml(query)}</strong>.`);
      return;
    }
    /* When a word was corrected, say which question was answered: silently
       returning the results of "frontmatter" to someone who typed "frontmatr"
       hides the fact that search guessed. */
    const corrected = hits[0].corrected;
    const count = `${hits.length} result${hits.length === 1 ? '' : 's'}`;
    paint(
      corrected ? `${count} for ${corrected}` : count,
      hits.map(hit => row(hit.href, hit.title, hit.meta, corrected ?? query, hit.kind, hit.method)),
    );
  };

  const load = () => {
    loading ??= Promise.all([
      fetch(indexUrl)
        .then(response => (response.ok ? (response.json() as Promise<Index>) : null))
        .catch(() => null),
      import('./search-rank').catch(() => null),
    ]).then(([loaded, module]) => {
      index = loaded;
      ranking = module;
      if (!index || !ranking) message('Search is unavailable right now.');
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
