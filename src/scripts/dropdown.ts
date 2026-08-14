/**
 * The one dropdown this site builds on the client.
 *
 * Two places need a "pick one of these" control that the server cannot render,
 * because what the options are is only known once the DOM exists: the language
 * selector on a code group, and the view selector a page with `<View>` gets. They
 * used to be a custom menu and a native `<select>` respectively — the same
 * decision presented two different ways on the same page, one of them styled by
 * the operating system.
 *
 * The markup and classes are the ones the OpenAPI panel's own selectors already
 * use (`.api-select-*` in api-reference.css), so all four controls on the site are
 * the same control. The `api-` prefix predates this being shared.
 */
import { $, $$ } from './dom';

export interface SelectOption {
  value: string;
  label: string;
  /** Language slug for the masked sprite icon. Omitted for a plain list. */
  icon?: string;
}

export interface Select {
  /** The wrapper, for the caller to place. */
  element: HTMLElement;
  /** Reflects a selection made elsewhere — a tab click, say — in the trigger. */
  show(value: string): void;
}

/*
 * Every open menu, by its closer.
 *
 * One pair of document listeners for the page rather than one pair per control:
 * a page with eight code groups was binding sixteen, each running on every click
 * anywhere, none of them ever removed.
 */
const openMenus = new Set<() => void>();
let dismissBound = false;

function bindGlobalDismiss() {
  if (dismissBound) return;
  dismissBound = true;
  document.addEventListener('click', event => {
    if ((event.target as HTMLElement).closest('[data-select]')) return;
    openMenus.forEach(close => close());
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') openMenus.forEach(close => close());
  });
}

/**
 * The same glyphs the server-rendered selectors use — cloned from templates in
 * DocsLayout.astro rather than hand-drawn here, so one chevron and one check
 * serve every selector on the site. See `[data-select-glyphs-template]`.
 */
function glyph(name: 'chevron' | 'check') {
  const template = $<HTMLTemplateElement>('[data-select-glyphs-template]');
  return $(`[data-select-glyph="${name}"]`, template?.content)?.firstElementChild?.cloneNode(true) ?? null;
}

function iconFor(slug: string, url: (slug: string) => string) {
  const icon = document.createElement('span');
  icon.className = 'api-language-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.style.setProperty('--api-language-icon', url(slug));
  return icon;
}

export function createSelect(config: {
  label: string;
  options: SelectOption[];
  value?: string;
  onSelect: (value: string) => void;
  /** Extra classes on the wrapper, for placement and width. */
  className?: string;
  /** Builds a masked-icon URL from a slug. Only needed when options carry icons. */
  iconUrl?: (slug: string) => string;
}): Select {
  const { label, options, onSelect, className, iconUrl } = config;

  const wrapper = document.createElement('div');
  wrapper.className = ['api-select', className].filter(Boolean).join(' ');
  wrapper.dataset.select = '';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'api-select-trigger';
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', label);

  const triggerIcon = document.createElement('span');
  triggerIcon.className = 'api-language-icon';
  triggerIcon.setAttribute('aria-hidden', 'true');
  triggerIcon.hidden = true;
  const triggerLabel = document.createElement('span');
  triggerLabel.dataset.selectLabel = '';
  trigger.append(triggerIcon, triggerLabel);
  const mark = glyph('chevron');
  if (mark) trigger.append(mark);

  const menu = document.createElement('div');
  menu.className = 'api-select-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;

  options.forEach(option => {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', 'false');
    item.dataset.selectOption = option.value;
    item.dataset.label = option.label;
    if (option.icon) item.dataset.icon = option.icon;

    if (option.icon && iconUrl) item.append(iconFor(option.icon, iconUrl));
    const text = document.createElement('span');
    text.textContent = option.label;
    const check = document.createElement('span');
    check.className = 'api-select-check';
    check.setAttribute('aria-hidden', 'true');
    const tick = glyph('check');
    if (tick) check.append(tick);
    item.append(text, check);
    menu.append(item);
  });

  wrapper.append(trigger, menu);

  const items = () => $$<HTMLButtonElement>('[data-select-option]', menu);

  const close = (restoreFocus = false) => {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    openMenus.delete(dismiss);
    if (restoreFocus) trigger.focus();
  };
  /* Only pulls focus back when it was inside the menu, so a click elsewhere on
     the page does not yank the caret to this trigger. */
  const dismiss = () => close(menu.contains(document.activeElement));
  const open = () => {
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    openMenus.add(dismiss);
  };

  const show = (value: string) => {
    const chosen = items().find(item => item.dataset.selectOption === value);
    items().forEach(item => item.setAttribute('aria-checked', String(item === chosen)));
    triggerLabel.textContent = chosen?.dataset.label ?? '';
    const slug = chosen?.dataset.icon;
    triggerIcon.hidden = !slug;
    if (slug && iconUrl) triggerIcon.style.setProperty('--api-language-icon', iconUrl(slug));
  };

  trigger.addEventListener('click', event => {
    event.stopPropagation();
    menu.hidden ? open() : close();
  });
  trigger.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    open();
    const list = items();
    const at = list.findIndex(item => item.getAttribute('aria-checked') === 'true');
    list[Math.max(0, at)]?.focus();
  });
  menu.addEventListener('click', event => {
    const item = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-select-option]');
    if (!item) return;
    const value = item.dataset.selectOption || '';
    /* The control reflects the choice itself before telling the caller, so a
       caller that only has to *act* on the choice — the view selector — does not
       also have to remember to update the trigger. Callers that drive selection
       from elsewhere, like a tab strip, call `show` again with the same value;
       it is idempotent. */
    show(value);
    onSelect(value);
    close(true);
  });
  menu.addEventListener('keydown', event => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? list.length - 1
      : (at + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
    list[next]?.focus();
  });

  bindGlobalDismiss();
  show(config.value ?? options[0]?.value ?? '');

  return { element: wrapper, show };
}
