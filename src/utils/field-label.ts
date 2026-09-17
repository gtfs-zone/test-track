/* @vendored-from coloring-book:src/utils/field-label.ts
   @sha 59ed6d0
   @status verbatim */
/**
 * The parts of a form field's label that are not about GTFS.
 *
 * A field label in any of the gtfs.zone apps is the same three things: the
 * field's name, a badge saying how the reference talks about its presence, and
 * a hover/focus tooltip carrying the reference's own prose. What differs
 * between the apps is only where those facts come from - a schedule table's
 * column here, a realtime message's field in yard-master - so the presence
 * vocabulary and the trigger markup live here and the lookup stays with the
 * spec layer that owns it. `field-component.ts` is this app's lookup.
 *
 * The tooltip is a portal rather than a positioned child, because these labels
 * render inside scrollable panels and modals that clip a CSS tooltip. See
 * `tooltip-position.ts`, which finds triggers by `TOOLTIP_TRIGGER_CLASS` and
 * is already shared for the same reason.
 */

import { escapeHtml } from 'interlocking/util/escape-html';

/**
 * The *Presence* column, which the schedule and realtime references word the
 * same way. Realtime has no `Recommended`; carrying it here costs nothing and
 * saves an app declaring its own near-copy of this union.
 */
export type SpecPresence =
  | 'Required'
  | 'Optional'
  | 'Conditionally Required'
  | 'Conditionally Forbidden'
  | 'Recommended';

/** What `tooltip-position.ts` looks for. */
export const TOOLTIP_TRIGGER_CLASS = 'field-tooltip-trigger';

/**
 * The `data-tooltip-content` attribute for a portal tooltip trigger.
 *
 * For icon-only affordances (a `+`, a `✕`, a trash glyph), which have no text
 * to read the action off. The element also needs `TOOLTIP_TRIGGER_CLASS`,
 * which callers add to their own class list. Text spans keep their plain
 * `title` instead: they already say what they are.
 */
export function tooltipContentAttr(content: string): string {
  // `escapeHtml` covers both quote characters, so it is safe inside an
  // attribute value and not only as text content.
  return `data-tooltip-content="${escapeHtml(content)}"`;
}

/** Wrap already-rendered markup in a portal tooltip trigger. */
export function renderTooltipTrigger(content: string, inner: string): string {
  return `<span class="${TOOLTIP_TRIGGER_CLASS}" tabindex="0" ${tooltipContentAttr(content)}>${inner}</span>`;
}

/** Badge class and wording for each presence value that gets a badge. */
const PRESENCE_BADGES: Partial<
  Record<SpecPresence, { badgeClass: string; label: string; short: string }>
> = {
  Required: {
    badgeClass: 'badge-error',
    label: 'Required',
    short: 'Required',
  },
  'Conditionally Required': {
    badgeClass: 'badge-warning',
    label: 'Conditionally required',
    short: 'Cond. required',
  },
  Recommended: {
    badgeClass: 'badge-success',
    label: 'Recommended',
    short: 'Recommended',
  },
  'Conditionally Forbidden': {
    badgeClass: 'badge-ghost',
    label: 'Conditionally forbidden',
    short: 'Cond. forbidden',
  },
};

/** Rendering options for a field label. */
export interface FieldLabelOptions {
  /** Use abbreviated presence wording, for narrow columns and headers. */
  short?: boolean;
}

/**
 * The presence indicator, as a badge carrying the presence word.
 *
 * `Optional` and a missing presence render nothing: an optional field is the
 * default and a badge on every one of them would be noise.
 *
 * Narrow contexts (table headers, the timetable label column) pass
 * `short: true` to get the abbreviated wording instead of clipping with CSS.
 */
export function renderPresenceBadge(
  presence: SpecPresence | undefined,
  options?: FieldLabelOptions
): string {
  if (!presence) {
    return '';
  }
  const badge = PRESENCE_BADGES[presence];
  if (!badge) {
    return '';
  }
  const text = options?.short ? badge.short : badge.label;
  return `<span class="badge badge-xs ${badge.badgeClass} align-middle whitespace-nowrap">${escapeHtml(text)}</span>`;
}
