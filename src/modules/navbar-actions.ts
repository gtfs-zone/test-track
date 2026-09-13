/* @vendored-from coloring-book:src/modules/navbar-actions.ts
   @sha 6ed5829
   @status verbatim */
import { escapeHtml } from '../utils/escape-html';
import { renderNavIcon, type NavIconName } from './nav-icons';

/**
 * The navbar's action row, as data.
 *
 * Every entry renders through one of four shapes below, so an action cannot
 * end up with a different box, a different icon size, a missing tooltip or a
 * missing accessible label than its neighbours: the `label` field feeds both
 * `data-tip` and `aria-label`, and the button classes come from the renderer,
 * not the entry.
 *
 * The list itself belongs to the app, not to this module. Element ids in it
 * are the contract with whatever wires the clicks up.
 */

interface CommonAction {
  /** Element id of the control itself. */
  id: string;
  /** Tooltip text and accessible name. */
  label: string;
  /** Consecutive entries sharing a group render in one tighter cluster. */
  group?: string;
}

/** Fields shared by every action that renders inside a tooltip wrapper. */
interface TooltippedAction extends CommonAction {
  /** Id for the count badge span; omitted means no badge. */
  badgeId?: string;
  /** Badge colour class; defaults to `badge-primary`. */
  badgeClass?: string;
  /** Hidden below the `md` breakpoint, where the dock takes over. */
  desktopOnly?: boolean;
  /** Id on the tooltip wrapper, for actions whose tip changes at runtime. */
  tooltipId?: string;
}

export interface IconAction extends TooltippedAction {
  kind: 'icon';
  icon: string;
  disabled?: boolean;
  onclick?: string;
}

export interface LinkAction extends TooltippedAction {
  kind: 'link';
  icon: string;
  href: string;
  /** Opens in a new tab, with the matching `rel`. */
  external?: boolean;
}

export interface ToggleAction extends TooltippedAction {
  kind: 'toggle';
  /** Shown when the checkbox is checked / unchecked. */
  iconOn: string;
  iconOff: string;
  /** Class the controlling module delegates on (e.g. `theme-controller`). */
  inputClass: string;
  value?: string;
}

export interface LabeledAction extends CommonAction {
  kind: 'labeled';
  icon: string;
  /** Button style, e.g. `btn-primary`. */
  btnClass: string;
  disabled?: boolean;
  /** Id on the label span, for a label written at runtime. */
  labelId?: string;
}

export type NavbarAction =
  | IconAction
  | LinkAction
  | ToggleAction
  | LabeledAction;

const ICON_BTN_CLASS = 'btn btn-ghost btn-sm btn-square';

function renderAction(action: NavbarAction): string {
  const label = escapeHtml(action.label);

  if (action.kind === 'labeled') {
    const disabled = action.disabled ? ' disabled' : '';
    const labelId = action.labelId ? ` id="${action.labelId}"` : '';
    return `<button id="${action.id}" class="btn btn-sm ${action.btnClass}" aria-label="${label}"${disabled}>${action.icon}<span${labelId} class="hidden md:inline">${label}</span></button>`;
  }

  let control: string;
  if (action.kind === 'toggle') {
    control =
      `<label id="${action.id}" class="${ICON_BTN_CLASS} swap swap-rotate" aria-label="${label}">` +
      `<input type="checkbox" class="${action.inputClass}"${action.value ? ` value="${action.value}"` : ''} />` +
      `${action.iconOn}${action.iconOff}</label>`;
  } else if (action.kind === 'link') {
    const target = action.external
      ? ' target="_blank" rel="noopener noreferrer"'
      : '';
    control = `<a id="${action.id}" href="${escapeHtml(action.href)}" class="${ICON_BTN_CLASS}" aria-label="${label}"${target}>${action.icon}</a>`;
  } else {
    control =
      `<button id="${action.id}" class="${ICON_BTN_CLASS}" aria-label="${label}"` +
      `${action.onclick ? ` onclick="${action.onclick}"` : ''}` +
      `${action.disabled ? ' disabled' : ''}>${action.icon}</button>`;
  }

  const tooltipId = action.tooltipId ? ` id="${action.tooltipId}"` : '';
  const tooltip = `<div class="tooltip tooltip-bottom"${tooltipId} data-tip="${label}">${control}</div>`;

  // The indicator only exists to anchor a badge; without one the tooltip
  // wrapper carries the responsive class itself.
  if (!action.badgeId) {
    return action.desktopOnly
      ? `<div class="indicator hidden md:inline-flex">${tooltip}</div>`
      : tooltip;
  }
  const indicatorClass = action.desktopOnly
    ? 'indicator hidden md:inline-flex'
    : 'indicator';
  const badgeClass = action.badgeClass ?? 'badge-primary';
  return `<div class="${indicatorClass}"><span id="${action.badgeId}" class="indicator-item badge badge-xs ${badgeClass} hidden"></span>${tooltip}</div>`;
}

/**
 * Render every navbar action into the container, grouped clusters included.
 *
 * Clustering walks consecutive entries: two entries with the same `group` that
 * are not adjacent render as two separate clusters, so list order decides the
 * rows.
 */
export function renderNavbarActions(
  container: HTMLElement,
  actions: NavbarAction[]
): void {
  const parts: string[] = [];
  let index = 0;

  while (index < actions.length) {
    const action = actions[index];
    if (!action.group) {
      parts.push(renderAction(action));
      index += 1;
      continue;
    }

    const cluster: string[] = [];
    const { group } = action;
    while (index < actions.length && actions[index].group === group) {
      cluster.push(renderAction(actions[index]));
      index += 1;
    }
    parts.push(
      `<div class="flex items-center gap-1">${cluster.join('')}</div>`
    );
  }

  container.innerHTML = parts.join('');
}

/**
 * Fill the dock buttons' icon slots from the shared icon map. The dock keeps
 * its own markup (labels, active state); only the artwork is shared.
 */
export function renderDockIcons(icons: [string, NavIconName][]): void {
  for (const [id, icon] of icons) {
    const button = document.getElementById(id);
    if (!button) {
      continue;
    }
    button.insertAdjacentHTML(
      'afterbegin',
      renderNavIcon(icon, { sizeClass: 'size-5', strokeWidth: 1.5 })
    );
  }
}
