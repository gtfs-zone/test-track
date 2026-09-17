/**
 * `RouteSource` over `GTFSScheduled`. The scheduled feed is loaded once and never
 * mutated, so this needs no invalidation and no adapter-side caching.
 */
import type { GTFSScheduled } from '../gtfs-scheduled';
import type { StopTimeRef } from 'interlocking/gtfs/types';
import type { RouteSource, RouteSourceTrip, RouteSourceStopTime } from 'interlocking/gtfs/route-source';

export class GTFSScheduledRouteSource implements RouteSource {
  constructor(private feed: GTFSScheduled) {}

  tripsForRoute(route_id: string): RouteSourceTrip[] {
    return this.feed.tripsByRoute.get(route_id) ?? [];
  }

  // test-track ingests no flex tables, so every stop_time is a plain stop ref.
  stopTimesForTrip(trip_id: string): RouteSourceStopTime[] {
    const times = this.feed.stopTimesByTrip.get(trip_id);
    if (!times) return [];
    return times.map((time) => ({
      ref: time.stop_id ? { kind: 'stop', id: time.stop_id } : null,
      stop_sequence: time.stop_sequence,
    }));
  }

  stationRoot(stop_id: string): string {
    return this.feed.stationRoot(stop_id);
  }

  stopName(stop_id: string): string | undefined {
    return this.feed.stops.get(stop_id)?.name;
  }

  // No location_groups.txt or locations.geojson in the ingest, so a non-stop
  // ref can never reach here.
  locationGroupName(): undefined {
    return undefined;
  }

  zoneName(): undefined {
    return undefined;
  }

  refName(ref: StopTimeRef): string | undefined {
    return ref.kind === 'stop' ? this.stopName(ref.id) : undefined;
  }
}
