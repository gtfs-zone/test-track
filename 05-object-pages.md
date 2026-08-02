# Plan 05 — Object Pages: Route Strip, Stop, Vehicle, Alert

## Summary

Build the four object pages that fill the right panel, with the vertical transit-map
route strip as the centerpiece. Every page shows a typed summary, live RT status, related
alerts, and a verbatim dump of all raw GTFS columns.

## Relevant Context

- Decided scope: exactly four page types — **route, stop, vehicle, alert.** Plus the
  status page from Plan 02 as the home/no-focus state.
- Decided: reuse coloring-book's trip-merging algorithm, but **adapt locally** — do not
  refactor coloring-book. Vendor `src/modules/scs.ts` verbatim (275 lines, zero
  dependencies, exports `shortestCommonSupersequenceWithAlignments` and
  `SCSResultHelper` with `getPositionMapping` / `getReversePositionMapping`), then write
  test-track's own thin caller. The equivalent caller in coloring-book is
  `TimetableDataProcessor.alignTripsWithSCS` (lines ~382–575) — read it as a reference,
  but it's welded to `GTFSRelationships` and IndexedDB, so we reimplement against the
  in-memory model from Plan 03.
- Decided: **direction tabs**, SCS run separately within each direction. Tab labels come
  from the dominant `trip_headsign` per direction, as coloring-book does.
- Decided vehicle placement: **`current_stop_sequence` only.** No geometry projection.
  Vehicles that don't report it are listed in a separate "unplaced vehicles" section on
  the route page rather than guessed at.
- Decided transparency model: typed summary + full `raw` column table on every page
  (Plan 03 Phase 1 provides `raw`).

## Phase 1 — Panel renderer skeleton

One dispatcher renders into `#panel-content` based on `AppState`'s current `PageState`.
Shared furniture across all pages: breadcrumb bar, object type + name header, an alerts
region, a properties region, and a raw-fields region.

- [x] Create `src/modules/panel-renderer.ts` dispatching on `PageState.type`
- [x] Shared `renderRawFields(raw: Record<string,string>)` — two-column table, values
      verbatim, empty values shown as an explicit empty marker rather than omitted
- [x] Shared `renderBreadcrumbs()` from Plan 03's synchronous breadcrumb builder
- [x] Shared entity-link helper so every referenced object id is a clickable link that
      sets focus (route ↔ stop ↔ vehicle ↔ alert)
- [x] All pages re-render on RT poll without losing scroll position

**As built.** The shared furniture landed in `src/modules/render-utils.ts` (escaping,
`entityLink`, `routeBadge`, `renderRawFields`, `renderRawJson`, `prop`/`propList`, time
and delay formatters, enum label maps); the pages themselves are `src/modules/pages/{route,stop,vehicle,alert}-page.ts`;
`panel-renderer.ts` is only the dispatcher plus the state that has to survive a render.
`panel-placeholder.ts` is deleted.

Scroll and `<details>` are both preserved, by different means. `scrollTop` is captured and
restored around the `innerHTML` swap. Open `<details>` cannot be captured that way, because
a re-render replaces the elements — instead every collapsible carries a stable
`data-detail` key and the renderer keeps a `Set` of open keys, updated by a capturing
`toggle` listener and re-applied after each render (before restoring scroll, since opening
a table changes the scroll height). Both are delegated listeners on the host, so they
survive every re-render.

`StatusPage` and `PanelRenderer` share `#panel-content` and each hold their own `active`
flag, so exactly one paints on a poll.

Two supporting modules came out of this phase because every page needed them:
`src/modules/rt-index.ts` (predictions by trip and by stop, vehicles by trip/route/stop,
rebuilt once per poll rather than per page render) and `src/modules/alerts.ts` (level-aware
alert matching, active-period logic, translations).

**Discovered:** `VehiclePosition` as Plan 04 left it carried only id/label/position/bearing/trip/route.
`current_stop_sequence`, `current_status`, `occupancy_status`, `timestamp`, and `speed` — the
fields Phases 3 and 5 are largely about — were being discarded at decode. `gtfs-rt.ts` now
keeps them, plus a `toObject`-ed copy of the whole entity for the raw JSON dump, and
`AlertRecord` gained the same. `toSeconds()` was added there for the protobuf `Long`
timestamps, which every page needs.

**Gotchas:** re-rendering the whole panel every 15 seconds destroys scroll position and
any open `<details>`. Either diff-update just the RT-derived regions, or capture and
restore `scrollTop` plus open-state before/after. The route strip in particular is long
and being bounced to the top every poll would make it unusable.

## Phase 2 — Route sequence derivation

New `src/modules/route-sequence.ts`. Given a `route_id` and a `direction_id`, produce the
canonical ordered stop list plus a per-trip alignment.

Algorithm:
1. Take all trips for the route with that `direction_id` (from `tripsByRoute`).
2. For each, build its stop-id sequence from `stopTimesByTrip` (already sorted numerically
   by `stop_sequence` — Plan 03 Phase 1).
3. Deduplicate identical sequences, keeping a count of how many trips share each pattern.
4. Feed the distinct sequences to `shortestCommonSupersequenceWithAlignments`.
5. Return `{ stops: string[], alignments, patternCounts }`.

Direction discovery: group trips by `direction_id`; for each, pick the modal
`trip_headsign` as the tab label, falling back to "Direction 0/1" and then to the
terminal stop name.

- [x] Vendor `src/modules/scs.ts` — verbatim, record in `VENDORED.md`
- [x] Write `src/modules/route-sequence.ts` with the five steps above
- [x] Cache results per `route_id:direction_id` — SCS is O(n·m) DP and reruns on every
      panel re-render otherwise
- [x] Handle the degenerate cases: one trip, zero trips, all trips identical
- [x] Handle loop routes where a stop repeats within one trip

**Decisions taken during implementation.**

*The k-way solver is unusable and is not used.* `shortestCommonSupersequence` memoises on a
position tuple, so its state space is the **product** of all k input lengths — 60^12 for a
typical route, not O(n·m). It has a `MAX_MEMO_SIZE` guard that gives up and returns
`sequences.flat()`. So `route-sequence.ts` folds pairwise in descending trip-count order,
where each fold is the exact two-sequence DP, exactly as this phase's gotcha suggested.
Folding is not guaranteed to yield the globally shortest supersequence; it is guaranteed to
contain every included pattern, which is what the strip needs.

*Alignments are computed locally.* `shortestCommonSupersequenceWithAlignments` would re-run
the k-way solver, and its `computeAlignments` is not exported. `route-sequence.ts` does its
own leftmost-match walk and wraps the result in the vendored `SCSResultHelper`, so
`getPositionMapping` is still what the strip reads. Every input is a subsequence of the fold
result by construction and greedy leftmost matching is complete for subsequence embedding,
so every walk consumes its whole input.

*Cap: 12 patterns, or 95% trip coverage, whichever binds first.* Both are surfaced on the
page as "Showing 12 of 34 stop patterns, covering N of M trips", never silently.

*Loops: de-looped by occurrence index, not collapsed.* A stop's n-th visit within a trip
becomes the element `stop_id ␁ n`, so each visit is its own supersequence position and each
gets its own strip row labelled "(visit 2)". Nothing is dropped and nothing is scrambled.
The route page says so in the coverage note.

*Cache keyed on the `GTFSStatic` instance* via a `WeakMap`, so loading a new feed drops the
cache without an explicit invalidation call.

**Known limit:** a route whose patterns are very long (~200+ stops) can push a single fold
past the vendored `MAX_MEMO_SIZE` guard, at which point that fold degrades to concatenation
— still a valid supersequence, but a strip that lists the two patterns end to end instead of
merging them, with a `console.error` from the vendored module. Not hit by any feed tried so
far; the fix if it shows up is a linear-space two-sequence SCS of our own rather than raising
the cap.

**Gotchas:** SCS over many long, divergent sequences is expensive — a route with 30
distinct patterns of 60 stops each will stall the main thread. Mitigate by folding
sequences pairwise in descending trip-count order and capping the number of distinct
patterns considered (e.g. patterns covering 95% of trips, with the remainder noted in the
UI). Decide the cap during implementation and surface it honestly — "showing 12 of 34
patterns" — rather than silently truncating.

Loop routes break the "sequence" assumption outright: a stop appearing twice in one trip
cannot map to a single supersequence position. Detect repeats and either de-loop by
suffixing the occurrence index, or flag the route as a loop and fall back to the single
most common pattern. Either is acceptable; silently producing a scrambled strip is not.

## Phase 3 — The route strip

The visual centerpiece. A vertical thick transit-map line down the left of the panel,
stops bulging out of it, vehicles rendered in the gaps between stops.

Structure per direction tab:

```
┌ Route header: badge (route_color), short + long name, agency
├ Route-level alerts (if any inform this route)
├ [ Direction 0 ▸ Harvard ] [ Direction 1 ▸ Alewife ]
│
│  ╺━━━┓
│   ●  ┃  Alewife                        ⚠ 2 alerts
│      ┃
│      ┃  🚋 1712  ·  in transit  ·  +3m      ← clickable vehicle
│      ┃
│   ●  ┃  Davis                          arriving 2m
│      ┃
│   ●  ┃  Porter
│  ╺━━━┛
│
└ Unplaced vehicles (no current_stop_sequence reported)
```

- The line is drawn in the route's `route_color`, thick (8–10px), with rounded caps at
  the terminals.
- Stops are circles that bulge past the line's width, white-filled with a colored ring;
  the focused stop is filled solid.
- Vehicles sit in the gap **between** the stop they last served and the one they're
  heading to, derived from `current_stop_sequence` + `current_status`
  (`STOPPED_AT` → aligned with the stop itself; `IN_TRANSIT_TO` / `INCOMING_AT` → in the
  gap before it).
- Each stop row shows its next arrival from trip updates, with delay coloring reusing the
  existing `formatDelay` thresholds.
- Alerts attach at their level: agency-wide alerts at the top of the page, route alerts
  under the header, stop alerts inline on the affected stop row.

- [x] Build the strip as CSS grid — line column + content column — not SVG. Stops and
      vehicles are absolutely positioned rows; that keeps text selectable and links real
- [x] Route color drives the line; ensure contrast against both light and dark themes
      (a `route_color` of `#FFFFFF` on light background is a real feed hazard — outline it)
- [x] Direction tabs; the active tab writes `direction_id` into the URL (Plan 03)
- [x] Vehicles placed by `current_stop_sequence` mapped through the SCS alignment for
      that vehicle's trip pattern
- [x] Unplaced-vehicle section, explicitly labeled with why they're unplaced
- [x] Per-stop next arrivals from trip updates
- [x] Alert placement at agency / route / stop levels
- [x] Everything clickable: stop → stop page, vehicle → vehicle page, alert → alert page
- [x] Raw route row table at the bottom

**As built.** Each row is its own `grid-cols-[2.5rem_1fr]`, rail then content — the rail
segment is absolutely positioned *within its own row's* cell rather than rows being
absolutely positioned within the strip. Same visual result, but rows lay themselves out, so
a long stop name wrapping cannot desynchronise the rail from the content.

Terminal caps are applied after the row list is built, to whichever rows land at the ends —
a vehicle rendered above the first stop takes the cap onto its own row rather than leaving
the rail visibly cut off above it.

The contrast hazard is handled with a neutral hairline (`ring-base-content/15` on the rail,
`/25` on the dots) rather than by inspecting the color's luminance: it reads on both themes
and against every `route_color`, including `#FFFFFF` and `#000000`, without having to decide
what "too close to the background" means.

Vehicle placement follows the three-step lookup the gotcha warns about: `current_stop_sequence`
→ index via `find(t => t.stop_sequence === …)` in that trip's `stop_times` (never as an array
index) → supersequence position via that trip's pattern alignment. Each of the four ways this
can fail produces a distinct, stated reason in the unplaced section — no `trip_id`, trip not in
the static feed, no `current_stop_sequence`, `stop_sequence` not in the trip's `stop_times`, or
the trip's pattern not among those shown.

`STOPPED_AT` vehicles render on a row immediately after their stop; `IN_TRANSIT_TO` and
`INCOMING_AT` render in the gap before it.

Direction tabs are only drawn when the route actually has more than one direction. A feed that
omits `direction_id` entirely collapses to one unnamed direction rather than being forced into
a 0/1 split the data does not support.

**Gotchas:** the alignment lookup is the subtle part. A vehicle reports
`current_stop_sequence` in **its own trip's** numbering; the strip is in supersequence
numbering. You must map trip position → supersequence position via
`SCSResultHelper.getPositionMapping(sequenceIndex)` for that trip's *pattern*, which means
tracking which distinct pattern each trip belongs to. Getting this wrong puts vehicles at
plausible-looking but wrong stops — the worst failure mode, because it looks fine.

`current_stop_sequence` is the GTFS `stop_sequence` value, not a zero-based index into the
trip's stop list. Look it up in `stopTimesByTrip`, don't use it as an array index.

## Phase 4 — Stop page

- [x] Header: stop name, id, `location_type`, parent station link
- [x] Routes serving this stop (from `routesByStop`), each a colored badge link
- [x] Upcoming departures from trip updates: route badge, headsign, scheduled vs
      predicted time, delay — sorted by time, replacing the current bare list
- [x] Vehicles currently `STOPPED_AT` this stop, as links
- [x] Alerts informing this stop
- [x] Child stops if this is a station; sibling platforms if it isn't
- [x] Raw stop row table

**As built.** The `!e.stopId` bug is fixed at the source: `alerts.ts` classifies each entity
selector by the level it actually names (`feed` / `agency` / `route-type` / `route` / `trip` /
`stop` / `route-stop`) and `alertsForStop` matches `e.stopId === stopId` only. Every alert row
on every page shows its level next to it, so a feed-wide alert appearing on a stop page reads
as feed-wide rather than as being about that stop.

Departures capped at 20, and predictions more than a minute in the past are dropped — unless
that would empty the list, in which case the stale ones are shown rather than claiming the
stop has no data.

**Gotchas:** the current stop-sheet code filters alerts with
`a.informedEntity?.some(e => !e.stopId || e.stopId === stopId)` — the `!e.stopId` clause
makes every route-level and agency-level alert match every stop. Fix the matching to be
explicit about which level an alert applies at, and show that level in the UI.

## Phase 5 — Vehicle page

- [x] Header: vehicle label/id, route badge, headsign
- [x] Live: position, bearing, speed, `current_status`, `occupancy_status`, timestamp
      (with age — a stale vehicle timestamp is exactly what this tool should expose)
- [x] Its trip: link to the route, current/next stop, progress through the strip
- [x] Full stop-time predictions for this vehicle's trip from the matching trip update
- [x] Alerts informing this trip or its route
- [x] Raw dump of the decoded `VehiclePosition` entity as formatted JSON
- [x] Handle the vehicle vanishing between polls: keep the page, show last-known data with
      a clear "no longer in feed as of <time>" banner

**As built.** The last-known cache is a module-level `Map` in `vehicle-page.ts`, written every
time the page renders a vehicle that *is* in the feed. Every field that a feed may omit renders
as an explicit "not reported" rather than as a blank or a zero — for `bearing`, `speed`,
`current_status`, `current_stop_sequence` and `occupancy_status` alike, since a feed reporting
`0` and a feed reporting nothing are different facts. The trip's route link carries the trip's
`direction_id`, so it lands on the strip tab the vehicle is actually on, and the vehicle's own
row in the predictions table is highlighted.

## Phase 6 — Alert page and alerts list

- [x] Alert page: header text, description text, URL, cause, effect, severity, active
      periods (as absolute times plus "active now / starts in 2h"), and every informed
      entity rendered as a link to its own page
- [x] Translations: show all available languages, not just `en` — the current
      `getTranslatedText` silently drops them
- [x] Replace the alerts modal contents with a list that links into alert pages
- [x] Navbar alert badge counts only *currently active* alerts, with total shown separately
- [x] Raw dump of the decoded `Alert` entity

**As built.** `preferredText()` picks the browser's language, then English, then whatever is
first — and every other translation is kept behind a disclosure rather than dropped. Active
periods render both bounds absolutely plus what the period means right now; a missing `end` is
stated as "open-ended" and a missing `activePeriod` entirely is stated as "always active", so
neither can render as an end of 1970. The modal lists active alerts first and states
"N active of M in the feed" above the list; the navbar badge shows N and hides itself when
nothing is active.

**Gotchas:** `activePeriod` timestamps are protobuf Longs and may be absent entirely
(meaning "always active"). An alert with `start` but no `end` is open-ended — don't render
that as "ends 1970".

## Done when

Selecting a route shows a full vertical transit-map strip with live vehicles positioned
between stops, clickable stops and vehicles, and alerts at the right level. Stop, vehicle,
and alert pages each show everything the feed says about that object, including every raw
column. Every reference between objects is a working link, and every page is reachable by
URL.
