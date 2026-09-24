/* @vendored-from coloring-book:src/modules/layer-manager.ts
   @sha 0d38e50
   @status adopted
   Promoted from `modified` in Phase 8. The shared half of this file is now
   `interlocking`'s `layer-specs.ts` (source ids, layer ids, filters, zoom ramps, fade
   bands, spotlight expressions) and `stop-layer-style.ts` (how one stop circle
   looks). What is left is this app's own half: which sources exist and what
   fills them. Upstream's remaining manager is the editor's, built on
   `GTFSParser` / IndexedDB with pathways, levels, flex zones, transfers and the
   editing affordances; re-syncing against it has stopped being meaningful, so
   the row is `adopted` and only the two spec files are checked.

   Deliberately not taken from upstream, with reasons:
   - Pathways, levels, the Tutte coord embedding for coord-less child stops,
     `stops-highlight` / `trip-highlight`, the editing affordances and
     file-highlight mode: no editor here.
   - `1dbef88` / `63af1c9` / `26b87e2` (flex zones and location groups),
     `c48eede` / `b5e30d1` / `8303357` / `dc1d421`'s transfer-edge half,
     `1528c8d` / `5b61f37` (shapes and zones via geojson.io): test-track
     ingests none of that data.
   - `69dd3f6` / `34a2750` (timetable stop focus): no timetable here.
   - The camera-ease-to-new-stop half of `7e77889`: no flow here creates a stop.

   Taken from upstream: `aff09db` (the gentler station fade band), `7e77889`
   (the small-feed fade exemption, which is the same change this repo already
   carried from `424cbdf`), `dc1d421`'s hovered-stop highlight, `767ac02`'s
   deduped focused expression, and `cef96c7`'s direction arrows on the single
   spotlighted route, which is what gives `interlocking`'s `map-icons.ts` a caller. */

import type maplibregl from 'maplibre-gl';
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
} from 'maplibre-gl';
import { CONFIG } from '../config';
import type { GTFSScheduled } from 'interlocking/gtfs/scheduled';
import type { VehiclePosition } from 'interlocking/gtfs/rt-types';
import { routeSortKey } from 'interlocking/gtfs/route-sort';
import { casingColor } from 'interlocking/gtfs/route-colors';
import { clearThemeColorCache, resolveThemeColor } from 'interlocking/util/theme-color';
import { ensureMapIcons } from 'interlocking/map/icons';
import {
  NO_ROUTE_FILTER,
  ROUTES_CASING_LAYER,
  ROUTES_CLICKAREA_LAYER,
  ROUTES_DIRECTION_LAYER,
  ROUTES_SOURCE,
  ROUTE_CASING_WIDTH_STOPS,
  ROUTE_WIDTH_STOPS,
  STOPS_BACKGROUND_LAYER,
  STOPS_CLICKAREA_LAYER,
  STOPS_SOURCE,
  STOPS_STATION_DOT_LAYER,
  TOP_LEVEL_STOPS_FILTER,
  routeMatch,
  routeSortKeyExpression,
  routeSpotlightOpacity,
  specialStop,
  stationDotFilter,
  stationFadeOpacity,
  stopClickAreaRadius,
  stopFadeOpacity,
  zoomWidth,
  type StopFadeBands,
  type StopFeatureState,
} from 'interlocking/map/layer-specs';
import {
  STOP_FOCUS_HALO_LAYER,
  STOP_FOCUS_RING_LAYER,
  STOP_FOCUS_TOP_LAYER,
  focusHaloPaint,
  focusRingPaint,
  focusTopPaint,
  stationDotPaint,
  stopFillColor,
  stopsBackgroundPaint,
  type StopStyleOptions,
} from 'interlocking/map/stop-layer-style';

/**
 * Counts of feed data the map could not draw. Surfaced on the status page —
 * a stop with no id or a vehicle whose route doesn't exist in the schedule
 * is exactly the kind of problem this tool exists to make visible.
 */
export interface MapDataIssues {
  /** Rows in stops.txt with a blank `stop_id` — unaddressable by feature-state. */
  stopsMissingId: number;
  /** Rows in stops.txt with unparseable `stop_lat`/`stop_lon`. */
  stopsMissingCoords: number;
  /** Vehicles whose `trip.route_id` doesn't resolve against the schedule. */
  vehiclesUnmatched: number;
  /**
   * Vehicles sharing a promoted map-feature id after key derivation. Must be 0:
   * a non-zero count means the derived `key` collapsed two vehicles onto one
   * feature (the "one click highlights all of them" failure) and the derivation
   * in `gtfs-rt.ts` is broken (Plan 06 Phase 4 backstop).
   */
  vehiclesDuplicateKeys: number;
}

/** This app's own realtime layers, which `layer-specs.ts` knows nothing about. */
const VEHICLES_SOURCE = 'vehicles';
const VEHICLES_HALO_LAYER = 'vehicles-halo';
const VEHICLES_CASING_LAYER = 'vehicles-casing';
const VEHICLES_DOT_LAYER = 'vehicles-dot';
const VEHICLES_ARROW_LAYER = 'vehicles-arrow';
const VEHICLES_CLICKAREA_LAYER = 'vehicles-clickarea';

/** The colored route line. Upstream names this layer `routes-background`. */
const ROUTES_LINE_LAYER = 'routes-line';

/** Layer ids in paint order, bottom first. Used by `clear()` and ordering. */
const LAYER_ORDER = [
  ROUTES_CASING_LAYER,
  ROUTES_LINE_LAYER,
  ROUTES_DIRECTION_LAYER,
  ROUTES_CLICKAREA_LAYER,
  STOP_FOCUS_HALO_LAYER,
  STOP_FOCUS_RING_LAYER,
  STOPS_BACKGROUND_LAYER,
  STOP_FOCUS_TOP_LAYER,
  STOPS_STATION_DOT_LAYER,
  STOPS_CLICKAREA_LAYER,
  VEHICLES_HALO_LAYER,
  VEHICLES_CASING_LAYER,
  VEHICLES_DOT_LAYER,
  VEHICLES_ARROW_LAYER,
  VEHICLES_CLICKAREA_LAYER,
] as const;

const SOURCE_IDS = [ROUTES_SOURCE, STOPS_SOURCE, VEHICLES_SOURCE] as const;

/**
 * Click priority, topmost first. A single map-level click handler queries these
 * in order rather than registering one handler per layer, so a vehicle sitting
 * on top of its own stop focuses the vehicle instead of firing both.
 */
const HIT_LAYERS = [
  VEHICLES_CLICKAREA_LAYER,
  STOPS_CLICKAREA_LAYER,
  ROUTES_CLICKAREA_LAYER,
] as const;

const STOP_CLICK_RADIUS = 15;

/**
 * The fade zooms this app resolves from its own config. `layer-specs.ts` takes
 * them as an argument because each app tunes them separately.
 */
const FADE_BANDS: StopFadeBands = {
  stationMin: CONFIG.STATION_FADE_ZOOM_MIN,
  stationMax: CONFIG.STATION_FADE_ZOOM_MAX,
  stopMin: CONFIG.STOP_FADE_ZOOM_MIN,
  stopMax: CONFIG.STOP_FADE_ZOOM_MAX,
};

/**
 * Which feature states exempt a stop from the zoom fade here: the clicked stop,
 * the one hovered from the panel's route strip, and every stop on the
 * spotlighted route. Hover counts so pointing at a strip row still shows you
 * the stop when the map is zoomed out past where plain stops have faded. The
 * editor's `kept` state has no counterpart in a viewer.
 */
const SPECIAL_STATES: readonly StopFeatureState[] = ['focused', 'hovered', 'onRoute'];
const SPECIAL_STOP = specialStop(SPECIAL_STATES);

const FOCUSED: ExpressionSpecification = ['boolean', ['feature-state', 'focused'], false];

/**
 * Selection color, resolved from the active DaisyUI theme. Red is reserved for
 * errors, so selection must not use it. The fallback is only reached when the
 * token cannot be read at all.
 */
function accentColor(): string {
  return resolveThemeColor('--color-primary', '#3b82f6');
}

/** Plain-stop colors and sizes the shared paint builders read. */
function stopStyle(accent: string): StopStyleOptions {
  return {
    accent,
    backgroundColor: '#ffffff',
    strokeColor: '#37474f',
    strokeWidth: 2,
    radius: 5.5,
  };
}

/** Hard-contrast edge for vehicles, so a route-colored marker reads on top of
 *  its own route line. Reads on light basemaps; on dark ones the dot keeps its
 *  white inner stroke and the arrow its route-colored fill. */
const VEHICLE_CASING_COLOR = '#0f172a';

type FocusTarget =
  | { kind: 'stop'; id: string }
  | { kind: 'route'; id: string }
  | { kind: 'vehicle'; id: string }
  | null;

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export class LayerManager {
  private map: MapLibreMap;
  private feed: GTFSScheduled | null = null;

  /** Built once per feed and re-used on style rebuilds. */
  private stopsData: GeoJSON.FeatureCollection = EMPTY;
  private routesData: GeoJSON.FeatureCollection = EMPTY;
  private vehiclesData: GeoJSON.FeatureCollection = EMPTY;
  private latestVehicles: VehiclePosition[] = [];

  private focus: FocusTarget = null;
  /** The stop whose strip row is hovered in the panel, if any. */
  private hoveredStopId: string | null = null;
  /** Stops that *should* carry the `onRoute` feature-state on the map. */
  private wantedRouteStopIds: string[] = [];
  /** False while the feed is small enough that both zoom fade bands are skipped. */
  private stopFadeActive = true;
  /** Armed while feature state is waiting for a source to finish loading. */
  private retry: (() => void) | null = null;

  issues: MapDataIssues = {
    stopsMissingId: 0,
    stopsMissingCoords: 0,
    vehiclesUnmatched: 0,
    vehiclesDuplicateKeys: 0,
  };

  onSelect: ((target: Exclude<FocusTarget, null>) => void) | null = null;
  /** Called when a click lands on no feature — the map's "click away". */
  onEmptySelect: (() => void) | null = null;

  /** Resolved once per theme; `refreshAccentColor` re-reads it. */
  private accent = accentColor();
  private stopStyle = stopStyle(this.accent);

  constructor(map: MapLibreMap) {
    this.map = map;
  }

  /**
   * Re-resolve the accent against the now-active theme and repaint every
   * property painted with it. Called by the theme controller; the layers are
   * already on the map, so this cannot go through `addLayers`.
   */
  refreshAccentColor(): void {
    clearThemeColorCache();
    this.accent = accentColor();
    this.stopStyle = stopStyle(this.accent);

    for (const id of [STOP_FOCUS_HALO_LAYER, STOP_FOCUS_RING_LAYER, VEHICLES_HALO_LAYER]) {
      if (!this.map.getLayer(id)) continue;
      this.map.setPaintProperty(id, 'circle-color', this.accent);
      this.map.setPaintProperty(id, 'circle-stroke-color', this.accent);
    }
    // Only the fill reads the accent on these two: the focused circle is
    // painted in it, everything else in the layer is accent-free.
    const fill = stopFillColor(this.accent, this.stopStyle.backgroundColor);
    for (const id of [STOPS_BACKGROUND_LAYER, STOP_FOCUS_TOP_LAYER]) {
      if (!this.map.getLayer(id)) continue;
      this.map.setPaintProperty(id, 'circle-color', fill);
    }
    // stops-background's opacity carries the route spotlight, which the
    // repaint above leaves untouched but applyStopDim re-derives anyway.
    this.applyStopDim();
  }

  // ── Data in ────────────────────────────────────────────────────────────────

  setScheduledFeed(feed: GTFSScheduled | null): void {
    this.feed = feed;
    this.stopsData = feed ? this.buildStops(feed) : EMPTY;
    this.routesData = feed ? this.buildRoutes(feed) : EMPTY;
    this.pushData(STOPS_SOURCE, this.stopsData);
    this.pushData(ROUTES_SOURCE, this.routesData);
    this.refreshStopFade(this.stopsData.features.length);
    // A new feed almost never contains the old focus; AppState clears it
    // separately, but the map's own spotlight and feature state have to go now
    // either way. setFocus(null) wipes every source's feature state, so a stale
    // `focused`/`onRoute` cannot survive into the new feed.
    this.hoveredStopId = null;
    this.setFocus(null);
  }

  setVehicles(positions: VehiclePosition[]): void {
    this.latestVehicles = positions;
    this.vehiclesData = this.buildVehicles(positions);
    // setData rather than re-adding the source: re-adding on every 15s poll
    // flashes the markers and drops their feature state.
    this.pushData(VEHICLES_SOURCE, this.vehiclesData);
    this.syncFeatureState();
  }

  // ── Focus ──────────────────────────────────────────────────────────────────

  setFocus(target: FocusTarget): void {
    // A platform is never drawn, so focusing one highlights and eases to its
    // drawn station instead (Plan 06 Phase 7). The panel still shows the
    // platform page; only the map resolves upward.
    this.focus =
      target?.kind === 'stop' ? { kind: 'stop', id: this.drawnAncestor(target.id) } : target;

    // Route focus spotlights the route and its stops; anything else clears it.
    this.wantedRouteStopIds =
      target?.kind === 'route' ? this.stopIdsForRoute(target.id) : [];
    const routeIds = target?.kind === 'route' ? [target.id] : null;
    this.applyStopDim();
    this.applySpotlight(routeIds);
    this.applyVehicleDim(routeIds);
    this.syncFeatureState();
  }

  /**
   * Light the stop whose row is hovered in the panel's route strip. Its own
   * feature state, so hovering never disturbs the selection, and a stop that is
   * both still reads as focused.
   *
   * Resolved through `drawnAncestor` for the same reason `setFocus` does it: a
   * platform is never drawn, so a hover on one has to land on its station.
   */
  setHoveredStop(stop_id: string | null): void {
    const resolved = stop_id === null ? null : this.drawnAncestor(stop_id);
    if (this.hoveredStopId === resolved) return;
    this.hoveredStopId = resolved;
    this.syncFeatureState();
  }

  /**
   * Push the wanted feature state onto the sources.
   *
   * Every pass first wipes *all* feature state on each source with
   * `removeFeatureState({ source })`, then re-applies only what is wanted now.
   * Feature state on a GeoJSON source survives `setData`, so a `focused: true`
   * or `onRoute: true` left on a feature would otherwise leak across focus
   * changes and — since a new feed reuses the same source — across feed changes
   * too (Plan 06 Root cause C). Clearing wholesale removes that entire class of
   * stale-highlight bug in one call.
   *
   * `setFeatureState` silently no-ops when the source hasn't loaded its data
   * yet — exactly the case for the first focus restored from a link, and again
   * after every basemap change. Anything that doesn't land is retried on
   * `sourcedata` until it does; the clear runs on each retry pass as well.
   */
  private syncFeatureState(): void {
    let settled = true;

    for (const source of SOURCE_IDS) {
      if (!this.map.getSource(source)) continue;
      try {
        this.map.removeFeatureState({ source });
      } catch (err) {
        console.debug(`[LayerManager] removeFeatureState failed for ${source}`, err);
      }
    }

    if (this.sourceReady(STOPS_SOURCE)) {
      for (const id of this.wantedRouteStopIds) {
        this.setState('stop', id, { onRoute: true });
      }
      // Hover is transient: if the source isn't ready the pointer has almost
      // certainly moved on, so it never arms the retry.
      if (this.hoveredStopId !== null) {
        this.setState('stop', this.hoveredStopId, { hovered: true });
      }
    } else if (this.wantedRouteStopIds.length > 0) {
      settled = false;
    }

    const target = this.focus;
    if (target) {
      if (this.sourceReady(sourceFor(target.kind))) {
        this.setState(target.kind, target.id, { focused: true });
      } else {
        settled = false;
      }
    }

    if (settled) {
      this.disarmRetry();
    } else {
      this.armRetry();
    }
  }

  private sourceReady(id: string): boolean {
    return Boolean(this.map.getSource(id)) && this.map.isSourceLoaded(id);
  }

  private armRetry(): void {
    if (this.retry) return;
    this.retry = () => this.syncFeatureState();
    this.map.on('sourcedata', this.retry);
  }

  private disarmRetry(): void {
    if (!this.retry) return;
    this.map.off('sourcedata', this.retry);
    this.retry = null;
  }

  private setState(kind: 'stop' | 'route' | 'vehicle', id: string, state: object): void {
    const source = sourceFor(kind);
    if (!this.map.getSource(source)) return;
    try {
      this.map.setFeatureState({ source, id }, state);
    } catch (err) {
      console.debug(`[LayerManager] setFeatureState failed for ${kind} ${id}`, err);
    }
  }

  /**
   * Dim every stop that isn't on the spotlighted route. The `onRoute` marks
   * themselves are applied by `syncFeatureState`; this is only the paint side.
   */
  private applyStopDim(): void {
    const dim = this.wantedRouteStopIds.length > 0 ? CONFIG.SPOTLIGHT_STOP_DIM : null;
    if (this.map.getLayer(STOPS_BACKGROUND_LAYER)) {
      const fade = this.stopFade(dim);
      this.map.setPaintProperty(STOPS_BACKGROUND_LAYER, 'circle-opacity', fade);
      this.map.setPaintProperty(STOPS_BACKGROUND_LAYER, 'circle-stroke-opacity', fade);
    }
    if (this.map.getLayer(STOPS_STATION_DOT_LAYER)) {
      this.map.setPaintProperty(
        STOPS_STATION_DOT_LAYER,
        'circle-opacity',
        this.stationFade(dim),
      );
    }
    if (this.map.getLayer(STOPS_CLICKAREA_LAYER)) {
      this.map.setPaintProperty(STOPS_CLICKAREA_LAYER, 'circle-radius', this.clickAreaRadius());
    }
  }

  /** The three fade expressions, bound to this app's bands and exemption set. */
  private stopFade(dim: number | null): ExpressionSpecification {
    return stopFadeOpacity(SPECIAL_STOP, FADE_BANDS, this.stopFadeActive, dim);
  }

  private stationFade(dim: number | null): ExpressionSpecification {
    return stationFadeOpacity(SPECIAL_STOP, FADE_BANDS, this.stopFadeActive, dim);
  }

  private clickAreaRadius(): ExpressionSpecification {
    return stopClickAreaRadius(
      SPECIAL_STOP,
      FADE_BANDS,
      this.stopFadeActive,
      STOP_CLICK_RADIUS,
    );
  }

  /**
   * Turn the zoom fade off for a feed with only a handful of stops, on again
   * once it grows. Called whenever the stop data changes.
   */
  private refreshStopFade(stopCount: number): void {
    const active = stopCount >= CONFIG.STOP_FADE_MIN_STOPS;
    if (active === this.stopFadeActive) return;
    this.stopFadeActive = active;
    this.applyStopDim();
  }

  /**
   * Dim every vehicle that isn't running on the spotlighted route, and lift the
   * ones that are above the rest. Vehicles carry `route_id` (resolved from the
   * trip when the position omits it), so the same literal match the route
   * spotlight uses works here unchanged.
   *
   * The focus halo is left alone: its radius is 0 unless the feature is
   * focused, and a route focus never coexists with a vehicle focus.
   */
  private applyVehicleDim(routeIds: string[] | null): void {
    const match = routeMatch(routeIds);
    const opacity = routeSpotlightOpacity(match, CONFIG.SPOTLIGHT_VEHICLE_DIM);

    // Vehicles have no natural paint order — one bucket of markers all drawn at
    // once — so the lift is a plain 1-or-0 rather than an offset off a base key.
    // `icon-allow-overlap` is true on the arrow, which is the case where a
    // *greater* symbol-sort-key draws on top, matching circle-sort-key.
    const sortKey = (match ? ['case', match, 1, 0] : 0) as unknown as ExpressionSpecification;

    if (this.map.getLayer(VEHICLES_CASING_LAYER)) {
      this.map.setPaintProperty(VEHICLES_CASING_LAYER, 'circle-opacity', opacity);
      this.map.setLayoutProperty(VEHICLES_CASING_LAYER, 'circle-sort-key', sortKey);
    }
    if (this.map.getLayer(VEHICLES_DOT_LAYER)) {
      this.map.setPaintProperty(VEHICLES_DOT_LAYER, 'circle-opacity', opacity);
      this.map.setPaintProperty(VEHICLES_DOT_LAYER, 'circle-stroke-opacity', opacity);
      this.map.setLayoutProperty(VEHICLES_DOT_LAYER, 'circle-sort-key', sortKey);
    }
    if (this.map.getLayer(VEHICLES_ARROW_LAYER)) {
      // icon-opacity covers the SDF fill and its halo together, so the arrow
      // fades as one mark rather than leaving a floating dark outline.
      this.map.setPaintProperty(VEHICLES_ARROW_LAYER, 'icon-opacity', opacity);
      this.map.setLayoutProperty(VEHICLES_ARROW_LAYER, 'symbol-sort-key', sortKey);
    }
    // Sorted with the drawn layers so a click on stacked vehicles resolves to
    // whichever one visually reads as on top.
    if (this.map.getLayer(VEHICLES_CLICKAREA_LAYER)) {
      this.map.setLayoutProperty(VEHICLES_CLICKAREA_LAYER, 'circle-sort-key', sortKey);
    }
  }

  private applySpotlight(routeIds: string[] | null): void {
    if (!this.map.getLayer(ROUTES_LINE_LAYER)) return;

    const match = routeMatch(routeIds);
    const opacity = routeSpotlightOpacity(match, CONFIG.SPOTLIGHT_ROUTE_DIM);

    this.map.setPaintProperty(ROUTES_LINE_LAYER, 'line-opacity', opacity);
    this.map.setPaintProperty(ROUTES_CASING_LAYER, 'line-opacity', opacity);
    this.map.setPaintProperty(
      ROUTES_LINE_LAYER,
      'line-width',
      zoomWidth(ROUTE_WIDTH_STOPS, match, CONFIG.SPOTLIGHT_LINE_BUMP),
    );
    this.map.setPaintProperty(
      ROUTES_CASING_LAYER,
      'line-width',
      zoomWidth(ROUTE_CASING_WIDTH_STOPS, match, CONFIG.SPOTLIGHT_CASING_BUMP),
    );

    const sortKey = routeSortKeyExpression(match, CONFIG.SPOTLIGHT_SORT_KEY);
    for (const id of [ROUTES_CASING_LAYER, ROUTES_LINE_LAYER, ROUTES_CLICKAREA_LAYER]) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'line-sort-key', sortKey);
    }

    // Direction arrows only when exactly one route is spotlighted: a stop click
    // spotlights every route serving the stop, and arrows on all of them are
    // noise.
    if (this.map.getLayer(ROUTES_DIRECTION_LAYER)) {
      this.map.setFilter(
        ROUTES_DIRECTION_LAYER,
        routeIds && routeIds.length === 1
          ? (['==', ['get', 'route_id'], routeIds[0]] as unknown as FilterSpecification)
          : (NO_ROUTE_FILTER as unknown as FilterSpecification),
      );
    }
  }

  // ── Geometry lookups, for camera moves ─────────────────────────────────────

  stopPosition(stopId: string): [number, number] | null {
    return this.feed?.resolvedPosition(stopId) ?? null;
  }

  /**
   * Where the camera should ease to when focusing a stop: the drawn stop the
   * focus resolves to (a platform resolves up to its station).
   */
  focusPosition(stopId: string): [number, number] | null {
    return this.stopPosition(this.drawnAncestor(stopId));
  }

  vehiclePosition(vehicleId: string): [number, number] | null {
    const v = this.latestVehicles.find(p => p.key === vehicleId);
    return v ? [v.lon, v.lat] : null;
  }

  /** `[[west, south], [east, north]]`, or null when the route has no geometry. */
  routeBounds(routeId: string): [[number, number], [number, number]] | null {
    const feature = this.routesData.features.find(f => f.properties?.route_id === routeId);
    if (!feature || feature.geometry.type !== 'MultiLineString') return null;
    return boundsOf(feature.geometry.coordinates.flat() as [number, number][]);
  }

  /** Bounds of every drawn stop — the "fit the whole feed" box. */
  stopsBounds(): [[number, number], [number, number]] | null {
    const coords = this.stopsData.features.map(
      f => (f.geometry as GeoJSON.Point).coordinates as [number, number],
    );
    return boundsOf(coords);
  }

  // ── Style lifecycle ────────────────────────────────────────────────────────

  /**
   * Re-add every source and layer. `map.setStyle()` destroys all of them, so
   * this runs on `basemap:changed` — without it, switching basemaps blanks all
   * GTFS data.
   */
  rebuild(): void {
    this.addArrowImage();
    // Registered images are dropped with the style too, and the direction layer
    // references `route-arrow` by name, so the glyphs have to be back first.
    ensureMapIcons(this.map);
    this.addSources();
    this.addLayers();
    // Neither paint overrides nor feature state survive a style swap.
    const routeIds = this.focus?.kind === 'route' ? [this.focus.id] : null;
    this.applyStopDim();
    this.applySpotlight(routeIds);
    this.applyVehicleDim(routeIds);
    this.syncFeatureState();
  }

  clear(): void {
    for (const id of LAYER_ORDER) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    for (const id of SOURCE_IDS) {
      if (this.map.getSource(id)) this.map.removeSource(id);
    }
  }

  private pushData(id: (typeof SOURCE_IDS)[number], data: GeoJSON.FeatureCollection): void {
    const source = this.map.getSource(id) as GeoJSONSource | undefined;
    if (source) source.setData(data);
  }

  private addSources(): void {
    // promoteId lifts the id out of properties so setFeatureState can address
    // string ids like "place-jfk"; without it every feature id would be 0.
    if (!this.map.getSource(ROUTES_SOURCE)) {
      this.map.addSource(ROUTES_SOURCE, {
        type: 'geojson',
        data: this.routesData,
        promoteId: 'route_id',
      });
    }
    if (!this.map.getSource(STOPS_SOURCE)) {
      this.map.addSource(STOPS_SOURCE, {
        type: 'geojson',
        data: this.stopsData,
        promoteId: 'stop_id',
      });
    }
    if (!this.map.getSource(VEHICLES_SOURCE)) {
      this.map.addSource(VEHICLES_SOURCE, {
        type: 'geojson',
        data: this.vehiclesData,
        promoteId: 'vehicle_id',
      });
    }
  }

  // ── Layers ─────────────────────────────────────────────────────────────────

  private addLayers(): void {
    this.addRouteLayers();
    this.addStopLayers();
    this.addVehicleLayers();
  }

  private addRouteLayers(): void {
    if (this.map.getLayer(ROUTES_CASING_LAYER)) return;

    this.map.addLayer({
      id: ROUTES_CASING_LAYER,
      type: 'line',
      source: ROUTES_SOURCE,
      paint: {
        'line-color': ['get', 'colorDark'],
        'line-width': zoomWidth(ROUTE_CASING_WIDTH_STOPS, null, 1),
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ['get', 'sortKey'],
      },
    });

    this.map.addLayer({
      id: ROUTES_LINE_LAYER,
      type: 'line',
      source: ROUTES_SOURCE,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': zoomWidth(ROUTE_WIDTH_STOPS, null, 1),
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ['get', 'sortKey'],
      },
    });

    // Direction chevrons for the single spotlighted route. Above the ribbon so
    // it can never cover them, below every stop layer. Starts filtered to
    // nothing; applySpotlight owns the filter. Each line in a route's
    // MultiLineString runs in its own shape's travel direction, so a
    // bidirectional route gets arrows pointing both ways, one set per shape.
    this.map.addLayer({
      id: ROUTES_DIRECTION_LAYER,
      type: 'symbol',
      source: ROUTES_SOURCE,
      filter: NO_ROUTE_FILTER as unknown as FilterSpecification,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 12, 80, 16, 140],
        'icon-image': 'route-arrow',
        'icon-rotation-alignment': 'map',
        // An upright flip would reverse the arrow, the one thing this layer
        // must never do.
        'icon-keep-upright': false,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 1],
        // Let collision detection interleave the arrows where two
        // opposite-direction features share a corridor, rather than stacking
        // them on top of each other.
        'icon-allow-overlap': false,
        'icon-ignore-placement': false,
      },
      paint: {
        'icon-opacity': [
          'interpolate',
          ['linear'],
          ['zoom'],
          CONFIG.ROUTE_ARROW_FADE_ZOOM_MIN,
          0,
          CONFIG.ROUTE_ARROW_FADE_ZOOM_MAX,
          CONFIG.ROUTE_ARROW_OPACITY,
        ],
      },
    });

    this.map.addLayer({
      id: ROUTES_CLICKAREA_LAYER,
      type: 'line',
      source: ROUTES_SOURCE,
      paint: { 'line-color': 'transparent', 'line-width': 15, 'line-opacity': 0 },
      // Sorted identically to the drawn layers so a click on overlapping routes
      // resolves to whichever one visually reads as on top.
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ['get', 'sortKey'],
      },
    });
  }

  /**
   * Stop paint comes from the shared `stop-layer-style.ts`, the filters and the
   * fade from `layer-specs.ts`. Order matters: the halo and ring sit under the
   * circles, the focus redraw sits over them so a neighbouring stop cannot
   * paint over the selection, and the station dot goes last so a focused
   * station keeps its center dot.
   */
  private addStopLayers(): void {
    if (this.map.getLayer(STOPS_BACKGROUND_LAYER)) return;

    this.map.addLayer({
      id: STOP_FOCUS_HALO_LAYER,
      type: 'circle',
      source: STOPS_SOURCE,
      filter: TOP_LEVEL_STOPS_FILTER,
      paint: focusHaloPaint(this.accent),
    });

    this.map.addLayer({
      id: STOP_FOCUS_RING_LAYER,
      type: 'circle',
      source: STOPS_SOURCE,
      filter: TOP_LEVEL_STOPS_FILTER,
      paint: focusRingPaint(this.accent),
    });

    this.map.addLayer({
      id: STOPS_BACKGROUND_LAYER,
      type: 'circle',
      source: STOPS_SOURCE,
      filter: TOP_LEVEL_STOPS_FILTER,
      paint: stopsBackgroundPaint(this.stopStyle, this.stopFade(null)),
    });

    this.map.addLayer({
      id: STOP_FOCUS_TOP_LAYER,
      type: 'circle',
      source: STOPS_SOURCE,
      filter: TOP_LEVEL_STOPS_FILTER,
      paint: focusTopPaint(this.stopStyle),
    });

    this.map.addLayer({
      id: STOPS_STATION_DOT_LAYER,
      type: 'circle',
      source: STOPS_SOURCE,
      // This app never expands a station, so the stop filter is always the
      // default one and the station-dot filter needs no composition.
      filter: stationDotFilter(null),
      paint: stationDotPaint(this.stationFade(null)),
    });

    // The hit radius mirrors the visible layer's fade: it collapses to 0 where
    // plain stops are fully faded out, so invisible stops are simply not
    // returned by queryRenderedFeatures: no JS-side visibility predicate to
    // keep in sync.
    this.map.addLayer({
      id: STOPS_CLICKAREA_LAYER,
      type: 'circle',
      source: STOPS_SOURCE,
      filter: TOP_LEVEL_STOPS_FILTER,
      paint: {
        'circle-radius': this.clickAreaRadius(),
        'circle-color': 'transparent',
        'circle-opacity': 0,
      },
    });
  }

  private addVehicleLayers(): void {
    if (this.map.getLayer(VEHICLES_DOT_LAYER)) return;

    // Focus halo: a soft ring that only exists for the focused vehicle. The
    // arrow's size is a layout property and so cannot read feature-state; the
    // halo carries the emphasis instead. It scales with zoom so it reads at any
    // scale rather than being a flat pixel radius.
    this.map.addLayer({
      id: VEHICLES_HALO_LAYER,
      type: 'circle',
      source: VEHICLES_SOURCE,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          8,
          ['case', FOCUSED, 11, 0],
          14,
          ['case', FOCUSED, 17, 0],
          18,
          ['case', FOCUSED, 23, 0],
        ] as unknown as ExpressionSpecification,
        'circle-color': this.accent,
        'circle-opacity': 0.25,
        'circle-stroke-color': this.accent,
        'circle-stroke-width': ['case', FOCUSED, 2, 0],
      },
    });

    // Dark casing behind the dot: a vehicle takes its fill from the route it
    // runs on and sits on that same-colored line, so without a hard-contrast
    // edge it disappears into the line. The casing is a slightly larger dark
    // circle drawn just under the dot (the arrow gets a dark halo instead).
    this.map.addLayer({
      id: VEHICLES_CASING_LAYER,
      type: 'circle',
      source: VEHICLES_SOURCE,
      filter: ['==', ['get', 'has_bearing'], false] as unknown as FilterSpecification,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 7, 14, 9.5, 18, 13],
        'circle-color': VEHICLE_CASING_COLOR,
      },
    });

    // Vehicles with no bearing render as a plain circle rather than an
    // arbitrarily-pointed arrow. Larger minimum size than the route casing so
    // the dot never reads as thinner than the line it sits on.
    this.map.addLayer({
      id: VEHICLES_DOT_LAYER,
      type: 'circle',
      source: VEHICLES_SOURCE,
      filter: ['==', ['get', 'has_bearing'], false] as unknown as FilterSpecification,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 14, 7.5, 18, 11],
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': ['case', FOCUSED, 3, 1.5],
      },
    });

    this.map.addLayer({
      id: VEHICLES_ARROW_LAYER,
      type: 'symbol',
      source: VEHICLES_SOURCE,
      filter: ['==', ['get', 'has_bearing'], true] as unknown as FilterSpecification,
      layout: {
        'icon-image': 'vehicle-arrow',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 0.85, 18, 1.15],
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        // The arrow image is an SDF, so its fill follows the route color and a
        // dark halo gives it the same hard-contrast edge as the dot's casing.
        'icon-color': ['get', 'color'],
        'icon-halo-color': VEHICLE_CASING_COLOR,
        'icon-halo-width': ['case', FOCUSED, 3, 2],
      },
    });

    // Never smaller than the largest drawn vehicle (focused halo aside): the
    // clickarea is the sole hit-test layer, same contract as the stops one.
    this.map.addLayer({
      id: VEHICLES_CLICKAREA_LAYER,
      type: 'circle',
      source: VEHICLES_SOURCE,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 12, 14, 15, 18, 20],
        'circle-color': 'transparent',
        'circle-opacity': 0,
      },
    });
  }

  /**
   * A north-pointing arrow, drawn as an SDF so `icon-color` can tint it per
   * route. MapLibre reads the alpha channel as a distance field, so the shape
   * is blurred slightly to give the edge a ramp instead of a hard step.
   *
   * Separate from `interlocking`'s `map-icons.ts`: that file's `route-arrow` is a
   * white-on-dark chevron laid along a line, not a tintable vehicle marker.
   */
  private addArrowImage(): void {
    if (this.map.hasImage('vehicle-arrow')) return;

    const size = 48;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.filter = 'blur(2px)';
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(size / 2, 6);
    ctx.lineTo(size - 10, size - 8);
    ctx.lineTo(size / 2, size - 16);
    ctx.lineTo(10, size - 8);
    ctx.closePath();
    ctx.fill();
    this.map.addImage('vehicle-arrow', ctx.getImageData(0, 0, size, size), { sdf: true });
  }

  // ── Interaction ────────────────────────────────────────────────────────────

  /**
   * One map-level handler rather than one per layer: overlapping features (a
   * vehicle parked on its own stop) would otherwise fire two selections.
   */
  attachInteraction(): void {
    this.map.on('click', e => {
      const hit = this.queryTop(e.point);
      if (hit) this.onSelect?.(hit);
      else this.onEmptySelect?.();
    });

    this.map.on('mousemove', e => {
      this.map.getCanvas().style.cursor = this.queryTop(e.point) ? 'pointer' : '';
    });
  }

  private queryTop(point: maplibregl.Point): Exclude<FocusTarget, null> | null {
    const available = HIT_LAYERS.filter(id => this.map.getLayer(id));
    if (available.length === 0) return null;

    for (const layer of available) {
      const [feature] = this.map.queryRenderedFeatures(point, { layers: [layer] });
      if (!feature) continue;
      const props = feature.properties ?? {};
      if (layer === VEHICLES_CLICKAREA_LAYER && props.vehicle_id) {
        return { kind: 'vehicle', id: String(props.vehicle_id) };
      }
      if (layer === STOPS_CLICKAREA_LAYER && props.stop_id) {
        return { kind: 'stop', id: String(props.stop_id) };
      }
      if (layer === ROUTES_CLICKAREA_LAYER && props.route_id) {
        return { kind: 'route', id: String(props.route_id) };
      }
    }
    return null;
  }

  // ── GeoJSON builders ───────────────────────────────────────────────────────

  private buildStops(feed: GTFSScheduled): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];
    let missingId = 0;
    let missingCoords = 0;

    for (const stop of feed.stops.values()) {
      // promoteId only works when the feature actually carries the property; a
      // stop with no id is unaddressable by setFeatureState and could never
      // highlight, so it is dropped here and counted for the status page.
      if (!stop.id) {
        missingId++;
        continue;
      }
      const position = feed.resolvedPosition(stop.id);
      if (!position) {
        missingCoords++;
        continue;
      }
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: position },
        properties: {
          stop_id: stop.id,
          stop_name: stop.name,
          location_type: stop.location_type,
          parent_station: stop.parent_station,
        },
      });
    }

    this.issues.stopsMissingId = missingId;
    this.issues.stopsMissingCoords = missingCoords;
    return { type: 'FeatureCollection', features };
  }

  /**
   * One feature per route, merging its trips' distinct geometries into a
   * MultiLineString. Deduplicating by shape_id first matters: a high-frequency
   * route has thousands of trips sharing a handful of shapes, and merging them
   * all would produce enormous geometries with heavy overdraw.
   */
  private buildRoutes(feed: GTFSScheduled): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];

    for (const route of feed.routes.values()) {
      const trips = feed.tripsByRoute.get(route.id) ?? [];
      const lines: [number, number][][] = [];
      const seen = new Set<string>();

      for (const trip of trips) {
        if (trip.shape_id) {
          if (seen.has(`shape:${trip.shape_id}`)) continue;
          const coords = feed.shapes.get(trip.shape_id);
          if (coords && coords.length >= 2) {
            seen.add(`shape:${trip.shape_id}`);
            lines.push(coords);
            continue;
          }
        }

        // Straight-line fallback: stop_times for this trip are already sorted
        // by stop_sequence, so the order here is the service order.
        const stopIds = (feed.stopTimesByTrip.get(trip.trip_id) ?? [])
          .map(st => st.stop_id)
          .filter(id => {
            const stop = feed.stops.get(id);
            return stop && Number.isFinite(stop.lat) && Number.isFinite(stop.lon);
          });
        if (stopIds.length < 2) continue;

        const key = `stops:${stopIds.join('|')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push(stopIds.map(id => [feed.stops.get(id)!.lon, feed.stops.get(id)!.lat]));
      }

      if (lines.length === 0) continue;

      features.push({
        type: 'Feature',
        geometry: { type: 'MultiLineString', coordinates: lines },
        properties: {
          route_id: route.id,
          color: route.color,
          colorDark: casingColor(route.color),
          // Paint order: mode rank blended with trip count. See route-sort.ts.
          sortKey: routeSortKey(route.type, trips.length),
        },
      });
    }

    return { type: 'FeatureCollection', features };
  }

  private buildVehicles(positions: VehiclePosition[]): GeoJSON.FeatureCollection {
    const feed = this.feed;
    let unmatched = 0;
    const seenKeys = new Set<string>();
    let duplicateKeys = 0;

    const features = positions.map(v => {
      const routeId = v.routeId || (v.tripId ? feed?.trips.get(v.tripId)?.route_id : undefined);
      const route = routeId ? feed?.routes.get(routeId) : undefined;
      if (!route) unmatched++;
      if (seenKeys.has(v.key)) duplicateKeys++;
      else seenKeys.add(v.key);

      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [v.lon, v.lat] },
        properties: {
          vehicle_id: v.key,
          bearing: v.bearing ?? 0,
          has_bearing: v.bearing !== undefined,
          color: route?.color ?? CONFIG.VEHICLE_UNMATCHED_COLOR,
          route_id: routeId ?? '',
          trip_id: v.tripId ?? '',
        },
      };
    });

    this.issues.vehiclesUnmatched = unmatched;
    this.issues.vehiclesDuplicateKeys = duplicateKeys;
    return { type: 'FeatureCollection', features };
  }

  /**
   * Every *drawn* stop served by a route. `stop_times` names platforms, which
   * are page-only and never drawn (Plan 06 Root cause E), so each stop id is
   * mapped up to its drawn ancestor — otherwise a subway route's `onRoute`
   * state lands on nothing and its stations get dimmed with everything else.
   */
  private stopIdsForRoute(routeId: string): string[] {
    const feed = this.feed;
    if (!feed) return [];
    const ids = new Set<string>();
    for (const trip of feed.tripsByRoute.get(routeId) ?? []) {
      for (const st of feed.stopTimesByTrip.get(trip.trip_id) ?? []) {
        ids.add(this.drawnAncestor(st.stop_id));
      }
    }
    return [...ids];
  }

  /**
   * The nearest ancestor of a stop that is actually drawn on the map — a
   * top-level stop or a station. Platforms resolve up to their station; a
   * platform whose ancestry is not drawn resolves to itself and simply gets no
   * highlight.
   */
  private drawnAncestor(stopId: string): string {
    const feed = this.feed;
    if (!feed) return stopId;
    const stop = feed.stops.get(stopId);
    if (!stop) return stopId;
    // Drawn: a station, or a stop with no parent (TOP_LEVEL_STOPS_FILTER).
    if (stop.location_type === 1 || !stop.parent_station) return stopId;
    const root = feed.stationRoot(stopId);
    return feed.stops.has(root) ? root : stopId;
  }
}

/** The source a focus kind's features live in. */
function sourceFor(kind: 'stop' | 'route' | 'vehicle'): string {
  if (kind === 'route') return ROUTES_SOURCE;
  return kind === 'stop' ? STOPS_SOURCE : VEHICLES_SOURCE;
}

function boundsOf(coords: [number, number][]): [[number, number], [number, number]] | null {
  if (coords.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lon, lat] of coords) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return [
    [west, south],
    [east, north],
  ];
}
