/**
 * The handful of DOM helpers every behaviour module shares.
 *
 * These modules are bundled by Astro into one fingerprinted, minified script
 * for the whole site — unlike an `is:inline` block, which is re-sent verbatim
 * with every page and never cached.
 */

export const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) =>
  root.querySelector<T>(selector);

export const $$ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document) => [
  ...root.querySelectorAll<T>(selector),
];

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const copyTimers = new WeakMap<Element, number>();

/**
 * Flips a `.copy-button` / `.copy-swap` into its confirmed state. Both states
 * are already stacked in the markup (see components.css), so this only
 * crossfades between them — the button never resizes or reflows.
 */
export function confirmCopy(button: Element | null, duration = 1600) {
  if (!button) return;
  button.classList.add('copied');
  clearTimeout(copyTimers.get(button));
  copyTimers.set(
    button,
    window.setTimeout(() => button.classList.remove('copied'), duration),
  );
}

/** Runs `handler` on every element matching `selector`, for the given event. */
export function on<K extends keyof HTMLElementEventMap>(
  selector: string,
  event: K,
  handler: (element: HTMLElement, event: HTMLElementEventMap[K]) => void,
) {
  $$(selector).forEach(element =>
    element.addEventListener(event, e => handler(element, e as HTMLElementEventMap[K])),
  );
}

/** Escapes text before it goes into innerHTML. Used by the search renderer. */
export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] as string,
  );
}
