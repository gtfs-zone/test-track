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

- [ ] Add `raw` to every entity interface in `src/gtfs-static.ts`
- [ ] Parse `agency.txt`, `feed_info.txt`, `calendar.txt`, `calendar_dates.txt`
- [ ] Replace the current `parseStopTimes` with one that keeps full `StopTime` records,
      builds `stopTimesByTrip` sorted by `stop_sequence`, and derives `routesByStop`
- [ ] Keep the existing `stopTrips` index or replace its callers — don't leave both
- [ ] Add `counts()` returning per-type totals for the status page
- [ ] Emit parse-progress callbacks (consumed by Plan 02 Phase 5)

**Gotchas:** `stop_times.txt` is by far the largest file — a mid-size agency is hundreds
of thousands of rows. Keeping full records plus a `raw` copy of each roughly doubles
memory versus today. Measure with MBTA before assuming it's fine; if it hurts, make
`raw` lazy for stop_times only (store the header + the raw line, split on demand) and
keep it eager everywhere else. Stop times are the one table with no object page, so
they're the safe place to economize.

`stop_sequence` must be compared numerically. It is a string in the CSV and
`'10' < '9'` lexically — a classic silent ordering bug that would scramble every route
strip.

## Phase 2 — RT store with per-endpoint status

Rework `GTFSRealtime` from a fire-and-forget `EventTarget` into a store that records the
outcome of every fetch.

Per endpoint (`vehicles` / `tripUpdates` / `alerts`), track: `url`, `inFlight`,
`lastFetchedAt`, `lastSuccessAt`, `feedTimestamp` (from `FeedHeader.timestamp`),
`lastError`, `entityCount`, and the raw `FeedHeader`. Expose the whole thing as a
`FeedStatus` object and fire a `statuschange` event whenever any field moves — that is
what the status page subscribes to.

`decodeFeed` stops swallowing errors: it distinguishes HTTP failure, decode failure, and
success, and records which.

- [ ] Rewrite `src/gtfs-rt.ts` around a per-endpoint status record
- [ ] Keep the decoded `FeedHeader` for the status page's raw dump
- [ ] Emit `statuschange` on every state transition, `vehicles`/`tripUpdates`/`alerts` on
      successful decode as today
- [ ] Add `refreshEndpoint(name)` for the status page's per-URL Apply button
- [ ] Make the poll interval configurable and surface `nextPollAt` for the countdown
- [ ] Preserve the previous successful payload on a failed poll — a transient error
      should not blank the map

**Gotchas:** `setInterval` does not wait for a slow poll to finish; a feed slower than the
interval stacks requests. Switch to a self-scheduling `setTimeout` chain that starts the
next delay after the current poll settles.

`FeedHeader.timestamp` is a protobuf Long, not a JS number — `gtfs-realtime-bindings`
returns a `Long` object. Convert explicitly (`Number(ts)`), the same trap the existing
code already hits with `stopTimeUpdate` delays.

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

- [ ] Vendor and reduce `page-state-manager.ts`; record cuts in its `@changes` list
- [ ] Vendor `src/types/page-state.ts`, reduced to the five variants + type guards
- [ ] Rewrite breadcrumb building synchronously against the in-memory model
- [ ] Do **not** vendor `page-state-integration.ts` or `gtfs-breadcrumb-lookup.ts` —
      write a small local integration instead
- [ ] `alert_id` needs a stable identity: GTFS-RT alerts have no id of their own, only
      the enclosing `FeedEntity.id`. Key alerts by entity id and note that it may change
      between polls for some producers

**Gotchas:** `vehicle_id` has the same instability. Prefer
`VehiclePosition.vehicle.id`, fall back to `FeedEntity.id`, and handle the focused
vehicle disappearing between polls — the page must show "this vehicle is no longer in the
feed" rather than going blank or throwing.

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

- [ ] Extend `pageStateToURL` / `urlToPageState` to round-trip the feed section
- [ ] Boot sequence: parse hash → load feeds → apply focus, with the loading bar running
- [ ] Update the hash when the selection changes (Plan 02's modals) and when focus changes
- [ ] Handle a focus param naming an object that isn't in the feed: notify and fall to home
- [ ] Show a "copy shareable link" affordance on the status page

**Gotchas:** feed URLs can be long, and a full four-endpoint config plus focus will push
past 500 characters. That's fine for browsers but ugly to share; consider offering the
copy button as the primary path rather than expecting people to read the address bar.

Auto-loading URLs straight from a hash means any link can make the browser fetch an
arbitrary URL, including through `cors.gtfs.zone`. That is inherent to the feature and
matches coloring-book's `#load=` behavior, but keep the proxy opt-in visible in the UI
rather than silently on.

## Phase 5 — Focus wiring

One `AppState` module owns the current `PageState` and mediates between map, panel, and
URL. Map click → set focus → panel renders + map highlights + hash updates. Panel link
click → same path. Hash change (back button) → same path, minus the hash write.

- [ ] Create `src/modules/app-state.ts` as the single entry point for focus changes
- [ ] Subscribe the panel renderer, the map controller, and the URL writer to it
- [ ] Ensure exactly one code path writes the hash, to keep `suppressHashUpdate` honest
- [ ] On mobile, a focus change opens the bottom sheet to `half`; clearing focus closes it

## Done when

Static parsing keeps every column. RT tracks per-endpoint status with real errors.
The hash captures both what you're looking at and which feeds you're looking at, the back
button works, and pasting a link into a fresh tab reproduces the session.
