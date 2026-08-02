/**
 * Application-wide configuration constants.
 * All magic numbers live here — import CONFIG rather than inlining literals.
 *
 * The map block is ported from coloring-book's `src/config.ts`; only the
 * constants the layer stack actually reads were carried over.
 */
export const CONFIG = {
  // Map navigation — zoom level used when focusing a single stop or vehicle.
  STOP_FOCUS_ZOOM: 16,

  // Map spotlight — zoom range over which plain stops fade in/out. Shared
  // between LayerManager's fade-opacity expression and its click-area hit
  // radius so hidden stops are never hoverable/clickable. Changing one
  // without the other produces ghost clicks on invisible stops.
  STOP_FADE_ZOOM_MIN: 10.5,
  STOP_FADE_ZOOM_MAX: 12.5,

  // Map spotlight — opacity/width treatment applied when a route (and its
  // stops) is selected. Non-matching routes/stops dim; the matched route's
  // line and casing get a width bump.
  SPOTLIGHT_STOP_DIM: 0.15,
  SPOTLIGHT_ROUTE_DIM: 0.2,
  SPOTLIGHT_LINE_BUMP: 1.35,
  SPOTLIGHT_CASING_BUMP: 1.3,

  // Realtime vehicles — neutral fill for a vehicle whose trip/route cannot be
  // resolved against the static feed.
  VEHICLE_UNMATCHED_COLOR: '#94a3b8',

  // localStorage keys for map view + appearance (Plan 03 decided these are
  // deliberately *not* in the URL: they are per-device preferences, not part
  // of what a shared link describes).
  MAP_VIEW_KEY: 'tt.map.view',
  MAP_APPEARANCE_KEY: 'tt.map.appearance',

  // Debounce for persisting the map view on moveend.
  MAP_VIEW_SAVE_DEBOUNCE: 400,
} as const;
