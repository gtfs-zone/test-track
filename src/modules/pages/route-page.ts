/**
 * The route page: a vertical transit-map strip with live vehicles sitting in
 * the gaps between stops.
 *
 * The strip is a two-column CSS grid — rail, then content. Only the rail is an
 * SVG, and only one per row: the lines have to branch and merge, which CSS
 * cannot draw, but everything readable stays real HTML, so stop names are
 * selectable and every stop and vehicle is a real link. Row heights are
 * content-driven and unknown at render time, so each row's SVG stretches a
 * fixed 100-unit viewBox over whatever height it gets. Circles would come out
 * as ellipses under that scale, which is why the dots are HTML spans.
 */

import type { AlertRecord } from '../../gtfs-rt';
import type { Route } from '../../gtfs-static';
import type { VehiclePosition } from '../../map-controller';
import type { PageState } from '../../types/page-state';
import { alertsForRoute, alertsForRouteStop, feedWideAlerts } from '../alerts';
import { routeGraph } from '../route-graph';
import type { RtIndex, VehicleStopSequence } from '../rt-index';
import type { Prediction } from '../rt-index';
import type { RouteSequence, StopStats } from '../route-sequence';
import { directionsForRoute, routeSequence } from '../route-sequence';
import type { RenderContext } from '../render-utils';
import {
  OCCUPANCY_LABELS,
  ROUTE_TYPE_LABELS,
  VEHICLE_STATUS_LABELS,
  entityLink,
  escHtml,
  formatDelay,
  formatDuration,
  formatEpochTime,
  missing,
  prop,
  propList,
  renderRawFields,
  routeBadge,
  section,
  stopSequenceMark,
  vehicleDisplayName,
} from '../render-utils';
import { renderAlertList } from './alert-page';

const RAIL_WIDTH = 9;
/** The gutter a single-lane route gets — the width the rail column always had. */
const GUTTER_BASE = 40;
/** Each extra lane costs this much width. */
const LANE_WIDTH = 14;

/** Where a row's dot goes, if it has one. */
type RowDot = { kind: 'none' } | { kind: 'open' | 'solid'; lane: number };

/**
 * A stop is called an endpoint when this share of the direction's trips begin
 * or end there. Any threshold is arbitrary; this one is low enough to catch a
 * genuine branch terminus and high enough to ignore the one train a day that
 * happens to lay up mid-route.
 */
const ENDPOINT_SHARE = 0.05;
/**
 * Below this share of trips, a stop is drawn as a deviation from the trunk and
 * labelled with how many trips actually call there. The label is a raw count,
 * not a percentage: "87 of 300 trips" is a fact about the timetable, while
 * "29%" is a number the reader has to unpack before it says anything.
 */
const MINORITY_SHARE = 0.5;

/** A vehicle that could not be put on the strip, and why not. */
interface Unplaced {
  vehicle: VehiclePosition;
  reason: string;
}

interface PlacedVehicle {
  vehicle: VehiclePosition;
  position: number;
  /** STOPPED_AT sits on the stop; everything else sits in the gap before it. */
  atStop: boolean;
  /** Where the stop_sequence behind this position came from. */
  current: VehicleStopSequence;
}

// ─── Vehicle placement ────────────────────────────────────────────────────────

/**
 * Put each of the route's vehicles on the strip.
 *
 * The subtle part: a vehicle reports `current_stop_sequence` in its *own
 * trip's* numbering, while the strip is numbered by the supersequence. The
 * value has to be looked up in the trip's `stop_times` to get an index, then
 * that index mapped through the alignment of the trip's pattern. Skipping
 * either step puts vehicles at plausible-looking but wrong stops.
 *
 * A vehicle that never reported the field can still be placed from the `stop_id`
 * it did report, or failing that from its trip's predictions — see
 * `RtIndex.stopSequenceFor`. The resolution rides along on each placement so the
 * chip can say where the position came from.
 */
function placeVehicles(
  ctx: RenderContext,
  rt: RtIndex,
  sequence: RouteSequence,
  routeId: string,
  directionId: string,
): { placed: PlacedVehicle[]; unplaced: Unplaced[] } {
  const feed = ctx.session.staticFeed;
  const placed: PlacedVehicle[] = [];
  const unplaced: Unplaced[] = [];

  for (const vehicle of rt.vehiclesByRoute.get(routeId) ?? []) {
    const trip = vehicle.tripId ? feed?.trips.get(vehicle.tripId) : undefined;

    if (trip && (trip.direction_id ?? '') !== directionId) continue;
    if (!trip) {
      // A vehicle whose trip we cannot resolve might belong to either
      // direction, so it is listed rather than guessed onto this one.
      unplaced.push({
        vehicle,
        reason: vehicle.tripId
          ? `trip ${vehicle.tripId} is not in the static feed`
          : 'no trip_id reported',
      });
      continue;
    }

    const current = rt.stopSequenceFor(vehicle);
    if (!current) {
      unplaced.push({
        vehicle,
        reason: 'no current_stop_sequence, and no future prediction to derive one from',
      });
      continue;
    }

    const times = feed?.stopTimesByTrip.get(trip.trip_id) ?? [];
    const stopIndex = times.findIndex(t => t.stop_sequence === current.sequence);
    if (stopIndex < 0) {
      unplaced.push({
        vehicle,
        reason: `stop_sequence ${current.sequence} is not in this trip's stop_times`,
      });
      continue;
    }

    const position = sequence.positionOf(trip.trip_id, stopIndex);
    if (position === null) {
      unplaced.push({ vehicle, reason: "this trip's stop pattern is not among those shown" });
      continue;
    }

    placed.push({ vehicle, position, atStop: vehicle.currentStatus === 1, current });
  }

  return { placed, unplaced };
}

// ─── Strip rendering ──────────────────────────────────────────────────────────

/** Centre of lane `l`, in px from the left of the gutter. */
function laneX(lane: number): number {
  return GUTTER_BASE / 2 + lane * LANE_WIDTH;
}

function gutterWidth(laneCount: number): number {
  return GUTTER_BASE + (laneCount - 1) * LANE_WIDTH;
}

/**
 * One rail path, drawn twice.
 *
 * `route_color` is whatever the feed says, and `#FFFFFF` on a light theme is a
 * real and common hazard, so a slightly wider neutral stroke goes underneath —
 * the SVG equivalent of the `ring-1 ring-base-content/15` the rail carried when
 * it was a `<span>`.
 *
 * The viewBox is 100 tall against a row whose height is content-driven and
 * unknown here, so the vertical scale is arbitrary. `non-scaling-stroke` keeps
 * the stroke 9px regardless; the curves stretch, which is the intended look.
 */
function railPath(d: string, color: string): string {
  return `<path d="${d}" fill="none" stroke="currentColor" class="text-base-content/15" stroke-width="${
    RAIL_WIDTH + 2
  }" stroke-linecap="round" vector-effect="non-scaling-stroke"/><path d="${d}" fill="none" stroke="${color}" stroke-width="${RAIL_WIDTH}" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
}

/** Straight down the whole row, in one lane. */
function verticalPath(lane: number): string {
  return `M ${laneX(lane)},0 L ${laneX(lane)},100`;
}

/** From `lane` at the top of the row into `into` at the row's centre. */
function mergePath(lane: number, into: number): string {
  const x0 = laneX(lane);
  const x1 = laneX(into);
  return lane === into ? `M ${x1},0 L ${x1},50` : `M ${x0},0 C ${x0},20 ${x1},30 ${x1},50`;
}

/** From `from` at the row's centre out into `lane` at the bottom. */
function branchPath(from: number, lane: number): string {
  const x0 = laneX(from);
  const x1 = laneX(lane);
  return lane === from ? `M ${x0},50 L ${x0},100` : `M ${x0},50 C ${x0},80 ${x1},70 ${x1},100`;
}

/**
 * The rail cell: an SVG of lines, plus the dot as real HTML on top.
 *
 * The dot cannot go in the SVG — the non-uniform vertical scale would render a
 * circle as an ellipse of unpredictable eccentricity.
 */
function railCell(color: string, laneCount: number, paths: string[], dot: RowDot): string {
  const width = gutterWidth(laneCount);
  const dotHtml =
    dot.kind === 'none'
      ? ''
      : `<span class="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full ring-1 ring-base-content/25"
           style="left:${laneX(dot.lane)}px;background:${
             dot.kind === 'solid' ? color : 'var(--color-base-100, #fff)'
           };box-shadow:inset 0 0 0 3px ${color}"></span>`;
  return `
    <div class="relative shrink-0" style="width:${width}px" aria-hidden="true">
      <svg class="absolute inset-0 w-full h-full" viewBox="0 0 ${width} 100" preserveAspectRatio="none">${paths
        .map(d => railPath(d, color))
        .join('')}</svg>
      ${dotHtml}
    </div>`;
}

function stripRow(railHtml: string, content: string, laneCount: number): string {
  return `<div class="grid gap-2 items-stretch" style="grid-template-columns:${gutterWidth(
    laneCount,
  )}px 1fr">
    ${railHtml}
    <div class="py-1 min-h-8 flex flex-col justify-center">${content}</div>
  </div>`;
}

/** "2m" until a predicted time, or the clock time when it is further out. */
function eta(prediction: Prediction | undefined): string {
  if (!prediction) return '';
  const parts: string[] = [];
  if (prediction.time !== undefined) {
    const secs = prediction.time - Date.now() / 1000;
    parts.push(
      secs < 0
        ? `<span class="opacity-60">${escHtml(formatDuration(secs))} ago</span>`
        : secs < 3600
          ? `<span class="tabular-nums">${escHtml(formatDuration(secs))}</span>`
          : `<span class="tabular-nums">${escHtml(formatEpochTime(prediction.time))}</span>`,
    );
  }
  const delay = formatDelay(prediction.delay);
  if (delay) parts.push(delay);
  return parts.length ? `<span class="text-xs flex gap-2 shrink-0">${parts.join('')}</span>` : '';
}

function vehicleChip(
  ctx: RenderContext,
  vehicle: VehiclePosition,
  current: VehicleStopSequence,
): string {
  const label = vehicleDisplayName(ctx.session.staticFeed, vehicle);
  const status =
    vehicle.currentStatus === undefined
      ? ''
      : `<span class="opacity-60">${escHtml(VEHICLE_STATUS_LABELS[vehicle.currentStatus] ?? String(vehicle.currentStatus))}</span>`;
  const occupancy =
    vehicle.occupancyStatus === undefined
      ? ''
      : `<span class="opacity-60">${escHtml(
          OCCUPANCY_LABELS[vehicle.occupancyStatus] ?? String(vehicle.occupancyStatus),
        )}</span>`;
  return `<div class="text-xs flex items-center gap-1 flex-wrap">
    <span class="badge badge-xs badge-neutral">▶</span>
    ${entityLink(ctx, { type: 'vehicle', vehicle_id: vehicle.key }, label, 'link link-hover font-medium')}
    ${status ? `<span class="opacity-40">·</span>${status}` : ''}
    ${occupancy ? `<span class="opacity-40">·</span>${occupancy}` : ''}
    ${stopSequenceMark(vehicle, current)}
  </div>`;
}

function alertPips(ctx: RenderContext, alerts: AlertRecord[]): string {
  if (alerts.length === 0) return '';
  const first = alerts[0];
  const label = alerts.length === 1 ? '1 alert' : `${alerts.length} alerts`;
  return entityLink(
    ctx,
    { type: 'alert', alert_id: first.id },
    `⚠ ${label}`,
    'badge badge-warning badge-xs shrink-0',
  );
}

/**
 * Where trips begin and end, when enough of them do it here to be a fact about
 * the route rather than about one trip. Washington is the case this is for: the
 * strip continues south to Norfolk past it, so nothing about the line's shape
 * says "terminus", but most of the route's trains stop there.
 */
function endpointNote(stats: StopStats, threshold: number): string {
  const parts: string[] = [];
  if (stats.endsHere >= threshold) parts.push(`${stats.endsHere} end`);
  if (stats.startsHere >= threshold) parts.push(`${stats.startsHere} start`);
  if (parts.length === 0) return '';
  return `<span class="text-xs opacity-60 tabular-nums shrink-0">${escHtml(
    parts.join(' · '),
  )}</span>`;
}

function renderStrip(
  ctx: RenderContext,
  rt: RtIndex,
  route: Route,
  sequence: RouteSequence,
  directionId: string,
  placed: PlacedVehicle[],
): string {
  const feed = ctx.session.staticFeed;
  if (sequence.stops.length === 0) {
    return '<p class="text-sm opacity-60">No trips with stop times for this direction.</p>';
  }

  const before = new Map<number, PlacedVehicle[]>();
  const at = new Map<number, PlacedVehicle[]>();
  for (const p of placed) {
    const bucket = p.atStop ? at : before;
    const list = bucket.get(p.position);
    if (list) list.push(p);
    else bucket.set(p.position, [p]);
  }

  const graph = routeGraph(sequence);

  /**
   * A vehicle chip's row carries the lanes that are live across it, so a chip no
   * longer breaks the rail.
   *
   * Past the end of the strip there is nothing live, only the neighbouring
   * stop's own lane, and the rail has to stop inside the chip's row rather than
   * run out of it — otherwise the strip ends in a bare stub with a flat cut
   * instead of a rounded terminus. `last` says this chip is the outermost of a
   * run, so only it gets the half-length capped segment; chips between it and
   * the stop still need the full height.
   */
  const gapPaths = (index: number, side: 'above' | 'below', last: boolean): string[] => {
    const row = graph.rows[index];
    const live = side === 'above' ? [...row.merges, ...row.through] : row.exiting;
    if (live.length > 0) return live.map(verticalPath);
    if (!last) return [verticalPath(row.lane)];
    // The outermost row of a terminus. Above the first stop the rail runs from
    // this row's centre down; below the last stop, from the top to the centre.
    return [side === 'above' ? branchPath(row.lane, row.lane) : mergePath(row.lane, row.lane)];
  };

  /**
   * A stop row's lines. `leadIn`/`leadOut` extend the row's own lane to the row
   * edge at a terminus that has a chip row beyond it, so the chip keeps the cap
   * and the rail between the two stays joined.
   */
  const stopPaths = (index: number, leadIn: boolean, leadOut: boolean): string[] => {
    const row = graph.rows[index];
    const paths = [
      ...row.through.map(verticalPath),
      ...row.merges.map(lane => mergePath(lane, row.lane)),
      ...row.branches.map(lane => branchPath(row.lane, lane)),
    ];
    if (leadIn && row.merges.length === 0) paths.push(mergePath(row.lane, row.lane));
    if (leadOut && row.branches.length === 0) paths.push(branchPath(row.lane, row.lane));
    return paths;
  };

  // Rows are collected first so the terminal caps can be put on whichever rows
  // actually end up at the ends — a vehicle above the first stop pushes the cap
  // down onto its own row.
  const rows: Array<{ dot: RowDot; paths: string[]; content: string }> = [];

  const endpointThreshold = Math.max(1, sequence.totalTrips * ENDPOINT_SHARE);

  sequence.stops.forEach((stop, index) => {
    const chipsBefore = before.get(index) ?? [];
    const chipsAt = at.get(index) ?? [];
    chipsBefore.forEach((p, n) => {
      rows.push({
        dot: { kind: 'none' },
        paths: gapPaths(index, 'above', n === 0),
        content: vehicleChip(ctx, p.vehicle, p.current),
      });
    });

    const name = feed?.stops.get(stop.stop_id)?.name || stop.stop_id;
    // The strip shows stations; the realtime feed talks about platforms. Ask
    // for the station and everything under it, the same split the station page
    // makes between boardable descendants (service) and all of them (alerts).
    const serviceIds = [stop.stop_id, ...(feed?.boardableDescendants(stop.stop_id) ?? [])];
    const alertIds = [stop.stop_id, ...(feed?.descendants(stop.stop_id) ?? [])];
    const prediction = rt.nextAtStopsForRoute(serviceIds, route.id, directionId, feed ?? null);
    const stopAlerts = alertsForRouteStop(ctx.session, route.id, alertIds);

    const stats = sequence.stopStats[index];
    const endpoint =
      stats.startsHere >= endpointThreshold || stats.endsHere >= endpointThreshold;
    const share = sequence.totalTrips > 0 ? stats.serves / sequence.totalTrips : 1;
    const minority = share < MINORITY_SHARE;

    rows.push({
      dot: { kind: endpoint ? 'solid' : 'open', lane: graph.rows[index].lane },
      paths: stopPaths(index, chipsBefore.length > 0, chipsAt.length > 0),
      content: `<div class="flex items-center gap-2" title="${escHtml(
        `Served by ${stats.serves} of ${sequence.totalTrips} trips`,
      )}">
        <span class="flex-1 min-w-0 truncate text-sm${minority ? ' opacity-60' : ''}">${entityLink(
          ctx,
          { type: 'stop', stop_id: stop.stop_id },
          name,
        )}${
          stop.occurrence > 0
            ? `<span class="opacity-50 text-xs ml-1">(visit ${stop.occurrence + 1})</span>`
            : ''
        }</span>
        ${endpointNote(stats, endpointThreshold)}
        ${
          minority
            ? `<span class="text-xs opacity-50 tabular-nums shrink-0">${escHtml(
                `${stats.serves} of ${sequence.totalTrips} trips`,
              )}</span>`
            : ''
        }
        ${alertPips(ctx, stopAlerts)}
        ${eta(prediction)}
      </div>`,
    });

    chipsAt.forEach((p, n) => {
      rows.push({
        dot: { kind: 'none' },
        paths: gapPaths(index, 'below', n === chipsAt.length - 1),
        content: vehicleChip(ctx, p.vehicle, p.current),
      });
    });
  });

  return `<div class="-mx-1">${rows
    .map(row =>
      stripRow(
        railCell(route.color, graph.laneCount, row.paths, row.dot),
        row.content,
        graph.laneCount,
      ),
    )
    .join('')}</div>`;
}

// ─── Coverage and unplaced notes ──────────────────────────────────────────────

function renderCoverage(sequence: RouteSequence): string {
  const notes: string[] = [];
  if (sequence.totalPatterns > 1) {
    notes.push(
      `${sequence.totalPatterns} stop patterns across ${sequence.totalTrips} trips, all of them on the strip. A trip count marks a stop fewer than half the trips call at; a filled dot marks where trips start or end. Platforms are shown under their parent station.`,
    );
  }
  if (sequence.isLoop) {
    notes.push(
      'Some trips visit a stop more than once. Repeat visits are shown as separate rows rather than collapsed onto one.',
    );
  }
  if (notes.length === 0) return '';
  return `<div class="text-xs opacity-60 space-y-1">${notes
    .map(n => `<p>${escHtml(n)}</p>`)
    .join('')}</div>`;
}

function renderUnplaced(ctx: RenderContext, unplaced: Unplaced[]): string {
  if (unplaced.length === 0) return '';
  return section(
    'Unplaced vehicles',
    `<p class="text-xs opacity-60">On this route but not positionable on the strip.</p>
     <ul class="space-y-1">${unplaced
       .map(
         u => `<li class="text-xs flex justify-between gap-2">
           ${entityLink(ctx, { type: 'vehicle', vehicle_id: u.vehicle.key }, vehicleDisplayName(ctx.session.staticFeed, u.vehicle))}
           <span class="opacity-60 text-right">${escHtml(u.reason)}</span>
         </li>`,
       )
       .join('')}</ul>`,
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function renderDirectionTabs(
  ctx: RenderContext,
  routeId: string,
  directions: { direction_id: string; label: string; tripCount: number }[],
  active: string,
): string {
  if (directions.length < 2) return '';
  return `<div role="tablist" class="tabs tabs-box tabs-sm">
    ${directions
      .map(d => {
        const state: PageState = { type: 'route', route_id: routeId, direction_id: d.direction_id };
        return `<a role="tab" href="${escHtml(ctx.href(state))}" data-nav="${escHtml(
          JSON.stringify(state),
        )}" class="tab ${d.direction_id === active ? 'tab-active' : ''}">${escHtml(d.label)}</a>`;
      })
      .join('')}
  </div>`;
}

export function renderRoutePage(
  ctx: RenderContext,
  rt: RtIndex,
  state: Extract<PageState, { type: 'route' }>,
): string {
  const feed = ctx.session.staticFeed;
  const route = feed?.routes.get(state.route_id);
  if (!feed || !route) return missing(`Route ${state.route_id}`);

  const directions = directionsForRoute(feed, route.id);
  const active =
    directions.find(d => d.direction_id === state.direction_id)?.direction_id ??
    directions[0]?.direction_id ??
    '';
  const sequence = routeSequence(feed, route.id, active);
  const { placed, unplaced } = placeVehicles(ctx, rt, sequence, route.id, active);

  const agency = feed.agencies.find(a => a.id === route.agency_id) ?? feed.agencies[0];

  return `
    <div class="space-y-4">
      <div class="space-y-1">
        <div class="flex items-center gap-2">
          ${routeBadge(ctx, route)}
          <span class="text-xs opacity-60">${escHtml(
            ROUTE_TYPE_LABELS[route.type] ?? `route_type ${route.type}`,
          )}</span>
        </div>
        <h2 class="text-lg font-semibold leading-tight">${escHtml(
          route.long_name || route.short_name || route.id,
        )}</h2>
        ${agency ? `<p class="text-xs opacity-60">${escHtml(agency.name)}</p>` : ''}
      </div>

      ${renderAlertList(ctx, feedWideAlerts(ctx.session), 'Feed-wide alerts')}
      ${renderAlertList(ctx, alertsForRoute(ctx.session, route.id), 'Route alerts')}

      ${renderDirectionTabs(ctx, route.id, directions, active)}
      ${renderCoverage(sequence)}
      ${renderStrip(ctx, rt, route, sequence, active, placed)}
      ${renderUnplaced(ctx, unplaced)}

      ${section(
        'Route',
        propList([
          prop('route_id', escHtml(route.id)),
          prop('Trips', String((feed.tripsByRoute.get(route.id) ?? []).length)),
          prop('Vehicles in feed', String((rt.vehiclesByRoute.get(route.id) ?? []).length)),
          prop('Stops on strip', String(sequence.stops.length)),
        ]),
      )}
      ${renderRawFields('routes.txt', route.raw)}
    </div>`;
}
