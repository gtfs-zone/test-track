# Plan 04 — Map: Drawing Style, Layers, Selection, Basemap & Projection

## Summary

Bring test-track's map up to coloring-book's visual and interaction standard: zoom-scaled
stop circles with location-type coloring and focus states, invisible click-area layers,
route lines drawn from shapes with a stop-to-stop fallback, feature-state-driven
selection highlighting, and the floating basemap + projection control. Vehicles get a
proper RT-aware layer on top.

**Status: complete.** All five phases shipped. Two deliberate deviations, both agreed
with the user before implementation and detailed in the phases below: stop *labels* are
deferred (Phase 1), and route focus dims via a paint update rather than feature-state
(Phase 2).

## Relevant Context

- test-track's `MapController` (197 lines) hardcodes
  `https://tiles.openfreemap.org/styles/liberty`, adds a `NavigationControl`, and wires a
  single `stops-layer` click. No basemap switching, no projection, no route selection,
  no focus states.
- coloring-book's `LayerManager` (1076 lines) is the reference. Its stop rendering is a
  stack of four layers over one `stops` GeoJSON source with `promoteId`:
  `stops-background` (zoom-interpolated radius, `location_type`-based fill),
  `stops-station-dot` (black inner dot for `location_type == 1`), a label layer, and
  `stops-clickarea` (invisible, wider hit target whose radius collapses to 0 exactly
  where plain stops fade out, so faded stops aren't clickable — no JS-side visibility
  predicate to keep in sync).
- Selection is `feature-state`-driven: `['boolean', ['feature-state', 'focused'], false]`
  gates radius, stroke, and width in the paint expressions. This requires `promoteId` on
  the source and `setFeatureState` on change — much faster than re-setting data.
- `basemap-control.ts` (500 lines) is a DaisyUI FAB speed-dial with six styles from
  `basemap-styles.ts` (Standard/OSM, Satellite, Stamen Light, Stamen Dark, Watercolor,
  Topographic) plus a globe/mercator swap toggle. It re-applies projection and sky on
  every style change, and it owns `ShapeToggleControl` (shapes vs straight stop-to-stop
  lines) so that toggle survives basemap rebuilds.
- Decided in Plan 03: map view (center/zoom/bearing/pitch) and appearance (basemap,
  projection, shape mode) persist to `localStorage`, **not** the URL.

**Discovered while building:** coloring-book has no stop *label* layer at all — the
`.stop-name` CSS in `main.css` styles timetable header cells, not map text. Its route
layers live in `route-renderer.ts`, not `layer-manager.ts`. Both were folded into our
single `layer-manager.ts` so the post-`setStyle` re-add path has exactly one owner.

## Phase 1 — Layer manager

Create `src/modules/layer-manager.ts`, adapted from coloring-book's. This is a heavy
adaptation, not a copy: the original is bound to `GTFSParser` and the IndexedDB layer,
and carries pathway/level/editing layers we don't want.

Keep and port:
- the `stops` source with `promoteId: 'stop_id'` and the four-layer stop stack
- the zoom-interpolated radius helpers (`stopRadiusAt`, `stopFadeOpacity`) and the
  `CONFIG.STOP_FADE_ZOOM_MIN` fade behavior
- `location_type` fill colors (station white + black dot, entrance amber, node purple,
  boarding area green, plain stop = configured base color)
- the `SPECIAL_STOP` expression that keeps focused / on-route stops at full opacity and
  full hit radius while unrelated stops fade
- route line layers with a click-area line underneath

Drop: pathways, levels, add-stop/add-pathway editing affordances, file-highlight mode.

- [x] Create `src/modules/layer-manager.ts` (`@status modified`, cuts listed)
- [x] Port `CONFIG` constants used by the layers into `src/config.ts`
- [x] Feed it the in-memory model from Plan 03 instead of `GTFSParser`
- [ ] ~~Stop labels: port the label layer including the `.stop-name` z-index CSS from
      Plan 01~~ — **deliberately deferred, see below**

**Stop labels — deferred.** There is no upstream label layer to port, and all six
vendored basemaps are raster styles with no `glyphs` URL, so a MapLibre `symbol` text
layer renders nothing over them. Adding labels means adding a font-tile host to every
style (a new external dependency and a divergence from verbatim `basemap-styles.ts`).
The user chose to ship without labels rather than take that on here. Anyone picking this
up later: add `glyphs` to each entry in `basemap-styles.ts` (marking it `modified`), then
a `stops-labels` symbol layer above `stops-station-dot` with the same fade expression.

**Gotchas:** `promoteId` only works when the GeoJSON feature actually carries that
property; a stop missing `stop_id` becomes unaddressable by `setFeatureState` and will
never highlight. Filter those out at build time and count them on the status page.
Done — `buildStops` drops them and also drops stops with unparseable lat/lon, and both
counts plus the unmatched-vehicle count render in a new **Map data issues** section on
the status page (hidden entirely when all three are zero).

The click-area radius-collapses-to-zero trick depends on the exact zoom breakpoints
matching the visible layer's fade. If you adjust one, adjust both, or stops become
clickable while invisible (or vice versa) — which reads as a ghost-click bug. Both read
`CONFIG.STOP_FADE_ZOOM_MIN` / `_MAX`, so the coupling is at least named.

## Phase 2 — Route rendering

Routes draw from `shapes.txt` when available and fall back to straight stop-to-stop
lines when a trip has no `shape_id` — that fallback is also user-selectable via
`ShapeToggleControl`.

Line color comes from `route_color` with the existing `#0066ff` default; width and
casing respond to focus state. A focused route renders above the rest with its
unselected siblings dimmed, mirroring the stop fade.

- [x] Build the `routes` GeoJSON source, `promoteId: 'route_id'`, one feature per route
      (merge its trips' distinct shapes into a MultiLineString)
- [x] `routes-casing` + `routes-line` + invisible `routes-clickarea` layer stack
- [x] Focus state widens the line and dims the others
- [x] Straight-line fallback: order stops by `stop_sequence` from the representative trip
- [x] Port `ShapeToggleControl` from `basemap-control.ts` and honor its mode

**Deviation — route focus is a paint update, not feature-state.** Widening the focused
route is per-feature and would suit `feature-state`, but *dimming everything else*
cannot be: no per-feature expression knows whether some other feature is focused. Since
that needs a `setPaintProperty` call regardless, both halves go through coloring-book's
`applySpotlight` (a `['in', ['get','route_id'], ...]` match) and route focus uses no
feature-state at all. `promoteId: 'route_id'` is still set on the source, as planned, so
a future per-route state has an addressable id.

**Gotchas:** merging every shape of a high-frequency route produces enormous
MultiLineStrings with heavy overdraw. Deduplicate by `shape_id` first, and consider
keeping only the distinct shapes (many trips share one). Done — `buildRoutes` keys a
`seen` set on `shape:<id>` in shapes mode and on the joined stop-id list in stops mode,
so a route with 4000 trips over 6 shapes emits 6 line strings.

Routes must be added **below** `stops-background` so stops stay clickable on top of their
own line. Handled by ordering rather than `beforeId`: `addLayers()` calls
`addRouteLayers()` → `addStopLayers()` → `addVehicleLayers()`, and `LAYER_ORDER`
documents the resulting bottom-to-top stack.

## Phase 3 — Vehicle layer

Vehicles get their own source and layer above routes, keyed by vehicle id with
`promoteId` so a focused vehicle can highlight like anything else.

The existing canvas-drawn arrow image stays, rotated by `bearing`. Vehicles with no
bearing render as a plain circle rather than an arbitrarily-pointed arrow. Color follows
the vehicle's route color when `trip.route_id` resolves against static data, falling back
to a neutral color when it doesn't — and the count of unresolvable vehicles goes on the
status page, because that mismatch is exactly the kind of feed problem this tool exists
to surface.

- [x] `vehicles` source with `promoteId: 'vehicle_id'`, updated on each RT poll
- [x] Arrow symbol layer for vehicles with bearing, circle layer for those without
- [x] Route-color fill with neutral fallback; report unmatched count to the status page
- [x] Focus state: focused vehicle scales up and gets a halo
- [x] Smooth position updates by calling `setData` on the existing source, never
      re-adding the layer

**Discoveries.** The arrow image had to become an **SDF** (`addImage(..., {sdf: true})`):
a plain raster icon cannot be tinted, and per-vehicle route color was a requirement. It
is drawn through `ctx.filter = 'blur(2px)'` so the alpha channel has a ramp for MapLibre's
SDF shader to threshold, instead of a hard step that aliases badly.

`icon-size` is a *layout* property and MapLibre does not evaluate `feature-state` in
layout expressions, so the focused arrow cannot literally scale. Emphasis instead comes
from a dedicated `vehicles-halo` circle layer underneath (radius 0 → 18 on focus) plus an
`icon-halo-width` bump, both paint properties. Visually this reads as the planned
"scales up and gets a halo".

A vehicle's route is resolved as `routeId ?? trips.get(tripId)?.route_id` — feeds
routinely put the route only on the trip.

**Gotchas:** re-adding the source on every 15-second poll causes a visible flash and
loses feature state. Always `getSource().setData()` — `pushData()` is the only write path.

## Phase 4 — Selection and focus

Selection is bidirectional with Plan 03's `AppState`: clicking a stop, route, or vehicle
sets focus; focus set from the panel or the URL highlights on the map and eases the
camera to it.

- [x] Click handlers on `stops-clickarea`, `routes-clickarea`, and the vehicle layers →
      `AppState.setFocus(...)`
- [x] `AppState` subscription → `setFeatureState({focused:true})` on the new target,
      clear the old
- [x] Focusing a route fits bounds to the route; focusing a stop or vehicle eases to it
      at a sensible zoom without yanking the camera if it's already visible
- [x] Pointer cursor on hover for all three click-area layers
- [x] When the bottom sheet is open on mobile, apply `setBottomPadding` so the focused
      feature isn't hidden behind it

**Deviation — one map-level hit test, not three per-layer handlers.** Per-layer `click`
handlers fire independently, so a vehicle sitting on top of its own stop would emit two
selections in one click with the winner decided by registration order. Instead a single
`map.on('click')` runs `queryRenderedFeatures` against `HIT_LAYERS` in priority order
(vehicle → stop → route) and emits at most one. `mousemove` shares the same query for the
pointer cursor, so hover and click can never disagree.

`setBottomPadding` was ported by rebuilding it: coloring-book's `MapController` just
stores the number, and the sheet had no way to report its height. `BottomSheetController`
gained `coveredHeight()` and `onSnapChange()` (recorded in `VENDORED.md`), `index.ts`
pipes one into the other, and the padding feeds both `fitBounds` and `easeTo`. A point
already on screen but *behind* the sheet counts as hidden, so the camera still moves.

**Gotchas:** `setFeatureState` silently no-ops if called before the source has loaded its
data. Queue focus application until the source is present, or the first URL-restored
focus won't highlight. Handled by `syncFeatureState()`, which applies what it can, and
arms a `sourcedata` listener that re-runs until everything lands. It covers the `onRoute`
stop marks as well as `focused`, and it is also what re-applies state after a basemap
change wipes it.

## Phase 5 — Basemap and projection control

Vendor `basemap-styles.ts` verbatim and `basemap-control.ts` with light modification
(remove any coloring-book-only hooks; keep `ShapeToggleControl`, the six styles, the
globe/mercator swap, and the sky handling).

- [x] Vendor `src/modules/basemap-styles.ts` — verbatim (`pnpm vendor:check` covers it)
- [x] Vendor `src/modules/basemap-control.ts` — modified
- [x] Replace the hardcoded `STYLE_URL` in `MapController` with the control's current style
- [x] Persist basemap id, projection, and shape mode to `localStorage`; restore at boot
- [x] Persist map view (center/zoom/bearing/pitch) to `localStorage`, debounced on moveend
- [x] Confirm the mobile CSS positions `.basemap-control` clear of the bottom sheet
      (already handled by the `max-width: 767px` block Plan 01 added to `main.css`)

**Discoveries.** OpenFreeMap Liberty is gone: the user chose to vendor the six styles
verbatim and default to `standard` + globe, matching coloring-book, rather than keep the
vector basemap as a seventh entry.

The control cannot own the *first* style — constructing it needs a map, and a `setStyle`
right after load would destroy anything added in between. `initialMapStyle(appearance)`
is exported so `MapController` can build the map with the persisted basemap and
projection already applied; `applyInitialProjection` then sees a match and does nothing.

`NavigationControl` moved from bottom-right (under the basemap FAB) to bottom-left.
While there: `#map-controls` spans the full width of the map and was swallowing drags
across the top strip, so it is now `pointer-events-none` with the search card opting
back in.

**Gotchas:** `map.setStyle()` destroys every custom source and layer. coloring-book
re-adds them after the `styledata` event; that re-add path must be wired to our layer
manager or switching basemaps will blank all GTFS data. This is the highest-risk item in
this plan — test it explicitly on every one of the six styles. Wired:
`BasemapControl.applyStyle` restores the view and fires `basemap:changed` on `styledata`,
`MapController` maps that to `LayerManager.rebuild()`, and `rebuild()` is idempotent
(every `addSource`/`addLayer` is existence-guarded) because a projection swap diffs
rather than tears down. **Not verified in a browser** — per project rules, visual
verification of all six styles is the user's.

Globe projection changes what `fitBounds` does at low zoom, and the sky layer must be
removed when switching back to mercator or it renders as an artifact. `styleWithProjection`
sets `sky: undefined` explicitly on mercator rather than omitting the key.

## Done when

Stops render like coloring-book at every zoom, routes draw from shapes with a working
straight-line toggle, vehicles animate without flashing, clicking anything focuses it in
the right panel, and the basemap/projection control switches all six styles without
losing GTFS layers.

## Files touched

| File | What |
|---|---|
| `src/config.ts` | new — zoom/fade/spotlight constants and localStorage keys |
| `src/modules/layer-manager.ts` | new — stops + routes + vehicles stacks, focus, spotlight |
| `src/modules/basemap-styles.ts` | new — vendored verbatim |
| `src/modules/basemap-control.ts` | new — vendored, appearance injected and persisted |
| `src/map-controller.ts` | rewritten — owns the two above, persistence, focus camera |
| `src/modules/bottom-sheet.ts` | `coveredHeight()` + `onSnapChange()` |
| `src/modules/status-page.ts` | **Map data issues** section |
| `src/index.ts` | `onSelect` ↔ `AppState`, focus → camera, sheet → map padding |
| `src/index.html` | `#map-controls` no longer eats drags |
| `VENDORED.md` | three new rows |
