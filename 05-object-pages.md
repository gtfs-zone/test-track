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

- [ ] Create `src/modules/panel-renderer.ts` dispatching on `PageState.type`
- [ ] Shared `renderRawFields(raw: Record<string,string>)` — two-column table, values
      verbatim, empty values shown as an explicit empty marker rather than omitted
- [ ] Shared `renderBreadcrumbs()` from Plan 03's synchronous breadcrumb builder
- [ ] Shared entity-link helper so every referenced object id is a clickable link that
      sets focus (route ↔ stop ↔ vehicle ↔ alert)
- [ ] All pages re-render on RT poll without losing scroll position

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

- [ ] Vendor `src/modules/scs.ts` — verbatim, record in `VENDORED.md`
- [ ] Write `src/modules/route-sequence.ts` with the five steps above
- [ ] Cache results per `route_id:direction_id` — SCS is O(n·m) DP and reruns on every
      panel re-render otherwise
- [ ] Handle the degenerate cases: one trip, zero trips, all trips identical
- [ ] Handle loop routes where a stop repeats within one trip

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

- [ ] Build the strip as CSS grid — line column + content column — not SVG. Stops and
      vehicles are absolutely positioned rows; that keeps text selectable and links real
- [ ] Route color drives the line; ensure contrast against both light and dark themes
      (a `route_color` of `#FFFFFF` on light background is a real feed hazard — outline it)
- [ ] Direction tabs; the active tab writes `direction_id` into the URL (Plan 03)
- [ ] Vehicles placed by `current_stop_sequence` mapped through the SCS alignment for
      that vehicle's trip pattern
- [ ] Unplaced-vehicle section, explicitly labeled with why they're unplaced
- [ ] Per-stop next arrivals from trip updates
- [ ] Alert placement at agency / route / stop levels
- [ ] Everything clickable: stop → stop page, vehicle → vehicle page, alert → alert page
- [ ] Raw route row table at the bottom

**Gotchas:** the alignment lookup is the subtle part. A vehicle reports
`current_stop_sequence` in **its own trip's** numbering; the strip is in supersequence
numbering. You must map trip position → supersequence position via
`SCSResultHelper.getPositionMapping(sequenceIndex)` for that trip's *pattern*, which means
tracking which distinct pattern each trip belongs to. Getting this wrong puts vehicles at
plausible-looking but wrong stops — the worst failure mode, because it looks fine.

`current_stop_sequence` is the GTFS `stop_sequence` value, not a zero-based index into the
trip's stop list. Look it up in `stopTimesByTrip`, don't use it as an array index.

## Phase 4 — Stop page

- [ ] Header: stop name, id, `location_type`, parent station link
- [ ] Routes serving this stop (from `routesByStop`), each a colored badge link
- [ ] Upcoming departures from trip updates: route badge, headsign, scheduled vs
      predicted time, delay — sorted by time, replacing the current bare list
- [ ] Vehicles currently `STOPPED_AT` this stop, as links
- [ ] Alerts informing this stop
- [ ] Child stops if this is a station; sibling platforms if it isn't
- [ ] Raw stop row table

**Gotchas:** the current stop-sheet code filters alerts with
`a.informedEntity?.some(e => !e.stopId || e.stopId === stopId)` — the `!e.stopId` clause
makes every route-level and agency-level alert match every stop. Fix the matching to be
explicit about which level an alert applies at, and show that level in the UI.

## Phase 5 — Vehicle page

- [ ] Header: vehicle label/id, route badge, headsign
- [ ] Live: position, bearing, speed, `current_status`, `occupancy_status`, timestamp
      (with age — a stale vehicle timestamp is exactly what this tool should expose)
- [ ] Its trip: link to the route, current/next stop, progress through the strip
- [ ] Full stop-time predictions for this vehicle's trip from the matching trip update
- [ ] Alerts informing this trip or its route
- [ ] Raw dump of the decoded `VehiclePosition` entity as formatted JSON
- [ ] Handle the vehicle vanishing between polls: keep the page, show last-known data with
      a clear "no longer in feed as of <time>" banner

## Phase 6 — Alert page and alerts list

- [ ] Alert page: header text, description text, URL, cause, effect, severity, active
      periods (as absolute times plus "active now / starts in 2h"), and every informed
      entity rendered as a link to its own page
- [ ] Translations: show all available languages, not just `en` — the current
      `getTranslatedText` silently drops them
- [ ] Replace the alerts modal contents with a list that links into alert pages
- [ ] Navbar alert badge counts only *currently active* alerts, with total shown separately
- [ ] Raw dump of the decoded `Alert` entity

**Gotchas:** `activePeriod` timestamps are protobuf Longs and may be absent entirely
(meaning "always active"). An alert with `start` but no `end` is open-ended — don't render
that as "ends 1970".

## Done when

Selecting a route shows a full vertical transit-map strip with live vehicles positioned
between stops, clickable stops and vehicles, and alerts at the right level. Stop, vehicle,
and alert pages each show everything the feed says about that object, including every raw
column. Every reference between objects is a working link, and every page is reachable by
URL.
