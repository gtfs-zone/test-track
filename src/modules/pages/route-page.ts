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

import type { AlertRecord } from 'interlocking/gtfs/rt-types';
import type { Route } from 'interlocking/gtfs/scheduled';
import type { VehiclePosition } from 'interlocking/gtfs/rt-types';
import type { PageState } from '../../types/page-state';
import { alertsForRoute, alertsForRouteStop, feedWideAlerts } from 'interlocking/gtfs/alerts';
import { renderTriangleIcon, renderWarningIcon } from 'interlocking/ui/modal-utils';
import { GTFSScheduledRouteSource } from 'interlocking/gtfs/scheduled-route-source';
import { routeGraph } from 'interlocking/gtfs/route-graph';
import type { RtIndex, VehicleStopSequence } from 'interlocking/gtfs/rt-index';
import type { Prediction } from 'interlocking/gtfs/rt-index';
import type { RouteSequence, StopStats } from 'interlocking/gtfs/route-sequence';
import { directionsForRoute, routeSequence } from 'interlocking/gtfs/route-sequence';
import {
  endpointNote,
  endpointThreshold,
  gutterWidth,
  isEndpoint,
  isMinority,
  railCell,
  renderCoverage,
  renderDirectionSections,
  rowPaths,
  STRIP_ROW_CLASS,
} from 'interlocking/gtfs/route-strip';
import type { RowDot } from 'interlocking/gtfs/route-strip';
import type { RenderContext } from '../render-context';
import {
  OCCUPANCY_LABELS,
  ROUTE_TYPE_LABELS,
  TRIP_SCHEDULE_RELATIONSHIP_LABELS,
  VEHICLE_STATUS_LABELS,
  entityLink,
  escHtml,
  formatDelay,
  formatDuration,
  formatEpochTime,
  missing,
  pageHeader,
  prop,
  propList,
  renderRawFields,
  routeBadge,
  section,
  stopSequenceMark,
  tripRelationshipMark,
  vehicleDisplayName,
} from 'interlocking/gtfs/entity-render';
import { renderAlertList } from './alert-page';

/** A vehicle that could not be put on the strip, and why not. */
interface Unplaced {
  vehicle: VehiclePosition;
  reason: string;
  /** Trip schedule_relationship, when the feed gave one that explains the placement. */
  relationship?: number;
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
  const feed = ctx.session.scheduledFeed;
  const placed: PlacedVehicle[] = [];
  const unplaced: Unplaced[] = [];

  for (const vehicle of rt.vehiclesByRoute.get(routeId) ?? []) {
    const trip = vehicle.tripId ? feed?.trips.get(vehicle.tripId) : undefined;

    if (trip && (trip.direction_id ?? '') !== directionId) continue;
    if (!trip) {
      // A vehicle whose trip we cannot resolve might belong to either
      // direction, so it is listed rather than guessed onto this one.
      const relationship = vehicle.scheduleRelationship;
      const reasonSuffix =
        relationship !== undefined && relationship !== 0
          ? `; the feed reports it as ${
              TRIP_SCHEDULE_RELATIONSHIP_LABELS[relationship] ?? String(relationship)
            }`
          : '';
      unplaced.push({
        vehicle,
        reason: vehicle.tripId
          ? `trip ${vehicle.tripId} is not in the schedule${reasonSuffix}`
          : 'no trip_id reported',
        relationship,
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

/**
 * `stopId` marks the row as a stop row rather than a vehicle-chip gap row, so
 * hovering it scales that stop's dot. The stop name is already a link, so the
 * dot itself stays decoration here.
 */
function stripRow(
  railHtml: string,
  content: string,
  laneCount: number,
  stopId?: string,
): string {
  const rowAttrs = stopId ? ` data-stop-id="${escHtml(stopId)}"` : '';
  return `<div class="grid gap-2 items-stretch ${
    stopId ? STRIP_ROW_CLASS : ''
  }" style="grid-template-columns:${gutterWidth(laneCount)}px 1fr"${rowAttrs}>
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
  const label = vehicleDisplayName(ctx.session.scheduledFeed, vehicle);
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
    <span class="badge badge-xs badge-neutral">${renderTriangleIcon('h-2 w-2')}</span>
    ${entityLink(ctx, { type: 'vehicle', vehicle_id: vehicle.key }, label, 'link link-hover font-medium')}
    ${status ? `<span class="opacity-40">·</span>${status}` : ''}
    ${occupancy ? `<span class="opacity-40">·</span>${occupancy}` : ''}
    ${stopSequenceMark(vehicle, current)}
    ${tripRelationshipMark(vehicle.scheduleRelationship)}
  </div>`;
}

function alertPips(ctx: RenderContext, alerts: AlertRecord[]): string {
  if (alerts.length === 0) return '';
  const first = alerts[0];
  const label = alerts.length === 1 ? '1 alert' : `${alerts.length} alerts`;
  return entityLink(
    ctx,
    { type: 'alert', alert_id: first.id },
    label,
    'badge badge-warning badge-xs shrink-0 gap-1',
    renderWarningIcon('h-3 w-3'),
  );
}

function endpointNoteHtml(stats: StopStats, threshold: number): string {
  const note = endpointNote(stats, threshold);
  return note
    ? `<span class="text-xs opacity-60 tabular-nums shrink-0">${escHtml(note)}</span>`
    : '';
}

function renderStrip(
  ctx: RenderContext,
  rt: RtIndex,
  route: Route,
  sequence: RouteSequence,
  directionId: string,
  placed: PlacedVehicle[],
): string {
  const feed = ctx.session.scheduledFeed;
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

  // Rows are collected first so the terminal caps can be put on whichever rows
  // actually end up at the ends — a vehicle above the first stop pushes the cap
  // down onto its own row.
  const rows: Array<{
    dot: RowDot;
    paths: string[];
    content: string;
    stopId?: string;
  }> = [];

  const threshold = endpointThreshold(sequence.totalTrips);

  sequence.stops.forEach((stop, index) => {
    const chipsBefore = before.get(index) ?? [];
    const chipsAt = at.get(index) ?? [];
    chipsBefore.forEach((p, n) => {
      rows.push({
        dot: { kind: 'none' },
        paths: rowPaths(graph, index, { kind: 'gap', side: 'above', last: n === 0 }),
        content: vehicleChip(ctx, p.vehicle, p.current),
      });
    });

    // Every strip element is a stop ref here: test-track ingests no flex tables.
    const stopId = stop.ref.id;
    const name = feed?.stops.get(stopId)?.name || stopId;
    // The strip shows stations; the realtime feed talks about platforms. Ask
    // for the station and everything under it, the same split the station page
    // makes between boardable descendants (service) and all of them (alerts).
    const serviceIds = [stopId, ...(feed?.boardableDescendants(stopId) ?? [])];
    const alertIds = [stopId, ...(feed?.descendants(stopId) ?? [])];
    const prediction = rt.nextAtStopsForRoute(serviceIds, route.id, directionId, feed ?? null);
    const stopAlerts = alertsForRouteStop(ctx.session, route.id, alertIds);

    const stats = sequence.stopStats[index];
    const endpoint = isEndpoint(stats, threshold);
    const minority = isMinority(stats, sequence.totalTrips);

    rows.push({
      stopId: stopId,
      dot: { kind: endpoint ? 'solid' : 'open', lane: graph.rows[index].lane },
      paths: rowPaths(graph, index, {
        kind: 'stop',
        leadIn: chipsBefore.length > 0,
        leadOut: chipsAt.length > 0,
      }),
      content: `<div class="flex items-center gap-2" title="${escHtml(
        `Served by ${stats.serves} of ${sequence.totalTrips} trips`,
      )}">
        <span class="flex-1 min-w-0 truncate text-sm${minority ? ' opacity-60' : ''}">${entityLink(
          ctx,
          { type: 'stop', stop_id: stopId },
          name,
        )}${
          stop.occurrence > 0
            ? `<span class="opacity-50 text-xs ml-1">(visit ${stop.occurrence + 1})</span>`
            : ''
        }</span>
        ${endpointNoteHtml(stats, threshold)}
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
        paths: rowPaths(graph, index, {
          kind: 'gap',
          side: 'below',
          last: n === chipsAt.length - 1,
        }),
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
        row.stopId,
      ),
    )
    .join('')}</div>`;
}

// ─── Unplaced notes ───────────────────────────────────────────────────────────

function renderUnplaced(ctx: RenderContext, unplaced: Unplaced[]): string {
  if (unplaced.length === 0) return '';
  return section(
    'Unplaced vehicles',
    `<p class="text-xs opacity-60">On this route but not positionable on the strip.</p>
     <ul class="space-y-1">${unplaced
       .map(
         u => `<li class="text-xs flex justify-between gap-2">
           ${entityLink(ctx, { type: 'vehicle', vehicle_id: u.vehicle.key }, vehicleDisplayName(ctx.session.scheduledFeed, u.vehicle))}
           <span class="opacity-60 text-right">${escHtml(u.reason)} ${tripRelationshipMark(u.relationship)}</span>
         </li>`,
       )
       .join('')}</ul>`,
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function renderRoutePage(
  ctx: RenderContext,
  rt: RtIndex,
  state: Extract<PageState, { type: 'route' }>,
): string {
  const feed = ctx.session.scheduledFeed;
  const route = feed?.routes.get(state.route_id);
  if (!feed || !route) return missing(`Route ${state.route_id}`);

  const source = new GTFSScheduledRouteSource(feed);
  const directions = directionsForRoute(source, route.id);

  const agency = feed.agencies.find(a => a.id === route.agency_id) ?? feed.agencies[0];

  return `
    <div class="space-y-4">
      ${pageHeader(
        route.long_name || route.short_name || route.id,
        route.id,
        routeBadge(ctx, route),
      )}

      ${renderAlertList(ctx, feedWideAlerts(ctx.session), 'Feed-wide alerts')}
      ${renderAlertList(ctx, alertsForRoute(ctx.session, route.id), 'Route alerts')}

      ${renderDirectionSections(directions, d => {
        const sequence = routeSequence(source, route.id, d.direction_id);
        const { placed, unplaced } = placeVehicles(
          ctx,
          rt,
          sequence,
          route.id,
          d.direction_id,
        );
        return `
          ${renderCoverage(sequence)}
          ${renderStrip(ctx, rt, route, sequence, d.direction_id, placed)}
          ${renderUnplaced(ctx, unplaced)}`;
      })}

      ${section(
        'Route',
        propList([
          prop('Mode', escHtml(ROUTE_TYPE_LABELS[route.type] ?? `route_type ${route.type}`)),
          agency?.name ? prop('Agency', escHtml(agency.name)) : '',
          prop('Trips', String((feed.tripsByRoute.get(route.id) ?? []).length)),
          prop('Vehicles in feed', String((rt.vehiclesByRoute.get(route.id) ?? []).length)),
        ]),
      )}
      ${renderRawFields('routes.txt', route.raw)}
    </div>`;
}
