/**
 * Turns the loaded session into search entries for `SearchController`.
 *
 * The payload is a `PageState`, so a selected result goes through `setFocus`
 * like any other navigation and the panel, map and hash all follow.
 *
 * Vehicles come from the session's live map, so they are as fresh as the last
 * poll — entries are rebuilt per query, which is what makes that free.
 */

import { CONFIG } from '../config';
import type { PageState } from '../types/page-state';
import type { FeedSession } from './feed-session';
import { vehicleDisplayName } from './render-utils';
import {
  dotMarker,
  routeMarker,
  stopMarker,
  type SearchEntry,
} from './search-controller';

/** Non-empty values only, so the haystack has no runs of blanks to match into. */
function haystack(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function buildSearchEntries(session: FeedSession): SearchEntry<PageState>[] {
  const feed = session.staticFeed;
  const entries: SearchEntry<PageState>[] = [];

  for (const stop of feed?.stops.values() ?? []) {
    entries.push({
      payload: { type: 'stop', stop_id: stop.id },
      icon: stopMarker(stop.location_type),
      primary: stop.name || stop.id,
      secondary: stop.raw['stop_code'] || stop.id,
      haystack: haystack(stop.name, stop.id, stop.raw['stop_code'], stop.raw['stop_desc']),
    });
  }

  for (const route of feed?.routes.values() ?? []) {
    const primary = route.short_name || route.long_name || route.id;
    entries.push({
      payload: { type: 'route', route_id: route.id },
      icon: routeMarker(route.color),
      primary,
      secondary: route.long_name && route.long_name !== primary ? route.long_name : route.id,
      haystack: haystack(route.short_name, route.long_name, route.id, route.raw['route_desc']),
    });
  }

  for (const vehicle of session.vehicles.values()) {
    // Same color the map paints it: the vehicle's route, or the unmatched grey.
    const routeId = vehicle.routeId || (vehicle.tripId ? feed?.trips.get(vehicle.tripId)?.route_id : undefined);
    const color = (routeId ? feed?.routes.get(routeId)?.color : undefined) ?? CONFIG.VEHICLE_UNMATCHED_COLOR;
    entries.push({
      payload: { type: 'vehicle', vehicle_id: vehicle.key },
      icon: dotMarker(color),
      primary: vehicleDisplayName(feed, vehicle),
      secondary: vehicle.vehicleId || vehicle.key,
      haystack: haystack(
        vehicleDisplayName(feed, vehicle),
        vehicle.vehicleId,
        vehicle.label,
        vehicle.tripId,
        routeId,
      ),
    });
  }

  return entries;
}
