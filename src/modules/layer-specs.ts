/* @vendored-from coloring-book:src/modules/layer-specs.ts
   @sha 0d38e50
   @status verbatim */
/**
 * The map's layer specification: source ids, layer ids, filters, zoom ramps
 * and the feature-state expressions that drive the stop fade and the route
 * spotlight.
 *
 * Companion to `stop-layer-style.ts`, which owns how one stop circle looks.
 * This file owns everything around it: which stops are drawn at which zoom,
 * how the hit area tracks the fade, and how wide a route line is.
 *
 * Pure builders only - no DOM, no map handle, no `this`, no app types, no
 * CONFIG. Every tunable comes in as an argument, because each app resolves
 * them differently: the set of feature states that exempt a stop from the
 * fade is not the same in an editor and in a viewer, and the fade zooms live
 * in each app's own config. Callers own `addSource`, `addLayer`, the layer
 * order, and what fills the sources.
 */

import type { ExpressionSpecification, FilterSpecification } from 'maplibre-gl';

/** The stop source and the layers painted on it, in the order they are added. */
export const STOPS_SOURCE = 'stops';
export const STOPS_BACKGROUND_LAYER = 'stops-background';
export const STOPS_STATION_DOT_LAYER = 'stops-station-dot';
export const STOPS_CLICKAREA_LAYER = 'stops-clickarea';

/** The route source and its layer stack, casing first. */
export const ROUTES_SOURCE = 'routes';
export const ROUTES_CASING_LAYER = 'routes-casing';
export const ROUTES_BACKGROUND_LAYER = 'routes-background';
export const ROUTES_DIRECTION_LAYER = 'routes-direction';
export const ROUTES_CLICKAREA_LAYER = 'routes-clickarea';

/**
 * Show top-level stops (empty parent_station) and stations, hide child stops.
 * The default for every stop layer; expanding a station replaces it.
 */
export const TOP_LEVEL_STOPS_FILTER: FilterSpecification = [
  'any',
  ['==', ['get', 'parent_station'], ''],
  ['==', ['get', 'location_type'], 1],
] as FilterSpecification;

/** Matches stations only. The station-dot layer's own filter. */
export const STATION_FILTER: FilterSpecification = [
  '==',
  ['get', 'location_type'],
  1,
] as unknown as FilterSpecification;

/**
 * Compose the station-dot filter with the active stop filter. Passing null
 * (the default filter is in force) leaves the plain station match.
 */
export function stationDotFilter(
  active: FilterSpecification | null
): FilterSpecification {
  return active === null
    ? STATION_FILTER
    : (['all', STATION_FILTER, active] as unknown as FilterSpecification);
}

/**
 * Feature states a stop can carry. `focused` is the clicked stop, `hovered` a
 * stop pointed at elsewhere in the app, `onRoute` a stop of the spotlighted
 * route, and `kept` a stop that must stay drawn regardless of the spotlight
 * (a member of an expanded station, a transfer endpoint).
 */
export type StopFeatureState = 'focused' | 'hovered' | 'onRoute' | 'kept';

/**
 * A stop is "special" when it must stay visible and clickable at any zoom.
 * Which states qualify is an app decision: an editor exempts the stops it is
 * holding open, a viewer exempts the one the pointer is on.
 */
export function specialStop(
  states: readonly StopFeatureState[]
): ExpressionSpecification {
  return [
    'any',
    ...states.map((state) => ['boolean', ['feature-state', state], false]),
  ] as unknown as ExpressionSpecification;
}

/**
 * Keep special stops at full opacity and dim everything else to `dim`. Shared
 * by the fade's full-zoom stop and the station-dot opacity so the two stay in
 * lockstep.
 */
export function specialOrDim(
  special: ExpressionSpecification,
  dim: number
): ExpressionSpecification {
  return ['case', special, 1, dim] as unknown as ExpressionSpecification;
}

/**
 * Everything that isn't a special stop is gone. Used as the bottom stop of
 * both fade bands, below which the map shows routes only.
 */
export function specialOnly(
  special: ExpressionSpecification
): ExpressionSpecification {
  return ['case', special, 1, 0] as unknown as ExpressionSpecification;
}

/**
 * The two nested zoom bands the stop layers fade through:
 *
 *   < stationMin   nothing but special stops
 *   ~ stationMax   stations and child nodes have faded in
 *   ~ stopMax      plain stops (location_type 0) have faded in
 *
 * Stations get the gentler band because they're far more spaced out: a
 * zoomed-out view of them still reads as a network, where the same view of
 * every plain stop reads as a pile of dots.
 *
 * A feed with only a handful of stops turns the fade off (`faded: false`)
 * rather than changing the zooms: it still needs `stopMax` as the top of the
 * click-area ramp.
 */
export interface StopFadeBands {
  stationMin: number;
  stationMax: number;
  stopMin: number;
  stopMax: number;
}

/**
 * Opacity for the stop layers. Special stops are exempt at every zoom. When
 * `dim` is set (route spotlight active), non-special stops top out at `dim`
 * rather than 1.
 */
export function stopFadeOpacity(
  special: ExpressionSpecification,
  bands: StopFadeBands,
  faded: boolean,
  dim: number | null
): ExpressionSpecification {
  const fullZoom = dim === null ? 1 : specialOrDim(special, dim);
  if (!faded) {
    return fullZoom as unknown as ExpressionSpecification;
  }
  const stationsOnly = [
    'case',
    special,
    1,
    ['==', ['get', 'location_type'], 0],
    0,
    dim ?? 1,
  ];
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    bands.stationMin,
    specialOnly(special),
    bands.stationMax,
    stationsOnly,
    bands.stopMin,
    stationsOnly,
    bands.stopMax,
    fullZoom,
  ] as unknown as ExpressionSpecification;
}

/**
 * Opacity for the station-dot layer, which is filtered to stations and so only
 * needs the station band. Without this the white station circle fades out at
 * low zoom and leaves its black center dot floating.
 */
export function stationFadeOpacity(
  special: ExpressionSpecification,
  bands: StopFadeBands,
  faded: boolean,
  dim: number | null
): ExpressionSpecification {
  const full = dim === null ? 1 : specialOrDim(special, dim);
  if (!faded) {
    return full as unknown as ExpressionSpecification;
  }
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    bands.stationMin,
    specialOnly(special),
    bands.stationMax,
    full,
  ] as unknown as ExpressionSpecification;
}

/**
 * Hit radius for the clickarea layer, mirroring `stopFadeOpacity` so an
 * invisible stop is not hoverable: no JS-side visibility predicate to keep in
 * sync. Adjust this and `stopFadeOpacity` together, or stops become clickable
 * while invisible, which reads as a ghost-click bug.
 *
 * The top of the ramp stays larger than the biggest visual circle (a focused
 * station at high zoom) so the clickarea is the sole hit-test layer.
 */
export function stopClickAreaRadius(
  special: ExpressionSpecification,
  bands: StopFadeBands,
  faded: boolean,
  radius: number
): ExpressionSpecification {
  const highZoom = [bands.stopMax, radius, 19, radius * 1.6];
  if (!faded) {
    return [
      'interpolate',
      ['linear'],
      ['zoom'],
      ...highZoom,
    ] as unknown as ExpressionSpecification;
  }
  const stationsOnly = [
    'case',
    special,
    radius,
    ['==', ['get', 'location_type'], 0],
    0,
    radius,
  ];
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    bands.stationMin,
    ['case', special, radius, 0],
    bands.stationMax,
    stationsOnly,
    bands.stopMin,
    stationsOnly,
    ...highZoom,
  ] as unknown as ExpressionSpecification;
}

// Zoom-interpolated line widths for the cased route look. The casing is a
// darker outline drawn underneath the colored line so routes read as crisp
// ribbons over the basemap at any zoom.
//
// Selection uses a "spotlight" treatment instead of extra highlight layers:
// non-selected routes dim to low opacity and the selected route gets a width
// bump, both as paint-expression updates on the two base layers.
export const ROUTE_WIDTH_STOPS: Array<[number, number]> = [
  [10, 1.5],
  [13, 3.5],
  [16, 7.5],
];
export const ROUTE_CASING_WIDTH_STOPS: Array<[number, number]> = [
  [10, 3],
  [13, 5.5],
  [16, 10.5],
];

/**
 * Build a zoom-interpolated line-width expression. When `match` is given,
 * matched routes get their width multiplied by `bump` (the spotlight bump).
 */
export function zoomWidth(
  widthStops: Array<[number, number]>,
  match: ExpressionSpecification | null,
  bump: number
): ExpressionSpecification {
  const expr: unknown[] = ['interpolate', ['linear'], ['zoom']];
  for (const [zoom, width] of widthStops) {
    expr.push(zoom, match ? ['case', match, width * bump, width] : width);
  }
  return expr as unknown as ExpressionSpecification;
}

/** Matches the given route ids, or null for "spotlight nothing". */
export function routeMatch(
  route_ids: string[] | null
): ExpressionSpecification | null {
  if (!route_ids || route_ids.length === 0) {
    return null;
  }
  return [
    'in',
    ['get', 'route_id'],
    ['literal', route_ids],
  ] as unknown as ExpressionSpecification;
}

/** Matches no feature: the direction layer's resting state. */
export const NO_ROUTE_FILTER = [
  '==',
  ['get', 'route_id'],
  '',
] as unknown as ExpressionSpecification;

/** Route line opacity under the spotlight: matched routes full, rest dimmed. */
export function routeSpotlightOpacity(
  match: ExpressionSpecification | null,
  dim: number
): ExpressionSpecification | number {
  return match
    ? (['case', match, 1, dim] as unknown as ExpressionSpecification)
    : 1;
}

/**
 * Lift the spotlighted routes above everything else. line-sort-key is a layout
 * property, so it cannot read feature-state, but the same literal route_id
 * match used for opacity works here unchanged. Layout changes force a tile
 * re-layout, which is fine once per selection but must never be driven from
 * hover.
 */
export function routeSortKeyExpression(
  match: ExpressionSpecification | null,
  spotlightKey: number
): ExpressionSpecification {
  return match
    ? ([
        'case',
        match,
        spotlightKey,
        ['get', 'sortKey'],
      ] as unknown as ExpressionSpecification)
    : (['get', 'sortKey'] as unknown as ExpressionSpecification);
}
