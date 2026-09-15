/**
 * The service alerts modal: an index into the alert pages rather than a place
 * where alert text is finally rendered. A row links to the page that shows
 * every translation, active period and informed entity.
 *
 * Built on `showModal` rather than a static `<dialog>` so it joins the modal
 * stack. That is what lets `modal-router.ts` close it by stack depth when the
 * hash stops naming it, and what keeps `isOutsideTopModal` honest, so a
 * keyboard shortcut cannot open the guide on top of it.
 *
 * The badges live in the navbar and the dock and are painted on every poll,
 * open or closed; the list is only repainted while the modal is up.
 */

import type { AlertRecord } from '../gtfs-rt';
import type { PageState } from '../types/page-state';
import { ALERT_LEVEL_LABELS, alertLevel, isActiveNow, preferredText } from './alerts';
import { showModal } from 'interlocking/modules/modal-utils';
import { escapeHtml } from 'interlocking/utils/escape-html';

const LIST_ID = 'alerts-list';

export interface AlertsModalHooks {
  /** The hash a row's `<a>` should carry, for middle-click and copy-link. */
  href: (state: PageState) => string;
  /** A left-click on a row, which closes the modal and focuses the alert. */
  navigate: (state: PageState) => void;
}

export class AlertsModal {
  private records: AlertRecord[] = [];
  private hooks: AlertsModalHooks;
  private list: HTMLElement | null = null;

  constructor(hooks: AlertsModalHooks) {
    this.hooks = hooks;
  }

  /** The latest poll's alerts: repaints the badges, and the list if it is up. */
  setRecords(records: AlertRecord[]): void {
    this.records = records;
    this.renderBadges();
    if (this.list) this.list.innerHTML = this.renderList();
  }

  /** Resolves when the modal closes, however it was closed. */
  async show(): Promise<void> {
    await showModal({
      title: 'Service Alerts',
      body: `<div id="${LIST_ID}" class="space-y-3">${this.renderList()}</div>`,
      actions: [{ label: 'Close', onClick: () => {} }],
      escapeAction: 0,
      boxClassName: 'max-w-2xl',
      onMount: () => {
        this.list = document.getElementById(LIST_ID);
        this.list?.addEventListener('click', e => this.handleRowClick(e));
      },
    });
    this.list = null;
  }

  /**
   * The row navigates and nothing here closes the modal: the new page state
   * carries no modal, so the router takes this one down. One path, whether the
   * alert was reached from a row, the back button or a pasted link.
   */
  private handleRowClick(e: MouseEvent): void {
    const row = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-alert-id]');
    if (!row) return;
    // Modified clicks and middle-clicks are the browser's to handle: the row is
    // a real link, so they open the alert in a new tab or window.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    this.hooks.navigate({ type: 'alert', alert_id: row.dataset.alertId! });
  }

  /**
   * The badges count only alerts that are active *now*. A feed routinely
   * carries alerts for next month's shutdown, and counting them as if they were
   * happening makes the badge useless; the total is stated next to it instead.
   */
  private renderBadges(): void {
    const active = this.records.filter(r => isActiveNow(r.alert)).length;
    // The navbar and the mobile dock each carry one.
    for (const id of ['alerts-badge', 'dock-alerts-badge']) {
      const badge = document.getElementById(id);
      if (!badge) continue;
      badge.textContent = active === 0 ? '' : String(active);
      badge.classList.toggle('hidden', active === 0);
    }
  }

  private renderList(): string {
    if (this.records.length === 0) {
      return '<p class="text-sm opacity-40 text-center py-8">No service alerts.</p>';
    }
    // Active first — the rest are scheduled or expired and can wait.
    const active = this.records.filter(r => isActiveNow(r.alert));
    const ordered = [...active, ...this.records.filter(r => !isActiveNow(r.alert))];
    return `
      <p class="text-xs opacity-60">${active.length} active of ${this.records.length} in the feed.</p>
      ${ordered.map(record => this.renderRow(record)).join('')}`;
  }

  private renderRow(record: AlertRecord): string {
    const header = preferredText(record.alert.headerText) || `Alert ${record.id}`;
    const desc = preferredText(record.alert.descriptionText);
    const state: PageState = { type: 'alert', alert_id: record.id };
    return `<a
        href="${escapeHtml(this.hooks.href(state))}"
        data-alert-id="${escapeHtml(record.id)}"
        class="block card card-bordered bg-base-200 p-3 space-y-1 hover:bg-base-300"
      >
      <div class="flex items-center gap-2">
        ${
          isActiveNow(record.alert)
            ? '<span class="badge badge-warning badge-xs">active</span>'
            : '<span class="badge badge-ghost badge-xs">not active</span>'
        }
        <span class="text-xs opacity-50">${escapeHtml(ALERT_LEVEL_LABELS[alertLevel(record)])}</span>
      </div>
      <p class="font-semibold text-sm">${escapeHtml(header)}</p>
      ${desc ? `<p class="text-xs opacity-70 line-clamp-3">${escapeHtml(desc)}</p>` : ''}
    </a>`;
  }
}
