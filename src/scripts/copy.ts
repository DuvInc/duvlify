/**
 * The "copy" affordances that aren't code blocks: prompts, heading permalinks,
 * and the whole page. Code blocks are in code.ts, because they share one
 * injected button with the tab strips.
 */
import { $, $$, confirmCopy, copyText, on } from './dom';
import { markdownUrl } from '../lib/markdown-url';

export function initCopyButtons() {
  on('[data-copy-prompt]', 'click', async button => {
    const body = $('[data-prompt-content]', button.closest('.prompt') ?? document);
    await copyText(((body as HTMLElement | null)?.innerText || '').trim());
    confirmCopy(button);
  });

  on('[data-copy-heading]', 'click', async (button, event) => {
    event.preventDefault();
    event.stopPropagation();
    const id = button.dataset.copyHeading;
    if (!id) return;
    history.replaceState(null, '', `#${id}`);
    await copyText(`${location.origin}${location.pathname}#${id}`);
    confirmCopy(button, 1100);
  });

  on('[data-copy-heading][role="button"]', 'keydown', (button, event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      button.click();
    }
  });
}

/**
 * "Copy page" appears twice — the pill button and the dropdown's first item.
 * Both copy the same Markdown source (the .md route behind every page, see
 * src/pages/[...slug].md.ts) and confirm on the pill, whichever was clicked.
 */
export function initCopyPage(onDone: () => void) {
  on('[data-copy-page]', 'click', async button => {
    let text = '';
    try {
      const response = await fetch(markdownUrl(location.pathname));
      text = response.ok ? await response.text() : ($('#article') as HTMLElement | null)?.innerText || '';
    } catch {
      text = ($('#article') as HTMLElement | null)?.innerText || '';
    }
    await copyText(text);
    const actions = button.closest('[data-page-actions]');
    const pill = actions ? $('.page-actions-pill [data-copy-page]', actions) : null;
    confirmCopy(pill || button);
    onDone();
  });
}

/** Assistant links carry a base URL from the config; append this page's prompt. */
export function initAssistantLinks() {
  const prompt = encodeURIComponent(
    `Please help me understand this documentation page: ${document.title}\n\n${location.href}`,
  );
  $$<HTMLAnchorElement>('[data-assistant]').forEach(link => {
    link.href = (link.dataset.assistant || '') + prompt;
  });
}

/** The page-actions dropdown beside "Copy page". */
export function initPageMenu() {
  const menus = $$<HTMLElement>('[data-page-actions]').map(actions => ({
    button: $<HTMLButtonElement>('[data-page-menu-toggle]', actions),
    panel: $<HTMLElement>('[data-page-menu]', actions),
  }));

  const close = () => {
    for (const { button, panel } of menus) {
      if (panel) panel.hidden = true;
      button?.setAttribute('aria-expanded', 'false');
    }
  };

  for (const { button, panel } of menus) {
    button?.addEventListener('click', event => {
      event.stopPropagation();
      if (!panel) return;
      const isOpen = !panel.hidden;
      close();
      panel.hidden = isOpen;
      button.setAttribute('aria-expanded', String(!isOpen));
    });
  }

  return { close };
}

/**
 * Framed and inline prose images open full-size in a lightbox. Clicking the
 * backdrop, the image itself, or Escape (native <dialog>) all close it.
 */
export function initLightbox() {
  const lightbox = $<HTMLDialogElement>('[data-lightbox]');
  const image = $<HTMLImageElement>('[data-lightbox-image]');
  if (!lightbox || !image) return;

  $$<HTMLImageElement>('.frame-content > img, .mdx-content p > img').forEach(source =>
    source.addEventListener('click', () => {
      image.src = source.currentSrc || source.src;
      image.alt = source.alt;
      lightbox.showModal();
    }),
  );

  lightbox.addEventListener('click', event => {
    if (event.target === lightbox || event.target === image) lightbox.close();
  });
}
