/* @vendored-from coloring-book:src/modules/breadcrumb-trail.ts
   @sha 138a116
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

/**
 * The dim uppercase type line, shared by crumbs and page headers.
 *
 * `leading-4` fixes the line box at 1rem; the trail's separator offset is
 * measured off it, so the two move together.
 */
export function pageHeaderEyebrow(typeLabel: string): string {
  return `<span class="block text-[10px] leading-4 uppercase tracking-wide opacity-50">${escHtml(
    typeLabel
  )}</span>`;
}

/**
 * The trail: every crumb but the last is a link carrying its serialized page
 * state in `data-nav`, which each app delegates a click handler to.
 *
 * Deliberately not daisyUI's `breadcrumbs`: it lays out `li` and `li > *` as
 * centred flex rows, which flattens each crumb's type-over-name stack into a
 * row and spaces it inconsistently (a gap on the linked crumbs, none on the
 * last). Plain flex wrapping here, so nothing has to be overridden.
 */
export function renderBreadcrumbTrail(
  items: BreadcrumbItem[],
  href: (state: PageState) => string
): string {
  if (items.length === 0) {
    return '';
  }

  // `pt-4` matches the eyebrow's `leading-4`, dropping the separator onto the
  // name line rather than floating it between the two lines.
  const separator =
    '<li aria-hidden="true" class="pt-4 opacity-40 select-none">/</li>';

  const crumbs = items.map((item, index) => {
    const inner = `${pageHeaderEyebrow(item.typeLabel)}<span class="block leading-tight break-words">${escHtml(
      item.label
    )}</span>`;
    const lead = index === 0 ? '' : separator;

    if (index === items.length - 1) {
      return `${lead}<li class="flex min-w-0 flex-col" aria-current="page">${inner}</li>`;
    }

    return `${lead}<li class="flex min-w-0 flex-col"><a class="flex flex-col hover:underline" href="${escHtml(
      href(item.pageState)
    )}" data-nav="${escHtml(JSON.stringify(item.pageState))}">${inner}</a></li>`;
  });

  return `
    <nav aria-label="Breadcrumb" class="text-sm">
      <ol class="flex flex-wrap items-start gap-x-2 gap-y-2">${crumbs.join('')}</ol>
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
