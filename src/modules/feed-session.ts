import { CONFIG } from '../config';
import { GTFSStatic } from '../gtfs-static';
import { GTFSRealtime } from '../gtfs-rt';
import type { AlertRecord, FeedStatus, FetchStartDetail, TripUpdate } from '../gtfs-rt';
import type { VehiclePosition } from '../map-controller';
import { adoptFeedTimezone } from './feed-time';
import { feedProgressIndicator } from './feed-progress-indicator';
import { downloadPercent, formatBytes, LoadCancelledError } from './feed-download';
import type { FeedSelection, RealtimeEndpointName, ScheduledSource } from './feed-selection';
import {
  REALTIME_ENDPOINT_LABELS,
  isComplete,
  resolvedRealtimeUrls,
  resolvedScheduledUrl,
} from './feed-selection';

/**
 * The remembered poll interval, or the default. Anything not on the offered
 * menu is discarded — the dropdown could never show it back to the user.
 */
function readStoredIntervalMs(): number {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(CONFIG.RT_INTERVAL_KEY);
  } catch {
    // Storage unavailable; fall through to the default.
  }
  const parsed = Number(stored);
  return (CONFIG.RT_INTERVAL_OPTIONS_MS as readonly number[]).includes(parsed)
    ? parsed
    : CONFIG.RT_INTERVAL_DEFAULT_MS;
}

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

  private intervalMs = readStoredIntervalMs();

  get status(): FeedStatus | null {
    return this.poller?.getStatus() ?? null;
  }

  /** Load a complete selection: static first, then start the RT poller. */
  async load(selection: FeedSelection): Promise<void> {
    if (!isComplete(selection)) {
      throw new Error('Selection is incomplete');
    }
    const previous = this.selection;
    this.selection = selection;
    try {
      await this.loadStatic(selection.scheduled!);
    } catch (err) {
      // A cancelled load leaves the session exactly as it was.
      if (err instanceof LoadCancelledError) {
        this.selection = previous;
      }
      throw err;
    }
    this.startPoller(selection);
    this.emitChange();
  }

  /**
   * Unload everything: stop polling, drop both feeds, forget the selection.
   *
   * Deliberately does not dispatch `staticloaded` — there is no feed to load,
   * and the listener that revalidates the focus would run against an empty
   * session. The caller clears the focus and repaints the map itself.
   */
  clear(): void {
    this.poller?.stop();
    this.poller = null;
    this.selection = null;
    this.staticFeed = null;
    this.staticError = null;
    this.staticLoadedAt = null;
    this.rtCounts = { vehicles: 0, tripUpdates: 0, alerts: 0 };
    this.vehicles = new Map();
    this.alerts = new Map();
    this.tripUpdates = [];
    this.emitChange();
  }

  /** Re-run the current selection from scratch: static download plus a fresh poller. */
  async reload(): Promise<void> {
    if (!this.selection) return;
    await this.load(this.selection);
  }

  /** The RT poll interval, remembered per-device across loads and sessions. */
  get pollIntervalMs(): number {
    return this.intervalMs;
  }

  setPollIntervalMs(intervalMs: number): void {
    this.intervalMs = intervalMs;
    try {
      localStorage.setItem(CONFIG.RT_INTERVAL_KEY, String(intervalMs));
    } catch {
      // Private browsing or a full quota — the interval still applies this session.
    }
    this.poller?.setIntervalMs(intervalMs);
    this.emitChange();
  }

  private async loadStatic(source: ScheduledSource): Promise<void> {
    const feed = new GTFSStatic();
    const label = source.label;

    // Download and parse are separate operations so the bar shows real byte
    // progress first, then per-file parse progress.
    let parsing = false;
    const hooks = {
      onDownload: (loaded: number, total: number | null) => {
        feedProgressIndicator.updateProgress(
          'static-download',
          downloadPercent(loaded, total) ?? 0,
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

    // A file upload has no fetch to abort, so it gets no Cancel button.
    const controller = source.kind === 'file' ? null : new AbortController();
    feedProgressIndicator.startLoading(
      'static-download',
      `Downloading ${label}…`,
      controller ? { onCancel: () => controller.abort() } : {},
    );
    try {
      if (source.kind === 'file') {
        await feed.loadFromFile(source.file, hooks);
      } else {
        await feed.loadFromUrl(resolvedScheduledUrl(source), {
          ...hooks,
          signal: controller!.signal,
        });
      }
      this.staticFeed = feed;
      // Every transit time rendered from here on is anchored to this feed's zone.
      adoptFeedTimezone(feed);
      this.staticError = null;
      this.staticLoadedAt = Date.now();
      this.dispatchEvent(new CustomEvent<GTFSStatic>('staticloaded', { detail: feed }));
    } catch (err) {
      // A cancel is not a feed error: the previously loaded feed stays live.
      if (!(err instanceof LoadCancelledError)) {
        this.staticError = err instanceof Error ? err.message : String(err);
      }
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

    const poller = new GTFSRealtime(resolvedRealtimeUrls(selection.realtime!), this.intervalMs);
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
