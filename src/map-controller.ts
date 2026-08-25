import maplibregl from 'maplibre-gl';
import { CONFIG } from './config';
import type { GTFSScheduled } from './gtfs-scheduled';
import type { PageState } from './types/page-state';
import { BasemapControl, initialMapStyle } from './modules/basemap-control';
import type { MapAppearance } from './modules/basemap-control';
import { LayerManager } from './modules/layer-manager';
import type { MapDataIssues } from './modules/layer-manager';

export interface VehiclePosition {
  /**
   * test-track's own internal instance handle: the map feature id, the key in
   * `FeedSession.vehicles`, and the `vehicle_id` URL param. Derived to be unique
   * per vehicle even when the feed's `vehicle.id` is not (Plan 06 Root cause D).
   * When the feed's ids are already unique, `key === vehicleId`.
   */
  key: string;
  /**
   * The feed's `vehicle.id`, **verbatim** — duplicated, empty, whatever the feed
   * said. This is reportage, never plumbing: it is what the vehicle page shows
   * and dumps, and never synthesized.
   */
  vehicleId: string;
  entityId: string;
  label?: string;
  lat: number;
  lon: number;
  bearing?: number;
  /** Metres per second, as the spec defines it. */
  speed?: number;
  tripId?: string;
  routeId?: string;
  directionId?: string;
  startDate?: string;
  startTime?: string;
  /**
   * The GTFS `stop_sequence` value of the stop the vehicle is working on — not
   * an index into the trip's stop list. Absent in many feeds, which is why the
   * route strip has an "unplaced vehicles" section.
   */
  currentStopSequence?: number;
  /** `stop_id` of the same stop, when the feed reports it. */
  stopId?: string;
  /** VehicleStopStatus: 0 INCOMING_AT, 1 STOPPED_AT, 2 IN_TRANSIT_TO. */
  currentStatus?: number;
  occupancyStatus?: number;
  /** Seconds since epoch, per the spec. Stale values are worth surfacing. */
  timestamp?: number;
  /** The decoded entity, kept verbatim for the vehicle page's raw dump. */
  raw: unknown;
}

interface MapView {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

const DEFAULT_VIEW: MapView = { center: [0, 30], zoom: 2, bearing: 0, pitch: 0 };

/**
 * Map view and appearance live in localStorage rather than the URL: they are
 * per-device preferences, not part of what a shared link describes (Plan 03).
 */
function readStored<T>(key: string): Partial<T> | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing / quota — appearance simply won't persist.
  }
}

function restoreView(): MapView {
  const stored = readStored<MapView>(CONFIG.MAP_VIEW_KEY);
  if (
    !stored ||
    !Array.isArray(stored.center) ||
    stored.center.length !== 2 ||
    !stored.center.every(Number.isFinite) ||
    typeof stored.zoom !== 'number'
  ) {
    return DEFAULT_VIEW;
  }
  return {
    center: stored.center as [number, number],
    zoom: stored.zoom,
    bearing: stored.bearing ?? 0,
    pitch: stored.pitch ?? 0,
  };
}

export class MapController {
  private map!: maplibregl.Map;
  private layers!: LayerManager;
  private basemap!: BasemapControl;
  private resizeTimeout: ReturnType<typeof setTimeout> | null = null;
  private viewSaveTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Height of the mobile bottom sheet, kept out of the camera's way. */
  private bottomPadding = 0;

  /**
   * Flips true exactly once, on the first `load`, and never back. Work issued
   * before that point is queued and flushed in order; nothing else consults
   * `map.loaded()`, which goes false on every dirty frame and would silently
   * drop map updates issued mid-repaint (see Plan 06 Root cause A).
   */
  private ready = false;
  private pending: Array<() => void> = [];

  /**
   * The vehicle key currently being followed, or null. Focusing a vehicle
   * enters follow mode; each `vehicles` payload re-centres on its new position
   * until the user takes the camera back (see the gesture listeners in
   * `initialize`). Focusing anything else — including home and alert — leaves
   * follow mode.
   */
  private following: string | null = null;

  /** Called when the user clicks a stop, route, or vehicle on the map. */
  onSelect: ((state: PageState) => void) | null = null;

  /** Called when the user clicks the map away from any feature. */
  onEmptySelect: (() => void) | null = null;

  initialize(container: string): void {
    const view = restoreView();
    const appearance = readStored<MapAppearance>(CONFIG.MAP_APPEARANCE_KEY) ?? {};

    this.map = new maplibregl.Map({
      container,
      style: initialMapStyle(appearance),
      center: view.center,
      zoom: view.zoom,
      bearing: view.bearing,
      pitch: view.pitch,
    });
    // Bottom-left is the only free corner: `#map-controls` covers the top strip
    // and the basemap FAB owns bottom-right.
    this.map.addControl(new maplibregl.NavigationControl(), 'bottom-left');

    this.layers = new LayerManager(this.map);
    this.layers.onSelect = target => {
      switch (target.kind) {
        case 'stop':
          this.onSelect?.({ type: 'stop', stop_id: target.id });
          break;
        case 'route':
          this.onSelect?.({ type: 'route', route_id: target.id });
          break;
        case 'vehicle':
          this.onSelect?.({ type: 'vehicle', vehicle_id: target.id });
          break;
      }
    };
    this.layers.onEmptySelect = () => this.onEmptySelect?.();

    this.basemap = new BasemapControl(this.map, {
      initial: appearance,
      onRenderModeChange: mode => this.layers.setShapeMode(mode),
      onAppearanceChange: next => writeStored(CONFIG.MAP_APPEARANCE_KEY, next),
    });
    this.layers.setShapeMode(this.basemap.getShapeMode());

    this.map.once('load', () => {
      this.layers.rebuild();
      this.layers.attachInteraction();
      this.ready = true;
      const queued = this.pending;
      this.pending = [];
      for (const fn of queued) fn();
    });

    // setStyle drops every source and layer we own, so each basemap or
    // projection change has to re-add them. This is the single highest-risk
    // path in the map: without it, switching basemaps blanks all GTFS data.
    this.map.on('basemap:changed', () => this.layers.rebuild());

    this.map.on('moveend', () => this.queueViewSave());

    // A user-initiated camera gesture unlocks follow permanently for the
    // current focus. Our own programmatic easeTo/fitBounds carry no
    // `originalEvent`, which is exactly what distinguishes them from a real
    // drag/scroll/rotate/pitch — so the follow ease itself never unlocks.
    for (const type of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'] as const) {
      this.map.on(type, e => {
        if ((e as { originalEvent?: unknown }).originalEvent) this.following = null;
      });
    }
  }

  /** Feed problems the map found, for the status page. */
  get issues(): MapDataIssues {
    return this.layers.issues;
  }

  private queueViewSave(): void {
    if (this.viewSaveTimeout) clearTimeout(this.viewSaveTimeout);
    this.viewSaveTimeout = setTimeout(() => {
      const center = this.map.getCenter();
      writeStored(CONFIG.MAP_VIEW_KEY, {
        center: [center.lng, center.lat],
        zoom: this.map.getZoom(),
        bearing: this.map.getBearing(),
        pitch: this.map.getPitch(),
      } satisfies MapView);
      this.viewSaveTimeout = null;
    }, CONFIG.MAP_VIEW_SAVE_DEBOUNCE);
  }

  private whenLoaded(fn: () => void): void {
    if (this.ready) fn();
    else this.pending.push(fn);
  }

  loadScheduledFeed(feed: GTFSScheduled): void {
    this.whenLoaded(() => {
      this.layers.setScheduledFeed(feed);
      this.fitFeed();
    });
  }

  clearScheduledFeed(): void {
    this.whenLoaded(() => this.layers.setScheduledFeed(null));
  }

  showVehicles(positions: VehiclePosition[]): void {
    this.whenLoaded(() => {
      this.layers.setVehicles(positions);
      // Follow: re-centre on the followed vehicle's new position. If it has
      // left the feed, leave the camera where it is — the vehicle page keeps a
      // lastSeen fallback.
      if (this.following) {
        const v = positions.find(p => p.key === this.following);
        if (v) {
          this.map.easeTo({
            center: [v.lon, v.lat],
            duration: CONFIG.FOLLOW_DURATION,
            essential: true,
          });
        }
      }
    });
  }

  clearVehicles(): void {
    this.whenLoaded(() => this.layers.setVehicles([]));
  }

  /**
   * Frame the loaded feed. Every schedule load refits, reloads included: the old
   * "camera is already inside the bbox" bail-out skipped the fit whenever the
   * stored view happened to sit in the new feed's box, and the only thing that
   * framed the feed after that was a click-in/click-out returning focus to home.
   *
   * Instant, with no duration: on the boot path a deep link's focus ease runs
   * right after this and would visibly interrupt an animated fit.
   */
  private fitFeed(): void {
    const bounds = this.layers.stopsBounds();
    if (!bounds) return;
    this.map.fitBounds(bounds, { padding: this.padding() });
  }

  private padding(): maplibregl.PaddingOptions {
    return { top: 40, left: 40, right: 40, bottom: 40 + this.bottomPadding };
  }

  /**
   * Reserve space at the bottom of the map for the mobile bottom sheet, so a
   * focused feature isn't hidden behind it.
   */
  setBottomPadding(px: number): void {
    this.bottomPadding = px;
  }

  // ── Focus ──────────────────────────────────────────────────────────────────

  /**
   * Highlight the focused object and move the camera to it. Called for every
   * focus change, including one restored from a link.
   */
  focus(state: PageState): void {
    this.whenLoaded(() => this.applyFocus(state));
  }

  /**
   * Light up a stop the pointer is over elsewhere in the app (a route strip
   * row). Purely visual: no camera move, no focus change, no spotlight. Not
   * wrapped in `whenLoaded` - a hover queued behind style load would fire long
   * after the pointer left.
   */
  hoverStop(stop_id: string | null): void {
    this.layers?.setHoveredStop(stop_id);
  }

  /**
   * Repaint the accent-colored map layers against the now-active theme. The
   * accent is resolved from the DaisyUI palette, so it only changes here.
   */
  refreshAccentColor(): void {
    this.layers?.refreshAccentColor();
  }

  private applyFocus(state: PageState): void {
    // Any focus that is not this same vehicle leaves follow mode.
    if (state.type !== 'vehicle') this.following = null;

    switch (state.type) {
      case 'home': {
        this.layers.setFocus(null);
        // Unfocusing frames the whole feed again, mirroring how focusing a
        // route frames that route.
        const bounds = this.layers.stopsBounds();
        if (bounds) {
          this.map.fitBounds(bounds, {
            padding: this.padding(),
            duration: CONFIG.FOCUS_BOUNDS_DURATION,
            essential: true,
          });
        }
        return;
      }

      case 'alert':
        // Alerts have no geometry of their own; nothing to highlight or fly to.
        this.layers.setFocus(null);
        return;

      case 'route': {
        this.layers.setFocus({ kind: 'route', id: state.route_id });
        const bounds = this.layers.routeBounds(state.route_id);
        if (bounds) {
          this.map.fitBounds(bounds, {
            padding: this.padding(),
            maxZoom: 15,
            duration: CONFIG.FOCUS_BOUNDS_DURATION,
            essential: true,
          });
        }
        return;
      }

      case 'stop': {
        this.layers.setFocus({ kind: 'stop', id: state.stop_id });
        this.easeToPoint(this.layers.focusPosition(state.stop_id));
        return;
      }

      case 'vehicle': {
        this.layers.setFocus({ kind: 'vehicle', id: state.vehicle_id });
        // Re-arm follow on this vehicle (a different vehicle replaces the old).
        this.following = state.vehicle_id;
        this.easeToPoint(this.layers.vehiclePosition(state.vehicle_id));
        return;
      }
    }
  }

  /**
   * Ease to a point, always. Focusing something moves the camera to it — unlike
   * the earlier "already visible" bail-out, which left the camera where it was
   * and made a panel click feel like it did nothing.
   */
  private easeToPoint(point: [number, number] | null): void {
    if (!point) return;
    this.map.easeTo({
      center: point,
      zoom: Math.max(this.map.getZoom(), CONFIG.STOP_FOCUS_ZOOM),
      padding: { top: 0, left: 0, right: 0, bottom: this.bottomPadding },
      duration: CONFIG.FOCUS_POINT_DURATION,
      essential: true,
    });
  }

  // ── Sizing ─────────────────────────────────────────────────────────────────

  /** Immediate resize — called on every frame of a panel drag. */
  resizeNow(): void {
    this.map?.resize();
  }

  /**
   * Deferred resize for after a CSS transition settles. Restores center and
   * zoom so the viewport doesn't jump when the canvas changes size.
   */
  forceMapResize(): void {
    if (!this.map) return;

    if (this.resizeTimeout) clearTimeout(this.resizeTimeout);

    this.resizeTimeout = setTimeout(() => {
      const center = this.map.getCenter();
      const zoom = this.map.getZoom();

      this.map.resize();
      this.map.setCenter(center);
      this.map.setZoom(zoom);

      this.resizeTimeout = null;
    }, 350);
  }
}
