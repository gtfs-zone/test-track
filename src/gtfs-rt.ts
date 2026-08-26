import { transit_realtime } from 'gtfs-realtime-bindings';
import { CONFIG } from './config';
import type { VehiclePosition } from './map-controller';
import type { RealtimeEndpointName } from './modules/feed-selection';
import { REALTIME_ENDPOINTS, describeHttpError, describeNetworkError } from './modules/feed-selection';

export type TripUpdate = transit_realtime.ITripUpdate;
export type ServiceAlert = transit_realtime.IAlert;

/**
 * An alert plus the identity it is addressed by.
 *
 * GTFS-RT alerts carry no id of their own — only the enclosing `FeedEntity.id`
 * — so that is what the alert page is keyed on. Some producers regenerate
 * entity ids between polls, which means a focused alert can vanish even though
 * the same disruption is still being reported. There is nothing better to key
 * on; the UI has to tolerate it.
 */
export interface AlertRecord {
  id: string;
  alert: ServiceAlert;
  /** Plain-object form of the same alert, for the alert page's raw dump. */
  raw: unknown;
}

/**
 * Whether the producer actually sent a field, as opposed to protobufjs handing
 * back a proto2 default.
 *
 * The generated bindings keep every default on the message *prototype*
 * (`VehiclePosition.prototype.currentStopSequence = 0`, `currentStatus = 2`),
 * and decoding only assigns own properties for fields that were on the wire. So
 * `msg.currentStopSequence ?? undefined` can never yield `undefined`, and an
 * absent field is indistinguishable from a reported zero unless the own-property
 * is checked. Getting this wrong makes test-track assert things the feed never
 * said — a stop_sequence of 0, a bearing of due north, an IN_TRANSIT_TO status.
 */
function present<T>(msg: object, field: string, value: T | null | undefined): T | undefined {
  return Object.prototype.hasOwnProperty.call(msg, field) ? (value ?? undefined) : undefined;
}

/**
 * A numeric field, or `undefined` when the producer did not send it.
 *
 * `present` plus the coercion the 64-bit fields need: protobuf decodes those to
 * `Long` objects rather than numbers, and every timestamp in GTFS-RT is one.
 * `Number(long)` goes through the Long's own `toString`, so this works whether
 * or not protobufjs installed Long support.
 *
 * Reading such a field without the own-property check is worse than useless: an
 * absent `int64` reads back as `Long{0,0}`, which is finite, so the value comes
 * out as `0` — midnight 1970 for a time, "on time" for a delay. Both are things
 * the feed never said.
 *
 * `msg` is nullable so the whole containing message may be absent, as in
 * `presentNumber(stu.arrival, 'time')`.
 */
export function presentNumber(msg: object | null | undefined, field: string): number | undefined {
  if (!msg || !Object.prototype.hasOwnProperty.call(msg, field)) return undefined;
  const n = Number((msg as Record<string, unknown>)[field]);
  return Number.isFinite(n) ? n : undefined;
}

/** Verbatim FeedHeader fields, for the status page's raw dump. */
export interface RawFeedHeader {
  gtfsRealtimeVersion: string;
  incrementality: string;
  timestamp: number | null;
}

/**
 * Which of the four key-derivation rules a vehicles feed forced (Plan 06 Root
 * cause D). `unique` is the no-op path a well-formed feed takes; anything else
 * means the feed's `vehicle.id` was not unique per vehicle and test-track had to
 * derive a safe instance key to address entities by.
 */
export type VehicleIdStrategy = 'unique' | 'trip' | 'entity' | 'index';

/** A `vehicle.id` the feed reused across more than one vehicle. */
export interface DuplicateVehicleId {
  vehicleId: string;
  count: number;
}

export interface EndpointStatus {
  name: RealtimeEndpointName;
  url: string;
  inFlight: boolean;
  /** Wall-clock of the last completed fetch, success or failure. */
  lastFetchedAt: number | null;
  lastSuccessAt: number | null;
  /** FeedHeader.timestamp — the age of the *data*, not of the fetch. */
  feedTimestamp: number | null;
  header: RawFeedHeader | null;
  entityCount: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  /** True until the endpoint has completed one fetch. */
  neverFetched: boolean;
  /**
   * Vehicles endpoint only: which key-derivation rule the last payload forced,
   * and the `vehicle.id` values it reused. Null/empty on the other two
   * endpoints and until the first vehicles fetch.
   */
  vehicleIdStrategy: VehicleIdStrategy | null;
  vehiclesDuplicateIds: DuplicateVehicleId[];
}

export interface FeedStatus {
  endpoints: Record<RealtimeEndpointName, EndpointStatus>;
  intervalMs: number;
  nextPollAt: number | null;
}

/** Detail of the `fetchstart` event. `prominent` marks bar-worthy fetches. */
export interface FetchStartDetail {
  name: RealtimeEndpointName;
  prominent: boolean;
}

const INCREMENTALITY_LABELS: Record<number, string> = {
  0: 'FULL_DATASET',
  1: 'DIFFERENTIAL',
};

function emptyStatus(name: RealtimeEndpointName, url: string): EndpointStatus {
  return {
    name,
    url,
    inFlight: false,
    lastFetchedAt: null,
    lastSuccessAt: null,
    feedTimestamp: null,
    header: null,
    entityCount: null,
    lastError: null,
    lastErrorAt: null,
    neverFetched: true,
    vehicleIdStrategy: null,
    vehiclesDuplicateIds: [],
  };
}

/**
 * Polls the three GTFS-RT endpoints and records the outcome of every fetch.
 *
 * Unlike a bare `setInterval`, the poll chain reschedules only once the current
 * poll has settled — a feed slower than the interval must not stack requests.
 */
export class GTFSRealtime extends EventTarget {
  private status: FeedStatus;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  // Kept alongside the timer so a changed interval can re-arm the pending sleep
  // instead of waiting the old one out.
  private pendingWake: (() => void) | null = null;
  private lastPollAt: number | null = null;

  constructor(
    urls: Partial<Record<RealtimeEndpointName, string>>,
    intervalMs: number = CONFIG.RT_INTERVAL_DEFAULT_MS,
  ) {
    super();
    this.status = {
      endpoints: {
        vehicles: emptyStatus('vehicles', urls.vehicles ?? ''),
        tripUpdates: emptyStatus('tripUpdates', urls.tripUpdates ?? ''),
        alerts: emptyStatus('alerts', urls.alerts ?? ''),
      },
      intervalMs,
      nextPollAt: null,
    };
  }

  getStatus(): FeedStatus {
    return this.status;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.pollLoop();
  }

  stop(): void {
    this.running = false;
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.pendingWake = null;
    this.status.nextPollAt = null;
    this.emitStatusChange();
  }

  /**
   * Change the poll interval, re-arming any sleep already in progress so the
   * new rate takes effect now rather than after the old one elapses.
   */
  setIntervalMs(intervalMs: number): void {
    this.status.intervalMs = intervalMs;

    if (this.pendingWake !== null && this.lastPollAt !== null) {
      const wake = this.pendingWake;
      if (this.timeoutId !== null) clearTimeout(this.timeoutId);
      const remaining = Math.max(0, this.lastPollAt + intervalMs - Date.now());
      this.status.nextPollAt = Date.now() + remaining;
      this.timeoutId = setTimeout(wake, remaining);
    }

    this.emitStatusChange();
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      await Promise.allSettled(REALTIME_ENDPOINTS.map(n => this.fetchEndpoint(n)));
      if (!this.running) break;
      this.lastPollAt = Date.now();
      this.status.nextPollAt = this.lastPollAt + this.status.intervalMs;
      this.emitStatusChange();
      await new Promise<void>(resolve => {
        this.pendingWake = resolve;
        this.timeoutId = setTimeout(resolve, this.status.intervalMs);
      });
      this.pendingWake = null;
    }
  }

  private async fetchEndpoint(name: RealtimeEndpointName): Promise<void> {
    const ep = this.status.endpoints[name];
    if (!ep.url || ep.inFlight) return;

    // Only a first fetch or a retry after an error is worth the loading bar;
    // steady-state polls would make it flash every interval.
    const prominent = ep.neverFetched || ep.lastError !== null;
    ep.inFlight = true;
    this.emitStatusChange();
    this.dispatchEvent(
      new CustomEvent<FetchStartDetail>('fetchstart', { detail: { name, prominent } }),
    );

    try {
      const feed = await decodeFeed(ep.url);
      ep.lastError = null;
      ep.lastSuccessAt = Date.now();
      ep.entityCount = feed.entity.length;
      ep.header = readHeader(feed.header);
      ep.feedTimestamp = ep.header.timestamp;
      this.emitPayload(name, feed);
    } catch (err) {
      // The previous payload is deliberately left in place: a transient error
      // should not blank the map.
      ep.lastError = err instanceof Error ? err.message : String(err);
      ep.lastErrorAt = Date.now();
    } finally {
      ep.inFlight = false;
      ep.neverFetched = false;
      ep.lastFetchedAt = Date.now();
      this.emitStatusChange();
      this.dispatchEvent(new CustomEvent<RealtimeEndpointName>('fetchend', { detail: name }));
    }
  }

  private emitPayload(name: RealtimeEndpointName, feed: transit_realtime.FeedMessage): void {
    if (name === 'vehicles') {
      // Collect first: the key derivation needs every entity's vehicle.id up
      // front, since uniqueness is only knowable after seeing them all.
      const rows: { entity: transit_realtime.IFeedEntity; v: transit_realtime.IVehiclePosition }[] =
        [];
      for (const entity of feed.entity) {
        const v = entity.vehicle;
        if (!v?.position) continue;
        rows.push({ entity, v });
      }

      const { keys, strategy, duplicates } = deriveVehicleKeys(
        rows.map(({ entity, v }) => ({
          vid: v.vehicle?.id ?? '',
          tripId: v.trip?.tripId ?? '',
          startDate: v.trip?.startDate ?? '',
          entityId: entity.id,
        })),
      );

      const ep = this.status.endpoints.vehicles;
      ep.vehicleIdStrategy = strategy;
      ep.vehiclesDuplicateIds = duplicates;

      const positions: VehiclePosition[] = rows.map(({ entity, v }, i) => ({
        // `key` is test-track's own instance handle; `vehicleId` is the feed's
        // own `vehicle.id`, verbatim (empty stays empty). See Plan 06 Root cause D.
        key: keys[i],
        vehicleId: v.vehicle?.id ?? '',
        entityId: entity.id,
        label: v.vehicle?.label ?? undefined,
        lat: v.position!.latitude,
        lon: v.position!.longitude,
        bearing: present(v.position!, 'bearing', v.position!.bearing),
        speed: present(v.position!, 'speed', v.position!.speed),
        tripId: v.trip?.tripId ?? undefined,
        routeId: v.trip?.routeId ?? undefined,
        directionId: v.trip
          ? present(v.trip, 'directionId', v.trip.directionId)?.toString()
          : undefined,
        startDate: v.trip?.startDate ?? undefined,
        startTime: v.trip?.startTime ?? undefined,
        scheduleRelationship: v.trip
          ? present(v.trip, 'scheduleRelationship', v.trip.scheduleRelationship)
          : undefined,
        currentStopSequence: present(v, 'currentStopSequence', v.currentStopSequence),
        stopId: present(v, 'stopId', v.stopId),
        currentStatus: present(v, 'currentStatus', v.currentStatus),
        occupancyStatus: present(v, 'occupancyStatus', v.occupancyStatus),
        timestamp: presentNumber(v, 'timestamp'),
        raw: transit_realtime.VehiclePosition.toObject(v as transit_realtime.VehiclePosition, {
          longs: Number,
          enums: String,
          defaults: false,
        }),
      }));
      this.dispatchEvent(new CustomEvent<VehiclePosition[]>('vehicles', { detail: positions }));
    } else if (name === 'tripUpdates') {
      const updates = feed.entity.flatMap(e => (e.tripUpdate ? [e.tripUpdate] : []));
      this.dispatchEvent(new CustomEvent<TripUpdate[]>('tripUpdates', { detail: updates }));
    } else {
      const alerts = feed.entity.flatMap(e =>
        e.alert
          ? [
              {
                id: e.id,
                alert: e.alert,
                raw: transit_realtime.Alert.toObject(e.alert as transit_realtime.Alert, {
                  longs: Number,
                  enums: String,
                  defaults: false,
                }),
              },
            ]
          : [],
      );
      this.dispatchEvent(new CustomEvent<AlertRecord[]>('alerts', { detail: alerts }));
    }
  }

  private emitStatusChange(): void {
    this.dispatchEvent(new CustomEvent<FeedStatus>('statuschange', { detail: this.status }));
  }
}

/** Throws with a distinguishable message on HTTP vs decode failure. */
async function decodeFeed(url: string): Promise<transit_realtime.FeedMessage> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    throw new Error(describeNetworkError(url, err));
  }
  if (!res.ok) {
    // A proxy refusal explains itself in the body; read it before discarding.
    const body = await res.text().catch(() => '');
    throw new Error(describeHttpError(url, res.status, res.statusText, body));
  }

  const buf = await res.arrayBuffer();
  try {
    return transit_realtime.FeedMessage.decode(new Uint8Array(buf));
  } catch (err) {
    throw new Error(`Decode failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function readHeader(header: transit_realtime.IFeedHeader | null | undefined): RawFeedHeader {
  // `timestamp` arrives as a protobuf Long, not a JS number.
  const ts = header?.timestamp;
  return {
    gtfsRealtimeVersion: header?.gtfsRealtimeVersion ?? '',
    incrementality: INCREMENTALITY_LABELS[header?.incrementality ?? 0] ?? String(header?.incrementality ?? ''),
    timestamp: ts === null || ts === undefined ? null : Number(ts),
  };
}

interface VehicleIdInput {
  vid: string;
  tripId: string;
  startDate: string;
  entityId: string;
}

/**
 * Derive a unique per-vehicle instance key for each entity, reporting which
 * rule the feed forced (Plan 06 Root cause D). The four rules, applied only to
 * entities that are still colliding at each level:
 *
 *   1. `vehicle.id` alone — the no-op path a well-formed feed (unique,
 *      non-empty ids) takes. `key === vehicleId` and nothing changes.
 *   2. `vehicle.id # trip_id : start_date` — Amtrak's 53 trains sharing one id
 *      separate here, since `start_date` disambiguates a >24h daily train.
 *   3. …append `entity.id`.
 *   4. …append the entity index. Guarantees uniqueness for a feed with no
 *      usable identity at all.
 *
 * `entity.id` is ranked below the trip composite deliberately: for some feeds
 * it is a reshuffling scan counter, unstable across polls, and `key` must be
 * stable or focus/follow break every poll.
 */
function deriveVehicleKeys(entities: VehicleIdInput[]): {
  keys: string[];
  strategy: VehicleIdStrategy;
  duplicates: DuplicateVehicleId[];
} {
  const keyAt = (e: VehicleIdInput, rule: number): string => {
    switch (rule) {
      case 1:
        return e.vid;
      case 2:
        return `${e.vid}#${e.tripId}:${e.startDate}`;
      case 3:
        return `${e.vid}#${e.tripId}:${e.startDate}#${e.entityId}`;
      default:
        return e.vid; // index appended by the caller
    }
  };

  const keys = entities.map(e => e.vid);
  const strategyNames: VehicleIdStrategy[] = ['unique', 'trip', 'entity', 'index'];
  let strategyLevel = 0;

  // A key is unresolved when it is empty (no usable id) or shared with another.
  const unresolved = (): number[] => {
    const count = new Map<string, number>();
    for (const k of keys) count.set(k, (count.get(k) ?? 0) + 1);
    const out: number[] = [];
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] === '' || count.get(keys[i])! > 1) out.push(i);
    }
    return out;
  };

  for (let rule = 1; rule <= 3; rule++) {
    const bad = unresolved();
    if (bad.length === 0) break;
    const target = rule + 1; // escalate to 2 (trip), 3 (entity), or 4 (index)
    for (const i of bad) {
      keys[i] =
        target <= 3 ? keyAt(entities[i], target) : `${keyAt(entities[i], 3)}#${i}`;
    }
    strategyLevel = Math.max(strategyLevel, target - 1);
  }

  // Duplicate report is about the feed's own ids, not the derived keys: which
  // non-empty vehicle.id values were reused across more than one vehicle.
  const vidCount = new Map<string, number>();
  for (const e of entities) {
    if (e.vid) vidCount.set(e.vid, (vidCount.get(e.vid) ?? 0) + 1);
  }
  const duplicates: DuplicateVehicleId[] = [];
  for (const [vehicleId, count] of vidCount) {
    if (count > 1) duplicates.push({ vehicleId, count });
  }
  duplicates.sort((a, b) => b.count - a.count);

  return { keys, strategy: strategyNames[strategyLevel], duplicates };
}
