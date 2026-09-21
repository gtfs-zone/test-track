/**
 * The vehicle page: where it is, what it says about itself, and what its trip
 * is predicted to do.
 */

import type { VehiclePosition } from 'interlocking/gtfs/rt-types';
import type { GTFSScheduled } from 'interlocking/gtfs/scheduled';
import type { PageState } from '../../types/page-state';
import { alertsForTrip } from 'interlocking/gtfs/alerts';
import type { RtIndex } from 'interlocking/gtfs/rt-index';
import type { RenderContext } from '../render-context';
import {
  OCCUPANCY_LABELS,
  TRIP_SCHEDULE_RELATIONSHIP_LABELS,
  VEHICLE_STATUS_LABELS,
  entityLink,
  escHtml,
  formatDelay,
  formatEpochTime,
  pageHeader,
  prop,
  propList,
  renderRawJson,
  routeBadge,
  section,
  stopSequenceMark,
  stopTimeRelationshipMark,
  timestampWithAge,
  tripRelationshipMark,
  vehicleDisplayName,
} from 'interlocking/gtfs/entity-render';
import { localClock, zoneLabel } from 'interlocking/gtfs/feed-time';
import { renderAlertList } from './alert-page';

/**
 * Last-known state for every vehicle the page has rendered.
 *
 * A vehicle disappearing from the feed is a fact worth reporting, not a reason
 * to blank the page — the last poll that contained it is often the most
 * interesting thing about it.
 */
const lastSeen = new Map<string, { vehicle: VehiclePosition; at: number }>();

/** Relationship values under which a trip legitimately has no static-schedule entry. */
const ADDED_LIKE_RELATIONSHIPS = new Set([1, 2, 4, 5]);

/**
 * The `current_stop_sequence` row of the raw property region: exactly what the
 * feed sent, and — when it sent nothing — where the value in use came from
 * instead. The "not reported" half never goes away; this region reports the
 * wire.
 */
function renderStopSequenceValue(rt: RtIndex, vehicle: VehiclePosition): string {
  if (vehicle.currentStopSequence !== undefined) {
    return `<span class="tabular-nums">${vehicle.currentStopSequence}</span>`;
  }

  const absent = '<span class="opacity-40">not reported</span>';
  const current = rt.stopSequenceFor(vehicle);
  if (!current) return absent;

  const note =
    current.source === 'stop_id'
      ? `stop_id ${escHtml(vehicle.stopId ?? '')} is stop_sequence <span class="tabular-nums">${current.sequence}</span> on this trip`
      : `derived <span class="tabular-nums">${current.sequence}</span> from trip updates`;
  return `${absent} <span class="opacity-60">— ${note}</span>`;
}

/**
 * The Route row when the trip is not in the static schedule. When the feed
 * explained why (ADDED / UNSCHEDULED / REPLACEMENT / DUPLICATED), say so and
 * still surface `vehicle.routeId` rather than dimming the row into a gap.
 */
function renderAddedTripRoute(
  ctx: RenderContext,
  feed: GTFSScheduled | null | undefined,
  vehicle: VehiclePosition,
): string {
  const rel = vehicle.scheduleRelationship;
  if (rel === undefined || !ADDED_LIKE_RELATIONSHIPS.has(rel)) {
    return prop('Route', '<span class="opacity-50">trip not in the schedule</span>');
  }
  const route = vehicle.routeId ? feed?.routes.get(vehicle.routeId) : undefined;
  const routeHtml = !vehicle.routeId
    ? '<span class="opacity-50">no route_id reported</span>'
    : route
      ? entityLink(ctx, { type: 'route', route_id: route.id }, route.short_name || route.long_name || route.id)
      : `<span class="font-mono">${escHtml(vehicle.routeId)}</span>`;
  return prop('Route', `${routeHtml} ${tripRelationshipMark(rel)}`);
}

function renderTripSection(ctx: RenderContext, rt: RtIndex, vehicle: VehiclePosition): string {
  const feed = ctx.session.scheduledFeed;
  const trip = vehicle.tripId ? feed?.trips.get(vehicle.tripId) : undefined;
  if (!vehicle.tripId) {
    return section('Trip', '<p class="text-xs opacity-60">No trip_id reported.</p>');
  }

  const times = trip ? (feed?.stopTimesByTrip.get(trip.trip_id) ?? []) : [];
  const current = rt.stopSequenceFor(vehicle);
  const currentIndex = current
    ? times.findIndex(t => t.stop_sequence === current.sequence)
    : -1;
  const currentStop = currentIndex >= 0 ? feed?.stops.get(times[currentIndex].stop_id) : undefined;
  const statusWord =
    vehicle.currentStatus === undefined
      ? 'at'
      : (VEHICLE_STATUS_LABELS[vehicle.currentStatus] ?? 'at');
  // The whole section hangs off the stop, so the mark rides with the value.
  const mark = current ? ` ${stopSequenceMark(vehicle, current)}` : '';

  const routeProp = trip
    ? prop(
        'Route',
        entityLink(
          ctx,
          { type: 'route', route_id: trip.route_id },
          feed?.routes.get(trip.route_id)?.short_name || trip.route_id,
        ),
      )
    : renderAddedTripRoute(ctx, feed, vehicle);

  return section(
    'Trip',
    propList([
      prop('trip_id', `<span class="font-mono">${escHtml(vehicle.tripId)}</span>`),
      routeProp,
      prop(
        'schedule_relationship',
        vehicle.scheduleRelationship === undefined
          ? '<span class="opacity-40">not reported</span>'
          : escHtml(
              TRIP_SCHEDULE_RELATIONSHIP_LABELS[vehicle.scheduleRelationship] ??
                String(vehicle.scheduleRelationship),
            ),
      ),
      trip?.headsign ? prop('Headsign', escHtml(trip.headsign)) : '',
      currentStop
        ? prop(
            `Currently ${escHtml(statusWord)}`,
            `${entityLink(ctx, { type: 'stop', stop_id: currentStop.id }, currentStop.name || currentStop.id)}${mark}`,
          )
        : '',
      currentIndex >= 0
        ? prop(
            'Progress',
            `<span class="tabular-nums">${currentIndex + 1} of ${times.length} stops</span>${mark}`,
          )
        : '',
      vehicle.startDate || vehicle.startTime
        ? prop('Trip start', escHtml(`${vehicle.startDate ?? ''} ${vehicle.startTime ?? ''}`.trim()))
        : '',
    ]),
  );
}

/** Every stop-time prediction for this vehicle's trip, in sequence order. */
function renderPredictions(ctx: RenderContext, rt: RtIndex, vehicle: VehiclePosition): string {
  if (!vehicle.tripId) return '';
  const predictions = rt.predictionsByTrip.get(vehicle.tripId);
  if (!predictions?.length) {
    return section(
      'Predictions',
      '<p class="text-xs opacity-60">No trip update in the feed matches this trip.</p>',
    );
  }
  const feed = ctx.session.scheduledFeed;
  const current = rt.stopSequenceFor(vehicle);
  const showRel = predictions.some(p => p.scheduleRelationship);

  return section(
    'Predictions',
    `<table class="table table-xs table-fixed">
      <colgroup>
        <col style="width: ${showRel ? '8.33%' : '9.09%'}" />
        <col style="width: ${showRel ? '33.33%' : '36.36%'}" />
        <col style="width: ${showRel ? '16.67%' : '18.18%'}" />
        <col style="width: ${showRel ? '16.67%' : '18.18%'}" />
        <col style="width: ${showRel ? '16.67%' : '18.18%'}" />
        ${showRel ? '<col style="width: 8.33%" />' : ''}
      </colgroup>
      <thead><tr>
        <th class="text-right">Seq</th><th>Stop</th>
        <th class="text-right">Arr ${escHtml(zoneLabel())}</th>
        <th class="text-right">Dep ${escHtml(zoneLabel())}</th>
        <th class="text-right">Delay</th>
        ${showRel ? '<th class="text-right">Rel</th>' : ''}
      </tr></thead>
      <tbody>${predictions
        .map(p => {
          const stop = feed?.stops.get(p.stop_id);
          const isCurrent = current !== undefined && p.stop_sequence === current.sequence;
          const skipped = p.scheduleRelationship === 1;
          return `<tr class="${isCurrent ? 'bg-base-200' : ''}">
            <td class="text-right tabular-nums opacity-60">${escHtml(String(p.stop_sequence ?? '—'))}</td>
            <td class="max-w-0 truncate${skipped ? ' opacity-50 line-through' : ''}">${
              stop
                ? entityLink(ctx, { type: 'stop', stop_id: stop.id }, stop.name || stop.id)
                : escHtml(p.stop_id)
            }</td>
            <td class="text-right whitespace-nowrap tabular-nums">${escHtml(
              formatEpochTime(p.arrival, false),
            )}</td>
            <td class="text-right whitespace-nowrap tabular-nums">${escHtml(
              formatEpochTime(p.departure, false),
            )}</td>
            <td class="text-right whitespace-nowrap">${formatDelay(p.delay)}</td>
            ${showRel ? `<td class="text-right whitespace-nowrap">${stopTimeRelationshipMark(p.scheduleRelationship)}</td>` : ''}
          </tr>`;
        })
        .join('')}</tbody>
    </table>`,
  );
}

export function renderVehiclePage(
  ctx: RenderContext,
  rt: RtIndex,
  state: Extract<PageState, { type: 'vehicle' }>,
): string {
  const live = ctx.session.vehicles.get(state.vehicle_id);
  if (live) lastSeen.set(state.vehicle_id, { vehicle: live, at: Date.now() });

  const remembered = lastSeen.get(state.vehicle_id);
  if (!live && !remembered) {
    return `<p class="text-sm opacity-60">Vehicle ${escHtml(
      state.vehicle_id,
    )} is not in the current realtime feed.</p>`;
  }

  const vehicle = live ?? remembered!.vehicle;
  const feed = ctx.session.scheduledFeed;
  const trip = vehicle.tripId ? feed?.trips.get(vehicle.tripId) : undefined;
  const route = feed?.routes.get(trip?.route_id ?? vehicle.routeId ?? '');

  // Every vehicle sharing this feed's `vehicle.id`. More than one is a GTFS-RT
  // spec violation — VehicleDescriptor.id "should be unique per vehicle" — that
  // test-track reports rather than hides (Plan 06 Root cause D).
  const sharing = vehicle.vehicleId
    ? [...ctx.session.vehicles.values()].filter(v => v.vehicleId === vehicle.vehicleId)
    : [vehicle];
  const sharedIdBanner =
    sharing.length > 1
      ? `<div class="rounded-lg border border-warning/50 bg-warning/10 p-3 text-xs space-y-1">
           <p>The feed's <span class="font-mono">vehicle.id</span>
           <span class="font-mono">${escHtml(vehicle.vehicleId)}</span> identifies
           ${sharing.length} vehicles in this feed. GTFS-RT specifies
           <span class="font-mono">VehicleDescriptor.id</span> "should be unique per
           vehicle"; this feed reuses it.</p>
           ${
             vehicle.tripId
               ? `<p>This instance is distinguished by trip
                  <span class="font-mono">${escHtml(vehicle.tripId)}</span>${
                    vehicle.startDate
                      ? ` on <span class="font-mono">${escHtml(vehicle.startDate)}</span>`
                      : ''
                  }.</p>`
               : ''
           }
         </div>`
      : '';

  const goneBanner = live
    ? ''
    : `<div class="rounded-lg border border-warning/50 bg-warning/10 p-3 text-xs">
         No longer in the feed as of ${escHtml(
           localClock(remembered!.at),
         )}. Everything below is the last poll that contained it.
       </div>`;

  return `
    <div class="space-y-4">
      ${goneBanner}
      ${sharedIdBanner}
      ${pageHeader(
        vehicleDisplayName(feed, vehicle),
        // The feed's own name for it, falling back to the entity that carried
        // it — the Identity props below keep the two apart.
        vehicle.vehicleId || vehicle.entityId,
        `${route ? routeBadge(ctx, route) : ''} ${tripRelationshipMark(vehicle.scheduleRelationship)}`.trim(),
      )}

      ${section(
        'Live',
        propList([
          prop('Position', escHtml(`${vehicle.lat.toFixed(5)}, ${vehicle.lon.toFixed(5)}`)),
          prop(
            'Bearing',
            vehicle.bearing === undefined
              ? '<span class="opacity-40">not reported</span>'
              : `${escHtml(vehicle.bearing.toFixed(0))}°`,
          ),
          prop(
            'Speed',
            vehicle.speed === undefined
              ? '<span class="opacity-40">not reported</span>'
              : `${escHtml(vehicle.speed.toFixed(1))} m/s`,
          ),
          prop(
            'Status',
            vehicle.currentStatus === undefined
              ? '<span class="opacity-40">not reported</span>'
              : escHtml(VEHICLE_STATUS_LABELS[vehicle.currentStatus] ?? String(vehicle.currentStatus)),
          ),
          // This region reports the wire, so an omitted field still reads as
          // omitted; the derived value is stated next to it, not in place of it.
          prop('current_stop_sequence', renderStopSequenceValue(rt, vehicle)),
          prop(
            'Occupancy',
            vehicle.occupancyStatus === undefined
              ? '<span class="opacity-40">not reported</span>'
              : escHtml(OCCUPANCY_LABELS[vehicle.occupancyStatus] ?? String(vehicle.occupancyStatus)),
          ),
          prop('Timestamp', timestampWithAge(vehicle.timestamp)),
          prop(
            'vehicle.id',
            vehicle.vehicleId
              ? `<span class="font-mono">${escHtml(vehicle.vehicleId)}</span>`
              : '<span class="opacity-40">empty in the feed</span>',
          ),
          prop('Feed entity id', `<span class="font-mono">${escHtml(vehicle.entityId)}</span>`),
        ]),
      )}

      ${renderTripSection(ctx, rt, vehicle)}
      ${renderPredictions(ctx, rt, vehicle)}
      ${renderAlertList(
        ctx,
        vehicle.tripId
          ? alertsForTrip(ctx.session, vehicle.tripId, trip?.route_id ?? vehicle.routeId)
          : [],
        'Alerts',
      )}

      ${renderRawJson('VehiclePosition (decoded)', vehicle.raw)}
    </div>`;
}
