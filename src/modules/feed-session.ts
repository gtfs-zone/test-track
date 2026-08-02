import { GTFSStatic } from '../gtfs-static';
import { GTFSRealtime } from '../gtfs-rt';
import type { AlertRecord, FeedStatus, FetchStartDetail, TripUpdate } from '../gtfs-rt';
import type { VehiclePosition } from '../map-controller';
import { feedProgressIndicator } from './feed-progress-indicator';
import { notify } from './notification-system';
import type { FeedSelection, RealtimeEndpointName, StaticSource } from './feed-selection';
import {
  REALTIME_ENDPOINT_LABELS,
  isComplete,
  resolvedRealtimeUrls,
  resolvedStaticUrl,
} from './feed-selection';

export interface RealtimeCounts {
  vehicles: number;
  tripUpdates: number;
  alerts: number;
}

/**
 * Owns the loaded feeds: the static dataset, the RT poller, and the selection
 * they came from. Everything that loads a feed goes through here so there is a
 * single place that reports progress and a single place the status page reads.
 *
 * Re-dispatches the poller's payload events, so consumers (map, alerts modal,
 * status page) never have to re-subscribe when the poller is replaced.
 */
export class FeedSession extends EventTarget {
  selection: FeedSelection | null = null;
  staticFeed: GTFSStatic | null = null;
  poller: GTFSRealtime | null = null;
  rtCounts: RealtimeCounts = { vehicles: 0, tripUpdates: 0, alerts: 0 };
  staticError: string | null = null;
  staticLoadedAt: number | null = null;

  // Latest decoded payloads, kept so a focused object can be resolved by id
  // without waiting for the next poll. Replaced wholesale on each poll.
  vehicles = new Map<string, VehiclePosition>();
  alerts = new Map<string, AlertRecord>();
  tripUpdates: TripUpdate[] = [];

  get status(): FeedStatus | null {
    return this.poller?.getStatus() ?? null;
  }

  /** Load a complete selection: static first, then start the RT poller. */
  async load(selection: FeedSelection): Promise<void> {
    if (!isComplete(selection)) {
      throw new Error('Selection is incomplete');
    }
    this.selection = selection;
    await this.loadStatic(selection.static!);
    this.startPoller(selection);
    this.emitChange();
  }

  /** Re-run the static load with a new URL, leaving the RT poller alone. */
  async applyStaticUrl(url: string, useCors: boolean): Promise<void> {
    if (!this.selection) return;
    const next: StaticSource = { kind: 'url', url, useCors, label: this.selection.static?.label ?? 'Static feed' };
    await this.loadStatic(next);
    this.selection.static = next;
    this.emitChange();
  }

  /**
   * Point one RT endpoint somewhere new and fetch it once.
   *
   * The new URL is validated by that fetch before the poller keeps it, so a
   * typo cannot silently kill a working endpoint — on failure the endpoint is
   * restored to its previous URL.
   */
  async applyRealtimeUrl(name: RealtimeEndpointName, url: string): Promise<void> {
    const poller = this.poller;
    if (!poller || !this.selection?.realtime) return;

    const previous = poller.getStatus().endpoints[name].url;
    poller.setEndpointUrl(name, url);
    await poller.refreshEndpoint(name);

    const ep = poller.getStatus().endpoints[name];
    if (url && ep.lastError) {
      poller.setEndpointUrl(name, previous);
      notify.error(`${REALTIME_ENDPOINT_LABELS[name]} not updated: ${ep.lastError}`);
      this.emitChange();
      return;
    }

    // Store the un-proxied URL on the selection; the poller holds the resolved one.
    const rt = this.selection.realtime;
    if (name === 'vehicles') rt.vehiclesUrl = url || undefined;
    else if (name === 'tripUpdates') rt.tripUpdatesUrl = url || undefined;
    else rt.alertsUrl = url || undefined;
    this.emitChange();
  }

  /** Force an immediate poll of every endpoint. */
  async refreshAll(): Promise<void> {
    const poller = this.poller;
    if (!poller) return;
    await Promise.allSettled(
      (Object.keys(poller.getStatus().endpoints) as RealtimeEndpointName[])
        .map(name => poller.refreshEndpoint(name)),
    );
  }

  private async loadStatic(source: StaticSource): Promise<void> {
    const feed = new GTFSStatic();
    const label = source.label;

    // Download and parse are separate operations so the bar shows real byte
    // progress first, then per-file parse progress.
    let parsing = false;
    const hooks = {
      onDownload: (loaded: number, total: number | null) => {
        feedProgressIndicator.updateProgress(
          'static-download',
          total ? Math.round((loaded / total) * 100) : 0,
          total
            ? `Downloading ${label} — ${formatBytes(loaded)} of ${formatBytes(total)}`
            : `Downloading ${label} — ${formatBytes(loaded)}`,
        );
      },
      onParse: (fileName: string, done: number, total: number) => {
        if (!parsing) {
          parsing = true;
          feedProgressIndicator.finishLoading('static-download');
          feedProgressIndicator.startLoading('static-parse', `Parsing ${label}…`);
        }
        feedProgressIndicator.updateProgress(
          'static-parse',
          Math.round((done / total) * 100),
          `Parsing ${label} — ${fileName}`,
        );
      },
    };

    feedProgressIndicator.startLoading('static-download', `Downloading ${label}…`);
    try {
      if (source.kind === 'file') {
        await feed.loadFromFile(source.file, hooks);
      } else {
        await feed.loadFromUrl(resolvedStaticUrl(source), hooks);
      }
      this.staticFeed = feed;
      this.staticError = null;
      this.staticLoadedAt = Date.now();
      this.dispatchEvent(new CustomEvent<GTFSStatic>('staticloaded', { detail: feed }));
    } catch (err) {
      this.staticError = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      feedProgressIndicator.finishLoading('static-download');
      feedProgressIndicator.finishLoading('static-parse');
      this.emitChange();
    }
  }

  private startPoller(selection: FeedSelection): void {
    this.poller?.stop();
    this.rtCounts = { vehicles: 0, tripUpdates: 0, alerts: 0 };
    this.vehicles = new Map();
    this.alerts = new Map();
    this.tripUpdates = [];

    const poller = new GTFSRealtime(resolvedRealtimeUrls(selection.realtime!));
    this.poller = poller;

    poller.addEventListener('fetchstart', e => {
      const { name, prominent } = (e as CustomEvent<FetchStartDetail>).detail;
      if (prominent) {
        feedProgressIndicator.startLoading(
          `rt-${name}`,
          `Fetching ${REALTIME_ENDPOINT_LABELS[name]}…`,
        );
      }
    });
    poller.addEventListener('fetchend', e => {
      feedProgressIndicator.finishLoading(`rt-${(e as CustomEvent<RealtimeEndpointName>).detail}`);
    });
    poller.addEventListener('statuschange', () => this.emitChange());

    poller.addEventListener('vehicles', e => {
      const detail = (e as CustomEvent<VehiclePosition[]>).detail;
      this.rtCounts.vehicles = detail.length;
      this.vehicles = new Map(detail.map(v => [v.key, v]));
      // Keys are derived to be unique, so the map must not lose anything. A
      // mismatch means the derivation collapsed two vehicles onto one key.
      if (import.meta.env.DEV && this.vehicles.size !== detail.length) {
        console.warn(
          `[FeedSession] vehicle key collision: ${detail.length} payload vehicles, ${this.vehicles.size} distinct keys`,
        );
      }
      this.dispatchEvent(new CustomEvent<VehiclePosition[]>('vehicles', { detail }));
    });
    poller.addEventListener('tripUpdates', e => {
      const detail = (e as CustomEvent<TripUpdate[]>).detail;
      this.rtCounts.tripUpdates = detail.length;
      this.tripUpdates = detail;
      this.dispatchEvent(new CustomEvent<TripUpdate[]>('tripUpdates', { detail }));
    });
    poller.addEventListener('alerts', e => {
      const detail = (e as CustomEvent<AlertRecord[]>).detail;
      this.rtCounts.alerts = detail.length;
      this.alerts = new Map(detail.map(a => [a.id, a]));
      this.dispatchEvent(new CustomEvent<AlertRecord[]>('alerts', { detail }));
    });

    poller.start();
  }

  private emitChange(): void {
    this.dispatchEvent(new Event('change'));
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
