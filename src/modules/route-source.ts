/* @vendored-from coloring-book:src/modules/route-source.ts
   @sha dca23b3
   @status verbatim */
/**
 * Storage-agnostic view of the data `route-sequence.ts` and `route-graph.ts`
 * need. Both modules originate in test-track, which reads from `GTFSScheduled`;
 * coloring-book reads from `GTFSParser`'s virtual tables. Narrowing to this
 * interface is what lets the same engine run over either.
 */

import type { StopTimeRef } from '../types/gtfs-flex';

export interface RouteSourceTrip {
  trip_id: string;
  direction_id?: string;
  headsign?: string;
}

export interface RouteSourceStopTime {
  /** The row's single reference, or null when the row is malformed. */
  ref: StopTimeRef | null;
  stop_sequence: number;
}

export interface RouteSource {
  /** Trips on the route, optionally scoped to one service. */
  tripsForRoute(route_id: string, service_id?: string): RouteSourceTrip[];
  /** The trip's stop_times, sorted by stop_sequence. */
  stopTimesForTrip(trip_id: string): RouteSourceStopTime[];
  /** The stop's topmost parent_station, or the stop itself. */
  stationRoot(stop_id: string): string;
  stopName(stop_id: string): string | undefined;
  /** Display name of a location group, from location_groups.txt. */
  locationGroupName(location_group_id: string): string | undefined;
  /** Display name of an on-demand zone, from locations.geojson. */
  zoneName(location_id: string): string | undefined;
  /** Display name for any stop_time reference, whatever its kind. */
  refName(ref: StopTimeRef): string | undefined;
}
