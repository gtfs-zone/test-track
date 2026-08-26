# Plan: Read `schedule_relationship` and stop reporting added trips as gaps

## Summary

The MBTA vehicles feed carries trips like `ADDED-1584879515` whose
`TripDescriptor.schedule_relationship` is `ADDED`. The producer stated, explicitly,
that this trip is not in the static schedule and never will be.

test-track never reads that field. `schedule_relationship` appears **nowhere** in
`src/`, `scripts/`, this file, or `CHANGELOG.md`. So the only thing the app knows is
that `feed.trips.get('ADDED-1584879515')` missed, and it renders that as:

- `src/modules/pages/route-page.ts:111` — unplaced, reason `trip ADDED-1584879515 is not in the schedule`
- `src/modules/pages/vehicle-page.ts:95` — `Route: trip not in the schedule` in dimmed text
- `src/modules/pages/stop-page.ts:82,93` — ghost badge in place of a route
- `src/modules/layer-manager.ts:1067` — counted as `vehiclesUnmatched`, painted `CONFIG.VEHICLE_UNMATCHED_COLOR`

An added trip is therefore indistinguishable from a stale or broken trip reference.
That inverts the tool's own rule, stated at `src/modules/render-utils.ts:247-252` and
`src/modules/status-page.ts:274-284`: report what the feed said, mark only what
test-track inferred, and render a legitimate-but-different encoding neutral rather
than as a defect. Here the app reports an inference ("missing") where the feed made
a statement ("ADDED").

Five phases plus a wrap-up. Capture `schedule_relationship` at both the trip and
stop-time level, label it, and use it to restate the three places that currently read
as defects. Purely additive: no existing row, column, section or layout moves for a
feed whose trips are all `SCHEDULED`.

### Deliberately out of scope

Other unread GTFS-RT fields, listed here so the next pass has a starting point:
`TripProperties` (trip_headsign / trip_short_name — would give an added trip a real
name instead of a hex id), `StopTimeProperties.assigned_stop_id` (track assignments),
`StopTimeEvent.uncertainty`, trip-level `TripUpdate.delay`, `occupancy_percentage`,
`multi_carriage_details`, `congestion_level`, `vehicle.wheelchair_accessible`,
`license_plate`, and the experimental entity types `shape` / `stop` /
`trip_modifications`.

---

## Relevant context

**The decoding trap.** `SCHEDULED = 0` and `StopTimeUpdate.SCHEDULED = 0`. protobufjs
keeps proto2 defaults on the message *prototype*, so `msg.scheduleRelationship ?? undefined`
can never be `undefined` and every trip in every feed would read as "SCHEDULED"
whether or not the producer said so. Every new read **must** go through the existing
own-property guard `present()` at `src/gtfs-rt.ts:38-40`. This is the same class of
bug the file's comment at `:31-36` was written about.

**Where the enums live.** `node_modules/gtfs-realtime-bindings/gtfs-realtime.d.ts:1802-1809`
(TripDescriptor) and `:730` (StopTimeUpdate).

| TripDescriptor | | StopTimeUpdate | |
|---|---|---|---|
| 0 | SCHEDULED | 0 | SCHEDULED |
| 1 | ADDED (deprecated in favour of NEW/DUPLICATED) | 1 | SKIPPED |
| 2 | UNSCHEDULED | 2 | NO_DATA |
| 3 | CANCELED | 3 | UNSCHEDULED (experimental) |
| 4 | REPLACEMENT (experimental) | | |
| 5 | DUPLICATED (experimental) | | |
| 6 | DELETED (experimental — "must not be shown to users") | | |

**Existing primitives to reuse, not reinvent:**

- `present()` / `presentNumber()` — `src/gtfs-rt.ts:38-62`
- `badgeMark(label, title)` — `src/modules/render-utils.ts:253-255`, `badge badge-ghost badge-xs`.
  Reserved for *inferred* values (`derived`, `ambiguous`); a feed-reported fact needs a
  visually distinct sibling.
- `VEHICLE_STATUS_LABELS` / `OCCUPANCY_LABELS` — `src/modules/render-utils.ts:180-196`, the
  established enum-label-table pattern.
- `prop()` / `propList()` — `src/modules/render-utils.ts:230-241`
- Conditional-column pattern — `src/modules/pages/stop-page.ts:139,151-158` (`${isStation ? '<th>…' : ''}`)
- `setFeedGapsProvider` wiring — `src/index.ts:127` → `src/modules/status-page.ts:515,528,587`
- `renderFeedGaps` — `src/modules/status-page.ts:286-321`, the neutral-vs-warning card idiom

**Constraint:** vendored files marked `verbatim` in `VENDORED.md` must change upstream
first. None of the files below are in that set, but `pnpm vendor:check --strict` must be
clean before finishing. Per `CLAUDE.md`, stop at `pnpm typecheck` / `pnpm build` — no
browser automation.

---

## Phase 1 — Capture the field

Read the relationship on vehicles and on trip updates, through `present()`. Nothing
renders yet; this phase alone is a no-op on screen.

**`src/map-controller.ts:10-51`** — add to the `VehiclePosition` interface:

```ts
/** TripDescriptor.schedule_relationship, or undefined when the producer omitted it. */
scheduleRelationship?: number;
```

**`src/gtfs-rt.ts:302-306`** — populate it beside `directionId`, with the same null-trip
guard that line already uses:

```ts
scheduleRelationship: v.trip
  ? present(v.trip, 'scheduleRelationship', v.trip.scheduleRelationship)
  : undefined,
```

**`src/modules/rt-index.ts:18-30`** — add two fields to `Prediction`:

```ts
/** TripDescriptor.schedule_relationship of the enclosing trip update. */
tripScheduleRelationship?: number;
/** StopTimeUpdate.schedule_relationship for this stop: SKIPPED, NO_DATA, … */
scheduleRelationship?: number;
```

**`src/modules/rt-index.ts:103-140`** — in `ingestUpdate`, read the trip-level value once
before the loop and the stop-level value per `stu`, both via `presentNumber` (already
imported at `:12`):

```ts
const tripRelationship = presentNumber(update.trip, 'scheduleRelationship');
// …inside the stopTimeUpdate loop:
scheduleRelationship: presentNumber(stu, 'scheduleRelationship'),
tripScheduleRelationship: tripRelationship,
```

### Gotchas

- Reading either field without `present` / `presentNumber` makes every trip in every
  feed report `SCHEDULED`, which is worse than not reading it at all.
- `v.trip` is nullable, so the vehicle read needs the ternary guard that `directionId`
  already carries at `gtfs-rt.ts:302`.
- An added trip has no `stop_times`, so a `StopTimeUpdate` carrying only `stop_sequence`
  and no `stop_id` is silently dropped by the existing `if (!stopId) continue` at
  `rt-index.ts:117`. **Record this as a comment there; do not fix it in this plan.** MBTA
  sends `stop_id`, so it does not bite today.

### Checklist

- [x] `VehiclePosition.scheduleRelationship` added and populated
- [x] `Prediction.scheduleRelationship` / `.tripScheduleRelationship` added and populated
- [x] Both reads go through `present` / `presentNumber`
- [x] Comment added at the `!stopId` drop about sequence-only updates on added trips
- [x] `pnpm typecheck`

---

## Phase 2 — Labels and a "the feed said this" badge

**`src/modules/render-utils.ts:196`** — two label tables next to `OCCUPANCY_LABELS`, in
the same shape. Cover every value including the experimental ones; the fallback at each
call site is `String(value)`, so an unknown number still renders honestly.

```ts
export const TRIP_SCHEDULE_RELATIONSHIP_LABELS: Record<number, string> = {
  0: 'SCHEDULED', 1: 'ADDED', 2: 'UNSCHEDULED', 3: 'CANCELED',
  4: 'REPLACEMENT', 5: 'DUPLICATED', 6: 'DELETED',
};

export const STOP_TIME_SCHEDULE_RELATIONSHIP_LABELS: Record<number, string> = {
  0: 'SCHEDULED', 1: 'SKIPPED', 2: 'NO_DATA', 3: 'UNSCHEDULED',
};
```

**A sibling of `badgeMark`, at `src/modules/render-utils.ts:255`.** `badgeMark` means
"test-track worked this out"; this means the opposite — "the producer stated this" — so it
must not share the ghost styling. Use `badge badge-outline badge-xs`:

```ts
/**
 * Marks a fact the feed reported, as against `badgeMark`'s inferred values. The two
 * must stay visually distinct: a reader has to be able to tell what the producer said
 * from what test-track worked out.
 */
export function feedMark(label: string, title: string): string { … }
```

**One shared explainer per relationship**, so the wording is written once and the `title=`
is identical everywhere the badge appears — the approach `DERIVED_STOP_SEQUENCE_TITLE`
already takes at `render-utils.ts:258`:

```ts
const TRIP_RELATIONSHIP_TITLES: Record<number, string> = {
  1: 'The feed reports this trip as ADDED: it is not in the static schedule by design, not by omission.',
  2: 'The feed reports this trip as UNSCHEDULED: a frequency-based trip with exact_times=0.',
  3: 'The feed reports this trip as CANCELED.',
  …
};

/** The badge for a trip's schedule_relationship, or '' when it is SCHEDULED or unreported. */
export function tripRelationshipMark(relationship: number | undefined): string { … }
export function stopTimeRelationshipMark(relationship: number | undefined): string { … }
```

### Gotchas

- Both mark helpers return `''` for `undefined` **and** for `0`. That single rule is what
  keeps the whole change additive: a well-formed all-`SCHEDULED` feed renders exactly as
  it does today.
- Do not reuse `badgeMark` for these. Its doc comment reserves the ghost badge for values
  test-track inferred; collapsing the two registers would make the page unable to say
  which is which.

### Checklist

- [x] Both label tables added
- [x] `feedMark` added, visually distinct from `badgeMark`
- [x] `tripRelationshipMark` / `stopTimeRelationshipMark` added, returning `''` for undefined and 0
- [x] `pnpm typecheck`

---

## Phase 3 — Vehicle page

**`src/modules/pages/vehicle-page.ts:62-114`, `renderTripSection`.**

Add a `schedule_relationship` row to the Trip property list, following the "this region
reports the wire" convention already used for `current_stop_sequence` at `:261` — an
omitted field still reads as omitted:

```ts
prop('schedule_relationship',
  vehicle.scheduleRelationship === undefined
    ? '<span class="opacity-40">not reported</span>'
    : escHtml(TRIP_SCHEDULE_RELATIONSHIP_LABELS[vehicle.scheduleRelationship]
        ?? String(vehicle.scheduleRelationship))),
```

Rewrite the `Route` fallback at **`:95`**. Today it is a flat dimmed `trip not in the
schedule`. When the feed explained why, say so instead of implying a gap — and keep
`vehicle.routeId` visible, which the current branch throws away even though an added trip
usually carries one:

- Relationship is ADDED / UNSCHEDULED / REPLACEMENT / DUPLICATED → render
  `vehicle.routeId` (linked if the route resolves in the schedule, plain mono if not)
  followed by `tripRelationshipMark(...)`, with the explanation in the badge title. No
  `opacity-50`; this is not missing data.
- Relationship absent or SCHEDULED → keep today's exact string and styling.

Add the trip badge to `pageHeader`'s `extra` slot at **`:229-235`** alongside `routeBadge`,
so the relationship is visible without scrolling.

**`renderPredictions`, `:117-168` — a conditional `Rel` column.** Render the sixth column
only when at least one prediction in the table has a defined, non-zero stop-level
relationship. This follows the `isStation` pattern at `stop-page.ts:139,151` and means the
common case is untouched — importantly, it does not undo commit `8796708`, which just
widened the Stop column.

The `<colgroup>` at `:132-138` is hardcoded and must be re-derived. Today's widths are
1/11, 4/11, 2/11, 2/11, 2/11. With the extra column, switch to twelfths:

| | Seq | Stop | Arr | Dep | Delay | Rel |
|---|---|---|---|---|---|---|
| without Rel (unchanged) | 9.09% | 36.36% | 18.18% | 18.18% | 18.18% | — |
| with Rel | 8.33% | 33.33% | 16.67% | 16.67% | 16.67% | 8.33% |

A `SKIPPED` row additionally gets `opacity-50` and `line-through` on the stop name — the
producer said the vehicle will not call there, so the times on that row are not times
anyone can catch. `NO_DATA` gets the badge only.

### Gotchas

- The Live property region is the "what the wire said" region. `schedule_relationship`
  belongs to the trip, so its row goes in the Trip section, not Live — but it keeps the
  same `not reported` treatment.
- The Stop cell is `max-w-0 truncate`; a badge placed inside it will be clipped. That is
  why the relationship gets its own column rather than riding along in the stop name.
- The colgroup percentages must sum to ~100 or `table-fixed` distributes the remainder
  unpredictably.

### Checklist

- [x] `schedule_relationship` prop row added to the Trip section
- [x] `:95` Route fallback restated; `vehicle.routeId` surfaced; badge attached
- [x] Trip relationship badge in `pageHeader`
- [x] Conditional `Rel` column with re-derived colgroup widths
- [x] SKIPPED rows dimmed and struck through
- [x] `pnpm typecheck`

---

## Phase 4 — Route page

**`src/modules/pages/route-page.ts:105-115`.** Keep added vehicles in the existing
`Unplaced vehicles` section — no new section, no layout change — but restate the reason
and attach the badge. `Unplaced` at `:59-63` gains an optional field so `renderUnplaced`
can render the mark:

```ts
interface Unplaced {
  vehicle: VehiclePosition;
  reason: string;
  /** Trip schedule_relationship, when the feed gave one that explains the placement. */
  relationship?: number;
}
```

At `:108-113`, when `vehicle.scheduleRelationship` is a defined non-zero value, the reason
becomes the feed's statement rather than test-track's observation:

```
trip ADDED-1584879515 is not in the schedule; the feed reports it as ADDED
```

versus today's bare `trip ADDED-1584879515 is not in the schedule`. The other four
unplaced reasons (`:112`, `:121`, `:131`, `:138`) are untouched.

`renderUnplaced` at **`:374-388`** renders `tripRelationshipMark(u.relationship)` after the
label. It stays a plain section, not a warning card.

Add the same mark to `vehicleChip` at **`:189-212`**, beside the existing status /
occupancy / `stopSequenceMark` markers, so a placed-but-added vehicle is marked on the
strip too.

### Gotchas

- An added trip still reaches this page: `rt-index.ts:145` falls back to `vehicle.routeId`
  when the trip is not in the schedule, so the vehicle is in `vehiclesByRoute` already.
- Do not turn the section's border to `warning`. The rule in the `renderFeedGaps` doc
  comment (`status-page.ts:274-284`) is that a legitimate-but-different encoding renders
  neutral; only inference and failure earn the warning treatment.

### Checklist

- [x] `Unplaced.relationship` added and populated
- [x] Reason text restated for non-SCHEDULED trips only
- [x] Badge rendered in `renderUnplaced` and in `vehicleChip`
- [x] Section stays neutral (no warning border)
- [x] `pnpm typecheck`

---

## Phase 5 — Status page roll-up

A feed-wide count of non-SCHEDULED trips, alongside `renderFeedGaps`. Neutral border
throughout: an added trip is a fact about the feed, not a defect.

**`src/modules/rt-index.ts`** — a tally computed in the constructor next to `gaps`, over
both vehicles and trip updates:

```ts
export interface ScheduleRelationshipCounts {
  /** Vehicles and trip updates whose TripDescriptor carried the field at all. */
  reported: number;
  /** Count per relationship value, SCHEDULED included. */
  trips: Map<number, number>;
  /** StopTimeUpdates by relationship: SKIPPED and NO_DATA are the interesting ones. */
  stopTimes: Map<number, number>;
}
```

**`src/index.ts:127`** — a second provider beside the existing one, same idiom:

```ts
statusPage.setScheduleRelationshipsProvider(() => panelRenderer.rtIndex.relationships);
```

**`src/modules/status-page.ts`** — `setScheduleRelationshipsProvider` (mirroring `:515,528`),
`renderScheduleRelationships`, and a call at `:587` after `renderFeedGaps`. Heading:
**"Trips outside the schedule"**, with one counted row per non-zero relationship and a
prose note that these are producer statements, not gaps — and that `CANCELED` and
`SKIPPED` mean the times shown are not times anyone can catch.

### Gotchas

- The section renders nothing when every non-SCHEDULED count is zero, the same
  self-hiding rule `renderIssueCard` uses (`src/utils/issue-card.ts:99`). Without that,
  every feed grows a new empty card.
- A vehicle and a trip update for the same trip are two separate entities in the tally;
  say which is being counted in the row labels rather than implying a trip count.

### Checklist

- [x] `ScheduleRelationshipCounts` computed on `RtIndex`
- [x] Provider wired in `src/index.ts`
- [x] `renderScheduleRelationships` added, neutral, self-hiding
- [x] `pnpm typecheck`

---

## Phase 6 — Finish

### Checklist

- [x] `CHANGELOG.md` entry
- [x] `pnpm vendor:check --strict` clean — re-vendored `basemap-control.ts` (route
      geometry shape toggle dropped, matching upstream) and `layer-manager.ts`
      (small-feed stop-fade exemption), both unrelated to this plan but blocking
      the strict check
- [x] `pnpm typecheck` and `pnpm build` clean
- [x] Conventional commits as each phase lands, no `Co-Authored-By` trailer

---

## Verification

No browser automation (`CLAUDE.md`). Build, then hand off for visual check.

```
pnpm typecheck && pnpm build && pnpm vendor:check --strict
pnpm dev
```

Load the MBTA feed and check, in order:

1. **Vehicle page for an `ADDED-…` trip** (e.g. train 1630 → `ADDED-1584879515`). Trip
   section shows `schedule_relationship: ADDED`; the Route row shows the route id with an
   `ADDED` badge rather than dimmed `trip not in the schedule`; the badge title explains
   it. The raw `VehiclePosition (decoded)` dump at `vehicle-page.ts:289` already showed
   `scheduleRelationship` before this change — use it to confirm the parsed value matches.
2. **Route page for that vehicle's route.** It is still in `Unplaced vehicles`, reason now
   ends `…; the feed reports it as ADDED`, with a badge. The section border stays neutral.
3. **Status page.** "Trips outside the schedule" appears with a non-zero ADDED count.
4. **The no-op regression check — the important one.** Load a feed with no non-SCHEDULED
   trips (any other catalog feed). Every page must look exactly as it does today: no
   badges, no `Rel` column, no status section, predictions colgroup unchanged, and the
   Stop column as wide as commit `8796708` made it.
5. **SKIPPED / NO_DATA**, if a catalog feed carries them: the `Rel` column appears,
   SKIPPED rows are struck through, the colgroup rebalances without overflowing the panel.
