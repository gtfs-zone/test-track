/* @vendored-from coloring-book:src/modules/layer-manager.ts
   @sha f9c718c
   @status modified
   @changes
   - Fed from the in-memory `GTFSStatic` model instead of `GTFSParser` /
     IndexedDB; no async, no coord resolver, no `onStopsDataUpdated` hook.
   - Dropped pathways, levels, the Tutte coord embedding, `stops-highlight` /
     `trip-highlight`, the editing affordances, and file-highlight mode.
   - Absorbed the route layer stack from coloring-book's `route-renderer.ts`
     (casing / line / clickarea, `zoomWidth`, `applySpotlight`), rebuilt as one
     MultiLineString feature per route with `promoteId: 'route_id'` rather than
     one feature per distinct geometry.
   - `getCasingColor` is no longer local: both repos now import `casingColor`
     from the vendored `utils/route-colors.ts`.
   - Added the realtime `vehicles` stack, which has no upstream equivalent.
   - Added `rebuild()`, called after a basemap change re-creates the style.
   - Route layers are sorted by a `sortKey` feature property (see
     `route-sort.ts`); `applySpotlight` lifts the focused route above it. */

import type maplibregl from 'maplibre-gl';
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
} from 'maplibre-gl';
import { CONFIG } from '../config';
import type { GTFSStatic } from '../gtfs-static';
import type { VehiclePosition } from '../map-controller';
import type { ShapeMode } from './basemap-control';
import { routeSortKey } from './route-sort';
import { casingColor } from '../utils/route-colors';

/**
 * Counts of feed data the map could not draw. Surfaced on the status page —
 * a stop with no id or a vehicle whose route doesn't exist in the static feed
 * is exactly the kind of problem this tool exists to make visible.
 */
export interface MapDataIssues {
  /** Rows in stops.txt with a blank `stop_id` — unaddressable by feature-state. */
  stopsMissingId: number;
  /** Rows in stops.txt with unparseable `stop_lat`/`stop_lon`. */
  stopsMissingCoords: number;
  /** Vehicles whose `trip.route_id` doesn't resolve against the static feed. */
  vehiclesUnmatched: number;
  /**
   * Vehicles sharing a promoted map-feature id after key derivation. Must be 0:
   * a non-zero count means the derived `key` collapsed two vehicles onto one
   * feature (the "one click highlights all of them" failure) and the derivation
   * in `gtfs-rt.ts` is broken (Plan 06 Phase 4 backstop).
   */
  vehiclesDuplicateKeys: number;
}

/** Layer ids in paint order, bottom first. Used by `clear()` and ordering. */
const LAYER_ORDER = [
  'routes-casing',
  'routes-line',
  'routes-clickarea',
  'stops-background',
  'stops-station-dot',
  'stops-clickarea',
  'vehicles-halo',
  'vehicles-casing',
  'vehicles-dot',
  'vehicles-arrow',
  'vehicles-clickarea',
] as const;

const SOURCE_IDS = ['routes', 'stops', 'vehicles'] as const;

/**
 * Click priority, topmost first. A single map-level click handler queries these
 * in order rather than registering one handler per layer, so a vehicle sitting
 * on top of its own stop focuses the vehicle instead of firing both.
 */
const HIT_LAYERS = ['vehicles-clickarea', 'stops-clickarea', 'routes-clickarea'] as const;

const STOPS_FILTER: FilterSpecification = [
  'any',
  ['==', ['get', 'parent_station'], ''],
  ['==', ['get', 'location_type'], 1],
] as FilterSpecification;

const STOP_RADIUS = 5.5;
const STOP_CLICK_RADIUS = 15;
const STOP_STROKE_COLOR = '#37474f';
const STOP_STROKE_WIDTH = 2;
const STOP_FILL_COLOR = '#ffffff';
const FOCUS_ACCENT = '#e74c3c';
/** Hard-contrast edge for vehicles, so a route-colored marker reads on top of
 *  its own route line. Reads on light basemaps; on dark ones the dot keeps its
 *  white inner stroke and the arrow its route-colored fill. */
const VEHICLE_CASING_COLOR = '#0f172a';

const ROUTE_WIDTH_STOPS: Array<[number, number]> = [
  [10, 1.5],
  [13, 3.5],
  [16, 7.5],
];
const CASING_WIDTH_STOPS: Array<[number, number]> = [
  [10, 3],
  [13, 5.5],
  [16, 10.5],
];

const FOCUSED: ExpressionSpecification = ['boolean', ['feature-state', 'focused'], false];

/**
 * A stop is "special" when it must stay visible and clickable at any zoom:
 * either focused (clicked) or on the currently spotlighted route.
 */
const SPECIAL_STOP = [
  'any',
  FOCUSED,
  ['boolean', ['feature-state', 'onRoute'], false],
] as unknown as ExpressionSpecification;

/**
 * Build a zoom-interpolated line-width expression. When `match` is given,
 * matched routes get their width multiplied by `bump` (the spotlight bump).
 */
function zoomWidth(
  widthStops: Array<[number, number]>,
  match: ExpressionSpecification | null,
  bump: number,
): ExpressionSpecification {
  const expr: unknown[] = ['interpolate', ['linear'], ['zoom']];
  for (const [zoom, width] of widthStops) {
    expr.push(zoom, match ? ['case', match, width * bump, width] : width);
  }
  return expr as unknown as ExpressionSpecification;
}

type FocusTarget =
  | { kind: 'stop'; id: string }
  | { kind: 'route'; id: string }
  | { kind: 'vehicle'; id: string }
  | null;

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

export class LayerManager {
  private map: MapLibreMap;
  private feed: GTFSStatic | null = null;
  private shapeMode: ShapeMode = 'shapes';

  /** Built once per feed / shape-mode change and re-used on style rebuilds. */
  private stopsData: GeoJSON.FeatureCollection = EMPTY;
  private routesData: GeoJSON.FeatureCollection = EMPTY;
  private vehiclesData: GeoJSON.FeatureCollection = EMPTY;
  private latestVehicles: VehiclePosition[] = [];

  private focus: FocusTarget = null;
  /** Stops that *should* carry the `onRoute` feature-state on the map. */
  private wantedRouteStopIds: string[] = [];
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

  constructor(map: MapLibreMap) {
    this.map = map;
  }

  // ── Data in ────────────────────────────────────────────────────────────────

  setStaticFeed(feed: GTFSStatic | null): void {
    this.feed = feed;
    this.stopsData = feed ? this.buildStops(feed) : EMPTY;
    this.routesData = feed ? this.buildRoutes(feed) : EMPTY;
    this.pushData('stops', this.stopsData);
    this.pushData('routes', this.routesData);
    // A new feed almost never contains the old focus; AppState clears it
    // separately, but the map's own spotlight and feature state have to go now
    // either way. setFocus(null) wipes every source's feature state, so a stale
    // `focused`/`onRoute` cannot survive into the new feed.
    this.setFocus(null);
  }

  setShapeMode(mode: ShapeMode): void {
    if (this.shapeMode === mode) return;
    this.shapeMode = mode;
    this.routesData = this.feed ? this.buildRoutes(this.feed) : EMPTY;
    this.pushData('routes', this.routesData);
  }

  setVehicles(positions: VehiclePosition[]): void {
    this.latestVehicles = positions;
    this.vehiclesData = this.buildVehicles(positions);
    // setData rather than re-adding the source: re-adding on every 15s poll
    // flashes the markers and drops their feature state.
    this.pushData('vehicles', this.vehiclesData);
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
    this.applyStopDim();
    this.applySpotlight(target?.kind === 'route' ? [target.id] : null);
    this.applyVehicleDim(target?.kind === 'route' ? [target.id] : null);
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

    if (this.sourceReady('stops')) {
      for (const id of this.wantedRouteStopIds) {
        this.setState('stop', id, { onRoute: true });
      }
    } else if (this.wantedRouteStopIds.length > 0) {
      settled = false;
    }

    const target = this.focus;
    if (target) {
      const source = target.kind === 'route' ? 'routes' : `${target.kind}s`;
      if (this.sourceReady(source)) {
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
    const source = kind === 'route' ? 'routes' : `${kind}s`;
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
    if (this.map.getLayer('stops-background')) {
      const fade = this.stopFadeOpacity(dim);
      this.map.setPaintProperty('stops-background', 'circle-opacity', fade);
      this.map.setPaintProperty('stops-background', 'circle-stroke-opacity', fade);
    }
    if (this.map.getLayer('stops-station-dot')) {
      this.map.setPaintProperty(
        'stops-station-dot',
        'circle-opacity',
        dim === null ? 1 : specialOrDim(dim),
      );
    }
  }

  /**
   * Dim every vehicle that isn't running on the spotlighted route. Vehicles
   * carry `route_id` (resolved from the trip when the position omits it), so
   * the same literal match the route spotlight uses works here unchanged.
   *
   * The focus halo is left alone: its radius is 0 unless the feature is
   * focused, and a route focus never coexists with a vehicle focus.
   */
  private applyVehicleDim(routeIds: string[] | null): void {
    const match =
      routeIds && routeIds.length > 0
        ? (['in', ['get', 'route_id'], ['literal', routeIds]] as unknown as ExpressionSpecification)
        : null;
    const opacity = (
      match ? ['case', match, 1, CONFIG.SPOTLIGHT_VEHICLE_DIM] : 1
    ) as unknown as ExpressionSpecification;

    if (this.map.getLayer('vehicles-casing')) {
      this.map.setPaintProperty('vehicles-casing', 'circle-opacity', opacity);
    }
    if (this.map.getLayer('vehicles-dot')) {
      this.map.setPaintProperty('vehicles-dot', 'circle-opacity', opacity);
      this.map.setPaintProperty('vehicles-dot', 'circle-stroke-opacity', opacity);
    }
    if (this.map.getLayer('vehicles-arrow')) {
      // icon-opacity covers the SDF fill and its halo together, so the arrow
      // fades as one mark rather than leaving a floating dark outline.
      this.map.setPaintProperty('vehicles-arrow', 'icon-opacity', opacity);
    }
  }

  private applySpotlight(routeIds: string[] | null): void {
    if (!this.map.getLayer('routes-line')) return;

    const match: ExpressionSpecification | null =
      routeIds && routeIds.length > 0
        ? (['in', ['get', 'route_id'], ['literal', routeIds]] as unknown as ExpressionSpecification)
        : null;
    const opacity = match
      ? (['case', match, 1, CONFIG.SPOTLIGHT_ROUTE_DIM] as unknown as ExpressionSpecification)
      : 1;

    this.map.setPaintProperty('routes-line', 'line-opacity', opacity);
    this.map.setPaintProperty('routes-casing', 'line-opacity', opacity);
    this.map.setPaintProperty(
      'routes-line',
      'line-width',
      zoomWidth(ROUTE_WIDTH_STOPS, match, CONFIG.SPOTLIGHT_LINE_BUMP),
    );
    this.map.setPaintProperty(
      'routes-casing',
      'line-width',
      zoomWidth(CASING_WIDTH_STOPS, match, CONFIG.SPOTLIGHT_CASING_BUMP),
    );

    // Lift the spotlighted routes above everything else. line-sort-key is a
    // layout property, so it cannot read feature state — but the same literal
    // route_id match used for opacity works here unchanged. Layout changes
    // force a tile re-layout, which is fine once per selection but must never
    // be driven from hover.
    const sortKey = (
      match
        ? ['case', match, CONFIG.SPOTLIGHT_SORT_KEY, ['get', 'sortKey']]
        : ['get', 'sortKey']
    ) as unknown as ExpressionSpecification;
    for (const id of ['routes-casing', 'routes-line', 'routes-clickarea']) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'line-sort-key', sortKey);
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
    this.addSources();
    this.addLayers();
    // Neither paint overrides nor feature state survive a style swap.
    this.applyStopDim();
    this.applySpotlight(this.focus?.kind === 'route' ? [this.focus.id] : null);
    this.applyVehicleDim(this.focus?.kind === 'route' ? [this.focus.id] : null);
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
    if (!this.map.getSource('routes')) {
      this.map.addSource('routes', {
        type: 'geojson',
        data: this.routesData,
        promoteId: 'route_id',
      });
    }
    if (!this.map.getSource('stops')) {
      this.map.addSource('stops', {
        type: 'geojson',
        data: this.stopsData,
        promoteId: 'stop_id',
      });
    }
    if (!this.map.getSource('vehicles')) {
      this.map.addSource('vehicles', {
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
    if (this.map.getLayer('routes-casing')) return;

    this.map.addLayer({
      id: 'routes-casing',
      type: 'line',
      source: 'routes',
      paint: {
        'line-color': ['get', 'colorDark'],
        'line-width': zoomWidth(CASING_WIDTH_STOPS, null, 1),
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': ['get', 'sortKey'],
      },
    });

    this.map.addLayer({
      id: 'routes-line',
      type: 'line',
      source: 'routes',
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

    this.map.addLayer({
      id: 'routes-clickarea',
      type: 'line',
      source: 'routes',
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
   * Opacity expression that keeps special stops at full opacity and dims
   * everything else. Plain stops (location_type 0) fade out below
   * CONFIG.STOP_FADE_ZOOM_MAX so zoomed-out views show the network instead of
   * a pile of dots; stations, child nodes, and special stops always render.
   */
  private stopFadeOpacity(dim: number | null): ExpressionSpecification {
    const lowZoom = ['case', SPECIAL_STOP, 1, ['==', ['get', 'location_type'], 0], 0, dim ?? 1];
    const fullZoom = dim === null ? 1 : specialOrDim(dim);
    return [
      'interpolate',
      ['linear'],
      ['zoom'],
      CONFIG.STOP_FADE_ZOOM_MIN,
      lowZoom,
      CONFIG.STOP_FADE_ZOOM_MAX,
      fullZoom,
    ] as unknown as ExpressionSpecification;
  }

  /**
   * Per-location-type circle radius wrapped in the focused feature-state case,
   * evaluated at one zoom stop. `scale` is the multiplier relative to z16;
   * focused stops render ~1.7x larger.
   */
  private stopRadiusAt(scale: number): ExpressionSpecification {
    const byType = (mult: number) => [
      'case',
      ['==', ['get', 'location_type'], 1],
      8 * scale * mult,
      ['==', ['get', 'location_type'], 2],
      4.5 * scale * mult,
      ['==', ['get', 'location_type'], 3],
      4.5 * scale * mult,
      ['==', ['get', 'location_type'], 4],
      5 * scale * mult,
      STOP_RADIUS * scale * mult,
    ];
    return ['case', FOCUSED, byType(1.7), byType(1)] as unknown as ExpressionSpecification;
  }

  private addStopLayers(): void {
    if (this.map.getLayer('stops-background')) return;

    const fade = this.stopFadeOpacity(null);

    this.map.addLayer({
      id: 'stops-background',
      type: 'circle',
      source: 'stops',
      filter: STOPS_FILTER,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          11,
          this.stopRadiusAt(0.45),
          13.5,
          this.stopRadiusAt(0.7),
          16,
          this.stopRadiusAt(1),
          19,
          this.stopRadiusAt(1.5),
        ],
        'circle-color': [
          'case',
          ['==', ['get', 'location_type'], 1],
          '#ffffff', // Station: white (black inner dot drawn by stops-station-dot)
          ['==', ['get', 'location_type'], 2],
          '#f59e0b', // Entrance: amber
          ['==', ['get', 'location_type'], 3],
          '#8b5cf6', // Generic node: purple
          ['==', ['get', 'location_type'], 4],
          '#10b981', // Boarding area: green
          STOP_FILL_COLOR,
        ],
        'circle-stroke-color': [
          'case',
          FOCUSED,
          FOCUS_ACCENT,
          ['==', ['get', 'location_type'], 1],
          '#111111',
          STOP_STROKE_COLOR,
        ],
        'circle-stroke-width': [
          'interpolate',
          ['linear'],
          ['zoom'],
          11,
          ['case', FOCUSED, 2.5, 1.2],
          16,
          ['case', FOCUSED, 3.5, STOP_STROKE_WIDTH],
          19,
          ['case', FOCUSED, 4.5, STOP_STROKE_WIDTH + 0.8],
        ],
        'circle-opacity': fade,
        'circle-stroke-opacity': fade,
      },
    });

    this.map.addLayer({
      id: 'stops-station-dot',
      type: 'circle',
      source: 'stops',
      filter: ['==', ['get', 'location_type'], 1] as unknown as FilterSpecification,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          11,
          ['case', FOCUSED, 2.2, 1.3],
          16,
          ['case', FOCUSED, 4.5, 2.6],
          19,
          ['case', FOCUSED, 6, 3.8],
        ],
        'circle-color': '#111111',
        'circle-stroke-width': 0,
      },
    });

    // The hit radius mirrors the visible layer's fade: it collapses to 0 where
    // plain stops are fully faded out, so invisible stops are simply not
    // returned by queryRenderedFeatures — no JS-side visibility predicate to
    // keep in sync. Adjust this and stopFadeOpacity together or stops become
    // clickable while invisible, which reads as a ghost-click bug.
    this.map.addLayer({
      id: 'stops-clickarea',
      type: 'circle',
      source: 'stops',
      filter: STOPS_FILTER,
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          CONFIG.STOP_FADE_ZOOM_MIN,
          [
            'case',
            SPECIAL_STOP,
            STOP_CLICK_RADIUS,
            ['==', ['get', 'location_type'], 0],
            0,
            STOP_CLICK_RADIUS,
          ],
          CONFIG.STOP_FADE_ZOOM_MAX,
          STOP_CLICK_RADIUS,
          // Stay larger than the biggest visual circle (focused station at high
          // zoom) so the clickarea is the sole hit-test layer.
          19,
          STOP_CLICK_RADIUS * 1.6,
        ] as unknown as ExpressionSpecification,
        'circle-color': 'transparent',
        'circle-opacity': 0,
      },
    });
  }

  private addVehicleLayers(): void {
    if (this.map.getLayer('vehicles-dot')) return;

    // Focus halo: a soft ring that only exists for the focused vehicle. The
    // arrow's size is a layout property and so cannot read feature-state; the
    // halo carries the emphasis instead. It scales with zoom so it reads at any
    // scale rather than being a flat pixel radius.
    this.map.addLayer({
      id: 'vehicles-halo',
      type: 'circle',
      source: 'vehicles',
      paint: {
        'circle-radius': [
          'case',
          FOCUSED,
          ['interpolate', ['linear'], ['zoom'], 8, 11, 14, 17, 18, 23],
          0,
        ] as unknown as ExpressionSpecification,
        'circle-color': FOCUS_ACCENT,
        'circle-opacity': 0.25,
        'circle-stroke-color': FOCUS_ACCENT,
        'circle-stroke-width': ['case', FOCUSED, 2, 0],
      },
    });

    // Dark casing behind the dot: a vehicle takes its fill from the route it
    // runs on and sits on that same-colored line, so without a hard-contrast
    // edge it disappears into the line. The casing is a slightly larger dark
    // circle drawn just under the dot (the arrow gets a dark halo instead).
    this.map.addLayer({
      id: 'vehicles-casing',
      type: 'circle',
      source: 'vehicles',
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
      id: 'vehicles-dot',
      type: 'circle',
      source: 'vehicles',
      filter: ['==', ['get', 'has_bearing'], false] as unknown as FilterSpecification,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 14, 7.5, 18, 11],
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': ['case', FOCUSED, 3, 1.5],
      },
    });

    this.map.addLayer({
      id: 'vehicles-arrow',
      type: 'symbol',
      source: 'vehicles',
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
      id: 'vehicles-clickarea',
      type: 'circle',
      source: 'vehicles',
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
      if (layer === 'vehicles-clickarea' && props.vehicle_id) {
        return { kind: 'vehicle', id: String(props.vehicle_id) };
      }
      if (layer === 'stops-clickarea' && props.stop_id) {
        return { kind: 'stop', id: String(props.stop_id) };
      }
      if (layer === 'routes-clickarea' && props.route_id) {
        return { kind: 'route', id: String(props.route_id) };
      }
    }
    return null;
  }

  // ── GeoJSON builders ───────────────────────────────────────────────────────

  private buildStops(feed: GTFSStatic): GeoJSON.FeatureCollection {
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
  private buildRoutes(feed: GTFSStatic): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = [];

    for (const route of feed.routes.values()) {
      const trips = feed.tripsByRoute.get(route.id) ?? [];
      const lines: [number, number][][] = [];
      const seen = new Set<string>();

      for (const trip of trips) {
        if (this.shapeMode === 'shapes' && trip.shape_id) {
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
    // Drawn: a station, or a stop with no parent (STOPS_FILTER).
    if (stop.location_type === 1 || !stop.parent_station) return stopId;
    const root = feed.stationRoot(stopId);
    return feed.stops.has(root) ? root : stopId;
  }
}

function specialOrDim(dim: number): ExpressionSpecification {
  return ['case', SPECIAL_STOP, 1, dim] as unknown as ExpressionSpecification;
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
