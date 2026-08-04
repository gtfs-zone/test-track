/* @vendored-from coloring-book:src/modules/route-source.ts
   @sha 9f1f986
   @status verbatim */
/**
 * Storage-agnostic view of the data `route-sequence.ts` and `route-graph.ts`
 * need. Both modules originate in test-track, which reads from `GTFSStatic`;
 * coloring-book reads from `GTFSParser`'s virtual tables. Narrowing to this
 * interface is what lets the same engine run over either.
 */
export interface RouteSourceTrip {
  trip_id: string;
  direction_id?: string;
  headsign?: string;
}

export interface RouteSourceStopTime {
  stop_id: string;
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
}
