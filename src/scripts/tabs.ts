/**
 * Tab strips for <Tabs>, <CodeGroup> and <Examples>.
 *
 * The strip's container is rendered server-side by the component. Astro can't
 * read a slot's children as data, so the buttons themselves are derived on the
 * client from the panels each group actually contains — until then CSS shows
 * only the first panel (see .tabs in components.css), so a group never flashes
 * every panel at once.
 */
import { $, $$ } from './dom';
import { makeCopyButton, wireCopy } from './code';
import { languageIconUrl } from '../lib/language-icon';
import { createSelect, type Select } from './dropdown';

let groupIndex = 0;

const languageIcons: Record<string, string> = {
  bash: 'bash', shell: 'bash', sh: 'bash', curl: 'bash',
  javascript: 'javascript', js: 'javascript', jsx: 'javascript',
  typescript: 'javascript', ts: 'javascript', tsx: 'javascript',
  python: 'python', py: 'python', go: 'go', golang: 'go',
  java: 'java', php: 'php', ruby: 'ruby', rb: 'ruby',
};

function languageIcon(panel: HTMLElement, label: string) {
  const language = panel.querySelector<HTMLElement>('pre[data-language]')?.dataset.language || '';
  return languageIcons[language.toLowerCase()] || languageIcons[label.toLowerCase()] || '';
}

/* ── Synchronised selection ──────────────────────────────────────────────── */

/**
 * Groups synchronise by *signature* — their full ordered list of labels — not
 * by the label alone.
 *
 * A reader who picks Python in one install block means it for every install
 * block, and expects it to still be Python on the next page. They did not mean
 * it for an unrelated `<Tabs>` two sections down that happens to also offer a
 * tab called "REST": matching on one shared label made those two jump together,
 * which reads as a bug rather than as a preference being honoured.
 *
 * The same signature is the storage key, so the choice outlives the page.
 */
const CHOICE_KEY = 'duvlify-tab-choice';

const syncs = (group: HTMLElement) => group.dataset.tabSync !== 'false';

function readChoices(): Record<string, string> {
  try {
    const stored = JSON.parse(localStorage.getItem(CHOICE_KEY) || '{}');
    return stored && typeof stored === 'object' ? stored : {};
  } catch {
    /* Storage may be blocked or hold something else entirely; either way the
       authored default stands and selection still works for this page. */
    return {};
  }
}

function rememberChoice(signature: string, label: string) {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify({ ...readChoices(), [signature]: label }));
  } catch { /* no-op */ }
}

/* ── Activation ──────────────────────────────────────────────────────────── */

/* A group's language selector, when it has one, so `activate` can keep the
   trigger in step with a selection made from the tab strip or by synchronisation. */
const selectors = new WeakMap<HTMLElement, Select>();

function activate(tab: HTMLElement, focus = false, propagate = true) {
  const root = tab.closest<HTMLElement>('[data-tabs]');
  if (!root) return;

  $$('[data-tab]', root).forEach(candidate => {
    const active = candidate === tab;
    candidate.classList.toggle('active', active);
    candidate.setAttribute('aria-selected', String(active));
    candidate.tabIndex = active ? 0 : -1;
  });
  $$('[data-panel]', root).forEach(panel => {
    const active = panel.dataset.panel === tab.dataset.tab;
    panel.hidden = !active;
    panel.setAttribute('aria-hidden', String(!active));
  });
  selectors.get(root)?.show(tab.dataset.tab || '');
  if (focus) tab.focus();

  const label = tab.dataset.tabLabel;
  const signature = root.dataset.tabSignature;
  if (!propagate || !syncs(root) || !label || !signature) return;

  rememberChoice(signature, label);
  $$<HTMLElement>('[data-tabs]').forEach(other => {
    if (other === root || !syncs(other) || other.dataset.tabSignature !== signature) return;
    const match = $$<HTMLElement>('[data-tab]', other).find(c => c.dataset.tabLabel === label);
    if (match) activate(match, false, false);
  });
}

/* ── Build ───────────────────────────────────────────────────────────────── */

/**
 * A code group's language selector, when `dropdown` is set on the component.
 *
 * The control itself comes from scripts/dropdown.ts — the same one the OpenAPI
 * panel and the view selector use. All this does is describe the options and say
 * what a choice means.
 */
function buildLanguageSelect(root: HTMLElement, list: HTMLElement, panels: HTMLElement[]) {
  const tabs = $$<HTMLElement>('[data-tab]', list);
  const select = createSelect({
    label: list.getAttribute('aria-label') || 'Select code language',
    className: 'code-language-select',
    iconUrl: languageIconUrl,
    options: tabs.map((tab, index) => ({
      value: tab.dataset.tab || '',
      label: tab.dataset.tabLabel || '',
      icon: languageIcon(panels[index], tab.dataset.tabLabel || '') || undefined,
    })),
    onSelect: value => {
      const tab = tabs.find(candidate => candidate.dataset.tab === value);
      if (tab) activate(tab);
    },
  });
  selectors.set(root, select);
  list.parentElement?.insertBefore(select.element, list.nextSibling);
}

export function initTabs() {
  $$('[data-tabs]').forEach(root => {
    const list = $('[data-tab-list]', root);
    if (!list || $('[data-tab]', list)) return;

    const panels = [...root.children].filter((child): child is HTMLElement =>
      child instanceof HTMLElement && 'tabTitle' in child.dataset,
    );
    if (panels.length < 2) return;

    const rootId = root.id || `tab-group-${groupIndex++}`;
    root.id = rootId;

    const labels = panels.map((panel, index) => panel.dataset.tabTitle || `Tab ${index + 1}`);

    panels.forEach((panel, index) => {
      const panelId = `${rootId}-panel-${index}`;
      const tabId = `${rootId}-tab-${index}`;
      panel.dataset.panel = panelId;
      panel.id = panelId;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tabId);
      panel.setAttribute('aria-hidden', String(index !== 0));
      panel.hidden = index !== 0;

      const button = document.createElement('button');
      button.type = 'button';
      button.id = tabId;
      button.dataset.tab = panelId;
      button.dataset.tabLabel = labels[index];
      const icon = $('[data-tab-icon-template]', panel)?.firstElementChild;
      if (icon) button.append(icon.cloneNode(true));
      button.append(document.createTextNode(labels[index]));
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', panelId);
      button.setAttribute('aria-selected', String(index === 0));
      button.tabIndex = index === 0 ? 0 : -1;
      button.classList.toggle('active', index === 0);
      list.append(button);
    });

    root.dataset.tabSignature = labels.join('|');

    if (root.dataset.codeDropdown === 'true') buildLanguageSelect(root, list, panels);

    /* Marks that a strip exists, so the CSS can hide the per-block headers
       inside a code group. A single-file group keeps its own header instead. */
    root.dataset.tabbed = '';

    /* A remembered choice outranks `defaultTabIndex`: the author's default is
       for a reader who has not chosen yet. It is only consulted for a group
       that participates in synchronisation at all. */
    const remembered = syncs(root) ? readChoices()[root.dataset.tabSignature] : undefined;
    const rememberedIndex = remembered ? labels.indexOf(remembered) : -1;
    const authored = Math.min(Math.max(0, Number(root.dataset.defaultTabIndex) || 0), panels.length - 1);
    const initial = $$<HTMLElement>('[data-tab]', list)[rememberedIndex >= 0 ? rememberedIndex : authored];
    if (initial) activate(initial, false, false);

    /* A code group shows one copy button on the tab row, acting on whichever
       file is selected — the per-block headers are hidden inside a group.
       It goes in the bar beside the tablist, never inside it: a `role="tablist"`
       may only contain tabs, and a stray button there breaks the widget for a
       screen reader. */
    if (root.classList.contains('code-tabs')) {
      const copy = makeCopyButton();
      if (copy) {
        (list.parentElement ?? list).append(copy);
        wireCopy(copy, () => panels.find(panel => !panel.hidden));
      }
    }

    list.addEventListener('click', event => {
      const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-tab]');
      if (tab) activate(tab);
    });
    list.addEventListener('keydown', event => {
      const tabs = $$('[data-tab]', list);
      const current = tabs.indexOf((event.target as HTMLElement).closest<HTMLElement>('[data-tab]')!);
      if (current < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next =
        event.key === 'Home' ? 0
        : event.key === 'End' ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      activate(tabs[next], true);
    });
  });
}
