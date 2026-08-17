/**
 * Renders Mermaid diagrams, lazily and off the critical path.
 *
 * Mermaid is by far the largest thing this site can load: the library plus its
 * per-diagram-type chunks and the dagre layout engine come to roughly forty
 * requests. Awaiting the import during startup — which is what an
 * `await import()` at module scope does — put every one of them in the initial
 * critical request chain and added ~700ms to it on a throttled connection, on
 * any page containing a diagram.
 *
 * So the import is gated twice over:
 *
 *   1. No diagram on the page, no request at all.
 *   2. A diagram exists, but nothing is fetched until one nears the viewport.
 *      On a long page — the component showcase has its diagrams two thirds of
 *      the way down — that means the initial load never touches Mermaid, and a
 *      reader who never scrolls there never pays for it.
 *
 * The *library* is shared, but *drawing* is per diagram, and the two used to be
 * confused. One diagram coming into view fetched Mermaid and then drew every
 * diagram on the page, because it handed the whole node list to `mermaid.run`
 * and disconnected the observer. The download is genuinely shared — one copy
 * serves the page, and deferring it per diagram would only re-request what is
 * already cached — but layout is not: dagre runs per diagram, synchronously, so
 * N diagrams meant one long task on the main thread instead of N short ones,
 * and a reader who stopped at the first diagram paid to lay out all of them.
 *
 * Now each node is observed on its own, unobserved once claimed, and drawn in a
 * serial queue. Diagrams below the fold are laid out when the reader reaches
 * them, one at a time, with a yield between so the page stays responsive.
 *
 * Diagrams are re-rendered when the colour mode changes, which is why each
 * node's definition is stashed before the first run: Mermaid replaces the
 * element's contents with SVG and the source would otherwise be gone. A theme
 * flip redraws only what has actually been drawn — repainting a diagram the
 * reader has never scrolled to would undo the laziness above.
 */
import { $$ } from './dom';

/** Start fetching this far before a diagram scrolls into view. */
const PRELOAD_MARGIN = '600px';

type Mermaid = Awaited<typeof import('mermaid')>['default'];

/**
 * The library, fetched at most once per page however many diagrams ask for it.
 *
 * Memoised on the promise rather than the result, so two diagrams that come
 * into view in the same frame await the same import instead of racing.
 */
let library: Promise<Mermaid> | undefined;
const loadMermaid = () => (library ??= import('mermaid').then(module => module.default));

/**
 * The body font, read once per page.
 *
 * `getComputedStyle` forces layout, and this is the same value for every
 * diagram, so reading it per draw would pay that cost once per diagram and once
 * more on every theme flip.
 */
let bodyFont: string | undefined;

export function initMermaid() {
  const nodes = $$('[data-mermaid]');
  if (!nodes.length) return;

  /* Captured before Mermaid overwrites it, and before any layout read that
     would otherwise be forced later. */
  nodes.forEach(node => {
    node.dataset.source ??= node.textContent ?? '';
  });

  /* Only diagrams that have actually been drawn — what a theme flip redraws. */
  const drawn = new Set<HTMLElement>();

  /*
   * Draws run one after another, never in parallel.
   *
   * Mermaid carries global configuration between calls and its layout pass is
   * synchronous, so two overlapping draws would both interleave that state and
   * merge into the single long task that drawing per diagram exists to avoid.
   */
  let queue = Promise.resolve();
  const enqueue = (job: () => Promise<void>) => {
    queue = queue.then(job).then(yieldToBrowser).catch(() => {});
  };

  const claim = (node: HTMLElement) => {
    /* Claims the element: from here the CSS hides the raw definition, because
       something is about to replace it. Released again if that fails. */
    node.dataset.mermaidPending = '';
    enqueue(async () => {
      const mermaid = await loadMermaid();
      watchTheme(mermaid, drawn);
      if (await draw(mermaid, node)) {
        drawn.add(node);
        attachControls([node]);
      } else {
        delete node.dataset.mermaidPending;
      }
    });
  };

  if (!('IntersectionObserver' in window)) {
    /* No observer: fall back to drawing once the page is otherwise idle. Still
       queued one at a time, which is the part that keeps the thread free. */
    requestIdle(() => nodes.forEach(claim));
    return;
  }

  const observer = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        /* Unobserved individually: the rest of the page's diagrams stay
           watched, which is what makes this lazy per diagram rather than
           lazy until the first one. */
        observer.unobserve(entry.target);
        claim(entry.target as HTMLElement);
      }
    },
    { rootMargin: PRELOAD_MARGIN },
  );
  nodes.forEach(node => observer.observe(node));
}

function requestIdle(callback: () => void) {
  if ('requestIdleCallback' in window) window.requestIdleCallback(callback, { timeout: 3000 });
  else setTimeout(callback, 1200);
}

/**
 * Hands control back between diagrams, so a run of adjacent ones cannot hold
 * the main thread for the length of all of them.
 *
 * Deliberately not `requestAnimationFrame`: that resolves only when the browser
 * is about to paint, and a page in a background tab is not painting. Yielding on
 * a frame would park the whole queue until the reader came back to the tab —
 * turning "draw one diagram at a time" into "draw none". `scheduler.yield` is
 * the purpose-built primitive where it exists, and a task is the fallback.
 */
const yieldToBrowser = (): Promise<void> => {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise<void>(resolve => setTimeout(resolve, 0));
};

/** Draws one diagram. Resolves `false` if Mermaid rejected its definition. */
async function draw(mermaid: Mermaid, node: HTMLElement): Promise<boolean> {
  bodyFont ??= getComputedStyle(document.body).fontFamily;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'neutral',
    fontFamily: bodyFont,
  });

  node.textContent = node.dataset.source ?? '';
  node.removeAttribute('data-processed');

  try {
    await mermaid.run({ nodes: [node] });
    return true;
  } catch {
    /* A malformed diagram shouldn't take the rest of the page down, nor the
       diagrams queued behind it. Show its source again rather than leaving an
       empty frame. */
    return false;
  }
}

let themeWatched = false;

/**
 * Redraws on a colour-mode change.
 *
 * Registered on the first draw rather than at startup, because before that
 * there is nothing to redraw and no library to redraw it with.
 *
 * `data-theme` flips on the root element for both the menu and the OS.
 * Redrawing replaces the SVG, so the pan and zoom a reader had set has to be
 * put back onto the new one — otherwise the diagram silently snaps to its
 * original position while the controls still believe they are zoomed in.
 */
function watchTheme(mermaid: Mermaid, drawn: Set<HTMLElement>) {
  if (themeWatched) return;
  themeWatched = true;

  let redraw = Promise.resolve();
  new MutationObserver(() => {
    /* Serial here too, and for the same reason as the draw queue. */
    redraw = redraw
      .then(async () => {
        for (const node of drawn) {
          await draw(mermaid, node);
          applyView(node);
          await yieldToBrowser();
        }
      })
      .catch(() => {});
  }).observe(document.documentElement, { attributeFilter: ['data-theme'] });
}

/* ── Pan and zoom ────────────────────────────────────────────────────────── */

/** A diagram shorter than this is fully visible; controls would be noise. */
const CONTROLS_MIN_HEIGHT = 120;

interface DiagramView { scale: number; x: number; y: number }

/* Kept per node rather than in the closure that set it, so a redraw can
   reapply it — see the observer above. */
const views = new WeakMap<HTMLElement, DiagramView>();

function applyView(node: HTMLElement) {
  const view = views.get(node);
  const svg = node.querySelector<SVGElement>('svg');
  if (view && svg) svg.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
}

/**
 * Adds the pan/zoom pad to every diagram tall enough to need one.
 *
 * Measuring and mutating are two separate passes on purpose: `offsetHeight` is
 * a layout read, and appending the controls invalidates layout, so doing both
 * per diagram costs one forced reflow per diagram. Split, the whole page costs
 * one.
 */
function attachControls(nodes: HTMLElement[]) {
  const wanted = nodes.filter(node => {
    const setting = node.dataset.mermaidActions;
    if (setting === 'false') return false;
    if (setting === 'true') return true;
    return node.offsetHeight > CONTROLS_MIN_HEIGHT;
  });
  wanted.forEach(addControls);
}

function addControls(node: HTMLElement) {
  const figure = node.closest<HTMLElement>('.diagram');
  if (!figure || figure.querySelector('[data-mermaid-controls]')) return;

  const template = document.querySelector<HTMLTemplateElement>('[data-mermaid-controls-template]');
  const controls = template?.content.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
  if (!controls) return;
  controls.classList.add(node.dataset.mermaidPlacement || 'bottom-right');

  /* Only a diagram that can actually be panned clips its overflow — a static
     one keeps whatever the stylesheet gives it. */
  node.dataset.mermaidInteractive = '';

  const view: DiagramView = { scale: 1, x: 0, y: 0 };
  views.set(node, view);
  const apply = () => applyView(node);

  const actions: Record<string, () => void> = {
    fullscreen: () => openFullscreen(node),
    'zoom-in': () => { view.scale = Math.min(3, view.scale + .2); apply(); },
    'zoom-out': () => { view.scale = Math.max(.4, view.scale - .2); apply(); },
    // The arrows move the viewport, not the sheet of paper: pressing "up"
    // reveals content above by moving the diagram down, and so on.
    up: () => { view.y += 24; apply(); },
    down: () => { view.y -= 24; apply(); },
    left: () => { view.x += 24; apply(); },
    right: () => { view.x -= 24; apply(); },
    reset: () => { view.scale = 1; view.x = 0; view.y = 0; apply(); },
  };
  controls.querySelectorAll<HTMLButtonElement>('[data-mermaid-action]').forEach(button => {
    const handler = actions[button.dataset.mermaidAction || ''];
    if (handler) button.addEventListener('click', handler);
  });
  figure.append(controls);
}

function openFullscreen(node: HTMLElement) {
  const source = node.querySelector<SVGElement>('svg');
  const template = document.querySelector<HTMLTemplateElement>('[data-mermaid-dialog-template]');
  const dialog = template?.content.firstElementChild?.cloneNode(true) as HTMLDialogElement | undefined;
  if (!source || !dialog) return;

  const canvas = dialog.querySelector<HTMLElement>('[data-mermaid-dialog-canvas]');
  const stage = dialog.querySelector<HTMLElement>('[data-mermaid-dialog-stage]');
  const zoomLabel = dialog.querySelector<HTMLOutputElement>('[data-mermaid-zoom]');
  if (!canvas || !stage) return;

  const svg = source.cloneNode(true) as SVGSVGElement;
  svg.style.transform = '';
  svg.style.transition = 'none';
  svg.style.maxWidth = 'none';
  stage.append(svg);
  document.body.append(dialog);

  /*
   * The stage is laid out at the diagram's natural size and then scaled to fit.
   *
   * The clone arrives sized to the article column — Mermaid writes a width onto
   * the element and the stylesheet caps it — which says nothing about how much
   * room the dialog has. Taking the size from the viewBox instead gives the
   * diagram's own coordinate space, so `translate(-50%, -50%)` centres it
   * exactly and one scale factor makes the whole of it visible.
   */
  const viewBox = svg.viewBox?.baseVal;
  let natural = viewBox?.width && viewBox?.height
    ? { width: viewBox.width, height: viewBox.height }
    : { width: 0, height: 0 };

  /** Breathing room between the diagram and the dialog's edges, in px. */
  const FRAME = 56;
  /*
   * How far a diagram smaller than the dialog may be enlarged to fill it.
   *
   * Fitting is a two-way operation, and without a ceiling a two-node diagram
   * came out at 4x — vector-crisp, but with strokes and type so heavy it read as
   * a mistake. Twice its own size is enough to look deliberate in a large
   * dialog; the reader can zoom past it from there.
   */
  const MAX_UPSCALE = 2;

  let fit = 1;
  let scale = 1;
  let x = 0;
  let y = 0;
  let dragging = false;
  let pointerX = 0;
  let pointerY = 0;

  const apply = () => {
    stage.style.transform = `translate(-50%, -50%) translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    /* Shown relative to the fitted view, so the state a reader opens on — and
       the one Reset returns to — reads as 100% rather than an arbitrary number
       that depends on the diagram's size. */
    if (zoomLabel) zoomLabel.value = `${Math.round((scale / fit) * 100)}%`;
  };
  const zoom = (amount: number) => {
    scale = Math.min(fit * 8, Math.max(fit * .2, scale * amount));
    apply();
  };

  /** Measures the fit for the dialog's current size. */
  const measure = () => {
    if (!natural.width || !natural.height) {
      const rect = svg.getBoundingClientRect();
      natural = { width: rect.width || 1, height: rect.height || 1 };
    }
    stage.style.width = `${natural.width}px`;
    stage.style.height = `${natural.height}px`;
    svg.style.width = '100%';
    svg.style.height = '100%';
    const room = {
      width: Math.max(1, canvas.clientWidth - FRAME * 2),
      height: Math.max(1, canvas.clientHeight - FRAME * 2),
    };
    fit = Math.max(
      .05,
      Math.min(room.width / natural.width, room.height / natural.height, MAX_UPSCALE),
    );
  };

  const reset = () => { measure(); scale = fit; x = 0; y = 0; apply(); };

  dialog.querySelector('[data-mermaid-dialog-close]')?.addEventListener('click', () => dialog.close());
  dialog.querySelector('[data-mermaid-dialog-action="zoom-in"]')?.addEventListener('click', () => zoom(1.2));
  dialog.querySelector('[data-mermaid-dialog-action="zoom-out"]')?.addEventListener('click', () => zoom(1 / 1.2));
  dialog.querySelector('[data-mermaid-dialog-action="reset"]')?.addEventListener('click', reset);
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });

  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    zoom(Math.exp(-event.deltaY * .0015));
  }, { passive: false });
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    dragging = true;
    pointerX = event.clientX;
    pointerY = event.clientY;
    canvas.classList.add('dragging');
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!dragging) return;
    x += event.clientX - pointerX;
    y += event.clientY - pointerY;
    pointerX = event.clientX;
    pointerY = event.clientY;
    apply();
  });
  const stopDragging = (event: PointerEvent) => {
    dragging = false;
    canvas.classList.remove('dragging');
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener('pointerup', stopDragging);
  canvas.addEventListener('pointercancel', stopDragging);
  canvas.addEventListener('keydown', event => {
    const pan = 32;
    if (event.key === 'Escape') { dialog.close(); event.preventDefault(); return; }
    if (event.key === '+' || event.key === '=') zoom(1.2);
    else if (event.key === '-') zoom(1 / 1.2);
    else if (event.key === '0') reset();
    else if (event.key === 'ArrowUp') { y += pan; apply(); }
    else if (event.key === 'ArrowDown') { y -= pan; apply(); }
    else if (event.key === 'ArrowLeft') { x += pan; apply(); }
    else if (event.key === 'ArrowRight') { x -= pan; apply(); }
    else return;
    event.preventDefault();
  });

  /* A window resized while the viewer is open changes how much room there is,
     so the fit is recomputed — but only while the reader is still on the fitted
     view. Re-fitting under someone who has zoomed in would throw away their
     position. */
  const refit = () => { if (Math.abs(scale - fit) < 1e-6 && !x && !y) reset(); };
  addEventListener('resize', refit, { passive: true });
  dialog.addEventListener('close', () => removeEventListener('resize', refit), { once: true });

  dialog.showModal();
  /* After the first frame: the dialog has to be laid out before the canvas can
     say how much room it has. */
  requestAnimationFrame(() => {
    reset();
    canvas.focus();
  });
}
