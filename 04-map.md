# Plan 04 — Map: Drawing Style, Layers, Selection, Basemap & Projection

## Summary

Bring test-track's map up to coloring-book's visual and interaction standard: zoom-scaled
stop circles with location-type coloring and focus states, invisible click-area layers,
route lines drawn from shapes with a stop-to-stop fallback, feature-state-driven
selection highlighting, and the floating basemap + projection control. Vehicles get a
proper RT-aware layer on top.

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

- [ ] Create `src/modules/layer-manager.ts` (`@status modified`, cuts listed)
- [ ] Port `CONFIG` constants used by the layers into `src/config.ts`
- [ ] Feed it the in-memory model from Plan 03 instead of `GTFSParser`
- [ ] Stop labels: port the label layer including the `.stop-name` z-index CSS from Plan 01

**Gotchas:** `promoteId` only works when the GeoJSON feature actually carries that
property; a stop missing `stop_id` becomes unaddressable by `setFeatureState` and will
never highlight. Filter those out at build time and count them on the status page.

The click-area radius-collapses-to-zero trick depends on the exact zoom breakpoints
matching the visible layer's fade. If you adjust one, adjust both, or stops become
clickable while invisible (or vice versa) — which reads as a ghost-click bug.

## Phase 2 — Route rendering

Routes draw from `shapes.txt` when available and fall back to straight stop-to-stop
lines when a trip has no `shape_id` — that fallback is also user-selectable via
`ShapeToggleControl`.

Line color comes from `route_color` with the existing `#0066ff` default; width and
casing respond to focus state. A focused route renders above the rest with its
unselected siblings dimmed, mirroring the stop fade.

- [ ] Build the `routes` GeoJSON source, `promoteId: 'route_id'`, one feature per route
      (merge its trips' distinct shapes into a MultiLineString)
- [ ] `routes-casing` + `routes-line` + invisible `routes-clickarea` layer stack
- [ ] Focus state widens the line and dims the others
- [ ] Straight-line fallback: order stops by `stop_sequence` from the representative trip
- [ ] Port `ShapeToggleControl` from `basemap-control.ts` and honor its mode

**Gotchas:** merging every shape of a high-frequency route produces enormous
MultiLineStrings with heavy overdraw. Deduplicate by `shape_id` first, and consider
keeping only the distinct shapes (many trips share one).

Routes must be added **below** `stops-background` so stops stay clickable on top of their
own line — coloring-book passes the beforeId explicitly when adding line layers.

## Phase 3 — Vehicle layer

Vehicles get their own source and layer above routes, keyed by vehicle id with
`promoteId` so a focused vehicle can highlight like anything else.

The existing canvas-drawn arrow image stays, rotated by `bearing`. Vehicles with no
bearing render as a plain circle rather than an arbitrarily-pointed arrow. Color follows
the vehicle's route color when `trip.route_id` resolves against static data, falling back
to a neutral color when it doesn't — and the count of unresolvable vehicles goes on the
status page, because that mismatch is exactly the kind of feed problem this tool exists
to surface.

- [ ] `vehicles` source with `promoteId: 'vehicle_id'`, updated on each RT poll
- [ ] Arrow symbol layer for vehicles with bearing, circle layer for those without
- [ ] Route-color fill with neutral fallback; report unmatched count to the status page
- [ ] Focus state: focused vehicle scales up and gets a halo
- [ ] Smooth position updates by calling `setData` on the existing source, never
      re-adding the layer

**Gotchas:** re-adding the source on every 15-second poll causes a visible flash and
loses feature state. Always `getSource().setData()`.

## Phase 4 — Selection and focus

Selection is bidirectional with Plan 03's `AppState`: clicking a stop, route, or vehicle
sets focus; focus set from the panel or the URL highlights on the map and eases the
camera to it.

- [ ] Click handlers on `stops-clickarea`, `routes-clickarea`, and the vehicle layers →
      `AppState.setFocus(...)`
- [ ] `AppState` subscription → `setFeatureState({focused:true})` on the new target,
      clear the old
- [ ] Focusing a route fits bounds to the route; focusing a stop or vehicle eases to it
      at a sensible zoom without yanking the camera if it's already visible
- [ ] Pointer cursor on hover for all three click-area layers
- [ ] When the bottom sheet is open on mobile, apply `setBottomPadding` so the focused
      feature isn't hidden behind it (coloring-book's `MapController` already has this
      method — port it)

**Gotchas:** `setFeatureState` silently no-ops if called before the source has loaded its
data. Queue focus application until the source is present, or the first URL-restored
focus won't highlight.

## Phase 5 — Basemap and projection control

Vendor `basemap-styles.ts` verbatim and `basemap-control.ts` with light modification
(remove any coloring-book-only hooks; keep `ShapeToggleControl`, the six styles, the
globe/mercator swap, and the sky handling).

- [ ] Vendor `src/modules/basemap-styles.ts` — verbatim
- [ ] Vendor `src/modules/basemap-control.ts` — modified
- [ ] Replace the hardcoded `STYLE_URL` in `MapController` with the control's current style
- [ ] Persist basemap id, projection, and shape mode to `localStorage`; restore at boot
- [ ] Persist map view (center/zoom/bearing/pitch) to `localStorage`, debounced on moveend
- [ ] Confirm the mobile CSS positions `.basemap-control` clear of the bottom sheet

**Gotchas:** `map.setStyle()` destroys every custom source and layer. coloring-book
re-adds them after the `styledata` event; that re-add path must be wired to our layer
manager or switching basemaps will blank all GTFS data. This is the highest-risk item in
this plan — test it explicitly on every one of the six styles.

Globe projection changes what `fitBounds` does at low zoom, and the sky layer must be
removed when switching back to mercator or it renders as an artifact.

## Done when

Stops render like coloring-book at every zoom, routes draw from shapes with a working
straight-line toggle, vehicles animate without flashing, clicking anything focuses it in
the right panel, and the basemap/projection control switches all six styles without
losing GTFS layers.
