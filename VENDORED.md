# Vendored files

Files copied from [coloring-book](../coloring-book) are marked with a banner as the
very first lines of the file:

```ts
/* @vendored-from coloring-book:src/modules/basemap-control.ts
   @sha f9c718c
   @status verbatim */
```

`@status` is one of:
- `verbatim` — byte-identical apart from the banner. Re-sync = overwrite + re-add banner.
- `modified` — adapted. Must be followed by an `@changes` line listing what diverged,
  one bullet per change, so a re-sync knows what to re-apply.

This table is the single place to look when diffing against a newer coloring-book.
Run `pnpm vendor:check` to diff every `verbatim` entry below against the recorded SHA
in `../coloring-book` (skipped if that sibling repo isn't present).

| Local path | Source path | SHA | Status | Note |
|---|---|---|---|---|
| `src/styles/main.css` | `src/styles/main.css` | f9c718c | modified | Editor-only rules dropped, no mobile dock, daisyUI v4 color refs translated to v5 |
| `src/modules/notification-system.ts` | `src/modules/notification-system.ts` | 51e8536 | verbatim | Toast system; `notify` singleton needs `.initialize()`. Imports `renderCloseIcon` from the local `modal-utils.ts` |
| `src/modules/feed-progress-indicator.ts` | `src/modules/feed-progress-indicator.ts` | f9c718c | verbatim | Top loading bar; singleton touches `document.body` at import time |
| `src/modules/theme-controller.ts` | `src/modules/theme-controller.ts` | f9c718c | verbatim | Replaces the inline theme toggle that never applied `data-theme` |
| `src/modules/panel-resizer.ts` | `src/modules/panel-resizer.ts` | f9c718c | modified | Persists `--panel-width` to localStorage; adds `restorePanelWidth()` |
| `src/modules/bottom-sheet.ts` | `src/modules/bottom-sheet.ts` | f9c718c | modified | Dock and TabManager stripped; re-activates across the 768px breakpoint; `coveredHeight()`/`onSnapChange()` added for map padding |
| `src/modules/basemap-styles.ts` | `src/modules/basemap-styles.ts` | f9c718c | verbatim | Six raster basemaps; all glyph-less, so no `symbol` text layer can render over them |
| `src/modules/basemap-control.ts` | `src/modules/basemap-control.ts` | f9c718c | modified | Appearance is injected and persisted; projection/sky block deduped; one-shot stylesheet |
| `src/modules/layer-manager.ts` | `src/modules/layer-manager.ts` | f9c718c | modified | Fed from `GTFSStatic`; pathways/levels/editing dropped; route layers absorbed from `route-renderer.ts`; realtime vehicles added; route layers sorted by `sortKey` with a focus lift in `applySpotlight`; `casingColor` moved out to `utils/route-colors.ts`; stop paint delegated to the vendored `stop-layer-style.ts`, with a hardcoded red accent in place of coloring-book's resolved theme color |
| `src/modules/route-sort.ts` | `src/modules/route-sort.ts` | 50657d9 | verbatim | Paint order for route lines. `routeTypeRank` maps a GTFS `route_type` (base or extended) to a rank — subway on top, bus at the bottom — and `routeSortKey` blends in a log-scaled trip count as the within-mode tiebreaker. Feeds `line-sort-key` on the three route layers |
| `src/utils/route-colors.ts` | `src/utils/route-colors.ts` | 83ba9b9 | verbatim | Route fill, line casing, and badge text color. A feed that omits `route_color` gets a hue hashed from `route_id`, rendered through OKLCH at fixed lightness/chroma so hashed routes read at one visual weight rather than HSL's wildly uneven ramp. `HASH_LIGHTNESS`/`HASH_CHROMA`/`HUE_STEP`/`CASING_FACTOR` are the tuning dials. Consumed by `GTFSStatic.ingestRoutes` and `layer-manager.ts` |
| `src/types/page-state.ts` | `src/types/page-state.ts` | f9c718c | modified | Five variants only; `vehicle`/`alert` added, `direction_id` on route; sync `StateValidator` |
| `src/modules/page-state-manager.ts` | `src/modules/page-state-manager.ts` | f9c718c | modified | Breadcrumbs synchronous and injected; feed URLs merged into the hash; singleton dropped |
| `src/modules/search-controller.ts` | `src/modules/search-controller.ts` | 5e790a4 | verbatim | The map search box. Data-source agnostic: entries come from `search-entries.ts`, selection hands a `PageState` back to `AppState.setFocus`. Needs `#map-search` inside `#map-search-card`. `SearchEntry.priority` (lower sorts first) lets adapters bucket by type while `SearchController` stable-sorts within a bucket by uFuzzy quality |
| `src/modules/load-modal.ts` | `src/modules/load-modal.ts` | 9491e81 | verbatim | The one way into a feed: examples, the rt.gtfs.zone catalog, the TransitLand atlas, hand-typed URLs and file upload on one screen. `showLoadModal(current, { realtime })` is the only axis the two apps disagree on — with `realtime: false` (coloring-book) the RT section, its fields and every rt-only atlas row are not emitted and a static source alone is complete. `extraActions` appends action-bar buttons (coloring-book puts "New Empty Feed" there) |
| `src/modules/feed-selection.ts` | `src/modules/feed-selection.ts` | 200966a | verbatim | The `FeedSelection` model, the CORS proxy rules, and the error describers. `isComplete`/`describeMissing` take a `requireRealtime` flag defaulting to true, so test-track's call sites read unchanged |
| `src/modules/feed-catalog.ts` | `src/modules/feed-catalog.ts` | 200966a | verbatim | cafe-car's public `GET /feeds`, resolved against `RT_BASE` |
| `src/modules/feed-url-resolve.ts` | `src/modules/feed-url-resolve.ts` | 200966a | verbatim | `RT_BASE` (re-exported from each app's `CONFIG`, since coloring-book has no local feed server), `normalizeFeedUrl`, `validateFeedUrl`, `isLocalUrl`, `splitInnerZipPath` |
| `src/modules/examples.ts` | `src/modules/examples.ts` | 200966a | verbatim | Curated ready-to-load feeds. An entry may set `realtime: null` when the agency publishes no GTFS-RT — it still fills the static slot here |
| `scripts/generate-atlas-data.ts` | `scripts/generate-atlas-data.ts` | 200966a | verbatim | Builds `public/atlas-feeds.json` from the transitland-atlas DMFR corpus, one row per source kind. `--static-only` drops the rt rows; coloring-book passes it, test-track does not |
| `src/modules/scs.ts` | `src/modules/scs.ts` | 3f42194 | verbatim | Shortest common supersequence. Now folds pairwise over an exact iterative O(n·m) two-sequence DP (no k-way memo, no `MAX_MEMO_SIZE` fallback), so multi-pattern routes no longer degrade to concatenation. `route-sequence.ts` still folds pairwise and does its own alignment walk |
| `src/modules/route-source.ts` | `src/modules/route-source.ts` | 9f1f986 | verbatim | The `RouteSource` interface the route engine reads through. test-track's `GTFSStaticRouteSource` (not vendored, app-specific) adapts `GTFSStatic` to it |
| `src/modules/route-sequence.ts` | `src/modules/route-sequence.ts` | 9f1f986 | verbatim | Canonical stop order per direction: pattern grouping, Kahn topo sort, SCS fallback fold, `positionOf`. Originated in test-track; coloring-book is now the canonical source, so this row still flows coloring-book -> test-track like every other |
| `src/modules/route-graph.ts` | `src/modules/route-graph.ts` | 9f1f986 | verbatim | Branch lane sweep over `route-sequence.ts`'s pattern positions; express-bypass vs. real-branch classification |
| `src/modules/route-strip.ts` | `src/modules/route-strip.ts` | f7a054d | verbatim | Rail SVG path builders and the endpoint/minority fact helpers, extracted from what used to be module-private code in `route-page.ts`. Also owns stop-row highlighting: `STRIP_ROW_CLASS` on a row scopes the hover that scales the dot, and `railCell`'s `stop_id` option turns the dot into a button each app wires itself |
| `src/modules/stop-layer-style.ts` | `src/modules/stop-layer-style.ts` | cfecd04 | verbatim | How a stop circle looks: the `location_type` radius ramp and fill, the stop casing, and the focus/hover halo, ring, and focus-top redraw, as pure MapLibre expression builders. Selection is carried by the halo, never by size, so a focused plain stop can never outgrow an unfocused station. The accent, the plain-stop colors, and the zoom fade come in as arguments, since each app resolves those differently |
| `src/utils/issue-card.ts` | `src/utils/issue-card.ts` | a515310 | modified | `renderIssueCard(title, rows)`: the warning card of label/count/note rows, empty when every count is zero. Extracted in coloring-book from the block `status-page.ts` had repeated in `renderMapIssues` and `renderStationIssues`, which now both call it. `renderPaddedColumns` stays bespoke: its label and note carry inline `font-mono` markup that an escaping helper cannot pass through |
