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

  // Camera animation durations (ms). Focusing always moves the camera now;
  // these match coloring-book. The follow ease is short so it never queues
  // behind the next 15s poll.
  FOCUS_POINT_DURATION: 1500,
  FOCUS_BOUNDS_DURATION: 2000,
  FOLLOW_DURATION: 300,

  // Map spotlight — zoom range over which plain stops fade in/out. Shared
  // between LayerManager's fade-opacity expression and its click-area hit
  // radius so hidden stops are never hoverable/clickable. Changing one
  // without the other produces ghost clicks on invisible stops.
  STOP_FADE_ZOOM_MIN: 10.5,
  STOP_FADE_ZOOM_MAX: 12.5,

  // Map spotlight — the same fade applied to stations and child nodes, but
  // pitched lower. Stations are far more spaced out than plain stops, so they
  // can stay legible well past the zoom where a pile of stops turns to mush.
  // Must sit below STOP_FADE_ZOOM_MIN or the two bands overlap and stations
  // fade back out as plain stops fade in.
  STATION_FADE_ZOOM_MIN: 7.5,
  STATION_FADE_ZOOM_MAX: 9.5,

  // Map spotlight — below this many stops, the zoom fade is skipped and every
  // stop draws at full opacity. The fade exists to stop thousands of dots
  // piling up; a small feed has no pile to avoid, and the vehicle it's meant
  // to be tracking needs its one nearby stop visible at any zoom.
  STOP_FADE_MIN_STOPS: 50,

  // Map spotlight — opacity/width treatment applied when a route (and its
  // stops) is selected. Non-matching routes/stops dim; the matched route's
  // line and casing get a width bump.
  SPOTLIGHT_STOP_DIM: 0.15,
  SPOTLIGHT_ROUTE_DIM: 0.2,
  SPOTLIGHT_LINE_BUMP: 1.35,
  SPOTLIGHT_CASING_BUMP: 1.3,

  // Map spotlight — opacity for vehicles not running on the focused route.
  // Higher than the route dim: a vehicle is a small mark and needs more
  // opacity than a long line to stay legible at the same visual weight.
  SPOTLIGHT_VEHICLE_DIM: 0.25,

  // Map spotlight: zoom range over which the direction arrows on the single
  // spotlighted route fade in, and their opacity once faded in. Sits above
  // STOP_FADE_ZOOM_MAX so arrows are the last thing to appear as you zoom in.
  ROUTE_ARROW_FADE_ZOOM_MIN: 12,
  ROUTE_ARROW_FADE_ZOOM_MAX: 13.5,
  ROUTE_ARROW_OPACITY: 0.85,

  // Map spotlight — line-sort-key applied to the focused route so it paints
  // above every other route. Far above any natural key (max ~90999).
  SPOTLIGHT_SORT_KEY: 1_000_000,

  // Realtime vehicles — neutral fill for a vehicle whose trip/route cannot be
  // resolved against the schedule.
  VEHICLE_UNMATCHED_COLOR: '#94a3b8',

  // localStorage keys for map view + appearance (Plan 03 decided these are
  // deliberately *not* in the URL: they are per-device preferences, not part
  // of what a shared link describes).
  MAP_VIEW_KEY: 'tt.map.view',
  MAP_APPEARANCE_KEY: 'tt.map.appearance',

  // Debounce for persisting the map view on moveend.
  MAP_VIEW_SAVE_DEBOUNCE: 400,

  // Realtime poll interval — a per-device preference like the map view above,
  // deliberately not in the shared URL.
  RT_INTERVAL_KEY: 'tt.rt.interval',
  RT_INTERVAL_DEFAULT_MS: 15000,
  RT_INTERVAL_OPTIONS_MS: [5000, 10000, 15000, 30000, 60000],

  // Prod URL of the schedule editor (coloring-book). Hardcoded to prod on
  // purpose: dev editor URLs change often, so a shared/edit link should always
  // point at the stable public editor. It loads a scheduled GTFS via `#load=<url>`.
  EDITOR_BASE: 'https://edit.gtfs.zone',

  // Where a path-only realtime URL resolves to. Dev is the music-student
  // stack's cafe-car (`docker-compose.yml`, service `api`); prod is the
  // deployed feed server. Fetching it directly rather than through
  // a vite proxy means cafe-car's `CORS_ALLOWED_ORIGINS` has to name the dev
  // server's origin — it allows localhost:8080-8089, which covers vite's whole
  // drift range. cors.kcfam.us is a separate whitelist with its own list
  // (home-docker `local.cors_proxy_dev_origins`), covering localhost:8080-8091.
  // Lives here rather than in the vendored `feed-url-resolve.ts`
  // because coloring-book has no local feed server and wants prod always.
  RT_BASE: import.meta.env.DEV ? 'http://localhost:8000' : 'https://rt.gtfs.zone',
} as const;
