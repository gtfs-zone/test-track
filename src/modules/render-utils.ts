/**
 * Shared furniture for the object pages: escaping, entity links, the raw column
 * table, and the handful of formatters that have to agree across pages.
 *
 * Pages are rendered as HTML strings and mounted in one go, so every link is a
 * real `<a href>` carrying the target page's hash — middle-click and
 * copy-link-address work — plus a `data-nav` payload that the panel renderer
 * intercepts to navigate without a reload.
 */

import type { RawRow } from 'interlocking/gtfs/scheduled';
import type { GTFSScheduled, Route } from 'interlocking/gtfs/scheduled';
import type { VehiclePosition } from '../map-controller';
import type { PageState } from '../types/page-state';
import type { FeedSession } from './feed-session';
import type { VehicleStopSequence } from './rt-index';
import { clockAt, feedTimezone, formatScheduleTime, zoneLabel } from 'interlocking/gtfs/feed-time';


export interface RenderContext {
  session: FeedSession;
  /** The full hash for a page, supplied by AppState. */
  href: (state: PageState) => string;
}

export function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A link that navigates the panel rather than reloading the page.
 *
 * `iconHtml` is emitted raw before the label, for callers that need an svg icon
 * inside the anchor. The label itself is always escaped.
 */
export function entityLink(
  ctx: RenderContext,
  state: PageState,
  label: string,
  className = 'link link-hover',
  iconHtml = '',
): string {
  return `<a href="${escHtml(ctx.href(state))}" data-nav="${escHtml(
    JSON.stringify(state),
  )}" class="${className}">${iconHtml}${escHtml(label)}</a>`;
}

/**
 * A route's colored badge. `route_color` is feed-supplied and routinely
 * collides with the page background — white on light, black on dark — so every
 * badge carries a neutral hairline outline regardless of the color chosen.
 */
export function routeBadge(ctx: RenderContext, route: Route): string {
  const label = route.short_name || route.long_name || route.id;
  return `<a href="${escHtml(ctx.href({ type: 'route', route_id: route.id }))}"
    data-nav="${escHtml(JSON.stringify({ type: 'route', route_id: route.id }))}"
    class="badge badge-sm font-semibold border-0 ring-1 ring-base-content/20"
    style="background:${escHtml(route.color)};color:${escHtml(route.text_color)}"
    >${escHtml(label)}</a>`;
}

export function section(title: string, body: string, extra = ''): string {
  if (!body) return '';
  return `
    <section class="space-y-2">
      <h3 class="font-semibold text-sm">${escHtml(title)}${extra}</h3>
      ${body}
    </section>`;
}

/**
 * Every column of the source row, verbatim.
 *
 * Empty values are shown as an explicit marker rather than omitted: "this
 * column exists and is blank" and "this column is absent" are different facts
 * about a feed, and the whole point of the table is to tell them apart.
 */
export function renderRawFields(title: string, raw: RawRow, open = false): string {
  const rows = Object.entries(raw)
    .map(
      ([k, v]) =>
        `<tr><td class="opacity-60 align-top whitespace-nowrap">${escHtml(k)}</td><td class="break-all">${
          v ? escHtml(v) : '<span class="opacity-30">(empty)</span>'
        }</td></tr>`,
    )
    .join('');
  return `
    <details class="text-xs rounded-lg border border-base-300 p-2" data-detail="raw:${escHtml(title)}"${
      open ? ' open' : ''
    }>
      <summary class="cursor-pointer font-medium">${escHtml(title)}</summary>
      <table class="table table-xs mt-1"><tbody>${rows}</tbody></table>
    </details>`;
}

/** The decoded protobuf entity, pretty-printed. */
export function renderRawJson(title: string, value: unknown): string {
  return `
    <details class="text-xs rounded-lg border border-base-300 p-2" data-detail="json:${escHtml(title)}">
      <summary class="cursor-pointer font-medium">${escHtml(title)}</summary>
      <pre class="mt-1 overflow-x-auto bg-base-200 rounded p-2">${escHtml(
        JSON.stringify(value, null, 2),
      )}</pre>
    </details>`;
}

// ─── Time ─────────────────────────────────────────────────────────────────────

/**
 * Clock time from a GTFS-RT epoch-seconds value, in the feed's zone (see
 * `feed-time.ts`) and labelled with it, so a time can never be read against
 * the wrong clock. Pass `withZone: false` where the surrounding text already
 * establishes the zone.
 */
export function formatEpochTime(seconds: number | undefined, withZone = true): string {
  if (seconds === undefined) return '—';
  const clock = clockAt(seconds);
  return withZone ? `${clock} ${zoneLabel(seconds * 1000)}` : clock;
}

/** A scheduled `stop_times` clock time, formatted to match `formatEpochTime`. */
export function formatScheduledTime(value: string | undefined, withZone = true): string {
  const clock = formatScheduleTime(value);
  if (!withZone || clock === '—') return clock;
  return `${clock} ${zoneLabel()}`;
}

export function formatAbsolute(seconds: number | undefined): string {
  if (seconds === undefined) return '—';
  const ms = seconds * 1000;
  return `${new Date(ms).toLocaleString([], { timeZone: feedTimezone() ?? undefined })} ${zoneLabel(ms)}`;
}

/** "12s ago" / "3m ago" — driven by the panel's shared ticker. */
export function formatRelative(ms: number): string {
  const secs = Math.round((Date.now() - ms) / 1000);
  if (secs < 0) return `in ${formatDuration(-secs)}`;
  if (secs < 60) return `${secs}s ago`;
  return `${formatDuration(secs)} ago`;
}

export function formatDuration(secs: number): string {
  const s = Math.abs(Math.round(secs));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

/** A timestamp that also states its own age, refreshed in place by the ticker. */
export function timestampWithAge(seconds: number | undefined): string {
  if (seconds === undefined) return '<span class="opacity-40">not reported</span>';
  const ms = seconds * 1000;
  return `${escHtml(formatEpochTime(seconds))} <span class="opacity-60" data-since="${ms}">${escHtml(
    formatRelative(ms),
  )}</span>`;
}

// ─── Delay ────────────────────────────────────────────────────────────────────

/**
 * Delay coloring. Under a minute is noise in every feed worth reading; five
 * minutes is where a rider would call it late.
 */
export function formatDelay(seconds: number | undefined): string {
  if (seconds === undefined) return '';
  if (Math.abs(seconds) < 60) return '<span class="text-success">on time</span>';
  const magnitude = formatDuration(seconds);
  if (seconds < 0) return `<span class="text-info">${escHtml(magnitude)} early</span>`;
  const cls = seconds < 300 ? 'text-warning' : 'text-error';
  return `<span class="${cls}">${escHtml(magnitude)} late</span>`;
}

// ─── Enum labels ──────────────────────────────────────────────────────────────

export const VEHICLE_STATUS_LABELS: Record<number, string> = {
  0: 'incoming at',
  1: 'stopped at',
  2: 'in transit to',
};

export const OCCUPANCY_LABELS: Record<number, string> = {
  0: 'Empty',
  1: 'Many seats available',
  2: 'Few seats available',
  3: 'Standing room only',
  4: 'Crushed standing room only',
  5: 'Full',
  6: 'Not accepting passengers',
  7: 'No data available',
  8: 'Not boardable',
};

export const TRIP_SCHEDULE_RELATIONSHIP_LABELS: Record<number, string> = {
  0: 'SCHEDULED',
  1: 'ADDED',
  2: 'UNSCHEDULED',
  3: 'CANCELED',
  4: 'REPLACEMENT',
  5: 'DUPLICATED',
  6: 'DELETED',
};

export const STOP_TIME_SCHEDULE_RELATIONSHIP_LABELS: Record<number, string> = {
  0: 'SCHEDULED',
  1: 'SKIPPED',
  2: 'NO_DATA',
  3: 'UNSCHEDULED',
};

export const ROUTE_TYPE_LABELS: Record<number, string> = {
  0: 'Tram / light rail',
  1: 'Subway / metro',
  2: 'Rail',
  3: 'Bus',
  4: 'Ferry',
  5: 'Cable tram',
  6: 'Aerial lift',
  7: 'Funicular',
  11: 'Trolleybus',
  12: 'Monorail',
};

/**
 * The header every entity page opens with: the name, then the feed's own id
 * for it. One shape across pages, so the id is always in the same place and
 * the facts about the entity live in its properties region instead.
 *
 * `extra` is for a marker that has to sit with the name, e.g. a route badge.
 */
export function pageHeader(title: string, id: string, extra = ''): string {
  const heading = `<h2 class="text-lg font-semibold leading-tight whitespace-pre-wrap">${escHtml(
    title,
  )}</h2>`;
  return `
    <div class="space-y-1">
      ${extra ? `<div class="flex items-center gap-2">${extra}${heading}</div>` : heading}
      <p class="text-xs opacity-60 font-mono break-words">${escHtml(id)}</p>
    </div>`;
}

/** A definition list row, used by every page's properties region. */
export function prop(label: string, valueHtml: string): string {
  return `
    <div class="flex justify-between gap-3">
      <dt class="opacity-60 shrink-0">${escHtml(label)}</dt>
      <dd class="text-right break-words">${valueHtml}</dd>
    </div>`;
}

export function propList(rows: string[]): string {
  const body = rows.filter(Boolean).join('');
  return body ? `<dl class="text-xs space-y-1">${body}</dl>` : '';
}

export function missing(what: string): string {
  return `<p class="text-sm opacity-60">${escHtml(what)} is not in the loaded feed.</p>`;
}

/**
 * Marks a value test-track worked out from the feed rather than one the feed
 * reported. The tool exists to show what a feed says, so anything it inferred
 * has to carry this wherever it is shown — the status page's count is the
 * feed-wide version of the same disclosure.
 */
export function badgeMark(label: string, title: string): string {
  return `<span class="badge badge-ghost badge-xs align-middle" title="${escHtml(title)}">${escHtml(label)}</span>`;
}

/**
 * Marks a fact the feed reported, as against `badgeMark`'s inferred values. The two
 * must stay visually distinct: a reader has to be able to tell what the producer said
 * from what test-track worked out.
 */
export function feedMark(label: string, title: string): string {
  return `<span class="badge badge-outline badge-xs align-middle" title="${escHtml(title)}">${escHtml(label)}</span>`;
}

/** One explanation per trip relationship, so the wording is written once. */
const TRIP_RELATIONSHIP_TITLES: Record<number, string> = {
  1: 'The feed reports this trip as ADDED: it is not in the static schedule by design, not by omission.',
  2: 'The feed reports this trip as UNSCHEDULED: a frequency-based trip with exact_times=0.',
  3: 'The feed reports this trip as CANCELED: it will not run.',
  4: 'The feed reports this trip as REPLACEMENT: it replaces a scheduled trip (experimental).',
  5: 'The feed reports this trip as DUPLICATED: it duplicates a scheduled trip at a new time (experimental).',
  6: 'The feed reports this trip as DELETED: the producer states it should not be shown to users (experimental).',
};

/** One explanation per stop-time relationship. */
const STOP_TIME_RELATIONSHIP_TITLES: Record<number, string> = {
  1: 'The feed reports this stop as SKIPPED: the vehicle will not call there, so the times on this row are not times anyone can catch.',
  2: 'The feed reports NO_DATA for this stop: no prediction is given, and any time shown comes from the schedule.',
  3: 'The feed reports this stop as UNSCHEDULED: it is not in the static schedule for this trip (experimental).',
};

/** The badge for a trip's schedule_relationship, or '' when it is SCHEDULED or unreported. */
export function tripRelationshipMark(relationship: number | undefined): string {
  if (relationship === undefined || relationship === 0) return '';
  const label = TRIP_SCHEDULE_RELATIONSHIP_LABELS[relationship] ?? String(relationship);
  const title =
    TRIP_RELATIONSHIP_TITLES[relationship] ??
    `The feed reports this trip's schedule_relationship as ${label}.`;
  return feedMark(label, title);
}

/** The badge for a stop_time_update's schedule_relationship, or '' when SCHEDULED or unreported. */
export function stopTimeRelationshipMark(relationship: number | undefined): string {
  if (relationship === undefined || relationship === 0) return '';
  const label = STOP_TIME_SCHEDULE_RELATIONSHIP_LABELS[relationship] ?? String(relationship);
  const title =
    STOP_TIME_RELATIONSHIP_TITLES[relationship] ??
    `The feed reports this stop's schedule_relationship as ${label}.`;
  return feedMark(label, title);
}

/** The standard explanation behind every derived `current_stop_sequence`. */
export const DERIVED_STOP_SEQUENCE_TITLE =
  'The feed reported no current_stop_sequence. This position comes from the soonest still-future stop_time_update on the same trip.';

/**
 * How a vehicle's position was arrived at, when that is worth saying.
 *
 * A `stop_id` the feed reported is not a guess and gets no mark — GTFS-RT lets a
 * producer name the current stop that way. The exception is a trip that calls at
 * that stop more than once, where choosing a visit *is* a guess and the reader
 * deserves to know which way it went.
 */
export function stopSequenceMark(v: VehiclePosition, current: VehicleStopSequence): string {
  if (current.source === 'derived') return badgeMark('derived', DERIVED_STOP_SEQUENCE_TITLE);
  if (current.source === 'stop_id' && current.ambiguous) {
    return badgeMark(
      'ambiguous',
      `The feed reported no current_stop_sequence, only stop_id ${v.stopId}. This trip calls there more than once; the first visit was assumed.`,
    );
  }
  return '';
}

/**
 * The name to *display* for a vehicle. Prefers the scheduled trip's
 * `trip_short_name` — for Amtrak this is the train number — then the trip
 * headsign, then the feed's `vehicle.label`, then the id. This is display-layer
 * only: the raw dump and the id field still show exactly what the feed sent.
 *
 * The feed's `label` was `hell-gate-bridge-amtrak` for all 53 trains before the
 * upstream fix (Plan 06 Root cause D), so it named nothing; `trip_short_name`
 * distinguishes them either way.
 */
export function vehicleDisplayName(
  feed: GTFSScheduled | null | undefined,
  v: VehiclePosition,
): string {
  const trip = v.tripId ? feed?.trips.get(v.tripId) : undefined;
  const shortName = trip?.raw?.trip_short_name?.trim();
  if (shortName) return shortName;
  if (trip?.headsign) return trip.headsign;
  if (v.label) return v.label;
  return v.vehicleId || v.key;
}
