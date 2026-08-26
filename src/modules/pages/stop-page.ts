/**
 * The stop page. For a platform (or a plain stop) this is what serves it, what
 * is predicted to arrive, and what is sitting at it now. For a *station* it is
 * the same questions answered over the whole place — every boardable platform
 * beneath it — because a station never appears in `stop_times` itself; its
 * services are named by its platforms (Plan 06 Root cause E).
 *
 * Aggregation is always labelled as aggregation: every merged row names the
 * child stop it came from, so nothing reads as though the station id appeared
 * in `stop_times`.
 */

import type { AlertRecord } from '../../gtfs-rt';
import type { Stop } from '../../gtfs-scheduled';
import type { PageState } from '../../types/page-state';
import { alertsForStop } from '../alerts';
import { stopTypeLabel } from '../breadcrumb-trail';
import { zoneLabel } from '../feed-time';
import type { RtIndex } from '../rt-index';
import type { RenderContext } from '../render-utils';
import {
  VEHICLE_STATUS_LABELS,
  entityLink,
  escHtml,
  formatDelay,
  formatEpochTime,
  formatScheduledTime,
  missing,
  pageHeader,
  prop,
  propList,
  renderRawFields,
  routeBadge,
  section,
  vehicleDisplayName,
} from '../render-utils';
import { renderAlertList } from './alert-page';

const MAX_DEPARTURES = 20;

/** A platform's rider-facing label: platform_code, then platform_name, then id. */
function platformLabel(stop: Stop): string {
  return (stop.raw.platform_code || stop.raw.platform_name || stop.id).trim() || stop.id;
}

/** The muted "this came from a child stop" tag every aggregated row carries. */
function fromChild(ctx: RenderContext, stopId: string): string {
  const stop = ctx.session.scheduledFeed!.stops.get(stopId);
  const label = stop ? platformLabel(stop) : stopId;
  return `<span class="opacity-50 text-xs whitespace-nowrap">@ ${escHtml(label)}</span>`;
}

function aggregationNote(count: number): string {
  return `<p class="text-xs opacity-50">Aggregated across ${count} platform${
    count === 1 ? '' : 's'
  } — these rows come from child stops in <span class="font-mono">stop_times</span>, not this station id.</p>`;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

function renderRoutes(ctx: RenderContext, serviceIds: string[], isStation: boolean): string {
  const feed = ctx.session.scheduledFeed!;
  // route_id → the platforms that serve it
  const routePlatforms = new Map<string, Set<string>>();
  for (const id of serviceIds) {
    for (const routeId of feed.routesByStop.get(id) ?? []) {
      let set = routePlatforms.get(routeId);
      if (!set) routePlatforms.set(routeId, (set = new Set()));
      set.add(id);
    }
  }
  if (routePlatforms.size === 0) return '';

  if (!isStation) {
    return section(
      'Routes serving this stop',
      `<div class="flex flex-wrap gap-1">${[...routePlatforms.keys()]
        .map(id => {
          const route = feed.routes.get(id);
          return route
            ? routeBadge(ctx, route)
            : `<span class="badge badge-ghost badge-sm">${escHtml(id)}</span>`;
        })
        .join('')}</div>`,
    );
  }

  const rows = [...routePlatforms.entries()]
    .map(([routeId, platforms]) => {
      const route = feed.routes.get(routeId);
      const badge = route
        ? routeBadge(ctx, route)
        : `<span class="badge badge-ghost badge-sm">${escHtml(routeId)}</span>`;
      const platformTags = [...platforms]
        .map(id => fromChild(ctx, id))
        .join('<span class="opacity-30">·</span> ');
      return `<div class="flex items-center gap-2 flex-wrap">${badge}${platformTags}</div>`;
    })
    .join('');

  return section(
    'Routes serving this station',
    `${aggregationNote(new Set(serviceIds).size)}<div class="space-y-1">${rows}</div>`,
  );
}

// ─── Departures ─────────────────────────────────────────────────────────────

function renderDepartures(
  ctx: RenderContext,
  rt: RtIndex,
  serviceIds: string[],
  isStation: boolean,
): string {
  const feed = ctx.session.scheduledFeed!;
  const upcoming = isStation
    ? rt.upcomingAtStops(serviceIds, MAX_DEPARTURES)
    : rt.upcomingAtStop(serviceIds[0], MAX_DEPARTURES);
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
      ? feed.stopTimesByTrip.get(trip.trip_id)?.find(t => t.stop_id === p.stop_id)?.departure_time
      : undefined;

    return `<tr>
      <td class="whitespace-nowrap">${
        route
          ? routeBadge(ctx, route)
          : `<span class="badge badge-ghost badge-sm">${escHtml(p.update.trip?.routeId ?? '?')}</span>`
      }</td>
      <td class="max-w-0 truncate">${escHtml(trip?.headsign || p.trip_id)}</td>
      ${isStation ? `<td class="whitespace-nowrap">${fromChild(ctx, p.stop_id)}</td>` : ''}
      <td class="text-right whitespace-nowrap tabular-nums opacity-60">${escHtml(
        formatScheduledTime(scheduled, false),
      )}</td>
      <td class="text-right whitespace-nowrap tabular-nums">${escHtml(
        formatEpochTime(p.time, false),
      )}</td>
      <td class="text-right whitespace-nowrap">${formatDelay(p.delay)}</td>
    </tr>`;
  });

  const body = `<table class="table table-xs">
      <thead><tr>
        <th>Route</th><th>Headsign</th>${isStation ? '<th>Platform</th>' : ''}
        <th class="text-right">Sched ${escHtml(zoneLabel())}</th>
        <th class="text-right">Pred ${escHtml(zoneLabel())}</th>
        <th class="text-right">Delay</th>
      </tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>`;

  return section(
    'Upcoming departures',
    isStation ? `${aggregationNote(new Set(serviceIds).size)}${body}` : body,
  );
}

// ─── Vehicles here now ──────────────────────────────────────────────────────

function renderVehiclesHere(
  ctx: RenderContext,
  rt: RtIndex,
  serviceIds: string[],
  isStation: boolean,
): string {
  const rows: string[] = [];
  for (const id of serviceIds) {
    for (const v of rt.vehiclesAtStop.get(id) ?? []) {
      rows.push(`<li class="flex justify-between gap-2 items-center">
        <span class="flex items-center gap-2 min-w-0">
          ${entityLink(ctx, { type: 'vehicle', vehicle_id: v.key }, vehicleDisplayName(ctx.session.scheduledFeed, v))}
          ${isStation ? fromChild(ctx, id) : ''}
        </span>
        <span class="opacity-60 shrink-0">${escHtml(
          VEHICLE_STATUS_LABELS[v.currentStatus ?? -1] ?? '',
        )}</span>
      </li>`);
    }
  }
  if (rows.length === 0) return '';
  return section(
    'Vehicles here now',
    `${isStation ? aggregationNote(new Set(serviceIds).size) : ''}<ul class="space-y-1 text-xs">${rows.join('')}</ul>`,
  );
}

// ─── Alerts ─────────────────────────────────────────────────────────────────

/** Alerts naming the station or any descendant, deduped, each marked. */
function renderStationAlerts(ctx: RenderContext, ids: string[]): string {
  const seen = new Set<string>();
  const records: AlertRecord[] = [];
  for (const id of ids) {
    for (const record of alertsForStop(ctx.session, id)) {
      if (seen.has(record.id)) continue;
      seen.add(record.id);
      records.push(record);
    }
  }
  return renderAlertList(ctx, records, 'Alerts at this station');
}

// ─── Platforms and related stops ────────────────────────────────────────────

/**
 * The station's own structure: boardable platforms first, each with its code
 * and route badges, then the entrances and generic nodes collapsed so they
 * cannot bury the platforms (South Station has 131 of them over 23 platforms).
 */
function renderPlatforms(ctx: RenderContext, stopId: string): string {
  const feed = ctx.session.scheduledFeed!;
  const children = feed.descendants(stopId).map(id => feed.stops.get(id)!).filter(Boolean);
  if (children.length === 0) {
    return section('Platforms', '<p class="text-xs opacity-60">No platforms in this feed.</p>');
  }

  const boardable = children.filter(s => s.location_type === 0);
  const others = children.filter(s => s.location_type !== 0);

  const platformRow = (s: Stop): string => {
    const routeIds = [...(feed.routesByStop.get(s.id) ?? [])];
    const badges = routeIds
      .map(id => {
        const route = feed.routes.get(id);
        return route ? routeBadge(ctx, route) : '';
      })
      .join('');
    return `<li class="flex items-center justify-between gap-2 flex-wrap">
      <span class="flex items-center gap-2 min-w-0">
        ${entityLink(ctx, { type: 'stop', stop_id: s.id }, platformLabel(s))}
        <span class="opacity-50 font-mono text-xs">${escHtml(s.id)}</span>
      </span>
      <span class="flex gap-1 flex-wrap">${badges}</span>
    </li>`;
  };

  const boardableList = boardable.length
    ? `<ul class="space-y-1 text-xs">${boardable.map(platformRow).join('')}</ul>`
    : '<p class="text-xs opacity-60">No boardable platforms in this feed.</p>';

  const otherList = others.length
    ? `<details class="text-xs">
         <summary class="cursor-pointer opacity-60">${others.length} entrance${
           others.length === 1 ? '' : 's'
         } and generic node${others.length === 1 ? '' : 's'}</summary>
         <ul class="space-y-1 mt-1">${others
           .map(
             s => `<li class="flex justify-between gap-2">
               ${entityLink(ctx, { type: 'stop', stop_id: s.id }, s.name || s.id)}
               <span class="opacity-50">${escHtml(
                 stopTypeLabel(s.location_type),
               )}</span>
             </li>`,
           )
           .join('')}</ul>
       </details>`
    : '';

  return section('Platforms', `${boardableList}${otherList}`);
}

/** For a platform: the parent's other platforms. Stations use renderPlatforms. */
function renderSiblingPlatforms(ctx: RenderContext, stop: Stop): string {
  const feed = ctx.session.scheduledFeed!;
  if (!stop.parent_station) return '';
  const siblings = (feed.childrenByParent.get(stop.parent_station) ?? [])
    .filter(id => id !== stop.id)
    .map(id => feed.stops.get(id)!)
    .filter(Boolean);
  if (siblings.length === 0) return '';

  return section(
    'Sibling platforms',
    `<ul class="space-y-1 text-xs">${siblings
      .map(
        s => `<li class="flex justify-between gap-2">
          ${entityLink(ctx, { type: 'stop', stop_id: s.id }, s.name || s.id)}
          <span class="opacity-50 font-mono">${escHtml(s.id)}</span>
        </li>`,
      )
      .join('')}</ul>`,
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function renderStopPage(
  ctx: RenderContext,
  rt: RtIndex,
  state: Extract<PageState, { type: 'stop' }>,
): string {
  const feed = ctx.session.scheduledFeed;
  const stop = feed?.stops.get(state.stop_id);
  if (!feed || !stop) return missing(`Stop ${state.stop_id}`);

  const parent = stop.parent_station ? feed.stops.get(stop.parent_station) : undefined;

  // A station aggregates over its boardable descendants; anything else answers
  // for itself. Include self in the service set so a plain stop still works and
  // a station that happens to carry its own stop_times is not dropped.
  const boardable = feed.boardableDescendants(stop.id);
  const isStation = boardable.length > 0;
  const serviceIds = isStation ? [...boardable, stop.id] : [stop.id];
  const alertIds = [stop.id, ...feed.descendants(stop.id)];

  return `
    <div class="space-y-4">
      <div class="space-y-1">
        ${pageHeader(stop.name || stop.id, stop.id)}
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

      ${
        isStation
          ? renderStationAlerts(ctx, alertIds)
          : renderAlertList(ctx, alertsForStop(ctx.session, stop.id), 'Alerts at this stop')
      }
      ${renderRoutes(ctx, serviceIds, isStation)}
      ${renderDepartures(ctx, rt, serviceIds, isStation)}
      ${renderVehiclesHere(ctx, rt, serviceIds, isStation)}
      ${isStation ? renderPlatforms(ctx, stop.id) : renderSiblingPlatforms(ctx, stop)}

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
