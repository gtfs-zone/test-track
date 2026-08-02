/**
 * The stop page: what serves this stop, what is predicted to arrive, what is
 * sitting at it right now, and every column stops.txt gave us.
 */

import type { PageState } from '../../types/page-state';
import { alertsForStop } from '../alerts';
import type { RtIndex } from '../rt-index';
import type { RenderContext } from '../render-utils';
import {
  LOCATION_TYPE_LABELS,
  VEHICLE_STATUS_LABELS,
  entityLink,
  escHtml,
  formatDelay,
  formatEpochTime,
  missing,
  prop,
  propList,
  renderRawFields,
  routeBadge,
  section,
} from '../render-utils';
import { renderAlertList } from './alert-page';

const MAX_DEPARTURES = 20;

function renderRoutes(ctx: RenderContext, stopId: string): string {
  const feed = ctx.session.staticFeed!;
  const routeIds = [...(feed.routesByStop.get(stopId) ?? [])];
  if (routeIds.length === 0) return '';
  return section(
    'Routes serving this stop',
    `<div class="flex flex-wrap gap-1">${routeIds
      .map(id => {
        const route = feed.routes.get(id);
        return route ? routeBadge(ctx, route) : `<span class="badge badge-ghost badge-sm">${escHtml(id)}</span>`;
      })
      .join('')}</div>`,
  );
}

/**
 * Predicted departures, soonest first. Each row names the route and headsign
 * from the static trip, so a prediction whose trip is not in the static feed is
 * visibly that rather than silently blank.
 */
function renderDepartures(ctx: RenderContext, rt: RtIndex, stopId: string): string {
  const feed = ctx.session.staticFeed!;
  const upcoming = rt.upcomingAtStop(stopId, MAX_DEPARTURES);
  if (upcoming.length === 0) {
    return section(
      'Upcoming departures',
      '<p class="text-xs opacity-60">No trip updates reference this stop.</p>',
    );
  }

  const rows = upcoming.map(p => {
    const trip = feed.trips.get(p.trip_id);
    const route = trip ? feed.routes.get(trip.route_id) : undefined;
    const scheduled = trip
      ? feed.stopTimesByTrip.get(trip.trip_id)?.find(t => t.stop_id === stopId)?.departure_time
      : undefined;

    return `<tr>
      <td class="whitespace-nowrap">${
        route
          ? routeBadge(ctx, route)
          : `<span class="badge badge-ghost badge-sm">${escHtml(p.update.trip?.routeId ?? '?')}</span>`
      }</td>
      <td class="max-w-0 truncate">${escHtml(trip?.headsign || p.trip_id)}</td>
      <td class="text-right whitespace-nowrap tabular-nums opacity-60">${escHtml(scheduled || '—')}</td>
      <td class="text-right whitespace-nowrap tabular-nums">${escHtml(formatEpochTime(p.time))}</td>
      <td class="text-right whitespace-nowrap">${formatDelay(p.delay)}</td>
    </tr>`;
  });

  return section(
    'Upcoming departures',
    `<table class="table table-xs">
      <thead><tr>
        <th>Route</th><th>Headsign</th>
        <th class="text-right">Sched</th><th class="text-right">Pred</th><th class="text-right">Delay</th>
      </tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`,
  );
}

function renderVehiclesHere(ctx: RenderContext, rt: RtIndex, stopId: string): string {
  const vehicles = rt.vehiclesAtStop.get(stopId) ?? [];
  if (vehicles.length === 0) return '';
  return section(
    'Vehicles here now',
    `<ul class="space-y-1 text-xs">${vehicles
      .map(
        v => `<li class="flex justify-between gap-2">
          ${entityLink(ctx, { type: 'vehicle', vehicle_id: v.id }, v.label || v.id)}
          <span class="opacity-60">${escHtml(
            VEHICLE_STATUS_LABELS[v.currentStatus ?? -1] ?? '',
          )}</span>
        </li>`,
      )
      .join('')}</ul>`,
  );
}

/**
 * Children when this is a station; siblings when it is a platform. Both answer
 * the same question — "what else is part of this place?" — so both are shown
 * under one heading rather than depending on the reader knowing which case
 * they are in.
 */
function renderRelatedStops(ctx: RenderContext, stopId: string): string {
  const feed = ctx.session.staticFeed!;
  const stop = feed.stops.get(stopId)!;

  const children = [...feed.stops.values()].filter(s => s.parent_station === stopId);
  const siblings = stop.parent_station
    ? [...feed.stops.values()].filter(
        s => s.parent_station === stop.parent_station && s.id !== stopId,
      )
    : [];
  const related = children.length ? children : siblings;
  if (related.length === 0) return '';

  return section(
    children.length ? 'Child stops' : 'Sibling platforms',
    `<ul class="space-y-1 text-xs">${related
      .map(
        s => `<li class="flex justify-between gap-2">
          ${entityLink(ctx, { type: 'stop', stop_id: s.id }, s.name || s.id)}
          <span class="opacity-50 font-mono">${escHtml(s.id)}</span>
        </li>`,
      )
      .join('')}</ul>`,
  );
}

export function renderStopPage(
  ctx: RenderContext,
  rt: RtIndex,
  state: Extract<PageState, { type: 'stop' }>,
): string {
  const feed = ctx.session.staticFeed;
  const stop = feed?.stops.get(state.stop_id);
  if (!feed || !stop) return missing(`Stop ${state.stop_id}`);

  const parent = stop.parent_station ? feed.stops.get(stop.parent_station) : undefined;

  return `
    <div class="space-y-4">
      <div class="space-y-1">
        <p class="text-xs uppercase tracking-wide opacity-50">${escHtml(
          LOCATION_TYPE_LABELS[stop.location_type] ?? `location_type ${stop.location_type}`,
        )}</p>
        <h2 class="text-lg font-semibold leading-tight">${escHtml(stop.name || stop.id)}</h2>
        <p class="text-xs opacity-60 font-mono">${escHtml(stop.id)}</p>
        ${
          parent
            ? `<p class="text-xs">Part of ${entityLink(
                ctx,
                { type: 'stop', stop_id: parent.id },
                parent.name || parent.id,
              )}</p>`
            : ''
        }
      </div>

      ${renderAlertList(ctx, alertsForStop(ctx.session, stop.id), 'Alerts at this stop')}
      ${renderRoutes(ctx, stop.id)}
      ${renderDepartures(ctx, rt, stop.id)}
      ${renderVehiclesHere(ctx, rt, stop.id)}
      ${renderRelatedStops(ctx, stop.id)}

      ${section(
        'Properties',
        propList([
          prop('Coordinates', escHtml(`${stop.lat.toFixed(5)}, ${stop.lon.toFixed(5)}`)),
          prop('Trips calling', String((feed.stopTrips.get(stop.id) ?? []).length)),
        ]),
      )}
      ${renderRawFields('stops.txt', stop.raw)}
    </div>`;
}
