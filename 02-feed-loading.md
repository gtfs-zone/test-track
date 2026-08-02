# Plan 02 — Feed Loading: Dual-Source Requirement, Atlas Pinning, Status Page

## Summary

Rebuild feed selection around a hard requirement: **a session needs both a static GTFS
source and at least one GTFS-RT source before it can load.** Rework the three load paths
(Examples, TransitLand Atlas, Manual) to satisfy that contract, fix the atlas dataset,
and build the feed status page that becomes the right panel's content when nothing is
focused.

## Relevant Context

- Decided: hard requirement. The Load action stays disabled until both halves are chosen.
  No static-only degraded mode.
- Today `FeedConfig` (`src/modules/atlas-search.ts`) is a flat bag —
  `{staticUrl?, staticFile?, vehiclesUrl?, tripUpdatesUrl?, alertsUrl?, useCors}` — with
  every field optional and one shared `useCors`. It does not express "one static source
  plus one RT source", and `index.ts` happily loads whatever subset it gets.
- `public/atlas-feeds.json` is **currently broken**: every entry has
  `"operator_name": ""` and `"location": ""`, and `name` falls back to the raw feed id
  (`f-9q8-samtrans`). Fuzzy search over `${name} ${operator_name} ${location}` is
  therefore searching feed ids only. Cause is in `scripts/generate-atlas-data.ts`: the
  per-file `operatorMap` only sees operators declared in that same DMFR file, but
  transitland-atlas declares most operators in separate `operators/` files, so the
  lookup misses.
- A single DMFR feed entry can carry both `static_current` and realtime URLs, but the
  atlas UI must present **rt and static as separately labeled, separately selectable
  rows** (decided).
- `feedProgressIndicator` from Plan 01 is the loading bar for everything here.

## Phase 1 — The feed selection model

Replace `FeedConfig` with an explicit two-slot model in a new
`src/modules/feed-selection.ts`.

```ts
export type StaticSource =
  | { kind: 'url'; url: string; useCors: boolean }
  | { kind: 'file'; file: File };

export interface RealtimeSource {
  vehiclesUrl?: string;
  tripUpdatesUrl?: string;
  alertsUrl?: string;
  useCors: boolean;
  label: string;      // shown in status page / atlas pin
}

export interface FeedSelection {
  static: StaticSource | null;
  realtime: RealtimeSource | null;
}

export function isComplete(sel: FeedSelection): boolean;   // both non-null AND rt has >=1 url
export function describeMissing(sel: FeedSelection): string; // "Choose a static feed"
```

`useCors` moves per-source, because an atlas static feed and an `rt.gtfs.zone` RT feed
have genuinely different proxy needs.

- [ ] Create `src/modules/feed-selection.ts` with the types and the two predicates
- [ ] Delete `FeedConfig` from `atlas-search.ts`; every module imports from the new file
- [ ] Move `maybeProxy()` out of `index.ts` into `feed-selection.ts` and apply it per source

**Gotchas:** an RT source with all three URLs empty must count as incomplete —
`isComplete` checks url presence, not just non-null.

## Phase 2 — Fix the atlas dataset

`generate-atlas-data.ts` must resolve operators across the whole atlas, not per file, and
must emit one row per *source kind*.

Two-pass build: first walk every DMFR file collecting `operators[]` into a global
`Map<onestop_id, DmfrOperator>`; then walk feeds and resolve against that global map.
Emit, per DMFR feed:

- a `static` row if `urls.static_current` exists
- an `rt` row if any of the three realtime URLs exist (all three grouped into one row —
  they're one RT endpoint set from one provider)

Each row carries `kind: 'static' | 'rt'`, a stable `rowId` (`${feed.id}:static`), the feed
id, resolved operator name, short name, and location, plus the URLs.

- [ ] Restructure `generate-atlas-data.ts` into collect-operators-then-resolve-feeds
- [ ] Emit `kind`-tagged rows; add `rowId`
- [ ] Keep the local-atlas fast path and the GitHub fallback both working
- [ ] Regenerate `public/atlas-feeds.json` and spot-check that `operator_name` and
      `location` are populated for well-known agencies (MBTA, SFMTA, TriMet)
- [ ] If the file grows past a few MB, gzip it or trim unused fields — it is fetched on
      first atlas open

**Gotchas:** `deriveLocation` reads `op.places[]`; operators with no places still need a
sensible empty string, not `undefined`, or the fuzzy haystack gets `"undefined"` in it.
The local path uses `fs.readdir(..., {recursive:true})` over `feeds/` only — operators
may live outside that directory in the atlas layout; check before assuming.

## Phase 3 — Atlas search with pinning

Rework `showAtlasSearchModal` into a persistent picker with two pin slots.

Behavior (as specified):
- Each result row shows a **Static** or **RT** badge reflecting its `kind`.
- Clicking a row pins it to its slot and renders it in a pinned strip above the results,
  highlighted.
- Clicking a row of a kind that is already pinned **replaces** that pin.
- Clicking the currently pinned row **unpins** it.
- Changing the search text never clears pins — pins survive re-filtering, which is the
  whole point (find the static feed, pin it, search again for the RT feed).
- The confirm button is disabled until both slots are filled, labeled with what's missing
  (`describeMissing`).

- [ ] Rewrite `src/modules/atlas-search.ts` around a `{staticPin, rtPin}` state object
- [ ] Render the pinned strip above `#atlas-results`, always visible
- [ ] Row click → pin / replace / unpin per the rules above
- [ ] Badge each row from `kind`; keep the ufuzzy filter over name+operator+location
- [ ] Per-pin CORS checkbox in the pinned strip, not one global checkbox
- [ ] Confirm returns a complete `FeedSelection`; cancel returns null

**Gotchas:** the current implementation re-renders `innerHTML` and re-wires clicks on
every keystroke, indexing by array position (`data-feed-idx`) into `visibleFeeds`. With
pinning, position-indexing breaks as soon as a pinned row is also in the filtered list.
Switch to `data-row-id` and look up by id.

Pinned rows should also appear inline in the results when they match the filter, shown in
their highlighted state — so the user can unpin from either place.

## Phase 4 — Examples and manual load

Examples become a curated list of complete, ready-to-load pairs. Each entry names both
halves so it satisfies the requirement in one click.

Seed list:
- **Amtrak** — `https://rt.gtfs.zone/amtrak/...` (RT) + its static counterpart
- **Columbia County** — `https://rt.gtfs.zone/columbia-county/...`
- **MBTA** — `https://cdn.mbta.com/realtime/VehiclePositions.pb`,
  `TripUpdates.pb`, `Alerts.pb` + `https://cdn.mbta.com/MBTA_GTFS.zip`

The exact `rt.gtfs.zone` paths need confirming against the live service before the list
ships — the trailing segment per feed (`VehiclePositions.pb` etc.) is assumed here.

Manual load gets two labeled sections, Static and Realtime, each with its own CORS
toggle; the static section keeps the file-upload option. Submit is disabled until
complete, with the same `describeMissing` hint.

- [ ] Rewrite `src/modules/examples.ts` with the three seed entries as `FeedSelection`s
- [ ] Confirm live `rt.gtfs.zone` URL shapes for amtrak and columbia-county
- [ ] Restructure `src/modules/manual-load-modal.ts` into Static / Realtime sections
- [ ] Both modals return `FeedSelection | null`; neither can return a partial selection

**Gotchas:** MBTA serves three separate `.pb` files, Amtrak via rt.gtfs.zone may serve a
combined feed — the RT source model already supports either (three optional URLs), but
the examples list must fill in whichever the provider actually offers.

## Phase 5 — Loading with progress

Route every load through `feedProgressIndicator` with distinct operation keys so the top
bar reports real progress instead of a single indeterminate spinner.

Operations: `static-download`, `static-parse`, `rt-vehicles`, `rt-trip-updates`,
`rt-alerts`. Static download reports real bytes via a streaming `fetch` reader when
`Content-Length` is present; static parse reports per-file progress as each `.txt` is
handled.

- [ ] Add progress callbacks to `GTFSStatic.loadFromUrl` / `loadFromFile`
- [ ] Stream the zip download and report percentage when `Content-Length` is available
- [ ] Report parse progress per GTFS file
- [ ] Each RT endpoint starts/finishes its own operation on every poll
- [ ] Failures call `finishLoading` and raise a notification-system toast — never `alert()`

**Gotchas:** the RT poller fires on an interval; if each poll calls `startLoading` the bar
will flash constantly. Show RT polls in the bar only for the *first* fetch of each
endpoint and for retries after an error; steady-state polls report into the status page
only (Phase 6).

## Phase 6 — Feed status page

The "nothing focused" state of the right panel. All four content groups are in scope.

**Counts** — a grid of every object type with live totals: stops, routes, trips, shapes,
agencies, calendar services from static; vehicles, trip updates, alerts from RT. RT
counts update on every poll.

**Per-endpoint fetch timing** — one row per RT endpoint showing: last fetched as both
absolute time and a live-ticking relative ("12s ago"), the GTFS-RT `FeedHeader.timestamp`
(which is the *data* age, often different from fetch time — show both, labeled), a
countdown to next refresh, an in-flight spinner while a poll is open, and the last error
with its timestamp if one occurred.

**Inline-editable URLs** — each of the four URLs is an editable input with an Apply
button that re-fetches just that endpoint in place, plus its CORS toggle. Editing the
static URL triggers a full static reload; editing an RT URL restarts only that poller.

**Raw dumps** — the GTFS-RT `FeedHeader` (gtfs_realtime_version, incrementality,
timestamp) per endpoint, and static `feed_info.txt` + `agency.txt` rendered as verbatim
field tables, matching the transparency of the object pages in Plan 05.

- [ ] Create `src/modules/status-page.ts` rendering into `#panel-content`
- [ ] Central `FeedStatus` store (Plan 03 owns it) that the page subscribes to
- [ ] Live-ticking relative timestamps via a single shared 1s interval, not one per row
- [ ] Editable URL fields with per-field Apply and CORS toggle
- [ ] Raw header / feed_info / agency dumps
- [ ] Empty state before any feed is loaded: prompt to Load, nothing else

**Gotchas:** one `setInterval` per relative timestamp will leak as the panel re-renders.
Use a single ticker that walks `[data-since]` elements.

Applying an edited URL must validate before tearing down the working poller — otherwise a
typo kills a live feed with no way back except a full reload.

## Done when

Nothing loads without both a static and an RT source. Atlas search pins one of each and
survives re-filtering. Examples load Amtrak / Columbia County / MBTA in one click. The
top loading bar reports real progress. The right panel, with nothing focused, tells you
exactly what is loaded, how many of each, when each endpoint was last fetched, and lets
you edit any URL in place.
