/* @vendored-from coloring-book:src/modules/sidebar-modal.ts
   @sha dca23b3
   @status verbatim */
/**
 * The shared sidebar-modal scaffold.
 *
 * `fares-modal.ts`, `feed-data-modal.ts`, `on-demand-modal.ts` and
 * `help-modal.ts` are all the same dialog: a menu of entries on the left, one
 * rendered pane on the right, and a Close action. This owns that skeleton, the
 * sidebar markup, the entry click delegation and the pane header, so a modal of
 * this shape is a list of entries rather than another copy of the layout.
 */

import { showModal, renderHelpIcon } from './modal-utils';
import { installGuideButtons } from './help-modal';
import { escapeHtml } from '../utils/escape-html';

export interface SidebarModalEntry {
  /** Table name, help page id, or anything else unique within the modal. */
  id: string;
  /** Sidebar label. */
  label: string;
  /** Sidebar grouping. Omitted on every entry gives a flat list. */
  group?: string;
  /** Sidebar count badge. Omitted renders no badge. */
  count?: () => Promise<number>;
  /** Heading of the pane header. Defaults to `label` when the header shows. */
  paneTitle?: string;
  /** A line of explanation under the header. Raw HTML, so it can carry a link. */
  note?: string;
  /** Help page id for the header's guide button. */
  guidePage?: string;
  /** Primary button in the header, e.g. "New zone". */
  primaryAction?: { label: string; onClick: (close: () => void) => unknown };
  /** The pane body, re-rendered on every refresh. */
  renderPane: () => Promise<string>;
}

export interface SidebarModalConfig {
  title: string;
  /** Raw HTML paragraph above the sidebar/pane row. */
  intro?: string;
  /** Group headers, in order. Groups not listed follow, in entry order. */
  groupOrder?: string[];
  entries: SidebarModalEntry[];
  /** Entry to open on. Falls back to the first entry. */
  initialId?: string;
  boxClassName?: string;
  closeLabel?: string;
  /**
   * Called after each pane render with that render's own wrapper element, for
   * pane-specific click wiring. The element is replaced on the next render, so
   * listeners on it do not accumulate.
   */
  onPaneRendered?: (paneEl: HTMLElement, close: () => void) => void;
  /** Filled in with a re-render callback, so a pane can refresh the modal. */
  refreshRef?: { refresh: () => Promise<void> };
}

// Nested sidebar modals would otherwise collide on the element ids.
let instanceCounter = 0;

function renderSidebar(
  config: SidebarModalConfig,
  activeId: string,
  counts: Map<string, number>
): string {
  const item = (entry: SidebarModalEntry): string => {
    const count = counts.get(entry.id);
    const badge =
      count === undefined
        ? ''
        : `<span class="badge badge-sm badge-ghost ml-auto">${count}</span>`;
    return `<li>
      <button
        type="button"
        data-sidebar-entry="${escapeHtml(entry.id)}"
        class="${entry.id === activeId ? 'menu-active' : ''}"
      >${escapeHtml(entry.label)}${badge}</button>
    </li>`;
  };

  const ungrouped = config.entries.filter((entry) => !entry.group);
  const groups: string[] = [...(config.groupOrder ?? [])];
  for (const entry of config.entries) {
    if (entry.group && !groups.includes(entry.group)) {
      groups.push(entry.group);
    }
  }

  const grouped = groups
    .map((group) => {
      const items = config.entries.filter((entry) => entry.group === group);
      if (items.length === 0) {
        return '';
      }
      return `<li class="menu-title">${escapeHtml(group)}</li>${items.map(item).join('')}`;
    })
    .join('');

  return `<ul class="menu menu-sm bg-base-200 rounded-box w-52 shrink-0">${ungrouped.map(item).join('')}${grouped}</ul>`;
}

/**
 * Header above the pane body. Skipped entirely for an entry that has nothing
 * to put in it, so a plain table pane looks as it did before the scaffold.
 */
function renderPaneHeader(entry: SidebarModalEntry): string {
  const hasHeader = Boolean(
    entry.primaryAction || entry.guidePage || entry.paneTitle
  );
  const note = entry.note
    ? `<p class="text-xs text-base-content/60 mb-2">${entry.note}</p>`
    : '';
  if (!hasHeader) {
    return note;
  }

  const action = entry.primaryAction
    ? `<button type="button" class="btn btn-sm btn-primary" data-pane-action>${escapeHtml(entry.primaryAction.label)}</button>`
    : '';
  const guide = entry.guidePage
    ? `<button type="button" class="btn btn-sm btn-ghost btn-square" data-open-guide="${escapeHtml(entry.guidePage)}" title="Guide">${renderHelpIcon()}</button>`
    : '';
  const buttons =
    action || guide
      ? `<div class="ml-auto flex gap-2">${action}${guide}</div>`
      : '';

  return `<div class="flex items-center gap-2 mb-2">
    <h4 class="font-semibold text-base">${escapeHtml(entry.paneTitle ?? entry.label)}</h4>
    ${buttons}
  </div>${note}`;
}

export async function showSidebarModal(
  config: SidebarModalConfig
): Promise<void> {
  if (config.entries.length === 0) {
    console.warn(`[SidebarModal] ${config.title} has no entries`);
    return;
  }

  const instanceId = `sidebar-modal-${++instanceCounter}`;
  const sidebarId = `${instanceId}-sidebar`;
  const paneId = `${instanceId}-pane`;

  let activeEntry =
    config.entries.find((entry) => entry.id === config.initialId) ??
    config.entries[0];
  let closeModal: () => void = () => {};

  const readCounts = async (): Promise<Map<string, number>> => {
    const counts = new Map<string, number>();
    for (const entry of config.entries) {
      if (entry.count) {
        counts.set(entry.id, await entry.count());
      }
    }
    return counts;
  };

  const refresh = async (): Promise<void> => {
    const counts = await readCounts();
    const sidebarEl = document.getElementById(sidebarId);
    const paneEl = document.getElementById(paneId);
    if (!sidebarEl || !paneEl) {
      return;
    }
    sidebarEl.innerHTML = renderSidebar(config, activeEntry.id, counts);

    // A fresh element per render, so listeners hung on it by onPaneRendered go
    // away with it instead of stacking up across pane switches.
    const content = document.createElement('div');
    content.innerHTML =
      renderPaneHeader(activeEntry) + (await activeEntry.renderPane());
    paneEl.replaceChildren(content);

    installGuideButtons(content);
    const actionBtn =
      content.querySelector<HTMLButtonElement>('[data-pane-action]');
    const primaryAction = activeEntry.primaryAction;
    if (actionBtn && primaryAction) {
      actionBtn.addEventListener('click', () => {
        void primaryAction.onClick(closeModal);
      });
    }
    config.onPaneRendered?.(content, closeModal);
  };

  if (config.refreshRef) {
    config.refreshRef.refresh = refresh;
  }

  const body = `
    ${config.intro ? `<p class="text-xs text-base-content/60 mb-3">${config.intro}</p>` : ''}
    <div class="flex gap-4 items-start">
      <div id="${sidebarId}" class="shrink-0"></div>
      <div id="${paneId}" class="flex-1 min-w-0"></div>
    </div>
  `;

  await showModal({
    title: config.title,
    body,
    actions: [{ label: config.closeLabel ?? 'Close', onClick: () => {} }],
    escapeAction: 0,
    boxClassName: config.boxClassName ?? 'max-w-6xl w-11/12',
    onMount: (close) => {
      closeModal = close;
      void refresh();

      document.getElementById(sidebarId)?.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
          '[data-sidebar-entry]'
        );
        const id = btn?.dataset.sidebarEntry;
        if (!id || id === activeEntry.id) {
          return;
        }
        const entry = config.entries.find((candidate) => candidate.id === id);
        if (!entry) {
          console.warn(`[SidebarModal] no entry for ${id}`);
          return;
        }
        activeEntry = entry;
        void refresh();
      });
    },
  });
}
