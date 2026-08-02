/**
 * Shared furniture for the object pages: escaping, entity links, the raw column
 * table, and the handful of formatters that have to agree across pages.
 *
 * Pages are rendered as HTML strings and mounted in one go, so every link is a
 * real `<a href>` carrying the target page's hash — middle-click and
 * copy-link-address work — plus a `data-nav` payload that the panel renderer
 * intercepts to navigate without a reload.
 */

import type { RawRow } from '../gtfs-static';
import type { GTFSStatic, Route } from '../gtfs-static';
import type { VehiclePosition } from '../map-controller';
import type { PageState } from '../types/page-state';
import type { FeedSession } from './feed-session';
import { clockAt, feedTimezone, formatScheduleTime, zoneLabel } from './feed-time';


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

/** A link that navigates the panel rather than reloading the page. */
export function entityLink(
  ctx: RenderContext,
  state: PageState,
  label: string,
  className = 'link link-hover',
): string {
  return `<a href="${escHtml(ctx.href(state))}" data-nav="${escHtml(
    JSON.stringify(state),
  )}" class="${className}">${escHtml(label)}</a>`;
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

/** A static `stop_times` clock time, formatted to match `formatEpochTime`. */
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

export const LOCATION_TYPE_LABELS: Record<number, string> = {
  0: 'Stop / platform',
  1: 'Station',
  2: 'Entrance / exit',
  3: 'Generic node',
  4: 'Boarding area',
};

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
 * The name to *display* for a vehicle. Prefers the static trip's
 * `trip_short_name` — for Amtrak this is the train number — then the trip
 * headsign, then the feed's `vehicle.label`, then the id. This is display-layer
 * only: the raw dump and the id field still show exactly what the feed sent.
 *
 * The feed's `label` was `hell-gate-bridge-amtrak` for all 53 trains before the
 * upstream fix (Plan 06 Root cause D), so it named nothing; `trip_short_name`
 * distinguishes them either way.
 */
export function vehicleDisplayName(
  feed: GTFSStatic | null | undefined,
  v: VehiclePosition,
): string {
  const trip = v.tripId ? feed?.trips.get(v.tripId) : undefined;
  const shortName = trip?.raw?.trip_short_name?.trim();
  if (shortName) return shortName;
  if (trip?.headsign) return trip.headsign;
  if (v.label) return v.label;
  return v.vehicleId || v.key;
}
