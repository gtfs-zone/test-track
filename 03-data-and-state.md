# Plan 03 — Data Model, Focus State, and URL Routing

## Summary

Extend the in-memory GTFS model to carry every raw column so object pages can be fully
transparent; build the RT store that tracks per-endpoint fetch state; and vendor
coloring-book's page-state manager, adapted to test-track's four page types, with feed
URLs carried in the URL alongside the focus.

## Relevant Context

- Decided: **no IndexedDB, no worker, no zod spec.** In-memory `Map`s stay, extended with
  a `raw: Record<string,string>` on every parsed entity. Object pages render a typed
  summary plus the verbatim raw-column table.
- Decided: only four object page types — **stop, route, vehicle, alert.** No agency,
  trip, service, or pathway pages. (Agency and feed_info data still surface, on the
  status page from Plan 02 and as context on route/alert pages.)
- Decided URL contents: **focus object + feed URLs.** Map view and map appearance go to
  `localStorage`, not the URL.
- `src/gtfs-static.ts` today parses stops, routes, shapes, trips, and a `stopTrips`
  index. It discards every column it doesn't explicitly name, and `parseStopTimes`
  throws away `stop_sequence` and the times — which the route strip in Plan 05 needs.
- `src/gtfs-rt.ts` swallows every error (`decodeFeed` returns `null` on any failure) and
  emits nothing on failure, so the UI cannot distinguish "no data" from "fetch failed".
  The status page requires that distinction.
- coloring-book's `PageStateManager` (632 lines) uses a hash querystring —
  `#route=abc`, `#stop=123` — with `pageStateToURL` / `urlToPageState`, a hashchange
  listener guarded by a `suppressHashUpdate` flag, breadcrumb building via an injected
  `BreadcrumbLookup`, and a `StateValidator` hook. Its breadcrumb layer is async and
  database-backed; ours can be synchronous.

## Phase 1 — Raw-row static model

Every entity keeps its parsed convenience fields **and** the original CSV row.

```ts
export interface Stop {
  id: string; name: string; lat: number; lon: number;
  location_type: number; parent_station: string;
  raw: Record<string, string>;
}
```

Same treatment for `Route`, `Trip`, and new `Agency`, `Calendar`, `CalendarDate`, and
`FeedInfo` entities. `StopTime` keeps `trip_id`, `stop_id`, `stop_sequence` (number),
`arrival_time`, `departure_time`, plus `raw`.

New indices the later plans depend on:
- `stopTimesByTrip: Map<string, StopTime[]>` — sorted by `stop_sequence`
- `tripsByRoute: Map<string, Trip[]>`
- `routesByStop: Map<string, Set<string>>` — derived, for the stop page
- `agencies`, `feedInfo`, `calendar`, `calendarDates`

- [x] Add `raw` to every entity interface in `src/gtfs-static.ts`
- [x] Parse `agency.txt`, `feed_info.txt`, `calendar.txt`, `calendar_dates.txt`
- [x] Replace the current `parseStopTimes` with one that keeps full `StopTime` records,
      builds `stopTimesByTrip` sorted by `stop_sequence`, and derives `routesByStop`
- [x] Keep the existing `stopTrips` index or replace its callers — don't leave both
- [x] Add `counts()` returning per-type totals for the status page
- [x] Emit parse-progress callbacks (consumed by Plan 02 Phase 5)

**Gotchas:** `stop_times.txt` is by far the largest file — a mid-size agency is hundreds
of thousands of rows. Keeping full records plus a `raw` copy of each roughly doubles
memory versus today. Measure with MBTA before assuming it's fine; if it hurts, make
`raw` lazy for stop_times only (store the header + the raw line, split on demand) and
keep it eager everywhere else. Stop times are the one table with no object page, so
they're the safe place to economize.

`stop_sequence` must be compared numerically. It is a string in the CSV and
`'10' < '9'` lexically — a classic silent ordering bug that would scramble every route
strip.

**Built.** `StopTime` carries **no `raw`** — decided rather than measured, since the
browser measurement this plan asks for isn't something the agent can run. Stop times are
the one table with no object page, so nothing would ever render that raw table, and
skipping it avoids the doubling this section warns about. The lazy header+line fallback
is therefore unused and can be revisited if a stop-times view is ever wanted. Every other
entity gets eager `raw`.

Entity fields beyond the plan's sketch, all needed by later plans: `Route.agency_id`
(alert/route page context), `Trip.service_id` and `Trip.direction_id` (Plan 05's direction
tabs run off `direction_id`), `Stop.location_type` and `parent_station` (Plan 04's stop
stack and the breadcrumb parent chain). `Calendar.days` is a Monday-first `boolean[]`
rather than seven fields.

`agency.txt` / `feed_info.txt` / `calendar.txt` were previously stored as bare `RawRow[]`
by Plan 02 Phase 5; they are now typed entities with `raw`, and `status-page.ts` reads
`.raw` off them. `calendar_dates.txt` joins `PARSE_ORDER` — nine files now, so the parse
progress bar's denominator changed.

`stopTrips` is kept (Plan 04 has no replacement for it yet) but its dedupe is now a
tail check rather than `Array.includes`, which was O(n) per row on the largest file in the
feed. Stop-time rows for one trip arrive contiguously in every feed worth reading.

`counts()` gained `stopTimes`, and the status page grid shows it — it is the number that
tells you whether a feed is small or enormous, and it was previously invisible.

## Phase 2 — RT store with per-endpoint status

**Landed early, in Plan 02 Phase 6.** Everything below except alert identity was already
built when the status page needed a store to read from rather than a stub; that plan's
notes say this phase should read as "extend, not rewrite". Verified against the code and
checked off. The one thing added here is the alert-identity work the checklist calls for.

Rework `GTFSRealtime` from a fire-and-forget `EventTarget` into a store that records the
outcome of every fetch.

Per endpoint (`vehicles` / `tripUpdates` / `alerts`), track: `url`, `inFlight`,
`lastFetchedAt`, `lastSuccessAt`, `feedTimestamp` (from `FeedHeader.timestamp`),
`lastError`, `entityCount`, and the raw `FeedHeader`. Expose the whole thing as a
`FeedStatus` object and fire a `statuschange` event whenever any field moves — that is
what the status page subscribes to.

`decodeFeed` stops swallowing errors: it distinguishes HTTP failure, decode failure, and
success, and records which.

- [x] Rewrite `src/gtfs-rt.ts` around a per-endpoint status record
- [x] Keep the decoded `FeedHeader` for the status page's raw dump
- [x] Emit `statuschange` on every state transition, `vehicles`/`tripUpdates`/`alerts` on
      successful decode as today
- [x] Add `refreshEndpoint(name)` for the status page's per-URL Apply button
- [x] Make the poll interval configurable and surface `nextPollAt` for the countdown
- [x] Preserve the previous successful payload on a failed poll — a transient error
      should not blank the map

**Gotchas:** `setInterval` does not wait for a slow poll to finish; a feed slower than the
interval stacks requests. Switch to a self-scheduling `setTimeout` chain that starts the
next delay after the current poll settles.

`FeedHeader.timestamp` is a protobuf Long, not a JS number — `gtfs-realtime-bindings`
returns a `Long` object. Convert explicitly (`Number(ts)`), the same trap the existing
code already hits with `stopTimeUpdate` delays.

**Extended here.** The `alerts` event now carries `AlertRecord[]` (`{id, alert}`) instead
of bare `IAlert[]`, because the enclosing `FeedEntity.id` was being discarded at decode
and there is nothing else to key an alert page on. Vehicles likewise now prefer
`vehicle.id` over the entity id, keeping `entityId` and `label` alongside — the entity id
is only a fallback for feeds that omit the vehicle descriptor.

`FeedSession` now retains the latest decoded payloads (`vehicles` and `alerts` as maps,
`tripUpdates` as an array) rather than only counting them. Focus validation and
breadcrumbs both need to resolve an id *now*, not on the next poll, and Plan 05's pages
need the same. Payloads are replaced wholesale each poll, so a vehicle that leaves the
feed does disappear from the map — the focused-object case is handled at the page level
instead.

## Phase 3 — Page state

Vendor `src/modules/page-state-manager.ts` as `@status modified` and reduce it to our
four page types plus home.

```ts
export type PageState =
  | { type: 'home' }                          // → feed status page
  | { type: 'route'; route_id: string; direction_id?: string }
  | { type: 'stop'; stop_id: string }
  | { type: 'vehicle'; vehicle_id: string }
  | { type: 'alert'; alert_id: string };
```

Cuts from the original: `agency`, `timetable`, `service`, `pathway`, the async
`BreadcrumbLookup` interface, `gtfs-breadcrumb-lookup.ts`, and the database-backed
`StateValidator`. Keep: the URL round-trip, the hashchange handling with
`suppressHashUpdate`, the navigation-event handlers, and the back-navigation stack.

Breadcrumbs become synchronous, resolved straight from the in-memory maps: a stop's
breadcrumb is its parent station then itself; a vehicle's is its route then itself; an
alert's is whatever entity it's informing.

`direction_id` rides on the route state so the strip's direction tab is linkable.

- [x] Vendor and reduce `page-state-manager.ts`; record cuts in its `@changes` list
- [x] Vendor `src/types/page-state.ts`, reduced to the five variants + type guards
- [x] Rewrite breadcrumb building synchronously against the in-memory model
- [x] Do **not** vendor `page-state-integration.ts` or `gtfs-breadcrumb-lookup.ts` —
      write a small local integration instead
- [x] `alert_id` needs a stable identity: GTFS-RT alerts have no id of their own, only
      the enclosing `FeedEntity.id`. Key alerts by entity id and note that it may change
      between polls for some producers

**Gotchas:** `vehicle_id` has the same instability. Prefer
`VehiclePosition.vehicle.id`, fall back to `FeedEntity.id`, and handle the focused
vehicle disappearing between polls — the page must show "this vehicle is no longer in the
feed" rather than going blank or throwing.

**Built.** Vendored as `src/types/page-state.ts` and `src/modules/page-state-manager.ts`,
both `@status modified`, both listed in `VENDORED.md`. Cuts as planned; three changes
beyond them:

- The manager gained `setFeedParams()` / `buildHash()`, which is how Phase 4's feed
  section rides along. coloring-book's equivalent was a single `params.delete('load')`,
  since its feed config never lived in the URL.
- `StateValidator` and the breadcrumb builder are both synchronous, so `setPageState`,
  the hashchange handler, and URL restore stop being `async` — nothing about our model is
  awaitable.
- The module-level singleton (`getPageStateManager` / `initPageStateManager`) is dropped.
  `AppState` owns the one instance, which is what makes "exactly one code path writes the
  hash" enforceable rather than aspirational.

`initializeFromURL` split into `pendingStateFromURL()` (read the hash) and
`adoptState()` (accept it without dispatching navigation), because in test-track those
two happen either side of a feed load rather than together.

Breadcrumbs live in `src/modules/breadcrumbs.ts` alongside `validateState` and the four
label helpers — they read the same maps, and Plan 05 needs the labels independently for
entity links. The stop parent chain is walked with a `seen` set: `parent_station` is a
single edge in practice, but a feed with a cycle would otherwise hang the panel.

Left to Plan 05, deliberately: rendering breadcrumbs, and the "no longer in the feed"
vehicle page with its last-known-data banner. Phase 5's placeholder currently states the
fact plainly and nothing more.

## Phase 4 — Feed URLs in the URL

The hash carries both the focus and the feed configuration, so a link reproduces the
whole session.

Scheme: `#static=<enc>&rt_vp=<enc>&rt_tu=<enc>&rt_al=<enc>&cors=s,r&route=abc&dir=0`

- URLs are `encodeURIComponent`'d values inside the hash querystring.
- `cors` is a compact flag list rather than two booleans.
- A `staticFile` selection cannot be represented — when the static source is an uploaded
  file, omit `static` and mark the URL as non-reproducible in the status page.

On boot: parse the hash. If feed URLs are present, auto-load them, then apply the focus
once the static feed has parsed (the focus can't resolve before data exists). If URLs are
absent, show the empty status page and ignore any focus params.

- [x] Extend `pageStateToURL` / `urlToPageState` to round-trip the feed section
- [x] Boot sequence: parse hash → load feeds → apply focus, with the loading bar running
- [x] Update the hash when the selection changes (Plan 02's modals) and when focus changes
- [x] Handle a focus param naming an object that isn't in the feed: notify and fall to home
- [x] Show a "copy shareable link" affordance on the status page

**Gotchas:** feed URLs can be long, and a full four-endpoint config plus focus will push
past 500 characters. That's fine for browsers but ugly to share; consider offering the
copy button as the primary path rather than expecting people to read the address bar.

Auto-loading URLs straight from a hash means any link can make the browser fetch an
arbitrary URL, including through `cors.gtfs.zone`. That is inherent to the feature and
matches coloring-book's `#load=` behavior, but keep the proxy opt-in visible in the UI
rather than silently on.

**Built** as `src/modules/feed-url.ts`, a codec between `FeedSelection` and hash params,
kept separate from the page-state manager: the manager owns the hash, this owns what the
feed half of it means. The scheme is as specified, and `dir` (not `direction`) carries the
route direction.

Encoding stores the **un-proxied** URLs, with `cors` recording the intent, so a shared
link does not hard-code someone else's proxy decision — the proxy is re-applied at load
time by `resolvedStaticUrl` / `resolvedRealtimeUrls`, and its checkboxes stay visible on
the status page as the gotcha above requires.

A restored selection has no name of its own, so labels fall back to the URL's hostname.
`isReproducible()` is the file-upload check, and it drives both the disabled Copy button
and the explanation next to it; the static section already said as much in prose.

An incomplete link (feeds named, but not both halves) warns and loads nothing rather than
half-starting a session — `isComplete` stays the single gate, as Plan 02 Phase 1 set up.
A focus param that names a missing object warns naming the type ("Nothing in this feed
matches the linked stop") and falls to home.

Feed params are re-written from the session's `change` event, which covers all three
modals *and* the status page's inline URL edits without any of them knowing about the
URL. That event also fires on every poll; `writeHash` returns early when the hash is
unchanged, so the steady-state cost is a string compare.

## Phase 5 — Focus wiring

One `AppState` module owns the current `PageState` and mediates between map, panel, and
URL. Map click → set focus → panel renders + map highlights + hash updates. Panel link
click → same path. Hash change (back button) → same path, minus the hash write.

- [x] Create `src/modules/app-state.ts` as the single entry point for focus changes
- [x] Subscribe the panel renderer, the map controller, and the URL writer to it
- [x] Ensure exactly one code path writes the hash, to keep `suppressHashUpdate` honest
- [x] On mobile, a focus change opens the bottom sheet to `half`; clearing focus closes it

**Built.** `AppState` holds the one `PageStateManager`, wires the breadcrumb builder and
validator to the session, and exposes `setFocus` / `clearFocus` / `boot` /
`shareableUrl`. `index.ts` passes it a single `onFocusChange` hook and stays wiring-only.

Two scope boundaries, checked against the neighbouring plans rather than built here:

- **Map interaction is Plan 04 Phase 4's**, which owns click handlers on
  `stops-clickarea`, `routes-clickarea`, and the vehicle layers, plus `setFeatureState`
  highlighting and camera easing. The only thing wired here is `MapController`'s existing
  `onStopClick` hook, which was already built and had no subscriber — one line, and it
  closes the loop end to end. No new layers or handlers were added.
- **`panel-renderer.ts` is Plan 05 Phase 1's.** What exists now is
  `src/modules/panel-placeholder.ts`, marked TEMPORARY in its own header: breadcrumb
  labels as plain text, the object's name, and its raw column table. No entity links, no
  RT regions, no route strip, no scroll preservation — all Plan 05.

`StatusPage` became focus-aware, which Plan 02 Phase 6 explicitly deferred to this plan.
It gained `setActive()`, and both `render()` and the 1s ticker no-op while an object page
owns the panel — otherwise the next poll would paint the status page straight over it.

`AppState` also clears a stale focus when a *new* static feed loads, since an object id
from the previous feed will not name anything in the new one.

## Files touched

| File | What |
|---|---|
| `src/gtfs-static.ts` | rewritten — typed entities with `raw`, stop-time/trip/route indices |
| `src/gtfs-rt.ts` | `AlertRecord` identity, vehicle id preference, label |
| `src/map-controller.ts` | `VehiclePosition` gained `entityId` and `label` |
| `src/types/page-state.ts` | new — vendored, reduced to five variants |
| `src/modules/page-state-manager.ts` | new — vendored, sync + feed params in the hash |
| `src/modules/breadcrumbs.ts` | new — sync breadcrumbs, labels, focus validation |
| `src/modules/feed-url.ts` | new — `FeedSelection` ↔ hash params codec |
| `src/modules/app-state.ts` | new — the single entry point for focus changes |
| `src/modules/panel-placeholder.ts` | new, **temporary** — replaced by Plan 05 Phase 1 |
| `src/modules/feed-session.ts` | retains latest RT payloads for id lookup |
| `src/modules/status-page.ts` | focus-aware; stop-times count; share-link section |
| `src/index.ts` | focus wiring and boot-from-hash |
| `VENDORED.md` | two new `modified` entries |

## Done when

Static parsing keeps every column. RT tracks per-endpoint status with real errors.
The hash captures both what you're looking at and which feeds you're looking at, the back
button works, and pasting a link into a fresh tab reproduces the session.
