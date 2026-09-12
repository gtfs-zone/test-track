/* @vendored-from coloring-book:src/modules/help-modal.ts
   @sha dca23b3
   @status verbatim */
/**
 * The help viewer: a sidebar of `HELP_PAGES` grouped by `HelpGroup`, and one
 * rendered page in the content pane. Modelled directly on `fares-modal.ts`:
 * adding a page is an entry in `help-pages.ts`, not a new renderer.
 */

import { showSidebarModal } from './sidebar-modal';
import { escapeHtml } from '../utils/escape-html';
import { HELP_PAGES, getHelpPage, type HelpGroup } from './help-pages';

const GROUP_ORDER: HelpGroup[] = ['Getting Started', 'Reference'];

function shownKey(id: string): string {
  return `help.${id}.seen`;
}

/**
 * Whether an auto-shown help page has already been shown. `localStorage`
 * failing (private browsing, quota) must never block boot, so any error here
 * also means "show it".
 */
function alreadySeen(id: string): boolean {
  try {
    return localStorage.getItem(shownKey(id)) === '1';
  } catch {
    return false;
  }
}

function markSeen(id: string): void {
  try {
    localStorage.setItem(shownKey(id), '1');
  } catch {
    // Nothing to do: the page will simply show again next time.
  }
}

// Open state, so F1 (and a second click on Guide) cannot stack a duplicate
// modal on top of the one already showing.
let helpModalOpen = false;

/**
 * Shown when the guide is opened as a gate before another modal (the shapes
 * and fares buttons). The action button reads this label instead of "Close"
 * so it is clear that dismissing the guide continues to the thing that was
 * gated, rather than merely closing a dialog.
 */
export interface HelpModalOptions {
  continueLabel?: string;
}

export async function showHelpModal(
  pageId?: string,
  options?: HelpModalOptions
): Promise<void> {
  if (HELP_PAGES.length === 0 || helpModalOpen) {
    return;
  }

  helpModalOpen = true;
  try {
    await showSidebarModal({
      title: 'Guide',
      groupOrder: GROUP_ORDER,
      initialId: pageId && getHelpPage(pageId) ? pageId : undefined,
      boxClassName: 'max-w-4xl w-11/12',
      closeLabel: options?.continueLabel,
      entries: HELP_PAGES.map((page) => ({
        id: page.id,
        label: page.label,
        group: page.group,
        paneTitle: page.title,
        renderPane: () =>
          Promise.resolve(
            `<div class="flex flex-col gap-3">${page.render()}</div>`
          ),
      })),
    });
  } finally {
    helpModalOpen = false;
  }
}

/**
 * Wire every `[data-open-guide]` button inside `container` to open the help
 * page its attribute names (empty attribute: the first page).
 *
 * One implementation of the convention, called by the sidebar-modal scaffold
 * after each pane render and by page renderers after they build their markup.
 */
export function installGuideButtons(container: HTMLElement): void {
  container.querySelectorAll('[data-open-guide]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pageId = btn.getAttribute('data-open-guide') || undefined;
      void showHelpModal(pageId);
    });
  });
}

/**
 * Show a page the first time its trigger fires, then never again. Returns
 * whether it was shown, so a caller gating another modal knows if it awaited.
 *
 * The page is marked seen before it opens, so a reload mid-modal still counts.
 */
export async function showHelpPageOnce(
  pageId: string,
  options?: HelpModalOptions
): Promise<boolean> {
  const page = getHelpPage(pageId);
  if (!page?.showOnce || alreadySeen(pageId)) {
    return false;
  }
  markSeen(pageId);
  await showHelpModal(pageId, options);
  return true;
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
  /** Raw HTML used instead of the escaped `term`, for inline links. */
  termHtml?: string;
  /** Raw HTML used instead of the escaped `description`, for inline links. */
  descriptionHtml?: string;
}

export function glyphList(items: GlyphListItem[]): string {
  const rows = items
    .map((item) => {
      const term = item.termHtml ?? escapeHtml(item.term);
      const description = item.descriptionHtml ?? escapeHtml(item.description);
      const hasDescription = item.descriptionHtml
        ? true
        : Boolean(item.description);
      return `<div class="flex gap-3 items-start">
        <div class="shrink-0 w-6 h-6 text-primary">${item.icon}</div>
        <div>
          <dt class="font-semibold">${term}</dt>
          ${hasDescription ? `<dd class="text-sm text-base-content/60">${description}</dd>` : ''}
        </div>
      </div>`;
    })
    .join('');
  return `<dl class="flex flex-col gap-3">${rows}</dl>`;
}
