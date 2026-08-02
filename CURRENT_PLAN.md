# Route Strip: Full Coverage, Endpoints, and a Branch Tree

## Summary

The route page renders one direction of a route as a vertical strip built from the
shortest common supersequence (SCS) of the direction's distinct stop patterns. Three
things are wrong with it:

1. **It drops most of the route.** `build()` capped the strip at 12 stop patterns. On
   routes where nearly every trip has its own pattern (Amtrak Northeast Regional), that
   covers a small fraction of trips; every other vehicle lands in the "this trip's stop
   pattern is not among those shown" list, and stops served only by dropped patterns —
   including the trips continuing past Washington DC to Norfolk VA — vanish entirely.
2. **The SCS fold lists stops twice.** Once every pattern is admitted, the pairwise fold
   concatenates patterns that share few stops instead of interleaving them.
3. **It is linear, so branches are invisible.** The Red Line's Ashmont/Braintree split is
   fully present in the data and renders as one flat column.

The fix, in order: show every pattern → order stops correctly → mark where trips start and
end → draw a `git log --graph` style rail for genuine branches.

**Phases 1 and 2 are done and committed** (`65c72f8`); Phase 3 is the remaining work.

## Relevant Context

### Files

- `src/modules/route-sequence.ts` — builds the canonical stop order and the trip→strip
  position mapping. Cached per `GTFSStatic` in a `WeakMap`.
- `src/modules/pages/route-page.ts` — renders the strip as a two-column CSS grid
  (rail, content). Pure string templating; `panel-renderer.ts` injects via `innerHTML`.
- `src/modules/scs.ts` — **vendored, `@status verbatim`. Do not modify.** Its
  `SCSResultHelper`, `shortestCommonSupersequenceWithAlignments` and `computeAlignments`
  are unused by this repo.

### Measured evidence (real MBTA feed, 730 route/direction pairs)

Both ordering methods fail, on **disjoint** sets of routes:

| method | exact stop count | total rows | fails on |
|---|---|---|---|
| SCS fold | 716/730 | 14,286 | 14 routes — branching / short-turn |
| topological sort | 725/730 | 14,258 (= real stop count) | 5 routes — loops; 70 of 91,772 trips |

- **Worst SCS failure — Framingham/Worcester inbound (`CR-Worcester` dir 1):** 19 patterns,
  25 stops, 31 rows. The fold seeds with a Framingham-origin short turn, then cannot align
  it with the full Worcester run, so Framingham, West Natick, Natick Center, Wellesley
  Square, Wellesley Hills and Wellesley Farms each appear **twice, with the entire line
  between the two copies**.
- **Worst topological failure — Winthrop Ferry (`Boat-F6` dir 1):** direction 1 contains
  patterns running opposite ways (`Winthrop → Logan → Central Wharf → Seaport`, 6 trips,
  and `Seaport → Logan → Winthrop`, 5 trips). A genuine cycle, so the sort must break an
  edge, and it breaks one asserted by the *majority* pattern.
- The 5 topological-breaking routes are **all** in the SCS-bloat list, and none of the 14
  large SCS failures are cyclic. Hence the hybrid in Phase 1.
- Speed is a non-issue: across the whole feed, SCS 12ms vs topological 32ms.

### Decisions already taken

- **Ordering:** topological sort, falling back to the SCS fold for any route where the sort
  has to break a precedence edge.
- **Platforms:** collapse platform stop_ids to their `parent_station`. MBTA models JFK/UMass
  as four stop_ids under `place-jfk` (`70085` Ashmont, `70095` Braintree, plus the reverse
  pair); Framingham likewise. Without collapsing, the Red Line junction renders as two
  adjacent rows both labelled "JFK/UMass".
- **No percentages.** Show raw trip counts, not computed shares.
- Show everything first; compress later.

### Gotchas

- `elementKey()` joins `stop_id` and `occurrence` with a **literal NUL byte**, not a space.
  The Read tool renders it as a space, so the source *looks* like `${stop_id} ${occurrence}`.
  `parseElement()` splits on `lastIndexOf` of that NUL. Any new code building or parsing
  these keys must use the same separator. This is also why git reports the file as binary.
- Repeat visits within one trip are already handled by `occurrence`, so a ferry loop
  legitimately occupies two rows. Only a repeated `stop_id + occurrence` is a bug.
- A vehicle reports `current_stop_sequence` in its own trip's numbering; it must be looked
  up in that trip's `stop_times` for an index, then mapped through the pattern alignment.
  `placeVehicles` already does this — don't disturb the row/gap indexing.

---

## Phase 1 — Full coverage and correct ordering

Remove the pattern cap so every stop pattern shapes the strip, and replace the ordering
algorithm with a topological sort of the stop precedence graph, falling back to the SCS
fold on cyclic routes.

Each pattern asserts "stop A comes before stop B" for each consecutive pair. Collect those
as a weighted graph (weight = trips asserting the edge) and topologically sort it: any
valid topological order contains every pattern as a subsequence, with each element
appearing exactly once — the guarantee the fold cannot make. Break ties by mean normalized
position across patterns so the order stays geographic. If Kahn's algorithm stalls, the
route is cyclic; abandon the sort and use the existing fold for that route.

**Status: done, committed** (`65c72f8`).

- [x] Delete `MAX_PATTERNS` / `COVERAGE_TARGET`; fold all patterns busiest-first
- [x] `isSubsequence` fast path before each fold
- [x] Per-pattern alignment maps; drop the `SCSResultHelper` import
- [x] Add `topoOrder(sequences, weights)` — Kahn's algorithm, mean-position tie-break,
      returning `{ order, cyclic }`
- [x] Use it in `build()`, falling back to `foldSupersequence` when `cyclic`
- [x] Collapse stop ids to `parent_station` when building patterns
- [x] Keep `positionOf` tolerant: return null only for indices that genuinely fail to map

Discoveries:

- `GTFSStatic` already had everything needed: `stationRoot()` (cycle-guarded walk to the
  topmost ancestor), `descendants()` and `boardableDescendants()`. No new indexing.
- Edge *weights* turned out to be dead: Kahn's algorithm never consults them. Trips only
  weight the mean-position tie-break, and `topoOrder` says so rather than carrying a
  weighted adjacency nothing reads.
- Collapsing is done inside `tripStops`, before the occurrence counter, and two
  consecutive stop times at one station fold into one element. That desynchronises a
  trip's own `stop_times` indices from its element indices, so `tripStops` now also
  returns `indexOfStop` and `build` keeps it — **only for the trips where it differs from
  the identity**, which is a small minority. `positionOf` remaps through it.
- Measured on the real MBTA feed: 725/730 exact, and the 5 on the fold are exactly the
  known cyclic set (`Boat-F6`, `Boat-F7`, `15` dir 1, `37` dir 1, `70` dir 0). Amtrak:
  116/121 exact, 5 cyclic. All 2,262,928 stop-time indices in the MBTA feed map to a
  monotone strip position — nothing unmapped, nothing backwards.
- **Knock-on the plan did not anticipate:** the strip now names stations while the
  realtime feed predicts against platforms, so `nextAtStopForRoute` became
  `nextAtStopsForRoute(stopIds, …)` and `alertsForRouteStop` took a stop id list. Both had
  exactly one call site. The route page builds the two id sets the same way the station
  page does — `boardableDescendants` for service, `descendants` for alerts.
- CR-Worcester dir 1 is **18** rows, not the 25 this plan predicted: 25 counted platform
  stop_ids, and 18 is the real station count for Worcester → South Station.

## Phase 2 — Mark where trips start and end

With everything on the strip, the missing information is which stations are endpoints.
Graph degree gets this wrong: Northeast Regional trains continue past Washington to
Norfolk, so Washington has outgoing edges and looks like a through stop, when in fact most
of the route's trips end there. Endpoints must be counted per pattern.

`RouteSequence` gains `stopStats: StopStats[]` parallel to `stops`, each `{ startsHere,
endsHere, serves }`, weighted by trips. A stop where at least `ENDPOINT_SHARE` (5%) of the
direction's trips start or end gets a filled dot instead of an open one, plus a raw count
beside the name.

**Status: done, committed** (`65c72f8`, alongside Phase 1 — the two changes share
`route-page.ts` and could not be split cleanly).

- [x] `StopStats` on `RouteSequence`, accumulated from the alignment maps
- [x] Filled dot for endpoints (the `'solid'` variant already existed in `rail()`, unused)
- [x] `endpointNote()` rendering `142 end · 18 start`, gated by the same threshold
- [x] Replace the `%` badge with a raw count (`87 of 300 trips`); keep the dimming
- [x] Reword the coverage note to match

`MINORITY_SHARE` stayed — it is still what decides *whether* a stop is a deviation, it
just no longer supplies the text.

Discoveries: the 5% threshold behaves on both feeds. Northeast Regional dir 1 marks
Washington (258 of 373 trips end there) while Norfolk, Newport News and Roanoke all
remain on the strip below it, each correctly marked as its own terminus. Red Line dir 0
marks Alewife (816 start) and Park Street (684 start), Ashmont (754 end) and Braintree
(746 end) — the four the plan predicted, and nothing else. Amtrak's feed gives several
genuinely distinct stations the same name ("Boston" for both South Station and Back Bay,
two "New Haven"s) and has no `parent_station` linking them, so those still render as two
rows. That is the feed, not the ordering.

## Phase 3 — The branch tree

The graph is already computed and discarded: the per-pattern position maps give, for each
pattern, the ascending strip positions it occupies. Edges between consecutive positions,
deduped across patterns, are the DAG. No new algorithm.

Drawing every edge as a lane would be unreadable — on a route where each trip skips a
different subset, most edges are stopping policy, not geography. Classify:

- **bypass** — a skip edge `i → j` where another path from `i` to `j` exists through the
  positions it skips (an express rejoining the same line). **No lane.**
- **branch** — a skip edge with no alternate path, plus any node with two or more outgoing
  edges surviving the filter. **Lane.**

The alternate-path test is a bounded DFS over positions in `(i, j]` ignoring edge `(i,j)`,
so cost is proportional to the span. Lane assignment is the standard git-graph sweep:
lanes hold the node index they are reserved for; at each row the leftmost lane targeting it
wins, others emit merge elbows; outgoing branch edges allocate new lanes; untouched lanes
pass through as verticals. Cap at 5 lanes, overflow sharing the outermost.

- [ ] New `src/modules/route-graph.ts` — pure, no DOM; edge classification + lane sweep,
      memoised per `RouteSequence` in a `WeakMap`
- [ ] `RailRow { lane, through[], branches[], merges[], bypassed }` + `laneCount`
- [ ] Replace `railStyle()` / `rail()` in `route-page.ts` with a `RailRow`-driven renderer
- [ ] Gutter width `laneCount * LANE_WIDTH` (~12px); `stripRow`'s `grid-cols-[2.5rem_1fr]`
      becomes an inline `grid-template-columns`
- [ ] Lines as one inline `<svg viewBox="0 0 W 100" preserveAspectRatio="none">` per row,
      every path carrying `vector-effect="non-scaling-stroke"`
- [ ] Dots stay absolutely-positioned HTML spans at `left: laneX(row.lane)`
- [ ] Vehicle rows draw the gap state so chips no longer break the rail
- [ ] Update the file header comment, which currently says the strip is not an SVG

Gotchas: row heights are content-driven and unknown at render time, hence the non-uniform
viewBox scale — circles must not go in the SVG. Terminal caps come from Phase 2's
`stopStats`, never from graph degree. A single-lane route must look exactly as it does
today. Text stays real HTML so stop names remain selectable and links stay links.

---

## Verification

`pnpm typecheck` and `pnpm build` after each phase. Per CLAUDE.md, no browser automation —
hand off for visual checks.

Analysis harnesses live in the session scratchpad. Re-download the feeds with
`curl -sL -o mbta.zip https://cdn.mbta.com/MBTA_GTFS.zip` and
`curl -sL -o amtrak.zip https://content.amtrak.com/content/gtfs/GTFS.zip` if needed.

**Phases 1 and 2 — done.** The harnesses were rebuilt as `sweep.mts`, `detail.mts`,
`place.mts` and `amtrak.mts` (`.mts` so tsx allows top-level await; pass the zip as a
`Buffer` cast to `File`, since JSZip rejects a Node `Blob`). Results are recorded in each
phase above. `pnpm typecheck` and `pnpm build` both clean. Still owed: the visual pass on
the Red Line, CR-Worcester and Northeast Regional pages.

**Phase 3**
- Red Line dir 0 renders JFK/UMass as one node with two lanes below it, to Ashmont and
  Braintree, given the Phase 1 parent-station collapse.
- A route where all trips stop everywhere renders as a single lane.
- If a gutter is wide, the bypass/branch classification is admitting express skips it
  should filter — fix that, not the lane cap.
- Vehicles still land in the right gaps; `placeVehicles` is unchanged, so a regression
  points at row indexing in `renderStrip`.
