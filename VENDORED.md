# Vendored files

Files copied from a sibling repo are marked with a banner as the very first lines
of the file:

```ts
/* @vendored-from coloring-book:src/modules/basemap-control.ts
   @sha f9c718c
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

**Flow is one-way: coloring-book -> test-track -> yard-master.** Anything shared
that this repo wrote goes upstream first and is vendored back down
(`feed-download.ts` and `route-sequence.ts` both did exactly that). The exception
is `origin`, which is a file yard-master vendors straight from here because
coloring-book has no counterpart to put it in.

**Why the realtime half is `origin` rather than vendored.** coloring-book is an
editor: it reads no `.pb`, has no poller, and owns no vehicle, trip update or
service alert. A realtime module hosted there would have no caller, and its
`knip` gate would delete it on the next cleanup. yard-master *does* render
alerts and trackers, so it vendors those modules from here directly, and that is
what its `Source repo` column is for. The one-way rule is about where a file is
edited, not an obligation on one repo to host every shared file, so the realtime
set stays canonical here. The same holds for the four page renderers and the
panel dispatcher: they render GTFS-RT beside the schedule, which is a screen
coloring-book does not have.

Two `origin` rows are read at a path this repo no longer uses. `f54ae79`
(`refactor(vocab): call a static feed a scheduled feed`) renamed
`gtfs-static.ts` to `gtfs-scheduled.ts` and `gtfs-static-route-source.ts` to
`gtfs-scheduled-route-source.ts`, and `feed-session.ts` moved from `src/` to
`src/modules/`. yard-master's rows still name the old paths. They resolve today
because each is pinned to a SHA where the old path existed; they break the
moment those rows are re-vendored, and fixing them is yard-master's to do.

**What is deliberately absent.** `src/index.ts` (this app's boot order),
`src/config.ts` and `src/env.d.ts` (build and deployment constants),
`src/modules/feed-url.ts` (the `?scheduled=`/`?realtime=` query contract, which
only this app has), `src/modules/last-feed.ts` (a localStorage note of the last
feed loaded here) and `src/modules/status-page.ts` (the boot and feed-health
screen, written against this app's session) are the app itself. No sibling
vendors them and none should; they are named here so the table is a complete
map of `src/` rather than only its shared half.

This table is the single place to look when diffing against a newer source repo.
Run `pnpm vendor:check` to diff every `verbatim` entry below against its recorded
SHA (rows whose sibling repo isn't checked out are skipped).

| Local path | Source repo | Source path | SHA | Status | Note |
|---|---|---|---|---|---|
| `src/styles/main.css` | `coloring-book` | `src/styles/main.css` | 4448375 | modified | Editor-only rules dropped (CodeMirror, schedule/timetable, `.file-required`, the cupcake/night themes, and `.tab-content` renamed `.panel-scroll` since there are no tabs); daisyUI v4 color refs translated to v5, where upstream's were dead rules. The mobile dock rules are back as of Phase 5, so `--dock-height` is here again and both `#right-panel` and `.basemap-control` sit above the dock |
| `src/modules/notification-system.ts` | `coloring-book` | `src/modules/notification-system.ts` | dca23b3 | verbatim | Toast system; `notify` singleton needs `.initialize()`. Imports `renderCloseIcon` from the local `modal-utils.ts` |
| `src/modules/feed-progress-indicator.ts` | `coloring-book` | `src/modules/feed-progress-indicator.ts` | 43f3664 | verbatim | Top loading bar; singleton touches `document.body` at import time. Tracks a status and progress per operation and repaints from whichever one owns the bar, so finishing one download hands the bar back to whatever is still running instead of leaving "Complete!" at 100% |
| `src/modules/theme-controller.ts` | `coloring-book` | `src/modules/theme-controller.ts` | cbe72e1 | verbatim | Replaces the inline theme toggle that never applied `data-theme` |
| `src/modules/panel-resizer.ts` | `coloring-book` | `src/modules/panel-resizer.ts` | 146c371 | verbatim | Drag handle plus `restorePanelWidth()`, both of which went upstream in `146c371`. That commit also retyped the constructor's second argument as a structural `PanelResizeTarget` (`resizeNow`/`forceMapResize`) instead of importing `MapController`, which was the last thing keeping this row `modified` since the two repos keep that class at different paths. `MapController` here satisfies it structurally |
| `src/modules/bottom-sheet.ts` | `coloring-book` | `src/modules/bottom-sheet.ts` | b0a2ff8 | verbatim | Mobile bottom sheet and the dock behind it. Was `modified` for three things, all now upstream: `0bbea8f` parameterized `setupDock` over a `DockItem[]` so the dock is no longer wired to the editor's Files and Changes ids (and deleted `tab-manager.ts`, a no-op), and `b0a2ff8` took this repo's breakpoint re-activation and its `coveredHeight()`/`onSnapChange()`. Test-track passes Browse/Alerts/Help; `#mobile-dock` markup and the `--dock-height` rules live in `index.html` and `main.css` |
| `src/modules/basemap-styles.ts` | `coloring-book` | `src/modules/basemap-styles.ts` | ec33c12 | verbatim | Six raster basemaps; all glyph-less, so no `symbol` text layer can render over them |
| `src/modules/basemap-control.ts` | `coloring-book` | `src/modules/basemap-control.ts` | c15807b | modified | Appearance is injected and persisted; projection/sky block deduped; one-shot stylesheet; the route-geometry shape toggle was dropped with upstream's `f9c1f5b` |
| `src/modules/layer-manager.ts` | `coloring-book` | `src/modules/layer-manager.ts` | c15807b | modified | Fed from `GTFSScheduled`; pathways/levels/editing dropped; route layers absorbed from `route-renderer.ts`; realtime vehicles added; route layers sorted by `sortKey` with a focus lift in `applySpotlight`; `casingColor` moved out to `utils/route-colors.ts`; stop paint delegated to the vendored `stop-layer-style.ts`; the accent resolves from the DaisyUI theme through `utils/theme-color.ts` and repaints on `refreshAccentColor()`; small-feed stop-fade exemption from `424cbdf` wired into `setScheduledFeed` |
| `src/modules/route-sort.ts` | `coloring-book` | `src/modules/route-sort.ts` | a4b5ee1 | verbatim | Paint order for route lines. `routeTypeRank` maps a GTFS `route_type` (base or extended) to a rank — subway on top, bus at the bottom — and `routeSortKey` blends in a log-scaled trip count as the within-mode tiebreaker. Feeds `line-sort-key` on the three route layers |
| `src/utils/route-colors.ts` | `coloring-book` | `src/utils/route-colors.ts` | a4b5ee1 | modified | Route fill, line casing, and badge text color. A feed that omits `route_color` gets a hue hashed from `route_id`, rendered through OKLCH at fixed lightness/chroma so hashed routes read at one visual weight rather than HSL's wildly uneven ramp. `HASH_LIGHTNESS`/`HASH_CHROMA`/`HUE_STEP`/`CASING_FACTOR` are the tuning dials. Consumed by `GTFSScheduled.ingestRoutes` and `layer-manager.ts`. Kept `routeTextColor` (and its `luminance` helper), which knip removed upstream but `gtfs-scheduled.ts` still uses. Restored upstream in `3bb4772`, tagged `@lintignore` so knip leaves it alone, so the re-vendor that reaches this row makes it `verbatim` |
| `src/utils/theme-color.ts` | `coloring-book` | `src/utils/theme-color.ts` | a4b5ee1 | verbatim | Resolves a DaisyUI theme token to an sRGB hex MapLibre can parse, by painting the computed color into a 1x1 canvas. Cached per token, so `clearThemeColorCache()` has to run on every theme change |
| `src/types/page-state.ts` | `coloring-book` | `src/types/page-state.ts` | fcb17b2 | modified | Five variants only; `vehicle`/`alert` added, `direction_id` on route; sync `StateValidator` |
| `src/modules/page-state-manager.ts` | `coloring-book` | `src/modules/page-state-manager.ts` | fcb17b2 | modified | Breadcrumbs synchronous and injected; feed URLs merged into the hash; singleton dropped |
| `src/modules/search-controller.ts` | `coloring-book` | `src/modules/search-controller.ts` | a4b5ee1 | verbatim | The map search box. Data-source agnostic: entries come from `search-entries.ts`, selection hands a `PageState` back to `AppState.setFocus`. Needs `#map-search` inside `#map-search-card`. `SearchEntry.priority` (lower sorts first) lets adapters bucket by type while `SearchController` stable-sorts within a bucket by uFuzzy quality |
| `src/modules/load-modal.ts` | `coloring-book` | `src/modules/load-modal.ts` | 2ba42e2 | verbatim | The one way into a feed: examples, the TransitLand atlas, hand-typed URLs and file upload on one screen. `showLoadModal(current, { realtime })` is the only axis the two apps disagree on — with `realtime: false` (coloring-book) the RT section, its fields and every rt-only atlas row are not emitted and a scheduled source alone is complete. `extraActions` appends action-bar buttons (coloring-book puts "New Empty Feed" there). Returns a `LoadModalResult` union: `{ kind: 'selection' }`, `{ kind: 'continue' }` when the boot-only `continueWith` card is clicked, or null. Search and results lead the body; the Scheduled and Realtime URL blocks sit below and flash their border when a row click fills them |
| `src/modules/feed-selection.ts` | `coloring-book` | `src/modules/feed-selection.ts` | f91fd8a | verbatim | The `FeedSelection` model, the CORS proxy rules, and the error describers. `isComplete`/`describeMissing` take a `requireRealtime` flag defaulting to true, so test-track's call sites read unchanged |
| `src/modules/about-links.ts` | `coloring-book` | `src/modules/about-links.ts` | 2c858bf | verbatim | The About modal's shared blocks: version/source, the project and sibling-app links, the GTFS resources list, and the feedback list. Each app passes its own `AboutApp` (name, blurb, repo, sibling) and keeps its own middle sections; coloring-book adds Keyboard Shortcuts and a Map Key between Project and Resources, test-track has none |
| `src/modules/feed-download.ts` | `coloring-book` | `src/modules/feed-download.ts` | 43f3664 | verbatim | `downloadWithProgress` (byte progress over a streamed body, `AbortSignal`-aware), `downloadPercent` (clamped at 100, since a gzipped transfer reports compressed bytes in `Content-Length`), `formatBytes`, and `LoadCancelledError`. Progress callbacks are coalesced to one per 100ms (plus a final exact one), and the body comes back as a `Blob` assembled from the chunks rather than a merged `ArrayBuffer`, so a large feed is not copied twice through the JS heap. Originated as test-track's private downloader in `gtfs-scheduled.ts`; written into coloring-book first so vendoring still flows one way. DOM-free on purpose |
| `src/modules/feed-url-resolve.ts` | `coloring-book` | `src/modules/feed-url-resolve.ts` | 2d40667 | verbatim | `RT_BASE` (re-exported from each app's `CONFIG`, since coloring-book has no local feed server), `normalizeFeedUrl`, `validateFeedUrl`, `isLocalUrl`, `splitInnerZipPath` |
| `src/modules/examples.ts` | `coloring-book` | `src/modules/examples.ts` | 7671610 | verbatim | Curated ready-to-load feeds. An entry may set `realtime: null` when the agency publishes no GTFS-RT — it still fills the scheduled slot here |
| `src/modules/breadcrumb-trail.ts` | `coloring-book` | `src/modules/breadcrumb-trail.ts` | 138a116 | verbatim | The crumb type vocabulary (`STOP_TYPE_LABELS`, `stopTypeLabel`), the `BreadcrumbItem` shape, the two-line crumb render (`renderBreadcrumbTrail`), the header eyebrow, and `pageTitle`. Only the shell: which crumbs a page state has and how their labels are looked up stays in each app's own `breadcrumbs.ts`, since the variant sets and the label sources differ. The trail is a plain flex-wrap `<ol>`, not daisyUI's `breadcrumbs` component, which lays out `li` and `li > *` as centred flex rows and flattens each crumb's type-over-name stack |
| `src/modules/breadcrumbs.ts` | — | — | — | origin | Not vendored: this repo's own crumb build (the variant switch, the label lookups, `stopAncestors`, `vehicleRouteId`, `alertParent`, `validateState`), consuming `breadcrumb-trail.ts`. Listed because yard-master vendors *this* file, so a diff against yard-master starts here rather than upstream |
| `scripts/generate-atlas-data.ts` | `coloring-book` | `scripts/generate-atlas-data.ts` | f91fd8a | verbatim | Builds `public/atlas-feeds.json` from the transitland-atlas DMFR corpus, one row per source kind. `--schedule-only` drops the rt rows; coloring-book passes it, test-track does not |
| `src/modules/scs.ts` | `coloring-book` | `src/modules/scs.ts` | 1a77bff | verbatim | Shortest common supersequence. Now folds pairwise over an exact iterative O(n*m) two-sequence DP (no k-way memo, no `MAX_MEMO_SIZE` fallback), so multi-pattern routes no longer degrade to concatenation. `route-sequence.ts` still folds pairwise and does its own alignment walk |
| `src/types/gtfs-flex.ts` | `coloring-book` | `src/types/gtfs-flex.ts` | d66a68b | modified | `StopTimeRef`, the generalized form of a stop_time's single reference (stop, location group or on-demand zone), which the route sequence pipeline is keyed on since `850caff`. Types only here; the row helpers that parse a `StopTimes` entity stay upstream |
| `src/modules/route-source.ts` | `coloring-book` | `src/modules/route-source.ts` | dca23b3 | verbatim | The `RouteSource` interface the route engine reads through. test-track's `GTFSScheduledRouteSource` (not vendored, app-specific) adapts `GTFSScheduled` to it, now including the flex name lookups (`locationGroupName`, `zoneName`, `refName`) that adapter answers with `undefined` |
| `src/modules/route-sequence.ts` | `coloring-book` | `src/modules/route-sequence.ts` | dca23b3 | verbatim | Canonical stop order per direction: pattern grouping, Kahn topo sort, SCS fallback fold, `positionOf`. Originated in test-track; coloring-book is now the canonical source, so this row still flows coloring-book -> test-track like every other. Elements carry a `StopTimeRef`, not a bare `stop_id`, and `bfe6fe8` realigns visit indices across patterns by LCS so loop routes stop falling onto the fold |
| `src/modules/route-graph.ts` | `coloring-book` | `src/modules/route-graph.ts` | dca23b3 | verbatim | Branch lane sweep over `route-sequence.ts`'s pattern positions; express-bypass vs. real-branch classification |
| `src/modules/route-strip.ts` | `coloring-book` | `src/modules/route-strip.ts` | dca23b3 | verbatim | Rail SVG path builders and the endpoint/minority fact helpers, extracted from what used to be module-private code in `route-page.ts`. Also owns stop-row highlighting: `STRIP_ROW_CLASS` on a row scopes the hover that scales the dot, and `railCell`'s `stop_id` option turns the dot into a button each app wires itself. test-track does not pass `stop_id`: its whole strip row is the link to the stop page, so the dot stays decoration here |
| `src/modules/stop-layer-style.ts` | `coloring-book` | `src/modules/stop-layer-style.ts` | cfecd04 | verbatim | How a stop circle looks: the `location_type` radius ramp and fill, the stop casing, and the focus/hover halo, ring, and focus-top redraw, as pure MapLibre expression builders. Selection is carried by the halo, never by size, so a focused plain stop can never outgrow an unfocused station. The accent, the plain-stop colors, and the zoom fade come in as arguments, since each app resolves those differently |
| `src/utils/issue-card.ts` | `coloring-book` | `src/utils/issue-card.ts` | 1c16f14 | verbatim | `renderIssueCard(title, rows)`: the warning card of label/count/note rows, empty when every count is zero. Extracted in coloring-book from the block `status-page.ts` had repeated in `renderMapIssues` and `renderStationIssues`, which now both call it. A row may carry an optional `action` button in its header, stamped with `data-issue-action` for the host to delegate on; test-track sets none. `renderPaddedColumns` stays bespoke: its label and note carry inline `font-mono` markup that an escaping helper cannot pass through |
| `src/utils/escape-html.ts` | `coloring-book` | `src/utils/escape-html.ts` | b19718e | verbatim | Regex-based HTML escaping for string-building renderers, avoiding a detached-DOM-node allocation per call. Pulled in as a dependency of `help-modal.ts` |
| `src/modules/help-modal.ts` | `coloring-book` | `src/modules/help-modal.ts` | 2302e2e | verbatim | The sidebar help viewer: renders `HELP_PAGES` grouped by `HelpGroup`, tracks first-run "don't show again" state in localStorage, and exports the shared `eyebrow`/`lede`/`footnote`/`glyphList` render helpers. Fully generic over the page registry, so nothing here differs between apps |
| `src/modules/help-pages.ts` | `coloring-book` | `src/modules/help-pages.ts` | 2302e2e | modified | Replaces the old standalone `about-modal.ts` as the app's help entry point. Editor-only pages dropped (Getting Started/Shapes/Fares/Map Key/Keyboard Shortcuts); `HELP_PAGES` is just `[welcomePage, aboutPage]`. Welcome copy rewritten for viz.rt.gtfs.zone (live vehicle map, not the GTFS editor). `aboutPage` reuses the `AboutApp` config that used to live in `about-modal.ts`. `setHelpRuntimeData` narrowed to `{ version }` only, since test-track has no keyboard-shortcut registry |
| `src/modules/modal-utils.ts` | `coloring-book` | `src/modules/modal-utils.ts` | 9fb9de2 | modified | `showModal` and the icon builders. See the banner's `@changes`: three icons added and a wider modal box with a drawn close button. Every one of those is upstream at HEAD now, `renderWarningIcon` last, in `039b6bd`, so Phase 7 fast-forwards this to `verbatim` against a copy that is a strict superset |
| `scripts/vendor-check.ts` | `yard-master` | `scripts/vendor-check.ts` | 5dc61ef | modified | The two-pass drift and staleness checker behind `pnpm vendor:check`. The one row where the flow runs backwards: yard-master wrote the five-column, `Source repo`-aware form and this repo adopted it in Phase 1. Only the doc comment differs |
| `src/gtfs-rt.ts` | — | — | — | origin | Not vendored: the GTFS-RT decoder and poller, the `TripUpdate` / `VehiclePosition` / `ServiceAlert` / `AlertRecord` types, and the `present`/`presentNumber` guards every panel module reads a payload field through. yard-master vendors it `modified`, having dropped the decoder and the poller so protobufjs tree-shakes out |
| `src/modules/rt-index.ts` | — | — | — | origin | Not vendored: indexes the live payloads by trip and stop, including the derived `current_stop_sequence`. yard-master vendors it `verbatim` |
| `src/modules/alerts.ts` | — | — | — | origin | Not vendored: alert lookups by route, stop and trip over the session's alert map. yard-master vendors it `verbatim` |
| `src/modules/feed-time.ts` | — | — | — | origin | Not vendored: `adoptFeedTimezone` and the feed-local clock helpers, so every transit time renders against the feed's zone rather than the browser's. yard-master vendors it `verbatim` |
| `src/modules/render-utils.ts` | — | — | — | origin | Not vendored: the shared page furniture: `escHtml`, `entityLink`, `routeBadge`, the raw-column table, the time and delay formatters, and the `schedule_relationship` vocabulary (`TRIP_SCHEDULE_RELATIONSHIP_LABELS`, `STOP_TIME_SCHEDULE_RELATIONSHIP_LABELS`, `feedMark`, `tripRelationshipMark`, `stopTimeRelationshipMark`). The vocabulary is GTFS-RT's, so it belongs to the same `origin` set as the rest. yard-master vendors it `verbatim` |
| `src/gtfs-scheduled.ts` | — | — | — | origin | Not vendored: downloads and parses a GTFS zip in the browser, keeping the raw row behind every entity. yard-master vendors it `modified` at the pre-`f54ae79` path `src/gtfs-static.ts` |
| `src/modules/gtfs-scheduled-route-source.ts` | — | — | — | origin | Not vendored: the `RouteSource` adapter over `GTFSScheduled`, so the vendored route engine runs on this repo's parse. yard-master vendors it `verbatim` at the pre-`f54ae79` path `src/modules/gtfs-static-route-source.ts` |
| `src/modules/feed-session.ts` | — | — | — | origin | Not vendored: the live session, meaning the scheduled feed, the poller, and the vehicle, alert and trip-update maps. yard-master's copy is `adopted`, written there against the API and the SSE channel but deliberately shaped so the modules that read a `FeedSession` compile unchanged |
| `src/modules/app-state.ts` | — | — | — | origin | Not vendored: focus changes and feed selection. yard-master vendors it `modified`, since a feed there is an API row rather than a `FeedSelection` of URLs |
| `src/map-controller.ts` | — | — | — | origin | Not vendored: MapLibre setup, camera moves, focus and vehicle follow. coloring-book has a file of this name but it is the editor's, three times the size and built on a different model, so neither is the other's source. yard-master vendors this one `modified` |
| `src/modules/panel-renderer.ts` | — | — | — | origin | Not vendored: the panel dispatcher, its scroll and `<details>` restore, and the shared ticker. yard-master vendors it `modified` |
| `src/modules/search-entries.ts` | — | — | — | origin | Not vendored: builds `SearchController` entries from the session. coloring-book has its own, over the editor's tables; the interface between them is the vendored `search-controller.ts`, not this file. yard-master vendors this one `modified` |
| `src/modules/pages/route-page.ts` | — | — | — | origin | Not vendored: the route strip page. yard-master vendors it `modified` |
| `src/modules/pages/stop-page.ts` | — | — | — | origin | Not vendored: the stop and station page, departures included. yard-master vendors it `modified` |
| `src/modules/pages/alert-page.ts` | — | — | — | origin | Not vendored: `renderAlertList`, embedded by the route, stop and trip pages, plus the alert page itself. yard-master vendors it `modified` |
| `src/modules/pages/vehicle-page.ts` | — | — | — | origin | Not vendored and not vendored *from*: yard-master's equivalent screen is a tracker page against its own managed objects, not a copy of this one. Listed so the page set is complete |
