# Plan: Realtime GTFS-RT Visualizer (deploy-gtfs-rt #54)

## Summary

Build a single-page static site at `viz.rt.gtfs.zone` that lets users load a GTFS static feed and point at a GTFS-RT endpoint to see live vehicle positions on a map, tap stops for trip updates, and browse service alerts. Follow the coloring-book toolchain (Vite + Tailwind v4 + DaisyUI v5 + MapLibre) but keep it dramatically simpler — no editing, no undo, no tab management.

## Relevant Context

**cafe-car API** (public, no auth) — base URL `https://rt.gtfs.zone`:
- `GET /{feed_name}/vehicle_positions.pb` — live vehicle positions (GTFS-RT protobuf)
- `GET /{feed_name}/trip_updates.pb` — trip delay data (GTFS-RT protobuf)
- `GET /{feed_name}/service_alerts.pb` — service alerts (GTFS-RT protobuf)

**RT feed format**: Standard GTFS-RT protobuf (`FeedMessage`). Parse with `gtfs-realtime-bindings`.

**GTFS static**: ZIP with `stops.txt`, `routes.txt`, `shapes.txt`, `trips.txt`, `stop_times.txt`. Parse with `jszip` + `papaparse`.

**coloring-book files to copy/adapt:**
- `package.json` → trim editing deps, add `gtfs-realtime-bindings`
- `vite.config.js` → simplify (no version tracking needed initially)
- `tailwind.config.js` → copy as-is
- `postcss.config.js` → copy as-is
- `tsconfig.json` → copy as-is
- `src/index.html` navbar shell (lines 38–65, 91–116 for theme toggle) → adapt with "viz.rt.gtfs.zone" branding
- Modal pattern (`<dialog>` + `modal-box`) → reuse for alerts and feed config

**Current repo state**: Zola template — no src files yet. `build.yml` uses `zola build`; must be replaced with `npm run build`.

---

## Phase 1: Project scaffold

Replace Zola with Vite + npm, matching the coloring-book toolchain.

### Tasks
- [x] Create `package.json` based on coloring-book's, stripping editor-specific deps (`clusterize.js`, `idb`, `zod`, heavy scripts) and adding `gtfs-realtime-bindings`
- [x] Create `vite.config.js` (simplified: no git-describe versioning, same root/publicDir/build structure)
- [x] Create `tailwind.config.js` — copy from coloring-book exactly
- [x] Create `postcss.config.js` — copy from coloring-book exactly
- [x] Create `tsconfig.json` — copy from coloring-book exactly
- [x] Create `src/styles/main.css` with `@import "tailwindcss"` and `@plugin "daisyui"`
- [x] Create `public/` dir with placeholder `logo.svg` (can reuse coloring-book's)
- [x] Update `.forgejo/workflows/build.yml`: replace `zola build` with `npm ci && npm run build`; deploy `dist/` instead of `public/`
- [x] Update `.gitignore` to add `node_modules/`, `dist/`
- [x] Run `npm install` to generate `package-lock.json`

### Gotchas
- Tailwind v4 uses `@import "tailwindcss"` not `@tailwind` directives; DaisyUI v5 uses `@plugin "daisyui"` — don't use v3 syntax
- The build runner in `.forgejo/workflows/build.yml` uses `alpine-3.23` which has Node.js available via `apk add nodejs npm`
- `gtfs-realtime-bindings` latest is `1.1.1` (not `1.1.2` as originally noted); pinned to `^1.1.1`

---

## Phase 2: Static HTML shell

Build the full page layout with DaisyUI components. No JS logic yet — just the skeleton.

### Layout
```
┌─────────────────────────────────────────┐
│ navbar: viz.rt.gtfs.zone  [🌙] [alerts] │
├─────────────────────────────────────────┤
│                                         │
│  [Feed Config card - top left overlay]  │
│                                         │
│           MapLibre map                  │
│                                         │
│  [Stop bottom sheet - hidden by default]│
└─────────────────────────────────────────┘
```

### Tasks
- [x] Create `src/index.html`:
  - `<html data-theme="dark">` with `font-sans h-screen overflow-hidden`
  - Navbar (adapt coloring-book lines 42–64): title `<span class="text-primary">viz</span>.rt.gtfs.zone`, theme toggle (copy coloring-book lines 91–116), alerts button
  - Full-screen map `<div id="map" class="w-full h-full">`
  - Feed config overlay card (top-left, `absolute z-40`): static GTFS section (URL input + file upload button) and RT feed section (3 URL inputs: vehicle positions, trip updates, service alerts) + "Load" button; wrapped in `<details>` for collapsibility
  - Stop info bottom sheet: hidden `<div>` that slides up on stop click, showing stop name, trip updates list, relevant alerts
  - Alerts `<dialog>` modal with list of all service alerts
- [x] Create `src/index.ts` as empty entry point (`export {}`)

### Gotchas
- Keep the feed config card compact — consider a `<details>/<summary>` collapsible so it doesn't eat map space once loaded
- Bottom sheet on mobile: use DaisyUI drawer or a fixed bottom panel with `translate-y` toggle

---

## Phase 3: GTFS static parsing + map rendering

Load and display the static GTFS feed on the map.

### Tasks
- [x] `src/gtfs-static.ts` — `GTFSStatic` class:
  - `loadFromFile(file: File)` and `loadFromUrl(url: string)` → both call internal `parse(zip: JSZip)`
  - Parses `stops.txt` → `Map<string, Stop>` (id, name, lat, lon)
  - Parses `routes.txt` → `Map<string, Route>` (id, short_name, long_name, color, text_color, type)
  - Parses `shapes.txt` → `Map<string, [lon,lat][]>` (shape_id → coordinate array)
  - Parses `trips.txt` → `Map<string, Trip>` (trip_id → route_id, shape_id, headsign)
  - Parses `stop_times.txt` → `Map<string, string[]>` (stop_id → trip_ids that serve it)
- [x] `src/map-controller.ts` — `MapController` class:
  - `initialize(container: string)` — init MapLibre with a good default style (e.g. MapTiler or OpenFreeMap)
  - `loadStaticFeed(feed: GTFSStatic)` — add sources/layers for shapes (lines) and stops (circles)
  - Route lines colored by `route_color`; stops as small circles, larger on hover
  - `onStopClick(callback: (stopId: string) => void)` — fire when a stop is clicked
  - `showVehicles(positions: VehiclePosition[])` — add/update a `vehicles` GeoJSON source with bearing arrows
  - `clearVehicles()` / `clearStaticFeed()`

### Gotchas
- `stop_times.txt` can be huge; parse lazily or skip if not needed for the initial load (only needed for stop→trip lookups)
- MapLibre free tile options: `https://tiles.openfreemap.org/styles/liberty` (no API key needed)
- Route colors in GTFS are hex without `#`; prepend before using in MapLibre paint

---

## Phase 4: GTFS-RT polling + display

Fetch and render live data, wire up the stop tap sheet and alerts modal.

### Tasks
- [ ] `src/gtfs-rt.ts` — `GTFSRealtime` class:
  - `constructor(vehicleUrl: string, tripUpdatesUrl: string, alertsUrl: string)`
  - `start(intervalMs = 15000)` / `stop()` — poll all three endpoints
  - Uses `gtfs-realtime-bindings` to decode protobuf responses
  - Emits events: `'vehicles'`, `'tripUpdates'`, `'alerts'` with typed payloads
  - Handles CORS — endpoints must be same-origin or have CORS headers; note this in gotchas
- [ ] `src/index.ts` — wire everything together:
  - Feed config "Load" button → parse static GTFS + start RT polling
  - On `'vehicles'` event → `mapController.showVehicles()`
  - On `'alerts'` event → update alerts modal list + badge count on navbar button
  - On stop click → query trip updates for that stop's trips, show bottom sheet with:
    - Stop name + stop ID
    - List of upcoming trips with delay info (from trip updates)
    - List of alerts affecting that stop
  - Theme toggle wired up (copy ThemeController logic from coloring-book `src/modules/theme-controller.ts` or inline the 5-line version)
- [ ] Alerts modal: render each alert as a `<div class="alert">` card with header, description, cause/effect badges, affected routes/stops

### Gotchas
- `gtfs-realtime-bindings` ships ESM; import as `import { transit_realtime } from 'gtfs-realtime-bindings'`
- RT feeds are binary protobuf; fetch with `response.arrayBuffer()` not `.json()`
- CORS: the cafe-car API at `rt.gtfs.zone` must allow the `viz.rt.gtfs.zone` origin, or the user can enter a CORS proxy URL. Call this out in the UI with a note.
- vehicle bearing: use `entity.vehicle.position.bearing` to rotate a directional arrow marker
- The stop-to-trip lookup: iterate `tripUpdates` and match `stop_time_update.stop_sequence` against the static `stop_times.txt` or match by `trip.trip_id` against `stop_times` for that stop
