/* @vendored-from coloring-book:src/utils/issue-card.ts
   @sha a515310
   @status modified
   @changes
   - Escapes with `escHtml` from `../modules/render-utils` instead of importing
     coloring-book's `utils/escape-html` (test-track already has one escaper).
   - Import is extensionless, matching the rest of test-track. */
/**
 * Feed issue card.
 *
 * A warning card listing data-quality problems as label/count rows with an
 * optional explanatory note. Renders nothing when every count is zero, so a
 * clean feed does not leave an empty card as furniture.
 *
 * A row may also carry the offending items. When it does the row becomes an
 * expandable <details> block listing them; without items it renders exactly as
 * a plain label/count row. Items carry opaque data attributes so the host app
 * can attach its own delegated click handler: the card itself knows nothing
 * about navigation.
 *
 * Vendored into ../test-track, whose status page renders the same card. Keep it
 * generic: no GTFS or coloring-book types, escaping only. Changing the markup
 * here means re-vendoring there.
 */

import { escHtml } from '../modules/render-utils';

export interface IssueItem {
  /** Plain text shown for this item. Escaped here, so pass raw text. */
  label: string;
  /** Optional secondary text, shown dimmed after the label. */
  detail?: string;
  /** Data attribute names/values, without the `data-` prefix. */
  data?: Record<string, string>;
}

export interface IssueRow {
  label: string;
  count: number;
  note?: string;
  items?: IssueItem[];
  /** Items omitted from `items` because of the display cap. */
  moreCount?: number;
}

function renderItem(item: IssueItem): string {
  const attrs = Object.entries(item.data ?? {})
    .map(([name, value]) => ` data-${name}="${escHtml(value)}"`)
    .join('');
  const clickable = item.data && Object.keys(item.data).length > 0;
  const classes = clickable
    ? 'link link-hover cursor-pointer'
    : 'opacity-70 cursor-default';
  const detail = item.detail
    ? ` <span class="opacity-50">${escHtml(item.detail)}</span>`
    : '';
  return `<li><span class="${classes}"${attrs}>${escHtml(item.label)}</span>${detail}</li>`;
}

function renderHeader(row: IssueRow): string {
  return `
    <span>${escHtml(row.label)}</span>
    <span class="tabular-nums font-semibold">${row.count}</span>
  `;
}

function renderNote(row: IssueRow): string {
  return row.note
    ? `<p class="text-xs opacity-50">${escHtml(row.note)}</p>`
    : '';
}

function renderRow(row: IssueRow): string {
  if (!row.items || row.items.length === 0) {
    return `
      <div>
        <div class="flex justify-between gap-2 text-xs">${renderHeader(row)}</div>
        ${renderNote(row)}
      </div>
    `;
  }

  const more = row.moreCount
    ? `<li class="opacity-50">and ${row.moreCount} more</li>`
    : '';

  return `
    <details>
      <summary class="flex justify-between gap-2 text-xs cursor-pointer">${renderHeader(row)}</summary>
      ${renderNote(row)}
      <ul class="mt-1 ml-3 space-y-0.5 text-xs list-disc list-inside">
        ${row.items.map(renderItem).join('')}
        ${more}
      </ul>
    </details>
  `;
}

export function renderIssueCard(title: string, rows: IssueRow[]): string {
  const present = rows.filter((row) => row.count > 0);
  if (present.length === 0) {
    return '';
  }

  const body = present.map(renderRow).join('');

  return `
    <section class="space-y-2">
      <h3 class="font-semibold text-sm">${escHtml(title)}</h3>
      <div class="rounded-lg border border-warning/40 bg-warning/10 p-3 space-y-2">
        ${body}
      </div>
    </section>
  `;
}
