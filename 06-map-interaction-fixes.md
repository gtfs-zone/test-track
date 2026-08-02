# Plan 06 — Map Interaction Fixes: readiness, focus hygiene, vehicle identity, camera

## Summary

Nine reported bugs, six root causes. The big one is a broken map-readiness gate that
silently swallows *every* map update issued after the initial `load` event — it alone
explains the missing vehicles, the missing route spotlight, and the camera never moving.
The rest: no click-away handler; feature-state that is never cleared on feed change;
station pages that are empty because `stop_times` names platforms the station page never
aggregates; a stale, CORS-blocked Columbia County static URL; and a
vehicle identity function that collapses all 53 Amtrak trains into one id. Plus two
design items: vehicle styling and coloring-book-style focus zoom with vehicle follow.

On that last one — the Amtrak collision is a genuine GTFS-RT violation by **cafe-car**,
and the fix for the *data* belongs there. test-track's job is to keep working while
saying so out loud, so this plan separates the feed's reported `vehicleId` from an
internal instance `key` and turns the duplication into reported output rather than
absorbing it. A well-formed feed takes an identity path that is a no-op. Details under
Root cause D.

## Relevant Context

### Root cause A — `whenLoaded()` drops work after the first load

`MapController.whenLoaded` (`src/map-controller.ts:173`):

```ts
if (this.map.loaded()) fn(); else this.map.once('load', fn);
```

Both branches are wrong together. MapLibre's `Map.loaded()` is

```js
!this._styleDirty && !this._sourcesDirty && !!this.style && this.style.loaded()
```

(verified in `node_modules/maplibre-gl/dist/maplibre-gl.js`) — it is **false whenever any
repaint is pending**, which includes the moments right after `setData`, during tile
loads, and during camera animations. The `load` event, meanwhile, fires exactly once in a
map's lifetime, so `map.once('load', fn)` registered afterwards **never fires**. Any
`loadStaticFeed` / `showVehicles` / `focus` call that lands during a dirty frame is
dropped permanently.

This is the single explanation for three of the reported bugs:

- **Vehicles missing at first, appearing "after a bunch of clicking" or the second
  fetch** — the first `vehicles` payload arrives while the static feed's `setData` is
  still dirty, so it is dropped; a later poll happens to land on a clean frame.
- **"Changing feeds still shows the last fetch of the prior feed"** — same thing: the
  new feed's first vehicle push is dropped, and the vehicles source still holds the old
  feed's features because nothing ever cleared it.
- **Route spotlight not dimming other routes, camera not moving** — `focus()` goes
  through the same gate, so `applySpotlight` and `fitBounds` never run at all. (The panel
  still renders the route page, so it *looks* like the route is highlighted.)

### Root cause B — no click-away handler

`LayerManager.attachInteraction` (`src/modules/layer-manager.ts:717`) does
`if (hit) this.onSelect?.(hit)` and nothing on a miss. Coloring-book's
`interaction-handler.ts:236` calls `onEmptyClick()`, wired in `index.ts:191` to
`setPageState({ type: 'home' })`.

### Root cause C — focus feature-state is never fully cleared

`setStaticFeed` sets `this.focus = null` directly (`layer-manager.ts:184`) **without**
clearing the previously focused feature's state. That `focused: true` survives on the map
until the next style rebuild. Focus a vehicle, load another feed, focus a different
vehicle → two haloed vehicles. This is the most likely cause of the MBTA double-circle
(MBTA's own ids are clean — see below).

### Root cause D — a real spec violation in cafe-car, not something to normalize away

`gtfs-rt.ts:220` uses `id: v.vehicle?.id || entity.id`. Probed live, 2026-08-02:

| feed | entities | unique `vehicle.id` | unique `entity.id` | unique `vid\|trip\|start` |
|---|---|---|---|---|
| `rt.gtfs.zone/amtrak` | 53 | **1** (`hell-gate-bridge-amtrak`) | 53 | 53 |
| `cdn.mbta.com` | 227 | 227 | 227 | 227 |

The producer is at fault, and the fault is in **cafe-car**, not hell-gate-bridge.
`cafe-car/src/cafe_car/routers/gtfs_rt.py:166-167`:

```python
entity.vehicle.vehicle.id = tracker.nickname
entity.vehicle.vehicle.label = tracker.nickname
```

That is emitted once per Redis record, but `tracker.nickname` is a property of the
*tracker* (one per ingest process), not of the record. cafe-car already stores one record
per train — `ingest.py:71` keys them `vehicle:{tracker_id}:{trip_id}-{start_date}` — and
then throws that distinction away when serialising. hell-gate-bridge is behaving
correctly: `INGEST_VEHICLE_ID` must match `Tracker.id` for the `vehicle:{tracker_id}:*`
scan to find it (`hell-gate-bridge/config.py:20-25`); it is a credential, not a vehicle.

> **Fixed upstream 2026-08-02** (cafe-car `e19bce1`, hell-gate-bridge `bbfcee4`). cafe-car
> now reads a public `vehicle_id`/`vehicle_label` from the record and only falls back to
> the nickname for single-device producers; the ingest credential field is renamed
> `tracker_id`. hell-gate-bridge sends `train_num:start_date` as the id and `train_num` as
> the label. The table above describes the feed *before* that deploy; afterwards Amtrak's
> `vehicle.id` column reads 53. The tool-side plan below is unchanged — it must still
> handle feeds that are *not* fixed.

GTFS-RT's `VehicleDescriptor.id` is specified as "internal system identification of the
vehicle… **should be unique per vehicle**, and is used for tracking the vehicle as it
proceeds through the system." One id for 53 trains violates that, and it is exactly the
class of defect test-track exists to expose. **test-track must not paper over it.**

Related, same file: `entity.id = str(entity_id)` (`gtfs_rt.py:163`) is a counter over a
Redis `scan_iter`, whose order is not guaranteed stable between calls — so Amtrak's
`"1"`, `"2"`, `"3"`… reshuffle between polls. Entity ids are unusable as a focus key here
for that reason, independent of the `vehicle.id` problem.

The consequence in test-track today: `gtfs-rt.ts:220` uses `v.vehicle?.id || entity.id`,
so all 53 collapse onto one map feature id — one click highlights all of them — and
`FeedSession.vehicles` (a `Map` keyed on `v.id`, `feed-session.ts:187`) keeps only the
last one, silently discarding 52 vehicles from every page that reads it.

### The split: fix the data upstream, fix the *tool* here

These are two different fixes and both should happen.

**Upstream — DONE (2026-08-02, cafe-car `e19bce1` + hell-gate-bridge `bbfcee4`):** the
producer-side fix has landed. The ingest seam now separates the credential from the
vehicle: the field formerly named `vehicle_id` (which was really `Tracker.id`) is renamed
`tracker_id`, and a new optional public `vehicle_id`/`vehicle_label` carries the real
per-vehicle identity. hell-gate-bridge's Amtrak source sends `vehicle_id =
f"{train_num}:{start_date}"` with `vehicle_label = train_num` — `train_num` alone is not
unique because a >24h daily train has several concurrent instances of one train_num, which
`start_date` disambiguates. cafe-car emits that as `VehicleDescriptor.id`/`label`, falling
back to `tracker.nickname` only for single-device producers, and now derives `entity.id`
from the record's own identity (public id, else `nickname:trip_id:start_date`) instead of
the reshuffling scan counter. So once these deploy, `rt.gtfs.zone/amtrak` reports 53 unique
`vehicle.id`s and stable `entity.id`s — Amtrak joins MBTA on the no-op identity path below.

The tool-side work still stands: test-track cannot assume every feed is well-formed, so it
must keep deriving a safe `key` and reporting duplicates for *arbitrary* feeds. What
changes is that Amtrak is no longer the motivating live example of a broken feed — it is
now an example of a fixed one.

**Here:** test-track needs *some* unique handle to address a map feature and a URL, but
that handle must never be presented as though it were the feed's data. So:

- `VehiclePosition.vehicleId` stays **exactly what the feed said** — duplicated, empty,
  whatever. It is what the vehicle page displays and dumps.
- A new `VehiclePosition.key` is test-track's own internal instance handle: map feature
  id, `Map` keys, URL param. When the feed's ids are unique — MBTA, and Amtrak once
  cafe-car is fixed — `key === vehicleId` and nothing about the app changes.
- The duplication itself becomes **reported output**: a status-page finding and a warning
  on the affected vehicle pages, quoting the spec.

That way no validity is sacrificed for these two feeds: the tool reports the violation
rather than absorbing it, and a well-formed feed takes an identity path that is a no-op.

### Root cause E — station pages are empty, because `stop_times` names platforms

`STOPS_FILTER` (`layer-manager.ts:65`) draws only stops with no `parent_station`, plus
stations. Child platforms are neither drawn nor clickable. Meanwhile every station-level
lookup on the stop page — `routesByStop`, `upcomingAtStop`, `vehiclesAtStop` — is keyed
on the ids that appear in `stop_times.txt`, which for a station's services are the
**platform** ids. So a station page shows no routes, no departures, no vehicles, and the
platforms that hold all of it are unreachable.

Probed against MBTA_GTFS.zip (18.9 MB, 2026-08-02):

| | count |
|---|---|
| stops | 10298 |
| stations (`location_type` 1) | 276 |
| entrances (2) / generic nodes (3) | 332 / 1921 |
| stops with a `parent_station` | 3166 |
| max parent depth | 1 |
| `stop_times` rows naming a child stop (400k sampled) | 66437 (17%) |

The same mismatch quietly breaks the route spotlight: `stopIdsForRoute`
(`layer-manager.ts:870`) collects stop ids from `stop_times`, so for a subway route it
returns platform ids — which are filtered out of every drawn layer. The `onRoute`
feature-state lands on nothing, and the route's actual stations get *dimmed* along with
everything else. This is likely a second contributor to "the other routes don't seem to
be unhighlighted".

**Why platforms stay off the map.** Park Street's `70075` (Ashmont/Braintree) and `70076`
(Alewife) carry the *station's own* coordinates — identical to five decimal places.
Across the feed, platform offset from its station is median 29 m, p90 117 m, and a large
share is exactly 0. South Station has 165 children at one point. Drawing them produces
unclickable stacks, and any scheme for deciding which ones are distinct enough to draw is
more machinery than the problem is worth. **Platforms are page-only objects**: the map
keeps drawing exactly what it draws today, and the station page is where you see and pick
a platform.

Note also that most children are not boardable — of South Station's 165, only 23 are
`location_type` 0; the rest are generic nodes and entrances. Only `location_type` 0
carries `stop_times`, so only those belong in a service aggregation. MBTA's `platform_code`
/ `platform_name` columns are the natural labels ("B", "Ashmont/Braintree").

### Columbia County — two unrelated problems, one of them ours

`Failed to load Columbia County + Columbia County RT: NetworkError`. Probed 2026-08-02:

1. **The static URL is stale and CORS-blocked.** `examples.ts:45` points at
   `github.com/maxtkc/columbia-county-gtfs/raw/…`, which 301s to
   `github.com/columbia-county-ny-transit/gtfs-generator/raw/…` (the repo moved — the
   new path is what `hell-gate-bridge/config.py:4-7` already uses), which then 302s to
   `raw.githubusercontent.com`. `useCors: false`, and neither `github.com` hop sends a
   usable `access-control-allow-origin` (the second sends the header **with an empty
   value**), so the browser aborts the chain at the first redirect — Firefox reports that
   as exactly this `NetworkError`. The comment at `examples.ts:14-18` claims GitHub sends
   `access-control-allow-origin: *`; that is true of `raw.githubusercontent.com` only.
   Verified working, no proxy needed:
   `https://raw.githubusercontent.com/columbia-county-ny-transit/gtfs-generator/refs/heads/main/columbia_county_gtfs.zip`
   → `200`, `access-control-allow-origin: *`, 71988 bytes.
2. **The RT feeds are fine, and empty.** All three
   `rt.gtfs.zone/columbia-county/*.pb` return `200` with a 15-byte body — a valid
   `FeedMessage` with a header and zero entities. Through `cors.gtfs.zone` from
   `localhost:8080` they also return `200`. So there is nothing to fix on the RT side;
   the feed genuinely has no vehicles right now. Note the proxy allowlists origins by
   exact string: `http://localhost:8080` and `https://viz.rt.gtfs.zone` pass,
   `http://127.0.0.1:8080` gets a `403` with an explanatory body. Worth surfacing that
   body rather than a generic failure.

### Everything keys off `VehiclePosition.id`

`breadcrumbs.ts:25,60,161`, `pages/vehicle-page.ts:130`, `pages/route-page.ts:190,300`,
`pages/stop-page.ts:98`, `rt-index.ts:44`, and the `vehicle_id` URL param. Fixing the
derivation in `gtfs-rt.ts` fixes all of them at once — no call-site changes needed.

### Camera behaviour in coloring-book

`coloring-book/src/modules/map-controller.ts:712` (stop) and `:875` (route) fly
**unconditionally** — `flyTo` at `CONFIG.STOP_FOCUS_ZOOM` with 1500ms, `fitBounds` with
2000ms, both `essential: true`, 50/80px padding plus `bottomPadding`. test-track's
`easeToPoint` (`map-controller.ts:278`) instead bails out when the point is already
on-screen at zoom ≥ 12, which is the divergence the user is reporting.

---

## Phase 1 — Fix the map readiness gate

Replace `whenLoaded` with a real ready flag plus a pending queue. The flag flips once, on
the first `load`, and never flips back; work queued before that point is flushed in
order. Nothing else in the class should consult `map.loaded()`.

- [ ] Add `private ready = false` and `private pending: Array<() => void> = []` to
      `MapController`
- [ ] In `initialize`, inside the existing `map.once('load')` (after `layers.rebuild()`
      and `attachInteraction()`), set `ready = true` and drain `pending`
- [ ] `whenLoaded(fn)` → `this.ready ? fn() : this.pending.push(fn)`
- [ ] Verify the three callers that were silently failing now run every time:
      `loadStaticFeed`, `showVehicles`, `focus`
- [ ] `clearVehicles()` on feed change: have `FeedSession.startPoller` (or `index.ts`'s
      `staticloaded` handler) blank the vehicles layer so a failed first poll on the new
      feed cannot leave the previous feed's vehicles on screen

**Gotchas:**
- Do **not** substitute `map.isStyleLoaded()` — it is false mid-`setStyle` and would
  reintroduce a variant of the same drop on basemap changes.
- `basemap:changed` → `layers.rebuild()` stays on its own path; it must not go through
  the queue, since `ready` is already true by then and rebuild is synchronous.
- The queue only ever holds work from before first load — cap it or just let it be; in
  practice it is at most a handful of entries.

## Phase 2 — Click-away unfocuses

Match coloring-book: a click that hits no feature returns to home, which clears the
spotlight, hides the panel, and closes the bottom sheet (all already wired through
`AppState.onFocusChange`).

- [ ] `LayerManager` gains `onEmptySelect: (() => void) | null`
- [ ] `attachInteraction`'s click handler calls it when `queryTop` returns null
- [ ] `MapController` forwards it to a new `onEmptySelect` hook
- [ ] `index.ts` wires it to `appState.clearFocus()`

**Gotchas:**
- MapLibre fires `click` at the end of a drag only if the pointer barely moved, so this
  will not fight panning — but do not attach to `mouseup`.
- Clicking the basemap FAB or nav control must not reach the map canvas handler; they are
  DOM controls above the canvas, so this is already fine — confirm during review.

## Phase 3 — Focus feature-state hygiene

Stop tracking "the previous target" and instead clear the whole source's state before
applying the new one. `map.removeFeatureState({ source })` wipes every feature's state in
one call and removes the entire class of stale-highlight bugs, including the one across
feed changes.

- [ ] In `setFocus`, replace the `previous` bookkeeping with
      `removeFeatureState({ source })` for each of `stops` / `routes` / `vehicles` before
      re-applying, keeping the `wantedRouteStopIds` re-application afterwards
- [ ] `setStaticFeed` must clear map state too, not just the JS field `this.focus = null`
- [ ] Keep `syncFeatureState`'s `sourcedata` retry — the not-yet-loaded case is still
      real; make sure the clear happens on each retry pass too, or the retry re-adds
      state that a later clear was supposed to remove
- [ ] Confirm the route spotlight actually dims after Phase 1: if `SPOTLIGHT_ROUTE_DIM`
      (0.2) still reads as "not dimmed" on a dense feed like MBTA, the culprit is
      `routes-casing` and `routes-line` each painting at 0.2 and compositing to ~0.36 over
      stacked routes — dim the casing harder than the line rather than lowering both

**Gotchas:**
- `removeFeatureState` on a source that does not exist yet throws; guard with
  `getSource(id)` exactly as `setState` already does.
- Feature state on a GeoJSON source survives `setData`, which is why this leaks in the
  first place — it does *not* survive `setStyle`, which is why `rebuild()` re-applies.

## Phase 4 — Separate the feed's vehicle id from test-track's instance key

Split one field into two. `vehicleId` is reportage; `key` is plumbing. The tool addresses
entities by `key` and *tells you* when it had to.

Derivation of `key`, applied per feed message — two passes over `feed.entity`, since
uniqueness of `vehicle.id` is only knowable after seeing all of them:

1. Every non-empty `vehicle.id` distinct → `key = vehicle.id`. **No-op path**; MBTA and a
   fixed cafe-car both take it.
2. Otherwise, for the colliding entities only:
   `key = ${vehicle.id}#${trip.tripId}:${trip.startDate}`. Amtrak: unique across all 53.
3. Still colliding → append `entity.id`.
4. Still colliding → append the entity index, and record that the feed is not addressable
   at all.

- [ ] Rename `VehiclePosition.id` → `key`, and add `vehicleId: string` holding
      `v.vehicle?.id ?? ''` **verbatim, never synthesized** — empty stays empty. Keep
      `entityId` as it is
- [ ] Implement the two-pass derivation in `GTFSRealtime.emitPayload`
- [ ] Update the `key` call sites — they are mechanical: `feed-session.ts:187`,
      `breadcrumbs.ts:25,60,161`, `pages/vehicle-page.ts:130-136`,
      `pages/route-page.ts:190,300`, `pages/stop-page.ts:98`, `rt-index.ts:44`
- [ ] Report, don't absorb. Add to the RT status: `vehicleIdStrategy` (which of the four
      rules the feed forced) and `vehiclesDuplicateIds`. Status page states it plainly,
      naming the offending id and quoting the spec sentence about `VehicleDescriptor.id`
- [ ] Vehicle page: display the feed's `vehicleId`, and when it is shared with other
      vehicles say so inline — "this id identifies N vehicles in this feed" — with the
      trip that actually distinguishes this one. Never show `key` as if it were feed data
- [ ] `LayerManager.buildVehicles` counts duplicate promoted ids into `MapDataIssues` as
      a backstop: if that count is ever non-zero after this phase, the derivation is
      broken, since a duplicate promoted id *is* the "one click highlights all of them"
      failure
- [ ] Display name: pre-fix, `label` was `hell-gate-bridge-amtrak` for all 53, so it named
      nothing; post-fix (see Root cause D) it is the bare `train_num`. Either way, where a
      vehicle is *named* (`breadcrumbs.ts:25`, route/stop page links, vehicle page
      header), prefer the static trip's `trip_short_name` — Amtrak's train number, via
      `Trip.raw.trip_short_name` — then `headsign`, then `label`, then the id. This is
      display-layer only; the raw dump keeps showing what the feed sent

- [x] ~~File an issue against **cafe-car** for the producer-side fix (per-record
      `vehicle.vehicle.id` + `label`, stable `entity.id` from the slug), and one against
      **hell-gate-bridge** to send Amtrak's `train_num` through the ingest seam once
      cafe-car accepts it.~~ **Done directly** (cafe-car `e19bce1`, hell-gate-bridge
      `bbfcee4`, 2026-08-02): cafe-car reads public `vehicle_id`/`vehicle_label` from the
      record and derives `entity.id` from its identity; hell-gate sends
      `train_num:start_date` + `train_num`. Not blocking either way; the point of this
      phase is that test-track keeps working *and keeps complaining* for feeds that are
      still broken

**Gotchas:**
- `key` must be stable across polls or focus and follow break every 15s. `entity.id` is a
  reshuffling Redis-scan counter for Amtrak — never rank it above the trip composite.
  `trip_id` alone is not unique either: 8 collisions in the probe, same train number on
  consecutive service days, which is why `start_date` is in the composite.
- `key` appears in shared URLs. Amtrak links change; they were pointing at "all trains"
  before, so there is nothing to preserve. Do not build a migration.
- Once ids are unique, `FeedSession.vehicles.size === rtCounts.vehicles`. Assert it in
  development — a mismatch means the derivation collapsed something.
- The MBTA double-circle is *most likely* Root cause C (Phase 3); MBTA's ids probed
  clean. If it survives Phases 3 and 4, the duplicate counter added here will say so
  directly — read it before hunting further.

## Phase 7 — Stations aggregate their platforms

A station is a *place*; the platforms are how the feed addresses parts of it. The station
page should answer "what happens here" over the whole place, while every platform stays a
first-class object with its own page. Aggregation must be visibly labeled as aggregation
— a station does not appear in `stop_times`, and the page must never imply it does.

**Model.** One index built per feed, in `gtfs-static.ts` alongside the existing derived
maps:

- `childrenByParent: Map<string, string[]>`
- `stationRoot(stopId): string` — walk `parent_station` to the top
- `descendants(stopId): string[]` — recursive, with a visited-set cycle guard. MBTA's
  max depth is 1, but boarding areas (`location_type` 4) are children of platforms, and a
  feed with a parent cycle must not hang the app — it should be counted as a feed issue
- `boardableDescendants(stopId)` — `location_type` 0 only; this is what service
  aggregation uses

**Station page.** Aggregate over `boardableDescendants ∪ {self}`:

- [ ] Routes serving this station — union across platforms, heading stating the platform
      count, each route noting which platforms serve it
- [ ] Upcoming departures — merged and re-sorted across platforms, with a platform column
      (`platform_code` → `platform_name` → `stop_id`). This is the section that is empty
      today and is the whole point of the phase
- [ ] Vehicles here now — union across platforms, each labeled with its platform
- [ ] Alerts — union of alerts informing the station and any descendant, deduplicated,
      each marked with what it actually names
- [ ] Platforms section: boardable platforms first with their codes and route badges,
      then entrances and generic nodes in a collapsed group — South Station's 131 generic
      nodes must not bury the 23 platforms
- [ ] Every aggregated section carries an explicit marker that the rows come from child
      stops, naming the child. Nothing may read as though the station id appeared in
      `stop_times`
- [ ] Platform page: unchanged, keeping the existing parent link and sibling list. It is
      reached by link, not by map click

**Map.** `STOPS_FILTER` does not change — no platform is ever drawn. Two small fixes so
the map stays consistent with pages that can now name a platform:

- [ ] Fix `stopIdsForRoute`: map each `stop_times` stop id **up to its drawn ancestor**
      before applying `onRoute`. This is the spotlight bug in Root cause E — verify on an
      MBTA subway route specifically
- [ ] Focusing a platform (from a station-page link or a shared URL) highlights and eases
      to its **station**, since the platform itself has nothing drawn. The panel still
      shows the platform page; only the map resolves upward

**Gotchas:**
- Do not merge platforms into the station in the *route strip*. SCS runs on `stop_times`
  ids, and a station whose trips call different platforms would otherwise collapse or
  double. If the strip shows the same station twice in a direction, that is a real
  property of the feed; grouping consecutive same-station entries under one row with
  platform sub-labels is a reasonable follow-up but is out of scope here and should not be
  smuggled in.
- A platform whose ancestor is also not drawn (a `parent_station` pointing at something
  missing) simply gets no map highlight. Leave the camera alone rather than guessing.
- `routesByStop`, `stopTrips` and `RtIndex` stay keyed on real `stop_times` ids. The
  aggregation is a read-time union, not a rewrite of the index — otherwise the platform
  pages start lying.
- A station with no boardable children is not an error; some feeds model entrances only.
  Say "no platforms in this feed", not an empty section.
- `parent_station` pointing at a nonexistent stop, or at a non-station, is common in bad
  feeds. Count both as status-page issues rather than throwing.

## Phase 8 — Columbia County example, and honest network errors

Two independent things, both small.

- [ ] `examples.ts:45`: point the static source at
      `https://raw.githubusercontent.com/columbia-county-ny-transit/gtfs-generator/refs/heads/main/columbia_county_gtfs.zip`,
      keep `useCors: false`. Fixes the moved repo and the CORS-blocked redirect chain in
      one change
- [ ] Correct the comment at `examples.ts:14-18`: it is `raw.githubusercontent.com` that
      sends `access-control-allow-origin: *`, not `github.com`. Add the rule that follows
      from it — a `github.com/**/raw/**` URL is never directly fetchable and must either
      be rewritten or proxied
- [ ] Audit the other two examples' static URLs the same way while in here
- [ ] Surface proxy and CORS failures usefully. A bare `TypeError: NetworkError when
      attempting to fetch resource` is what the browser gives for *any* CORS refusal and
      it taught us nothing here. When a fetch rejects with a `TypeError` and the URL was
      not proxied, say so: "this may be CORS — try enabling the proxy for this source".
      When it *was* proxied and the proxy answered non-2xx, show the proxy's response body
      — `cors.gtfs.zone` returns a plain-text explanation (`The origin "…" was not
      whitelisted by the operator of this proxy.`) that is currently thrown away
- [ ] Note for the user, not a code change: all three
      `rt.gtfs.zone/columbia-county/*.pb` currently return a valid but **empty**
      `FeedMessage` (15 bytes, zero entities). After this fix Columbia County will load
      and show no vehicles. That is the feed's real state — and the status page should
      make "0 entities" read as a deliberate report rather than a silent blank

**Gotchas:**
- The proxy allowlists origins by exact string. `http://localhost:8080` (the Vite port in
  `vite.config.js:26`) and `https://viz.rt.gtfs.zone` pass; `http://127.0.0.1:8080` does
  not. If a contributor reaches the dev server by IP, every proxied feed 403s — the error
  surfacing above is what makes that diagnosable instead of mystifying.
- Do not "fix" the empty Columbia RT feeds by falling back to something else. An empty
  feed is a legitimate observation and this tool's job is to show it.

## Phase 5 — Vehicle styling that reads on top of its own route

Vehicles currently take `line-color` from the route they run on and sit directly on the
route line drawn in the same color — they disappear into it. Give them their own visual
language: keep the route color as the *fill* (that association is worth keeping) but add
a hard contrast casing and enough size separation that a vehicle never reads as part of
the line.

- [ ] Dark outer casing behind both the dot and the arrow (a second circle layer under
      `vehicles-dot`, and a wider `icon-halo-width` on the SDF arrow), so the marker has
      a defined edge against a same-colored line
- [ ] Larger minimum size at low zoom — the current dot bottoms out at 3.5px at z8, which
      is thinner than the route casing at that zoom
- [ ] Keep the focus halo, but make it read at any zoom (currently a flat 18px radius)
- [ ] Re-check `vehicles-clickarea`'s flat 14px radius against the new visual size, same
      contract as the stops clickarea: never smaller than what is drawn
- [ ] Check both light and dark basemaps, and the unmatched-vehicle gray
      (`VEHICLE_UNMATCHED_COLOR`)

**Gotchas:**
- `icon-size` is a layout property and cannot read feature-state — that is why the halo
  exists. Do not try to grow the arrow on focus.
- Vehicles draw above stops in `LAYER_ORDER`; adding a casing layer means adding it to
  that array in the right slot, or the ordering silently depends on insertion order.

## Phase 6 — Camera: focus zoom and vehicle follow

Two changes. First, match coloring-book: focusing something always moves the camera to
it. Second, a focused vehicle is *followed* across polls until the user takes the camera
back.

Follow semantics: focusing a vehicle enters follow mode; each `vehicles` payload
re-centres on that vehicle's new position. Any user-initiated camera gesture — drag,
scroll-zoom, rotate, pitch, keyboard — unlocks follow permanently for that focus. Our own
programmatic `easeTo`/`fitBounds` must not unlock it. Focusing a different vehicle
re-arms follow.

- [ ] Drop `easeToPoint`'s "already visible and zoom ≥ 12" bail-out; always animate, at
      `CONFIG.STOP_FOCUS_ZOOM`, with padding including `bottomPadding` (coloring-book
      uses 1500ms for a point, 2000ms for a bounds fit — adopt those, add to `CONFIG`)
- [ ] Same for `applyFocus`'s route branch: always `fitBounds`
- [ ] Add `private following: string | null` set when `applyFocus` handles a vehicle,
      cleared on any other focus (including `home` and `alert`)
- [ ] In `showVehicles`, if `following` is set and still present in the payload,
      `easeTo` its new position (short duration, ~300ms, no zoom change)
- [ ] Unlock on user gesture: listen for `dragstart`, `zoomstart`, `rotatestart`,
      `pitchstart` and unlock only when `e.originalEvent` is present — that is what
      distinguishes a user gesture from our own animation
- [ ] Vehicle leaves the feed while followed: stop moving the camera, leave it where it
      is (the vehicle page already has a `lastSeen` fallback, `vehicle-page.ts:133`)
- [ ] The follow `easeTo` must not fight `queueViewSave` — it will fire `moveend` every
      poll and rewrite localStorage; debounce is already 400ms so this is fine, but
      confirm it does not persist a runaway followed position as the app's default view

**Gotchas:**
- `easeTo` with a `duration` longer than the 15s poll interval would queue animations —
  keep the follow animation short.
- The unlock listeners must be attached once in `initialize`, not per focus.
- `essential: true` on the animations, so users with `prefers-reduced-motion` still get
  the camera move (coloring-book sets this).

---

## Verification

`pnpm typecheck` and `pnpm build`. Per CLAUDE.md, browser verification is the user's —
hand off after the build passes, with a note on what to look for per phase:

1. Load a feed cold; vehicles appear on the **first** poll. Switch feeds; old vehicles
   never persist.
2. Click empty map → panel returns to the status page.
3. Focus route A then route B; only B is bright. Load another feed after focusing a
   vehicle; the old halo is gone.
4. Amtrak: clicking one train highlights exactly one, the breadcrumb shows a train number
   rather than the shared credential label, and the status page reports any duplicate-id
   violation. Note the upstream feed is now fixed (Root cause D), so a freshly deployed
   `rt.gtfs.zone/amtrak` should report 53 unique `vehicle.id`s with nothing flagged; to
   exercise the duplicate-reporting path, use a feed that is still broken. MBTA: status
   page reports the `vehicle_id` strategy with nothing flagged.
5. Vehicles legible on top of their own route line, both themes.
6. Focus anything → camera moves. Focus a vehicle → it stays centred across polls until
   you drag, then never snaps back.
7. MBTA, a subway station (Park Street, `place-pktrm`): the page lists routes,
   departures and platforms instead of being empty, every aggregated row names the
   platform it came from, and the platform links reach their own pages. Its 61 generic
   nodes stay collapsed. The map looks exactly as it does today — no new dots — except
   that focusing a subway route now highlights its stations rather than dimming them.
8. Columbia County loads. Its RT feeds are empty upstream, so expect zero vehicles —
   stated as such on the status page, not a blank map.
