## v0.14.0 (2026-09-25)

### Feat

- **pages**: show predictions as shared Sched, Pred and Delay cells

## v0.13.0 (2026-09-24)

### Feat

- read the feed catalog and examples from data.gtfs.zone

### Fix

- **map**: make the focused-vehicle halo a top-level zoom interpolate

### Refactor

- build the shell on interlocking's shared modules

## v0.12.0 (2026-09-21)

### Feat

- stack every route direction instead of tabbing between them

### Refactor

- read the realtime half from interlocking
- move seven modules into interlocking v2.1.0

## v0.11.1 (2026-09-16)

### Fix

- **css**: scan the interlocking package for Tailwind classes

## v0.11.0 (2026-09-16)

### Feat

- **load**: keep a link's feed when it fails, and make custom URLs visible

### Refactor

- consume the 35 shared modules from interlocking

## v0.10.0 (2026-09-14)

### Feat

- **modals**: hash-route the alerts and help modals, and bind keyboard shortcuts
- **map**: add the auto-zoom-to-selection toggle
- **help**: re-vendor the modal foundation and the help viewer
- **shell**: re-vendor the shell and adopt the mobile dock

### Refactor

- **navbar**: render the navbar action row from a descriptor list
- **map**: re-vendor the basemap control and go globe-only
- **map**: re-vendor the map layer stack and adopt layer-manager
- **load**: drop the cafe-car feed catalog from the load modal

## v0.9.0 (2026-08-28)

### Feat

- **help**: add a Map Key page to Reference

## v0.8.0 (2026-08-27)

### Feat

- **help**: vendor coloring-book's help modal, replacing the About modal
- **status**: roll up schedule_relationship counts on the status page
- **vehicle-page**: show schedule_relationship on the trip, route and predictions
- **render-utils**: add labels and a feed-reported badge for schedule_relationship
- **rt**: capture TripDescriptor and StopTimeUpdate schedule_relationship
- **status**: rewrite the empty state around picking a feed
- **nav**: two-line breadcrumbs, page titles and shared headers
- **nav**: drop the clear feed button
- **boot**: open the load modal when no feed is in the link

### Fix

- **breadcrumbs**: truncate long crumb labels and use full text in alert tab titles
- **route-page**: restate added-trip vehicles as feed statements, not gaps
- **vehicle-page**: widen Stop column and narrow Seq in predictions table
- **nav**: stack breadcrumb crumbs and standardize page headers

### Refactor

- **vocab**: call a static feed a scheduled feed

## v0.7.1 (2026-08-21)

### Perf

- **load**: re-vendor the feed downloader with coalesced progress

## v0.7.0 (2026-08-20)

### Feat

- **nav**: match edit's navbar, add a Clear feed button, and polish About
- **about**: restructure the About modal onto the shared blocks and add SEO metadata
- **load**: cancel a static feed download from the progress bar
- **load**: vendor the shared feed downloader
- **map**: resolve the map accent from the active theme

### Fix

- **nav**: icon-only editor link and navbar spacing
- **map**: always frame the feed on static load

## v0.6.3 (2026-08-18)

## v0.6.2 (2026-08-18)

### Fix

- **load**: do not block an http feed URL that goes through the proxy

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
- update template src path to absolute
