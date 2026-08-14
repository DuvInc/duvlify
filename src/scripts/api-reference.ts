/** Interactive OpenAPI controls shared by the central docs and code rail. */
import { $, $$ } from './dom';
import { languageIconUrl } from '../lib/language-icon';

export function initApiReference() {
  const responseTabs = $$<HTMLButtonElement>('[data-api-response-tab]');
  const responsePanels = $$<HTMLElement>('[data-api-response-panel]');
  const centralOptions = $$<HTMLButtonElement>('[data-api-central-response-option]');
  const centralPanels = $$<HTMLElement>('[data-api-central-response-panel]');

  const selectResponse = (status: string) => {
    responseTabs.forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.apiResponseTab === status)));
    responsePanels.forEach(panel => { panel.hidden = panel.dataset.apiResponsePanel !== status; });
    $$<HTMLElement>('[data-api-response-code]').forEach(card => {
      const active = $<HTMLElement>('.api-response-panel:not([hidden])', card);
      const type = $<HTMLElement>('.api-content-type', card);
      if (type) type.textContent = active?.dataset.contentType ?? '';
    });

    centralOptions.forEach(option => option.setAttribute('aria-checked', String(option.dataset.apiCentralResponseOption === status)));
    centralPanels.forEach(panel => { panel.hidden = panel.dataset.apiCentralResponsePanel !== status; });
    $$<HTMLElement>('[data-api-response-details]').forEach(details => {
      const active = $<HTMLElement>('.api-central-response-panel:not([hidden])', details);
      const label = $<HTMLElement>('[data-api-response-select-label]', details);
      const type = $<HTMLElement>('[data-api-central-content-type]', details);
      if (label) label.textContent = status;
      if (type) type.textContent = active?.dataset.contentType ?? '';
    });
  };

  responseTabs.forEach(tab => tab.addEventListener('click', () => selectResponse(tab.dataset.apiResponseTab ?? '')));
  centralOptions.forEach(option => option.addEventListener('click', () => {
    selectResponse(option.dataset.apiCentralResponseOption ?? '');
    closeMenus();
  }));

  const languageOptions = $$<HTMLButtonElement>('[data-api-language-option]');
  const selectLanguage = (id: string) => {
    languageOptions.forEach(option => option.setAttribute('aria-checked', String(option.dataset.apiLanguageOption === id)));
    $$<HTMLElement>('[data-api-request-panel]').forEach(panel => { panel.hidden = panel.dataset.apiRequestPanel !== id; });
    $$<HTMLElement>('[data-api-language-select]').forEach(select => {
      const option = languageOptions.find(item => item.dataset.apiLanguageOption === id);
      const label = $<HTMLElement>('[data-api-language-label]', select);
      const icon = $<HTMLElement>('.api-language-trigger .api-language-icon', select);
      if (label) label.textContent = option?.dataset.label ?? id;
      if (icon && option?.dataset.icon) {
        icon.style.setProperty('--api-language-icon', languageIconUrl(option.dataset.icon));
      }
    });
  };

  languageOptions.forEach(option => option.addEventListener('click', () => {
    selectLanguage(option.dataset.apiLanguageOption ?? 'curl');
    closeMenus();
  }));

  const menuPairs = [
    ...$$<HTMLElement>('[data-api-language-select]').map(root => ({
      root,
      toggle: $<HTMLButtonElement>('[data-api-language-toggle]', root),
      menu: $<HTMLElement>('[data-api-language-menu]', root),
    })),
    ...$$<HTMLElement>('[data-api-response-select]').map(root => ({
      root,
      toggle: $<HTMLButtonElement>('[data-api-response-select-toggle]', root),
      menu: $<HTMLElement>('[data-api-response-select-menu]', root),
    })),
  ];

  function closeMenus(except?: HTMLElement) {
    menuPairs.forEach(pair => {
      if (!pair.toggle || !pair.menu || pair.root === except) return;
      pair.menu.hidden = true;
      pair.toggle.setAttribute('aria-expanded', 'false');
    });
  }

  menuPairs.forEach(({ root, toggle, menu }) => toggle?.addEventListener('click', event => {
    event.stopPropagation();
    const opening = menu?.hidden ?? false;
    closeMenus(root);
    if (!menu) return;
    menu.hidden = !opening;
    toggle.setAttribute('aria-expanded', String(opening));
  }));

  document.addEventListener('click', event => {
    if (!(event.target as HTMLElement).closest('[data-api-language-select], [data-api-response-select]')) closeMenus();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenus(); });
}
