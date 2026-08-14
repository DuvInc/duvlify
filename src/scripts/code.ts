/**
 * Copy buttons on code blocks.
 *
 * Every one is cloned from a single <template> the layout renders, so the icons
 * still come from Icon.astro and no module hand-writes SVG. It also means a
 * fenced code block (wrapped by lib/rehype-code-chrome.ts) and a <CodeBlock>
 * component end up with exactly the same button, because there is only one.
 *
 * The button is injected rather than server-rendered because it does nothing
 * without JavaScript — better absent than present and inert.
 */
import { $, $$, confirmCopy, copyText } from './dom';

let template: HTMLTemplateElement | null = null;

export function makeCopyButton() {
  template ??= $<HTMLTemplateElement>('[data-copy-button-template]');
  const node = template?.content.firstElementChild?.cloneNode(true);
  return node instanceof HTMLButtonElement ? node : null;
}

/** Wires a copy button to whatever `<code>` lives inside `scope`. */
export function wireCopy(button: HTMLButtonElement, scope: () => Element | null | undefined) {
  button.addEventListener('click', async () => {
    await copyText($('code', scope() ?? document)?.textContent || '');
    confirmCopy(button);
  });
}

export function initCodeBlocks() {
  $$('.code-block-header').forEach(header => {
    const block = header.closest('.code-block');
    const button = makeCopyButton();
    if (!block || !button) return;
    header.append(button);
    wireCopy(button, () => block.hasAttribute('data-api-response-code')
      ? block.querySelector('.api-response-panel:not([hidden]) .code-block-body')
      : block.hasAttribute('data-api-request-code')
        ? block.querySelector('.api-request-panel:not([hidden]) .code-block-body')
        : block.querySelector('.code-block-body'));
  });

  /* An endpoint bar only shows its copy affordance once the reader approaches
     the row, keeping the row visually quiet until it's useful. Reuse the same
     button/template as code blocks so the icon, confirmation state, keyboard
     behaviour and clipboard fallback remain consistent across the whole
     documentation. */
  $$('.endpoint-row').forEach(row => {
    const button = makeCopyButton();
    if (!button || row.querySelector(':scope > .copy-button')) return;
    button.setAttribute('aria-label', 'Copy endpoint path');
    row.append(button);
    wireCopy(button, () => row);
  });
}
