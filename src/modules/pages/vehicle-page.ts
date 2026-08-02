/**
 * The vehicle page: where it is, what it says about itself, and what its trip
 * is predicted to do.
 */

import type { VehiclePosition } from '../../map-controller';
import type { PageState } from '../../types/page-state';
import { alertsForTrip } from '../alerts';
import type { RtIndex } from '../rt-index';
import type { RenderContext } from '../render-utils';
import {
  OCCUPANCY_LABELS,
  VEHICLE_STATUS_LABELS,
  entityLink,
  escHtml,
  formatDelay,
  formatEpochTime,
  prop,
  propList,
  renderRawJson,
  routeBadge,
  section,
  timestampWithAge,
  vehicleDisplayName,
} from '../render-utils';
import { localClock, zoneLabel } from '../feed-time';
import { renderAlertList } from './alert-page';

/**
 * Last-known state for every vehicle the page has rendered.
 *
 * A vehicle disappearing from the feed is a fact worth reporting, not a reason
 * to blank the page — the last poll that contained it is often the most
 * interesting thing about it.
 */
const lastSeen = new Map<string, { vehicle: VehiclePosition; at: number }>();

function renderTripSection(ctx: RenderContext, vehicle: VehiclePosition): string {
  const feed = ctx.session.staticFeed;
  const trip = vehicle.tripId ? feed?.trips.get(vehicle.tripId) : undefined;
  if (!vehicle.tripId) {
    return section('Trip', '<p class="text-xs opacity-60">No trip_id reported.</p>');
  }

  const times = trip ? (feed?.stopTimesByTrip.get(trip.trip_id) ?? []) : [];
  const currentIndex =
    vehicle.currentStopSequence === undefined
      ? -1
      : times.findIndex(t => t.stop_sequence === vehicle.currentStopSequence);
  const currentStop = currentIndex >= 0 ? feed?.stops.get(times[currentIndex].stop_id) : undefined;
  const statusWord =
    vehicle.currentStatus === undefined
      ? 'at'
      : (VEHICLE_STATUS_LABELS[vehicle.currentStatus] ?? 'at');

  return section(
    'Trip',
    propList([
      prop('trip_id', `<span class="font-mono">${escHtml(vehicle.tripId)}</span>`),
      trip
        ? prop(
            'Route',
            entityLink(
              ctx,
              { type: 'route', route_id: trip.route_id, direction_id: trip.direction_id || undefined },
              feed?.routes.get(trip.route_id)?.short_name || trip.route_id,
            ),
          )
        : prop('Route', '<span class="opacity-50">trip not in the static feed</span>'),
      trip?.headsign ? prop('Headsign', escHtml(trip.headsign)) : '',
      currentStop
        ? prop(
            `Currently ${escHtml(statusWord)}`,
            entityLink(ctx, { type: 'stop', stop_id: currentStop.id }, currentStop.name || currentStop.id),
          )
        : '',
      currentIndex >= 0
        ? prop('Progress', `<span class="tabular-nums">${currentIndex + 1} of ${times.length} stops</span>`)
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
  const feed = ctx.session.staticFeed;

  return section(
    'Predictions',
    `<table class="table table-xs">
      <thead><tr>
        <th class="text-right">Seq</th><th>Stop</th>
        <th class="text-right">Arr ${escHtml(zoneLabel())}</th>
        <th class="text-right">Dep ${escHtml(zoneLabel())}</th>
        <th class="text-right">Delay</th>
      </tr></thead>
      <tbody>${predictions
        .map(p => {
          const stop = feed?.stops.get(p.stop_id);
          const isCurrent = p.stop_sequence === vehicle.currentStopSequence;
          return `<tr class="${isCurrent ? 'bg-base-200' : ''}">
            <td class="text-right tabular-nums opacity-60">${escHtml(String(p.stop_sequence ?? '—'))}</td>
            <td class="max-w-0 truncate">${
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
  const feed = ctx.session.staticFeed;
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
      <div class="space-y-1">
        <p class="text-xs uppercase tracking-wide opacity-50">Vehicle</p>
        <h2 class="text-lg font-semibold leading-tight">${escHtml(vehicleDisplayName(feed, vehicle))}</h2>
        <div class="flex items-center gap-2 flex-wrap">
          ${route ? routeBadge(ctx, route) : ''}
          ${trip?.headsign ? `<span class="text-xs opacity-60">${escHtml(trip.headsign)}</span>` : ''}
        </div>
      </div>

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
          prop(
            'current_stop_sequence',
            vehicle.currentStopSequence === undefined
              ? '<span class="opacity-40">not reported</span>'
              : `<span class="tabular-nums">${vehicle.currentStopSequence}</span>`,
          ),
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

      ${renderTripSection(ctx, vehicle)}
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
