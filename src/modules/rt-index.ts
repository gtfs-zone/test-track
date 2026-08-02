/**
 * Lookups over the last realtime poll: predictions by trip and by stop,
 * vehicles by trip, route and stop.
 *
 * Rebuilt whenever any payload array is replaced rather than on a timer, so a
 * page rendered twice between polls does the work once. Every page needs a
 * different slice of the same three payloads, and scanning all trip updates per
 * stop row would be quadratic on the route strip.
 */

import type { TripUpdate } from '../gtfs-rt';
import { toSeconds } from '../gtfs-rt';
import type { GTFSStatic } from '../gtfs-static';
import type { VehiclePosition } from '../map-controller';
import type { FeedSession } from './feed-session';

/** One prediction, with the trip it came from and its resolved stop. */
export interface Prediction {
  update: TripUpdate;
  trip_id: string;
  stop_id: string;
  stop_sequence: number | undefined;
  /** Epoch seconds, when the producer gave an absolute time. */
  arrival?: number;
  departure?: number;
  /** Seconds; positive is late. Arrival delay preferred, else departure. */
  delay?: number;
  /** The best time to sort and display by. */
  time?: number;
}

export class RtIndex {
  readonly predictionsByTrip = new Map<string, Prediction[]>();
  readonly predictionsByStop = new Map<string, Prediction[]>();
  readonly updateByTrip = new Map<string, TripUpdate>();
  readonly vehiclesByTrip = new Map<string, VehiclePosition[]>();
  readonly vehiclesByRoute = new Map<string, VehiclePosition[]>();
  /** Only vehicles reporting `STOPPED_AT` with a resolvable stop. */
  readonly vehiclesAtStop = new Map<string, VehiclePosition[]>();

  constructor(session: FeedSession) {
    const feed = session.staticFeed;
    for (const update of session.tripUpdates) this.ingestUpdate(update, feed);
    for (const vehicle of session.vehicles.values()) this.ingestVehicle(vehicle, feed);

    for (const list of this.predictionsByStop.values()) {
      list.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
    }
  }

  private ingestUpdate(update: TripUpdate, feed: GTFSStatic | null): void {
    const tripId = update.trip?.tripId;
    if (!tripId) return;
    this.updateByTrip.set(tripId, update);

    const times = feed?.stopTimesByTrip.get(tripId);
    const predictions: Prediction[] = [];

    for (const stu of update.stopTimeUpdate ?? []) {
      // Producers may give `stop_id`, `stop_sequence`, or both. When only the
      // sequence is given the stop has to come from the static trip, which is
      // also the only way to place the prediction on the strip.
      const sequence = stu.stopSequence ?? undefined;
      const stopId =
        stu.stopId ?? (sequence !== undefined ? times?.find(t => t.stop_sequence === sequence)?.stop_id : undefined);
      if (!stopId) continue;

      const arrival = toSeconds(stu.arrival?.time);
      const departure = toSeconds(stu.departure?.time);
      const delay = stu.arrival?.delay ?? stu.departure?.delay ?? undefined;

      predictions.push({
        update,
        trip_id: tripId,
        stop_id: stopId,
        stop_sequence: sequence,
        arrival,
        departure,
        delay: delay ?? undefined,
        time: departure ?? arrival,
      });
    }

    this.predictionsByTrip.set(tripId, predictions);
    for (const p of predictions) push(this.predictionsByStop, p.stop_id, p);
  }

  private ingestVehicle(vehicle: VehiclePosition, feed: GTFSStatic | null): void {
    if (vehicle.tripId) push(this.vehiclesByTrip, vehicle.tripId, vehicle);

    const routeId = (vehicle.tripId && feed?.trips.get(vehicle.tripId)?.route_id) || vehicle.routeId;
    if (routeId) push(this.vehiclesByRoute, routeId, vehicle);

    if (vehicle.currentStatus === 1) {
      const stopId = vehicle.stopId ?? this.resolveStopId(vehicle, feed);
      if (stopId) push(this.vehiclesAtStop, stopId, vehicle);
    }
  }

  /** `current_stop_sequence` is a GTFS `stop_sequence`, never an array index. */
  private resolveStopId(vehicle: VehiclePosition, feed: GTFSStatic | null): string | undefined {
    if (!vehicle.tripId || vehicle.currentStopSequence === undefined) return undefined;
    return feed?.stopTimesByTrip
      .get(vehicle.tripId)
      ?.find(t => t.stop_sequence === vehicle.currentStopSequence)?.stop_id;
  }

  /** The next few predictions at a stop, ignoring ones already in the past. */
  upcomingAtStop(stopId: string, limit: number, nowSeconds = Date.now() / 1000): Prediction[] {
    const list = this.predictionsByStop.get(stopId) ?? [];
    const future = list.filter(p => p.time === undefined || p.time >= nowSeconds - 60);
    return (future.length ? future : list).slice(0, limit);
  }

  /**
   * Departures merged and re-sorted across several stops — the station page's
   * aggregation over a station's platforms. Each returned prediction keeps its
   * own `stop_id`, so the caller can label which platform it came from.
   */
  upcomingAtStops(stopIds: string[], limit: number, nowSeconds = Date.now() / 1000): Prediction[] {
    const all: Prediction[] = [];
    for (const id of stopIds) all.push(...(this.predictionsByStop.get(id) ?? []));
    const future = all.filter(p => p.time === undefined || p.time >= nowSeconds - 60);
    const list = future.length ? future : all;
    return list.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity)).slice(0, limit);
  }

  /**
   * The soonest prediction at a stop for one specific route and direction.
   *
   * The direction is not optional: a stop on a bidirectional route is served by
   * trips going both ways, and the soonest of those is as likely as not the one
   * the reader is not looking at. A prediction whose direction cannot be
   * determined at all is skipped rather than guessed onto this direction, the
   * same call `placeVehicles` makes for vehicles it cannot resolve.
   */
  nextAtStopForRoute(
    stopId: string,
    routeId: string,
    directionId: string,
    feed: GTFSStatic | null,
    nowSeconds = Date.now() / 1000,
  ): Prediction | undefined {
    return (this.predictionsByStop.get(stopId) ?? []).find(p => {
      if (p.time !== undefined && p.time < nowSeconds - 60) return false;
      const trip = feed?.trips.get(p.trip_id);
      const tripRoute = trip?.route_id ?? p.update.trip?.routeId;
      if (tripRoute !== routeId) return false;
      // Static wins; the realtime field is a number, so both are stringified.
      // `''` from static is a known direction (the column was absent for that
      // trip) and must still match the `''` tab — only null/undefined is unknown.
      const dir = trip?.direction_id ?? p.update.trip?.directionId;
      return dir !== undefined && dir !== null && String(dir) === directionId;
    });
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  let list = map.get(key);
  if (!list) map.set(key, (list = []));
  list.push(value);
}
