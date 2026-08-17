/**
 * Colour-mode menu.
 *
 * The *initial* theme is applied by a tiny inline script in <head>
 * (ThemeBootstrap.astro) so there is no flash before paint. This module only
 * owns what happens after: the menu, the persisted choice, and following the
 * OS while the visitor is still on "system".
 */
import { $, $$ } from './dom';

export type ThemePref = 'system' | 'light' | 'dark';

const prefersDark = () => matchMedia('(prefers-color-scheme: dark)').matches;

export function initTheme(storageKey: string) {
  const root = document.documentElement;

  const apply = (pref: ThemePref) => {
    root.dataset.theme = pref === 'system' ? (prefersDark() ? 'dark' : 'light') : pref;
    root.dataset.themePref = pref;
    localStorage.setItem(storageKey, pref);
    $$('[data-theme-option]').forEach(button => {
      button.classList.toggle('active', button.dataset.themeOption === pref);
    });
  };

  const button = $('[data-theme-menu-toggle]');
  const panel = $('[data-theme-menu]');

  const close = () => {
    if (!panel) return;
    panel.hidden = true;
    button?.setAttribute('aria-expanded', 'false');
  };

  button?.addEventListener('click', event => {
    event.stopPropagation();
    if (!panel) return;
    const isOpen = !panel.hidden;
    panel.hidden = isOpen;
    button.setAttribute('aria-expanded', String(!isOpen));
  });

  $$('[data-theme-option]').forEach(option =>
    option.addEventListener('click', () => {
      apply((option.dataset.themeOption as ThemePref) || 'system');
      close();
    }),
  );

  /* Only follow the OS while the visitor hasn't made an explicit choice. */
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
    if (root.dataset.themePref !== 'system') return;
    root.dataset.theme = event.matches ? 'dark' : 'light';
  });

  apply((root.dataset.themePref as ThemePref) || 'system');
  return { close };
}
