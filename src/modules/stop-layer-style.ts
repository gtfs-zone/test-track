/* @vendored-from coloring-book:src/modules/stop-layer-style.ts
   @sha cfecd04
   @status verbatim */
/**
 * How a stop circle looks on the map: radius, fill, casing, and the focus /
 * hover halo, as pure MapLibre expression builders.
 *
 * Selection is carried by the halo, never by size. Radius encodes
 * location_type and nothing else, or a focused plain stop would outgrow an
 * unfocused station and the size hierarchy would lie. Hover is the same halo
 * at a lower opacity, so the two never look alike but also never need a second
 * pair of layers.
 *
 * Pure builders only - no DOM, no map handle, no `this`, no app types. The
 * accent color, the plain-stop colors, and the zoom fade come in as arguments,
 * because each app resolves those differently. Callers own `addLayer`, the
 * source, the filter, and the layer order.
 */

import type {
  CircleLayerSpecification,
  ExpressionSpecification,
} from 'maplibre-gl';

type CirclePaint = CircleLayerSpecification['paint'];

/** Layer ids this module paints, in the order they must be added. */
export const STOP_FOCUS_HALO_LAYER = 'stops-focus-halo';
export const STOP_FOCUS_RING_LAYER = 'stops-focus-ring';
export const STOP_FOCUS_TOP_LAYER = 'stops-focus-top';

/**
 * The two feature states the halo draws for: a clicked stop, and a stop being
 * hovered from somewhere else in the app (the timetable stop column).
 */
export const HALO_FOCUSED: ExpressionSpecification = [
  'boolean',
  ['feature-state', 'focused'],
  false,
];
export const HALO_HOVERED: ExpressionSpecification = [
  'boolean',
  ['feature-state', 'hovered'],
  false,
];
export const HALO_LIT: ExpressionSpecification = [
  'any',
  HALO_FOCUSED,
  HALO_HOVERED,
] as unknown as ExpressionSpecification;

/** Colors and sizes a caller supplies for the plain (location_type 0) stop. */
export interface StopStyleOptions {
  /** Theme accent, used by the halo, ring, and focused fill. */
  accent: string;
  /** Fill for a plain stop. */
  backgroundColor: string;
  /** Casing for a plain stop. */
  strokeColor: string;
  /** Casing width for a plain stop at the reference zoom. */
  strokeWidth: number;
  /** Radius for a plain stop at the reference zoom. */
  radius: number;
}

/**
 * Per-location-type circle radius, evaluated at one zoom stop. `scale` is the
 * multiplier relative to the reference zoom (z16). Stations are the largest so
 * they read as hubs; child node types sit in between.
 */
export function stopRadiusAt(
  plainRadius: number,
  scale: number
): ExpressionSpecification {
  return [
    'case',
    ['==', ['get', 'location_type'], 1],
    8 * scale,
    ['==', ['get', 'location_type'], 2],
    4.5 * scale,
    ['==', ['get', 'location_type'], 3],
    4.5 * scale,
    ['==', ['get', 'location_type'], 4],
    5 * scale,
    plainRadius * scale,
  ] as unknown as ExpressionSpecification;
}

/**
 * The full zoom ramp of `stopRadiusAt`. `wrap` lets a layer that only draws in
 * one feature state (the focus redraw) collapse every stop to 0 instead.
 */
export function stopRadiusByZoom(
  plainRadius: number,
  wrap: (value: ExpressionSpecification) => ExpressionSpecification = (v) => v
): ExpressionSpecification {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    11,
    wrap(stopRadiusAt(plainRadius, 0.45)),
    13.5,
    wrap(stopRadiusAt(plainRadius, 0.7)),
    16,
    wrap(stopRadiusAt(plainRadius, 1)),
    19,
    wrap(stopRadiusAt(plainRadius, 1.5)),
  ] as unknown as ExpressionSpecification;
}

/**
 * Fill for the stop circles. Focused stops invert to the accent so selection
 * survives at any zoom without a size change. Swapping the focused branch out
 * is how you go back to keeping the location_type color while selected.
 */
export function stopFillColor(
  accent: string,
  backgroundColor: string
): ExpressionSpecification {
  return [
    'case',
    HALO_FOCUSED,
    accent,
    ['==', ['get', 'location_type'], 1],
    '#ffffff', // Station: white (black inner dot drawn by the station-dot layer)
    ['==', ['get', 'location_type'], 2],
    '#f59e0b', // Entrance: amber
    ['==', ['get', 'location_type'], 3],
    '#8b5cf6', // Generic node: purple
    ['==', ['get', 'location_type'], 4],
    '#10b981', // Boarding area: green
    backgroundColor,
  ] as unknown as ExpressionSpecification;
}

/**
 * Radius of the focus halo. Fixed pixel sizes rather than a multiple of the
 * stop radius so the glow stays the same regardless of location_type.
 */
export function focusHaloRadius(): ExpressionSpecification {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    11,
    ['case', HALO_LIT, 14, 0],
    16,
    ['case', HALO_LIT, 24, 0],
    19,
    ['case', HALO_LIT, 38, 0],
  ] as unknown as ExpressionSpecification;
}

/**
 * Soft accent disc under the stop circles.
 *
 * Layer filters cannot read feature-state, so visibility is driven by
 * collapsing radius and opacity to 0 when unlit. That keeps the plain
 * setFeatureState flow working with no setFilter churn.
 */
export function focusHaloPaint(accent: string): CirclePaint {
  return {
    'circle-radius': focusHaloRadius(),
    'circle-color': accent,
    'circle-opacity': [
      'case',
      HALO_FOCUSED,
      0.18,
      HALO_HOVERED,
      0.12,
      0,
    ] as unknown as ExpressionSpecification,
    'circle-stroke-width': 0,
  };
}

/** Thin crisp ring at the halo's edge, drawn with it. */
export function focusRingPaint(accent: string): CirclePaint {
  return {
    'circle-radius': focusHaloRadius(),
    'circle-color': accent,
    'circle-opacity': 0,
    'circle-stroke-color': accent,
    'circle-stroke-width': 1.4,
    'circle-stroke-opacity': [
      'case',
      HALO_FOCUSED,
      0.9,
      HALO_HOVERED,
      0.55,
      0,
    ] as unknown as ExpressionSpecification,
  };
}

/**
 * The stop circles themselves. `fadeOpacity` is the caller's zoom fade, since
 * how far out plain stops survive is an app decision.
 */
export function stopsBackgroundPaint(
  options: StopStyleOptions,
  fadeOpacity: ExpressionSpecification
): CirclePaint {
  return {
    'circle-radius': stopRadiusByZoom(options.radius),
    'circle-color': stopFillColor(options.accent, options.backgroundColor),
    'circle-stroke-color': [
      'case',
      HALO_FOCUSED,
      '#ffffff', // Focused: white ring against the accent fill
      ['==', ['get', 'has_own_coords'], false],
      '#9ca3af', // No own lat/lon: grey stroke
      ['==', ['get', 'location_type'], 1],
      '#111111', // Station: near-black stroke
      options.strokeColor, // Plain stops: dark slate casing
    ] as unknown as ExpressionSpecification,
    // The halo carries the selection, so the focused ring stays thin instead
    // of turning the circle into a blob.
    'circle-stroke-width': [
      'interpolate',
      ['linear'],
      ['zoom'],
      11,
      ['case', HALO_FOCUSED, 1.6, 1.2],
      16,
      ['case', HALO_FOCUSED, 2, options.strokeWidth],
      19,
      ['case', HALO_FOCUSED, 2.4, options.strokeWidth + 0.8],
    ] as unknown as ExpressionSpecification,
    'circle-opacity': fadeOpacity,
    'circle-stroke-opacity': fadeOpacity,
  };
}

/**
 * Redraw of the focused stop above every other stop layer, so a neighbouring
 * circle can never paint over the thing that was just selected. Hidden by
 * collapsing radius and opacity when unfocused.
 */
export function focusTopPaint(options: StopStyleOptions): CirclePaint {
  const onlyFocused = (
    value: ExpressionSpecification | number
  ): ExpressionSpecification =>
    ['case', HALO_FOCUSED, value, 0] as unknown as ExpressionSpecification;

  return {
    'circle-radius': stopRadiusByZoom(options.radius, onlyFocused),
    'circle-color': stopFillColor(options.accent, options.backgroundColor),
    'circle-opacity': onlyFocused(1),
    'circle-stroke-color': '#ffffff',
    'circle-stroke-width': [
      'interpolate',
      ['linear'],
      ['zoom'],
      11,
      onlyFocused(1.6),
      16,
      onlyFocused(2),
      19,
      onlyFocused(2.4),
    ] as unknown as ExpressionSpecification,
    'circle-stroke-opacity': onlyFocused(1),
  };
}

/**
 * Small dot at the center of a station, marking it as one. Goes on top of the
 * white station circle, and after the focus redraw so a focused station keeps
 * its dot. `fadeOpacity` is the caller's station-band zoom fade.
 */
export function stationDotPaint(
  fadeOpacity: ExpressionSpecification
): CirclePaint {
  return {
    'circle-radius': [
      'interpolate',
      ['linear'],
      ['zoom'],
      11,
      1.3,
      16,
      2.6,
      19,
      3.8,
    ] as unknown as ExpressionSpecification,
    // White on a focused station, where the surrounding fill is the accent.
    'circle-color': [
      'case',
      HALO_FOCUSED,
      '#ffffff',
      '#111111',
    ] as unknown as ExpressionSpecification,
    'circle-opacity': fadeOpacity,
    'circle-stroke-width': 0,
  };
}
