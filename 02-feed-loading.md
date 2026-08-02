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

**Built.** `StaticSource` also carries a `label`, matching `RealtimeSource` — the status
page and the atlas pinned strip both need to name the static half, and deriving a name
from a URL is worse than carrying one. Beyond the two predicates the module also exports
`maybeProxy`, `resolvedStaticUrl`, `resolvedRealtimeUrls`, `describeSelection`,
`hasAnyRealtimeUrl`, and the `RealtimeEndpointName` union with its label map — the
endpoint names are referenced by the RT store, the session, and the status page, so they
belong with the model rather than being restated three times.

- [x] Create `src/modules/feed-selection.ts` with the types and the two predicates
- [x] Delete `FeedConfig` from `atlas-search.ts`; every module imports from the new file
- [x] Move `maybeProxy()` out of `index.ts` into `feed-selection.ts` and apply it per source

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

- [x] Restructure `generate-atlas-data.ts` into collect-operators-then-resolve-feeds
- [x] Emit `kind`-tagged rows; add `rowId`
- [x] Keep the local-atlas fast path and the GitHub fallback both working
- [x] Regenerate `public/atlas-feeds.json` and spot-check that `operator_name` and
      `location` are populated for well-known agencies (MBTA, SFMTA, TriMet)
- [x] If the file grows past a few MB, gzip it or trim unused fields — it is fetched on
      first atlas open

**Gotchas:** `deriveLocation` reads `op.places[]`; operators with no places still need a
sensible empty string, not `undefined`, or the fuzzy haystack gets `"undefined"` in it.
The local path uses `fs.readdir(..., {recursive:true})` over `feeds/` only — operators
may live outside that directory in the atlas layout; check before assuming.

**Built — and the diagnosis above was wrong.** Measured against the real corpus (732 DMFR
files, 5234 feeds, 309 operators):

- Operators do *not* live in separate `operators/` files; everything is under `feeds/`.
  The actual break is direction. Feeds almost never declare `operators[]` — 3864 of 5234
  have no operator reference at all, and of those that do, **zero** resolve within their
  own file. The real link runs the other way: `operator.associated_feeds[].feed_onestop_id`
  points back at the feed, usually from a different file. The index is now built from that
  reverse edge, with the forward `feed.operators[]` edge as a secondary pass.
- **`places` does not exist anywhere in the corpus** — 0 of 309 operators have it, and no
  operator tag carries a place either (the tag vocabulary is `wikidata_id`, `us_ntd_id`,
  `twitter_general`, and similar). `deriveLocation` was therefore deleted outright, and
  the `location` field is replaced by `source`: the DMFR filename domain (`511.org`,
  `mbta.com`), which is real, always present, and genuinely useful to search on.
- Only ~600 feeds resolve to an operator even after the fix, so unresolved rows are named
  by humanizing the feed onestop id (`f-9q8-samtrans` → "samtrans",
  `f-columbia~county~public~transportation` → "columbia county public transportation").
  The second dash-segment is a geohash and is dropped, but only when a third segment
  exists, so a genuinely short name is not eaten.
- GBFS (1288 feeds) is dropped — it is bikeshare auto-discovery, not loadable here.
  `USABLE_SPECS` keeps `gtfs` and `gtfs-rt` only.

Result: 3908 rows (3318 static, 590 rt), 593 with a resolved operator, 1.08 MB minified
(down from 2-space-indented). MBTA, SFMTA, samTrans and TriMet all carry full operator
names. Rows are sorted by `rowId` for stable diffs and deduped (one duplicate feed id
exists in the corpus). No gzip needed at this size.

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

- [x] Rewrite `src/modules/atlas-search.ts` around a `{staticPin, rtPin}` state object
- [x] Render the pinned strip above `#atlas-results`, always visible
- [x] Row click → pin / replace / unpin per the rules above
- [x] Badge each row from `kind`; keep the ufuzzy filter over name+operator+location
- [x] Per-pin CORS checkbox in the pinned strip, not one global checkbox
- [x] Confirm returns a complete `FeedSelection`; cancel returns null

**Gotchas:** the current implementation re-renders `innerHTML` and re-wires clicks on
every keystroke, indexing by array position (`data-feed-idx`) into `visibleFeeds`. With
pinning, position-indexing breaks as soon as a pinned row is also in the filtered list.
Switch to `data-row-id` and look up by id.

Pinned rows should also appear inline in the results when they match the filter, shown in
their highlighted state — so the user can unpin from either place.

**Built.** Row clicks are handled by a single delegated listener on `#atlas-results`
keyed on `data-row-id`, so re-rendering the list never re-wires handlers and a pinned row
stays clickable wherever it appears. The confirm button is reached via
`resultsEl.closest('.modal')` — `showModal` renders the actions itself and its `onMount`
hands back only `close`, so there is no other handle on the button.

Two additions not in the spec:
- The unfiltered and filtered lists are both capped at 200 rows. Painting all 3908 rows
  on open cost enough to be visible; the search is the way through the corpus.
- CORS checkbox state is held outside the pin, so replacing a pin keeps the setting the
  user already chose for that slot.

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

- [x] Rewrite `src/modules/examples.ts` with the three seed entries as `FeedSelection`s
- [x] Confirm live `rt.gtfs.zone` URL shapes for amtrak and columbia-county
- [x] Restructure `src/modules/manual-load-modal.ts` into Static / Realtime sections
- [x] Both modals return `FeedSelection | null`; neither can return a partial selection

**Gotchas:** MBTA serves three separate `.pb` files, Amtrak via rt.gtfs.zone may serve a
combined feed — the RT source model already supports either (three optional URLs), but
the examples list must fill in whichever the provider actually offers.

**Built.** rt.gtfs.zone URL shapes confirmed live against its OpenAPI document
(`cafe-car` v0.1.0): `/{feed_name}/vehicle_positions.pb`, `/{feed_name}/trip_updates.pb`,
`/{feed_name}/service_alerts.pb` — note **`service_alerts.pb`**, not the assumed
`alerts.pb`. Both `amtrak` and `columbia-county` return 200 on all three (columbia-county
currently returns empty 15-byte FeedMessages, which is valid). The service serves all
three endpoints per feed, so no combined-feed special case is needed.

Static counterparts, all verified 200:
- Amtrak — `https://content.amtrak.com/content/gtfs/GTFS.zip` (19 MB, no CORS headers)
- Columbia County — `https://github.com/maxtkc/columbia-county-gtfs/raw/refs/heads/main/columbia_county_gtfs.zip`
  (72 KB, sends `access-control-allow-origin: *`, so it is the one example shipped with
  `useCors: false`)
- MBTA — `https://cdn.mbta.com/MBTA_GTFS.zip` (19 MB, no CORS headers)

`cdn.mbta.com` sends no CORS headers on the `.pb` files either, so MBTA realtime is
proxied too. The manual modal's file-upload path gained a Clear button — without it,
picking a file left the URL input permanently disabled with no way back.

## Phase 5 — Loading with progress

Route every load through `feedProgressIndicator` with distinct operation keys so the top
bar reports real progress instead of a single indeterminate spinner.

Operations: `static-download`, `static-parse`, `rt-vehicles`, `rt-trip-updates`,
`rt-alerts`. Static download reports real bytes via a streaming `fetch` reader when
`Content-Length` is present; static parse reports per-file progress as each `.txt` is
handled.

- [x] Add progress callbacks to `GTFSStatic.loadFromUrl` / `loadFromFile`
- [x] Stream the zip download and report percentage when `Content-Length` is available
- [x] Report parse progress per GTFS file
- [x] Each RT endpoint starts/finishes its own operation on every poll
- [x] Failures call `finishLoading` and raise a notification-system toast — never `alert()`

**Gotchas:** the RT poller fires on an interval; if each poll calls `startLoading` the bar
will flash constantly. Show RT polls in the bar only for the *first* fetch of each
endpoint and for retries after an error; steady-state polls report into the status page
only (Phase 6).

**Built.** Load orchestration moved out of `index.ts` into a new
`src/modules/feed-session.ts`. `FeedSession` owns the static dataset, the RT poller, and
the selection they came from; it re-dispatches the poller's payload events so the map and
alerts modal never re-subscribe when the poller is replaced. `index.ts` is now wiring
only.

`GTFSRealtime` decides bar-worthiness itself rather than making the caller track it: it
emits `fetchstart` with a `prominent` flag (true on first fetch, after an error, or on an
explicit `refreshEndpoint`) and `fetchend`, and the session maps those onto
`startLoading`/`finishLoading` per endpoint.

Static parsing became sequential in a fixed `PARSE_ORDER`. It was `Promise.all` over four
files, which made per-file progress meaningless; parsing is CPU-bound in one thread
anyway, so nothing was lost. `agency.txt`, `feed_info.txt` and `calendar.txt` are now
parsed too — Phase 6 dumps the first two verbatim and counts the third. They are kept as
raw `Record<string,string>` rows; Plan 03 Phase 1 will give them typed entities.

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

- [x] Create `src/modules/status-page.ts` rendering into `#panel-content`
- [x] Central `FeedStatus` store (Plan 03 owns it) that the page subscribes to
- [x] Live-ticking relative timestamps via a single shared 1s interval, not one per row
- [x] Editable URL fields with per-field Apply and CORS toggle
- [x] Raw header / feed_info / agency dumps
- [x] Empty state before any feed is loaded: prompt to Load, nothing else

**Gotchas:** one `setInterval` per relative timestamp will leak as the panel re-renders.
Use a single ticker that walks `[data-since]` elements.

Applying an edited URL must validate before tearing down the working poller — otherwise a
typo kills a live feed with no way back except a full reload.

**Built.** The `FeedStatus` store landed early, inside `src/gtfs-rt.ts`, rather than
waiting for Plan 03 — the status page is not worth building against stubs. `GTFSRealtime`
is now a store: per endpoint it tracks `url`, `inFlight`, `lastFetchedAt`,
`lastSuccessAt`, `feedTimestamp`, `header`, `entityCount`, `lastError`, `lastErrorAt`,
and `neverFetched`, and fires `statuschange` on every transition. `decodeFeed` no longer
swallows errors — it distinguishes network failure, HTTP status, and decode failure, and
the previous payload is left in place on failure so a transient error does not blank the
map. The `setInterval` was replaced with a self-scheduling chain that only reschedules
once the current poll settles. This is most of Plan 03 Phase 2; that phase should now
read as "extend", not "rewrite". `FeedHeader.timestamp` is converted through `Number()`
at the boundary, as that plan warns.

`applyRealtimeUrl` validates by fetching once with the new URL and restoring the previous
one if that fetch errors, so a typo cannot kill a live endpoint. The status page's render
is skipped while an input inside it has focus, so a poll landing mid-edit does not clobber
what the user is typing, and renders are coalesced through `queueMicrotask` because one
poll produces a burst of `statuschange` events.

Deferred to Plan 03/05, and left out deliberately:
- `counts()` covers stops, routes, trips, shapes, agencies, and services. Calendar dates,
  and any count that needs the richer entity model, arrive with Plan 03 Phase 1.
- The status page is constructed directly against `#panel-content`. It has no
  focus-awareness yet, because there is no focus state until Plan 03 Phase 3 — right now
  it is simply always the panel's content.

## Files touched

| File | What |
|---|---|
| `src/modules/feed-selection.ts` | new — the two-slot model, predicates, proxy helpers |
| `src/modules/feed-session.ts` | new — owns static + poller + progress reporting |
| `src/modules/status-page.ts` | new — the panel's no-focus content |
| `scripts/generate-atlas-data.ts` | rewritten — two-pass, kind-tagged rows |
| `public/atlas-feeds.json` | regenerated — 3908 rows |
| `src/modules/atlas-search.ts` | rewritten — pinning picker |
| `src/modules/examples.ts` | rewritten — three seeded pairs |
| `src/modules/manual-load-modal.ts` | rewritten — Static / Realtime sections |
| `src/gtfs-static.ts` | progress hooks, sequential parse, agency/feed_info/calendar |
| `src/gtfs-rt.ts` | rewritten — per-endpoint status store |
| `src/index.ts` | reduced to wiring |

## Done when

Nothing loads without both a static and an RT source. Atlas search pins one of each and
survives re-filtering. Examples load Amtrak / Columbia County / MBTA in one click. The
top loading bar reports real progress. The right panel, with nothing focused, tells you
exactly what is loaded, how many of each, when each endpoint was last fetched, and lets
you edit any URL in place.
