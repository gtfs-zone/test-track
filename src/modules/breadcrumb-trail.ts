/* @vendored-from coloring-book:src/modules/breadcrumb-trail.ts
   @sha fcb17b2
   @status verbatim */
/**
 * Breadcrumb trail markup, page titles, and the crumb type vocabulary.
 *
 * The canonical copy lives here and is vendored into test-track and
 * yard-master. What is shared is the item shape, the two-line crumb render,
 * the header eyebrow and the title format. What each app keeps for itself is
 * the build: which crumbs a page state has, and how their labels are looked
 * up, since the variant sets and the data sources genuinely differ.
 */

import { PageState } from '../types/page-state.js';

/**
 * One crumb: a dim uppercase type over a name, pointing at a page state.
 */
export interface BreadcrumbItem {
  /** Dim uppercase eyebrow, e.g. "Route", "Station", "Service alert". */
  typeLabel: string;
  label: string;
  pageState: PageState;
}

/** GTFS `location_type` to the word a crumb or a header calls it. */
export const STOP_TYPE_LABELS: Record<number, string> = {
  0: 'Stop',
  1: 'Station',
  2: 'Entrance',
  3: 'Node',
  4: 'Boarding area',
};

/** The label for a stop's `location_type`, defaulting to a plain stop. */
export function stopTypeLabel(locationType: number | undefined): string {
  return STOP_TYPE_LABELS[locationType ?? 0] ?? 'Stop';
}

/** Local escaping, so the vendored file pulls in nothing from its app. */
function escHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The dim uppercase type line, shared by crumbs and page headers. */
export function pageHeaderEyebrow(typeLabel: string): string {
  return `<span class="block text-[10px] uppercase tracking-wide opacity-50">${escHtml(
    typeLabel
  )}</span>`;
}

/**
 * The trail: every crumb but the last is a link carrying its serialized page
 * state in `data-nav`, which each app delegates a click handler to.
 *
 * The wrapping overrides matter: daisyUI's `breadcrumbs` scrolls a nowrap row,
 * which clips a chain of two-line crumbs in a narrow panel instead of
 * reflowing it.
 */
export function renderBreadcrumbTrail(
  items: BreadcrumbItem[],
  href: (state: PageState) => string
): string {
  if (items.length === 0) {
    return '';
  }

  const crumbs = items.map((item, index) => {
    const inner = `${pageHeaderEyebrow(item.typeLabel)}<span class="block">${escHtml(
      item.label
    )}</span>`;

    if (index === items.length - 1) {
      return `<li>${inner}</li>`;
    }

    return `<li><a href="${escHtml(href(item.pageState))}" data-nav="${escHtml(
      JSON.stringify(item.pageState)
    )}">${inner}</a></li>`;
  });

  return `
    <nav class="breadcrumbs text-sm overflow-x-visible [&>ul]:flex-wrap [&>ul]:items-start [&>ul]:whitespace-normal">
      <ul>${crumbs.join('')}</ul>
    </nav>`;
}

/**
 * `<typeLabel> <label> | <appName>` for the deepest crumb, the bare app name
 * when there is no trail.
 */
export function pageTitle(items: BreadcrumbItem[], appName: string): string {
  const last = items[items.length - 1];
  if (!last) {
    return appName;
  }
  return `${last.typeLabel} ${last.label} | ${appName}`;
}
