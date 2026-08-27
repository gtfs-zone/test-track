/* @vendored-from coloring-book:src/modules/help-modal.ts
   @sha 2302e2e
   @status verbatim */
/**
 * The help viewer: a sidebar of `HELP_PAGES` grouped by `HelpGroup`, and one
 * rendered page in the content pane. Modelled directly on `fares-modal.ts`:
 * adding a page is an entry in `help-pages.ts`, not a new renderer.
 */

import { showModal } from './modal-utils.js';
import { escapeHtml } from '../utils/escape-html.js';
import { HELP_PAGES, getHelpPage, type HelpGroup } from './help-pages.js';

const GROUP_ORDER: HelpGroup[] = ['Getting Started', 'Reference'];

function shownKey(id: string): string {
  return `help.${id}.seen`;
}

/**
 * Whether a help page should be shown. A page with no `showOnceKey` is always
 * shown. `localStorage` failing (private browsing, quota) must never block
 * boot, so any error here also means "show it".
 */
export function shouldShowHelpPage(id: string): boolean {
  const page = getHelpPage(id);
  if (!page?.showOnceKey) {
    return true;
  }
  try {
    return localStorage.getItem(shownKey(id)) !== '1';
  } catch {
    return true;
  }
}

export function markHelpPageSeen(id: string): void {
  const page = getHelpPage(id);
  if (!page?.showOnceKey) {
    return;
  }
  try {
    localStorage.setItem(shownKey(id), '1');
  } catch {
    // Nothing to do: the page will simply show again next time.
  }
}

function renderSidebar(activeId: string): string {
  const groups = GROUP_ORDER.map((group) => {
    const pages = HELP_PAGES.filter((page) => page.group === group);
    if (pages.length === 0) {
      return '';
    }
    const items = pages
      .map(
        (page) => `<li>
          <button
            type="button"
            data-help-entry="${escapeHtml(page.id)}"
            class="${page.id === activeId ? 'menu-active' : ''}"
          >${escapeHtml(page.label)}</button>
        </li>`
      )
      .join('');
    return `<li class="menu-title">${group}</li>${items}`;
  }).join('');

  return `<ul class="menu menu-sm bg-base-200 rounded-box w-52 shrink-0">${groups}</ul>`;
}

function renderCheckbox(page: { id: string; showOnceKey?: string }): string {
  if (!page.showOnceKey) {
    return '';
  }
  return `<label class="label cursor-pointer gap-2">
    <input type="checkbox" class="checkbox checkbox-sm" data-help-dont-show>
    Don't show this again
  </label>`;
}

export async function showHelpModal(pageId?: string): Promise<void> {
  if (HELP_PAGES.length === 0) {
    return;
  }
  let activePage = (pageId && getHelpPage(pageId)) || HELP_PAGES[0];

  const render = (): void => {
    const sidebarEl = document.getElementById('help-sidebar');
    const paneEl = document.getElementById('help-pane');
    if (!sidebarEl || !paneEl) {
      return;
    }
    sidebarEl.innerHTML = renderSidebar(activePage.id);
    paneEl.innerHTML = `<h4 class="font-semibold text-base mb-2">${escapeHtml(activePage.title)}</h4><div class="flex flex-col gap-3">${activePage.render()}</div>`;
    const actionBar = document.getElementById('help-action-bar');
    if (actionBar) {
      actionBar.innerHTML = renderCheckbox(activePage);
      const checkbox = actionBar.querySelector<HTMLInputElement>(
        '[data-help-dont-show]'
      );
      checkbox?.addEventListener('change', () => {
        if (checkbox.checked) {
          markHelpPageSeen(activePage.id);
        } else if (activePage.showOnceKey) {
          try {
            localStorage.removeItem(shownKey(activePage.id));
          } catch {
            // Nothing to do.
          }
        }
      });
    }
  };

  const body = `
    <div class="flex gap-4 items-start">
      <div id="help-sidebar" class="shrink-0"></div>
      <div id="help-pane" class="flex-1 min-w-0"></div>
    </div>
  `;

  await showModal({
    title: 'Help',
    body,
    actions: [{ label: 'Close', onClick: () => {} }],
    actionBarContent: '<div id="help-action-bar"></div>',
    escapeAction: 0,
    boxClassName: 'max-w-4xl w-11/12',
    onMount: () => {
      render();

      document
        .getElementById('help-sidebar')
        ?.addEventListener('click', (e) => {
          const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
            '[data-help-entry]'
          );
          const id = btn?.dataset.helpEntry;
          if (!id || id === activePage.id) {
            return;
          }
          const page = getHelpPage(id);
          if (!page) {
            return;
          }
          activePage = page;
          render();
        });
    },
  });
}

// ─── Shared render helpers for page content ────────────────────────────────

export function eyebrow(text: string): string {
  return `<div class="eyebrow text-xs font-semibold tracking-[0.18em] uppercase text-primary">${escapeHtml(text)}</div>`;
}

export function lede(text: string): string {
  return `<p class="text-sm text-base-content/70">${text}</p>`;
}

/**
 * A trailing aside after a glyph list (e.g. "you can revisit this later").
 * Styled distinctly from `lede()` and spaced off from the content above it,
 * so it doesn't read as one more list item.
 */
export function footnote(text: string): string {
  return `<p class="mt-3 text-xs italic text-base-content/50">${text}</p>`;
}

export interface GlyphListItem {
  /** Inline SVG, viewBox 0 0 32 32, stroke currentColor width 1.5. */
  icon: string;
  term: string;
  description: string;
}

export function glyphList(items: GlyphListItem[]): string {
  const rows = items
    .map(
      (item) => `<div class="flex gap-3 items-start">
        <div class="shrink-0 w-6 h-6 text-primary">${item.icon}</div>
        <div>
          <dt class="font-semibold">${escapeHtml(item.term)}</dt>
          ${item.description ? `<dd class="text-sm text-base-content/60">${escapeHtml(item.description)}</dd>` : ''}
        </div>
      </div>`
    )
    .join('');
  return `<dl class="flex flex-col gap-3">${rows}</dl>`;
}
