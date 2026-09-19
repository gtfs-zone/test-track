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
import { presentNumber } from '../gtfs-rt';
import type { GTFSScheduled } from 'interlocking/gtfs/scheduled';
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
  /** TripDescriptor.schedule_relationship of the enclosing trip update. */
  tripScheduleRelationship?: number;
  /** StopTimeUpdate.schedule_relationship for this stop: SKIPPED, NO_DATA, … */
  scheduleRelationship?: number;
}

/**
 * Where a vehicle's working `stop_sequence` came from.
 *
 * - `reported` — the producer sent `current_stop_sequence`.
 * - `stop_id` — it sent `stop_id` instead, which the spec equally allows. Still
 *   reported data: the feed named the stop, just not its ordinal.
 * - `derived` — it sent neither, and test-track worked the stop out from the
 *   trip's predictions. This one is an inference and has to be declared.
 */
export type StopSequenceSource = 'reported' | 'stop_id' | 'derived';

export interface VehicleStopSequence {
  sequence: number;
  source: StopSequenceSource;
  /** `stop_id` only: the trip calls at that stop more than once. */
  ambiguous: boolean;
}

/**
 * How the vehicles feed identifies the current stop, counted for the status
 * page. A feed that uses `stop_id` throughout is not defective — but which
 * field it used is a fact about the feed worth stating.
 */
export interface FeedGaps {
  vehicles: number;
  missingStopSequence: number;
  resolvedFromStopId: number;
  stopSequenceDerived: number;
}

/**
 * Feed-wide tally of `schedule_relationship`, counted for the status page. A
 * vehicle and a trip update for the same trip are two separate entities here —
 * kept in separate maps so a row can say which one it is counting rather than
 * implying a trip count.
 */
export interface ScheduleRelationshipCounts {
  /** Vehicles and trip updates whose TripDescriptor carried the field at all. */
  reported: number;
  /** Vehicles' TripDescriptor.schedule_relationship, by value. SCHEDULED included. */
  vehicleTrips: Map<number, number>;
  /** Trip updates' TripDescriptor.schedule_relationship, by value. SCHEDULED included. */
  updateTrips: Map<number, number>;
  /** StopTimeUpdates by relationship: SKIPPED and NO_DATA are the interesting ones. */
  stopTimes: Map<number, number>;
}

/**
 * A prediction this many seconds in the past still counts as the stop the
 * vehicle is working on: `current_stop_sequence` under `STOPPED_AT` names the
 * stop the vehicle is *at*, which a producer may have already timestamped as
 * served. Same grace as `upcomingAtStop`.
 */
const PAST_PREDICTION_GRACE = 60;

export class RtIndex {
  readonly predictionsByTrip = new Map<string, Prediction[]>();
  readonly predictionsByStop = new Map<string, Prediction[]>();
  readonly updateByTrip = new Map<string, TripUpdate>();
  readonly vehiclesByTrip = new Map<string, VehiclePosition[]>();
  readonly vehiclesByRoute = new Map<string, VehiclePosition[]>();
  /** Only vehicles reporting `STOPPED_AT` with a resolvable stop. */
  readonly vehiclesAtStop = new Map<string, VehiclePosition[]>();
  readonly gaps: FeedGaps = {
    vehicles: 0,
    missingStopSequence: 0,
    resolvedFromStopId: 0,
    stopSequenceDerived: 0,
  };
  readonly relationships: ScheduleRelationshipCounts = {
    reported: 0,
    vehicleTrips: new Map(),
    updateTrips: new Map(),
    stopTimes: new Map(),
  };

  /** Derivation is per-trip, and several vehicles can share a trip. */
  private readonly derivedByTrip = new Map<string, number | undefined>();
  private readonly feed: GTFSScheduled | null;
  private readonly nowSeconds: number;

  constructor(session: FeedSession, nowSeconds = Date.now() / 1000) {
    const feed = session.scheduledFeed;
    this.feed = feed;
    this.nowSeconds = nowSeconds;

    for (const update of session.tripUpdates) this.ingestUpdate(update, feed);
    for (const vehicle of session.vehicles.values()) this.ingestVehicle(vehicle, feed);

    for (const list of this.predictionsByStop.values()) {
      list.sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
    }
  }

  private ingestUpdate(update: TripUpdate, feed: GTFSScheduled | null): void {
    const tripId = update.trip?.tripId;
    if (!tripId) return;
    this.updateByTrip.set(tripId, update);

    const times = feed?.stopTimesByTrip.get(tripId);
    const predictions: Prediction[] = [];
    const tripRelationship = presentNumber(update.trip, 'scheduleRelationship');
    if (tripRelationship !== undefined) {
      this.relationships.reported++;
      bump(this.relationships.updateTrips, tripRelationship);
    }

    for (const stu of update.stopTimeUpdate ?? []) {
      // Producers may give `stop_id`, `stop_sequence`, or both. When only the
      // sequence is given the stop has to come from the scheduled trip, which is
      // also the only way to place the prediction on the strip.
      const sequence = presentNumber(stu, 'stopSequence');
      const stopId =
        stu.stopId ?? (sequence !== undefined ? times?.find(t => t.stop_sequence === sequence)?.stop_id : undefined);
      const stopRelationship = presentNumber(stu, 'scheduleRelationship');
      if (stopRelationship !== undefined) bump(this.relationships.stopTimes, stopRelationship);
      // A trip with no scheduled stop_times cannot resolve a sequence-only
      // update, so those stop time updates are dropped here.
      if (!stopId) continue;

      // Every one of these is a proto2 default away from being a lie: an absent
      // time reads back as midnight 1970 and an absent delay as "on time".
      const arrival = presentNumber(stu.arrival, 'time');
      const departure = presentNumber(stu.departure, 'time');
      const delay = presentNumber(stu.arrival, 'delay') ?? presentNumber(stu.departure, 'delay');

      predictions.push({
        update,
        trip_id: tripId,
        stop_id: stopId,
        stop_sequence: sequence,
        arrival,
        departure,
        delay,
        time: departure ?? arrival,
        scheduleRelationship: stopRelationship,
        tripScheduleRelationship: tripRelationship,
      });
    }

    this.predictionsByTrip.set(tripId, predictions);
    for (const p of predictions) push(this.predictionsByStop, p.stop_id, p);
  }

  private ingestVehicle(vehicle: VehiclePosition, feed: GTFSScheduled | null): void {
    if (vehicle.tripId) push(this.vehiclesByTrip, vehicle.tripId, vehicle);

    const routeId = (vehicle.tripId && feed?.trips.get(vehicle.tripId)?.route_id) || vehicle.routeId;
    if (routeId) push(this.vehiclesByRoute, routeId, vehicle);

    this.gaps.vehicles++;
    if (vehicle.scheduleRelationship !== undefined) {
      this.relationships.reported++;
      bump(this.relationships.vehicleTrips, vehicle.scheduleRelationship);
    }
    if (vehicle.currentStopSequence === undefined) {
      this.gaps.missingStopSequence++;
      const source = this.stopSequenceFor(vehicle)?.source;
      if (source === 'stop_id') this.gaps.resolvedFromStopId++;
      else if (source === 'derived') this.gaps.stopSequenceDerived++;
    }

    if (vehicle.currentStatus === 1) {
      const stopId = vehicle.stopId ?? this.resolveStopId(vehicle, feed);
      if (stopId) push(this.vehiclesAtStop, stopId, vehicle);
    }
  }

  /**
   * The stop this vehicle is working on, and where that came from.
   *
   * GTFS-RT gives a producer two ways to name the current stop —
   * `current_stop_sequence` and `stop_id` — and does not require either. Take
   * them in order of how directly the feed said it:
   *
   *   1. the sequence, as reported;
   *   2. the vehicle's own `stop_id`, looked up in the trip's `stop_times`;
   *   3. failing both, an inference from the trip's predictions.
   *
   * Only the third is a guess. Feeds that use `stop_id` exclusively are common
   * (RIPTA is one), and reading step 2 as a fallback would understate what those
   * feeds actually told us.
   *
   * `undefined` for `currentStopSequence` genuinely means "not sent" (see the
   * `present()` guard in `gtfs-rt.ts`), so a reported `0` stops at step 1.
   */
  stopSequenceFor(vehicle: VehiclePosition): VehicleStopSequence | undefined {
    if (vehicle.currentStopSequence !== undefined) {
      return { sequence: vehicle.currentStopSequence, source: 'reported', ambiguous: false };
    }
    if (!vehicle.tripId) return undefined;

    const fromStopId = this.stopSequenceFromStopId(vehicle);
    if (fromStopId) return fromStopId;

    const tripId = vehicle.tripId;
    if (!this.derivedByTrip.has(tripId)) {
      this.derivedByTrip.set(tripId, this.deriveStopSequence(tripId));
    }
    const sequence = this.derivedByTrip.get(tripId);
    return sequence === undefined ? undefined : { sequence, source: 'derived', ambiguous: false };
  }

  /**
   * The `stop_sequence` of the stop the vehicle named with `stop_id`.
   *
   * A trip that calls at a stop twice makes this genuinely ambiguous — the feed
   * named a stop, not a visit — so the first visit is taken and the result says
   * so. Not memoised per trip: two vehicles on one trip sit at different stops.
   */
  private stopSequenceFromStopId(vehicle: VehiclePosition): VehicleStopSequence | undefined {
    if (!vehicle.stopId || !vehicle.tripId) return undefined;
    const times = this.feed?.stopTimesByTrip.get(vehicle.tripId);
    if (!times) return undefined;

    const visits = times.filter(t => t.stop_id === vehicle.stopId);
    if (visits.length === 0) return undefined;
    return { sequence: visits[0].stop_sequence, source: 'stop_id', ambiguous: visits.length > 1 };
  }

  /**
   * The `stop_sequence` of the trip's soonest prediction that is not already in
   * the past.
   *
   * A prediction that carries only `stop_id` has to be looked up in the schedule
   * trip. On a trip that visits a stop twice that lookup takes the first visit —
   * a known approximation, reachable only when the producer gave no sequence.
   */
  private deriveStopSequence(tripId: string): number | undefined {
    const times = this.feed?.stopTimesByTrip.get(tripId);
    const floor = this.nowSeconds - PAST_PREDICTION_GRACE;

    let best: { sequence: number; time: number } | undefined;
    for (const p of this.predictionsByTrip.get(tripId) ?? []) {
      // An untimed prediction cannot be ordered against the others, so it says
      // nothing about which stop comes next.
      if (p.time === undefined || p.time < floor) continue;
      if (best && p.time >= best.time) continue;

      const sequence = p.stop_sequence ?? times?.find(t => t.stop_id === p.stop_id)?.stop_sequence;
      if (sequence === undefined) continue;
      best = { sequence, time: p.time };
    }
    return best?.sequence;
  }

  /** `current_stop_sequence` is a GTFS `stop_sequence`, never an array index. */
  private resolveStopId(vehicle: VehiclePosition, feed: GTFSScheduled | null): string | undefined {
    const current = this.stopSequenceFor(vehicle);
    if (!vehicle.tripId || !current) return undefined;
    return feed?.stopTimesByTrip
      .get(vehicle.tripId)
      ?.find(t => t.stop_sequence === current.sequence)?.stop_id;
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
   * The soonest prediction across a set of stops for one route and direction.
   *
   * Takes several stop ids because the route strip shows stations, not
   * platforms, while the realtime feed predicts against platforms — so the
   * caller hands over the station and everything under it and gets the earliest
   * of the lot.
   *
   * The direction is not optional: a stop on a bidirectional route is served by
   * trips going both ways, and the soonest of those is as likely as not the one
   * the reader is not looking at. A prediction whose direction cannot be
   * determined at all is skipped rather than guessed onto this direction, the
   * same call `placeVehicles` makes for vehicles it cannot resolve.
   */
  nextAtStopsForRoute(
    stopIds: string[],
    routeId: string,
    directionId: string,
    feed: GTFSScheduled | null,
    nowSeconds = Date.now() / 1000,
  ): Prediction | undefined {
    let best: Prediction | undefined;
    for (const stopId of stopIds) {
      for (const p of this.predictionsByStop.get(stopId) ?? []) {
        if (p.time !== undefined && p.time < nowSeconds - 60) continue;
        const trip = feed?.trips.get(p.trip_id);
        const tripRoute = trip?.route_id ?? p.update.trip?.routeId;
        if (tripRoute !== routeId) continue;
        // The schedule wins; the realtime field is a number, so both are stringified.
        // `''` from the schedule is a known direction (the column was absent for that
        // trip) and must still match the `''` tab — only null/undefined is unknown.
        const dir = trip?.direction_id ?? p.update.trip?.directionId;
        if (dir === undefined || dir === null || String(dir) !== directionId) continue;
        // A prediction with no time cannot be ordered; it stands only until a
        // timed one turns up.
        if (!best || (p.time ?? Infinity) < (best.time ?? Infinity)) best = p;
      }
    }
    return best;
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  let list = map.get(key);
  if (!list) map.set(key, (list = []));
  list.push(value);
}

function bump(map: Map<number, number>, key: number): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}
