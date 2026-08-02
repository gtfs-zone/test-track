import { transit_realtime } from 'gtfs-realtime-bindings';
import type { VehiclePosition } from './map-controller';
import type { RealtimeEndpointName } from './modules/feed-selection';
import { REALTIME_ENDPOINTS } from './modules/feed-selection';

export type TripUpdate = transit_realtime.ITripUpdate;
export type ServiceAlert = transit_realtime.IAlert;

/** Verbatim FeedHeader fields, for the status page's raw dump. */
export interface RawFeedHeader {
  gtfsRealtimeVersion: string;
  incrementality: string;
  timestamp: number | null;
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

  constructor(
    urls: Partial<Record<RealtimeEndpointName, string>>,
    intervalMs = 15000,
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
    this.status.nextPollAt = null;
    this.emitStatusChange();
  }

  setIntervalMs(intervalMs: number): void {
    this.status.intervalMs = intervalMs;
    this.emitStatusChange();
  }

  /** Point an endpoint somewhere new. Pass '' to disable it. */
  setEndpointUrl(name: RealtimeEndpointName, url: string): void {
    const ep = this.status.endpoints[name];
    ep.url = url;
    ep.lastError = null;
    ep.lastErrorAt = null;
    ep.neverFetched = true;
    this.emitStatusChange();
  }

  /** Re-fetch one endpoint immediately, without disturbing the poll chain. */
  async refreshEndpoint(name: RealtimeEndpointName): Promise<void> {
    await this.fetchEndpoint(name, true);
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      await Promise.allSettled(REALTIME_ENDPOINTS.map(n => this.fetchEndpoint(n)));
      if (!this.running) break;
      this.status.nextPollAt = Date.now() + this.status.intervalMs;
      this.emitStatusChange();
      await new Promise<void>(resolve => {
        this.timeoutId = setTimeout(resolve, this.status.intervalMs);
      });
    }
  }

  private async fetchEndpoint(
    name: RealtimeEndpointName,
    forceProminent = false,
  ): Promise<void> {
    const ep = this.status.endpoints[name];
    if (!ep.url || ep.inFlight) return;

    // Only a first fetch or a retry after an error is worth the loading bar;
    // steady-state polls would make it flash every interval.
    const prominent = forceProminent || ep.neverFetched || ep.lastError !== null;
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
      const positions: VehiclePosition[] = [];
      for (const entity of feed.entity) {
        const v = entity.vehicle;
        if (!v?.position) continue;
        positions.push({
          id: entity.id,
          lat: v.position.latitude,
          lon: v.position.longitude,
          bearing: v.position.bearing ?? undefined,
          tripId: v.trip?.tripId ?? undefined,
          routeId: v.trip?.routeId ?? undefined,
        });
      }
      this.dispatchEvent(new CustomEvent<VehiclePosition[]>('vehicles', { detail: positions }));
    } else if (name === 'tripUpdates') {
      const updates = feed.entity.flatMap(e => (e.tripUpdate ? [e.tripUpdate] : []));
      this.dispatchEvent(new CustomEvent<TripUpdate[]>('tripUpdates', { detail: updates }));
    } else {
      const alerts = feed.entity.flatMap(e => (e.alert ? [e.alert] : []));
      this.dispatchEvent(new CustomEvent<ServiceAlert[]>('alerts', { detail: alerts }));
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
    throw new Error(`Network error: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());

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
