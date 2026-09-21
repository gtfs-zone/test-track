# Vendored files

## The shared half is mostly a dependency now

The 49 files that have moved out of the apps live in **`interlocking`**, a
git dependency shipping raw TypeScript with no build step. They are imported as
`interlocking/ui/...`, `interlocking/gtfs/...`, `interlocking/map/...` and
`interlocking/util/...`, resolved by `tsconfig.json` `paths` and a
`resolve.alias` in `vite.config.js`, both pointing at
`node_modules/interlocking/src`.

They are **not in the table below and not checked by `vendor:check`**: a package
version is the contract. A shared change there is a commit in interlocking, a
tag, and a bump in each of the three consumers. It is not edited here.

## What is still vendored

Everything below is still a hand-copied file. Each is marked with a banner as the
very first lines of the file:

```ts
/* @vendored-from coloring-book:src/modules/load-modal.ts
   @sha 619efb5
   @status verbatim */
```

Every row names its own `Source repo` and resolves against that sibling checkout
next to this one. That is `coloring-book` for every vendored row but
`scripts/vendor-check.ts`, which came from `yard-master`.

`@status` is one of:
- `verbatim`: byte-identical apart from the banner. Re-sync = overwrite + re-add
  banner.
- `modified`: adapted. Must be followed by an `@changes` line listing what
  diverged, one bullet per change, so a re-sync knows what to re-apply.
- `adopted`: this repo's file now. The banner records where it came from and
  nothing is checked, neither drift nor staleness. A file moves here when feature
  work has taken it over far enough that re-syncing has stopped being meaningful.
- `origin`: not vendored at all, but the canonical copy another repo vendors
  *from*. Carries no banner, no source repo and no SHA; listed so the table is
  the whole map of what is shared.

`adopted` exists so `verbatim` stays a contract that is actually enforced. A file
the features own will drift by design: promote it to `adopted` rather than
contorting the app to keep a row green.

**Flow is one-way: coloring-book -> test-track -> yard-master**, for what is
left. Anything still vendored that this repo wrote goes upstream first and is
vendored back down. The rule no longer covers the shared half that moved to
`interlocking`, which is edited there and reaches all three repos as a version
bump; coloring-book is not its upstream any more. The other exception is
`origin`, which is a file yard-master vendors straight from here because
coloring-book has no counterpart to put it in.

**Why the realtime half is `origin` rather than vendored.** coloring-book is an
editor: it reads no `.pb`, has no poller, and owns no vehicle, trip update or
service alert. A realtime module hosted there would have no caller, and its
`knip` gate would delete it on the next cleanup. The one-way rule is about where
a file is edited, not an obligation on one repo to host every shared file, so
the realtime set stayed canonical here. Most of it has since moved on to
`interlocking` — `rt-types`, `feed-session`, `rt-index`, `alerts` and
`entity-render`, the last of which is this repo's old `render-utils.ts` — and
what is left under `origin` is the half that is this app's own: the decoder and
poller, the session that drives them, and the four page renderers and panel
dispatcher, which render GTFS-RT beside the schedule on a screen coloring-book
does not have.

**What is deliberately absent.** `src/index.ts` (this app's boot order),
`src/config.ts` and `src/env.d.ts` (build and deployment constants),
`src/modules/feed-url.ts` (the `?scheduled=`/`?realtime=` query contract, which
only this app has), `src/modules/last-feed.ts` (a localStorage note of the last
feed loaded here), `src/modules/status-page.ts` (the boot and feed-health
screen, written against this app's session) and the two descriptor lists the
shared renderers are parameterized over, `src/modules/navbar-action-list.ts` and
`src/modules/shortcut-list.ts`, are the app itself. No sibling
vendors them and none should; they are named here so the table is a complete
map of `src/` rather than only its shared half.

This table is the single place to look when diffing against a newer source repo.
Run `pnpm vendor:check` to diff every `verbatim` entry below against its recorded
SHA (rows whose sibling repo isn't checked out are skipped).

| Local path | Source repo | Source path | SHA | Status | Note |
|---|---|---|---|---|---|
| `src/styles/main.css` | `coloring-book` | `src/styles/main.css` | b8dfba9 | modified | Editor-only rules dropped (CodeMirror, schedule/timetable, `.file-required`, the cupcake/night themes, and `.tab-content` renamed `.panel-scroll` since there are no tabs); daisyUI v4 color refs translated to v5, where upstream's were dead rules. The mobile dock rules are back as of Phase 5, so `--dock-height` is here again and both `#right-panel` and `.basemap-control` sit above the dock |
| `src/modules/layer-manager.ts` | `coloring-book` | `src/modules/layer-manager.ts` | 0d38e50 | adopted | Promoted from `modified` in Phase 8, once the shared half of the file became `layer-specs.ts` and `stop-layer-style.ts`, now both in `interlocking`. What is left is this app's own half: the three sources (`routes`, `stops`, `vehicles`), what fills them from `GTFSScheduled` and the poller, the feature-state sync with its `sourcedata` retry, the realtime vehicle layer stack, and the single map-level hit test. Upstream's remaining manager is the editor's, on `GTFSParser` / IndexedDB with pathways, levels, flex zones, transfers and the editing affordances, so re-syncing against it has stopped being meaningful and the two spec files carry the contract instead, as package modules. The banner lists what was taken (`aff09db`, `7e77889`, `dc1d421`'s stop half, `767ac02`, `cef96c7`) and what was not, with reasons |
| `src/types/page-state.ts` | `coloring-book` | `src/types/page-state.ts` | ce1bfa0 | modified | Five variants only; `vehicle`/`alert` added, `direction_id` on route; sync `StateValidator`; `pageStatesEqual` and `sameLocation`, which compare the location and the modal separately. `1c16f14`'s modal dimension is taken as of Phase 12, with this repo's own `MODAL_TYPES` (`alerts`, `help`) in place of upstream's editor modals, and no `TimetableModalState`/`PaneModalState` split because neither modal needs more than one optional selector. `modal_page` names the guide page the modal opens on, not the one showing: `interlocking`'s `sidebar-modal.ts` has no pane-change hook |
| `src/modules/page-state-manager.ts` | `coloring-book` | `src/modules/page-state-manager.ts` | 1ce064d | modified | Breadcrumbs synchronous and injected; feed URLs merged into the hash; singleton dropped; `initializeFromURL` split into `pendingStateFromURL`/`adoptState`. `2287432`'s same-page guard not taken (`AppState.setFocus` already holds it). `1c16f14`'s modal dimension is taken as of Phase 12: `parseModalParams`, `clearModal`, the `modal_*` hash params and the modal-surviving home fallback. `clearModal` is async so the class satisfies `modal-router.ts`'s `ModalHost` unchanged, though `setPageState` here stays synchronous. `268411a`'s inline-edit flush and `f6506b7`'s `followRename` are both skipped: this app never writes the feed it renders |
| `src/modules/breadcrumbs.ts` | — | — | — | origin | Not vendored: this repo's own crumb build (the variant switch, the label lookups, `stopAncestors`, `vehicleRouteId`, `alertParent`, `validateState`), consuming `breadcrumb-trail.ts`. Listed because yard-master vendors *this* file, so a diff against yard-master starts here rather than upstream |
| `src/modules/help-pages.ts` | `coloring-book` | `src/modules/help-pages.ts` | 59ed6d0 | modified | Replaces the old standalone `about-modal.ts` as the app's help entry point. Editor-only pages dropped (Getting Started/Shapes/Fares/On-Demand/Publishing/Keyboard Shortcuts); `HELP_PAGES` is `[welcomePage, aboutPage, mapKeyPage]`, the last rewritten for this app's own symbology and carrying a direction-of-travel row since Phase 8 gave the spotlighted route its chevrons. Welcome copy rewritten for viz.rt.gtfs.zone (live vehicle map, not the GTFS editor). `aboutPage` reuses the `AboutApp` config that used to live in `about-modal.ts`. The Keyboard Shortcuts page is back as of Phase 12, once `d8afa32` parameterized `keyboard-shortcuts.ts` over an app-supplied command list: `buildShortcutsTable` and the `shortcuts` half of `setHelpRuntimeData` are upstream's, fed from `shortcut-list.ts` through `describeShortcuts()`. Since `1eb424b` this file also owns `HELP_GROUP_ORDER` and is handed to the viewer at boot with `setHelpPages` |
| `scripts/vendor-check.ts` | `yard-master` | `scripts/vendor-check.ts` | 5dc61ef | modified | The two-pass drift and staleness checker behind `pnpm vendor:check`. The one row where the flow runs backwards: yard-master wrote the five-column, `Source repo`-aware form and this repo adopted it in Phase 1. Only the doc comment differs |
| `src/gtfs-rt.ts` | — | — | — | origin | Not vendored: the GTFS-RT decoder and poller, and the `present` guard the decoder reads a payload field through. The types it used to declare — `TripUpdate`, `ServiceAlert`, `AlertRecord`, `VehiclePosition` — and `presentNumber` are `interlocking`'s `gtfs/rt-types.ts` now, so what is left is this app's own fetching half. Nothing vendors it; listed so the map of `src/` stays complete |
| `src/modules/feed-session.ts` | — | — | — | origin | Not vendored: the live session, meaning the scheduled feed, the poller, and the vehicle, alert and trip-update maps. The four members the shared modules read are `interlocking`'s `gtfs/feed-session.ts` interface, which this class satisfies structurally; yard-master's own session satisfies the same interface from the API and its SSE channel |
| `src/modules/app-state.ts` | — | — | — | origin | Not vendored: focus changes and feed selection. yard-master vendors it `modified`, since a feed there is an API row rather than a `FeedSelection` of URLs |
| `src/map-controller.ts` | — | — | — | origin | Not vendored: MapLibre setup, camera moves, focus and vehicle follow. coloring-book has a file of this name but it is the editor's, three times the size and built on a different model, so neither is the other's source. yard-master vendors this one `modified` |
| `src/modules/panel-renderer.ts` | — | — | — | origin | Not vendored: the panel dispatcher, its scroll and `<details>` restore, and the shared ticker. yard-master vendors it `modified` |
| `src/modules/search-entries.ts` | — | — | — | origin | Not vendored: builds `SearchController` entries from the session. coloring-book has its own, over the editor's tables; the interface between them is the vendored `search-controller.ts`, not this file. yard-master vendors this one `modified` |
| `src/modules/pages/route-page.ts` | — | — | — | origin | Not vendored: the route strip page. yard-master vendors it `modified` |
| `src/modules/pages/stop-page.ts` | — | — | — | origin | Not vendored: the stop and station page, departures included. yard-master vendors it `modified` |
| `src/modules/pages/alert-page.ts` | — | — | — | origin | Not vendored: `renderAlertList`, embedded by the route, stop and trip pages, plus the alert page itself. yard-master vendors it `modified` |
| `src/modules/alerts-modal.ts` | — | — | — | origin | Not vendored and not vendored *from*: the service alerts modal, an index into the alert pages. Built on `showModal` rather than a static `<dialog>` so it joins the modal stack and `modal-router.ts` can close it. Bound to this app's page states and its navbar and dock badge ids; yard-master lists alerts on a page instead |
| `src/modules/pages/vehicle-page.ts` | — | — | — | origin | Not vendored and not vendored *from*: yard-master's equivalent screen is a tracker page against its own managed objects, not a copy of this one. Listed so the page set is complete |
