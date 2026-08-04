/**
 * `RouteSource` over `GTFSStatic`. The static feed is loaded once and never
 * mutated, so this needs no invalidation and no adapter-side caching.
 */
import type { GTFSStatic } from '../gtfs-static';
import type { RouteSource, RouteSourceTrip, RouteSourceStopTime } from './route-source';

export class GTFSStaticRouteSource implements RouteSource {
  constructor(private feed: GTFSStatic) {}

  tripsForRoute(route_id: string): RouteSourceTrip[] {
    return this.feed.tripsByRoute.get(route_id) ?? [];
  }

  stopTimesForTrip(trip_id: string): RouteSourceStopTime[] {
    return this.feed.stopTimesByTrip.get(trip_id) ?? [];
  }

  stationRoot(stop_id: string): string {
    return this.feed.stationRoot(stop_id);
  }

  stopName(stop_id: string): string | undefined {
    return this.feed.stops.get(stop_id)?.name;
  }
}
