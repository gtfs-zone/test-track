## v0.6.1 (2026-08-15)

### Fix

- **modal**: match coloring-book's modal width and re-vendor load-modal

### Refactor

- **icons**: replace glyph characters with svg icons
- **load**: vendor the unified load modal from coloring-book

## v0.6.0 (2026-08-15)

### Feat

- **map**: adopt shared stop focus halo styles
- **map**: light a stop while its route-strip row is hovered
- **route-page**: scale a stop's dot when its strip row is hovered

### Refactor

- **status**: source the issue card from coloring-book

## v0.5.2 (2026-08-05)

### Refactor

- source the route engine from coloring-book

## v0.5.1 (2026-08-04)

## v0.5.0 (2026-08-04)

### Feat

- **load**: one modal for every way of choosing a feed
- **examples**: add nine verified agency feeds
- **static**: support a zip nested inside the static feed zip

### Refactor

- **status**: make the right panel read-only

## v0.4.0 (2026-08-03)

### Feat

- **map**: draw focused-route vehicles above the rest
- **map**: fade stations by zoom on a gentler band than plain stops
- **map**: vendor route coloring from coloring-book
- **map**: dim vehicles that are not on the focused route
- **map**: order route lines by mode, trip count, and focus
- **search**: prioritize stations, then routes, then stops/vehicles
- **search**: wire up the map search box

## v0.3.3 (2026-08-02)

### Fix

- overhaul feed URL inputs and support localhost endpoints

## v0.3.2 (2026-08-02)

### Fix

- fix version slug

## v0.3.1 (2026-08-02)

## v0.3.0 (2026-08-02)

### Feat

- zoom to full feed on unfocus
- **nav**: add editor link for the loaded feed
- **route**: place vehicles from their reported stop_id
- **status**: report vehicles missing current_stop_sequence
- **rt**: derive current_stop_sequence from trip updates
- **route**: draw genuine branches as a multi-lane rail
- **dev**: proxy the local music-student stack through vite
- **nav**: reload feed button and RT refresh-rate dropdown
- **map**: vehicle styling and camera focus/follow
- **stops**: aggregate platforms on the station page
- **object-pages**: route strip, stop, vehicle and alert pages
- **map**: layer stack, selection, and basemap/projection control
- **state**: raw-row static model, page state, and feed URLs in the hash
- **feed-loading**: require static + realtime, fix atlas data, add status page
- **shell**: rebuild app shell on coloring-book's two-column layout
- **feed-config**: replace inline inputs with Load dropdown wiring all three modals
- **manual-load-modal**: add showManualLoadModal with URL/file inputs and CORS toggle
- **examples**: add examples module with showExamplesModal
- **atlas-search**: add atlas-search module with fuzzy search and RT badges
- **scripts**: add generate-atlas-data script with RT feed support
- **modal-utils**: sync from coloring-book

### Fix

- **rt**: treat absent numeric fields as absent, not zero
- **route**: keep branch legs contiguous and merges unbroken
- **stops**: inherit coordinates from parent station when a stop's own are missing
- **route**: topological stop ordering and station collapse
- **rt**: filter stop predictions by direction
- **nav**: use the real heroicons arrow-path for reload
- **rt**: distinguish absent protobuf fields from proto2 defaults
- **time**: render transit times in the feed's timezone
- **feeds**: Columbia County URL and honest network errors
- **map**: readiness gate, click-away, focus hygiene, vehicle identity
- **scs**: re-vendor pairwise-fold SCS

## v0.2.0 (2026-05-04)

### Feat

- show app version as supertext in navbar
- add About button to navbar and wire up about modal
- add modal-utils and about-modal module
- inject __APP_VERSION__ at build time via vite define

## v0.1.0 (2026-04-29)

### Feat

- add CORS proxy checkbox to feed config card
- add GTFS-RT polling and full UI wiring for phase 4
- add GTFSStatic parser and MapController for static feed rendering
- add static HTML shell with navbar, feed config card, stop sheet, and alerts modal
- scaffold Vite + Tailwind v4 + DaisyUI v5 toolchain

### Fix

- fix opacity
- update copier src path to absolute
