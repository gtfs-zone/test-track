# Plan: Boot into the feed picker, scheduled-feed vocabulary, vendored breadcrumbs, page titles

## Summary

Five changes, spread across four frontend repos, in ten phases.

1. **viz boots into the load modal.** Today an empty hash lands on a status page
   whose only content is a sentence telling you to press Load. The modal opens
   instead, led by a "Continue with ..." card fed from a last-selection record in
   localStorage. It stays dismissable, and closing it lands on the same empty
   status page as today.
2. **The load modal leads with its search.** Continue card, search, results,
   warning notes, then the Scheduled GTFS block and the Realtime block at the
   bottom as the escape hatches they are.
3. **The trash button leaves viz.** A viz feed is a URL, Load reopens seeded, and
   the boot modal now covers "I want a different feed". Clearing one to look at
   an empty map is not a thing anyone wants.
4. **"Static" becomes "Scheduled" everywhere in the frontends.** Strings,
   identifiers, filenames, and the `static=` hash param, which gains a
   back-compat read. Backends are explicitly out of scope: `cafe-car`,
   `railroad-club`, `schedule-foamer` and `trip-updogger` keep `static` in their
   tables, models and API fields, so `static_url` off the catalog API is mapped
   at the boundary and named `scheduledUrl` from there inward.
5. **Breadcrumbs become one vendored module, and page titles come with them.**
   coloring-book owns the canonical file: the item type, the type-label table,
   the two-line crumb markup, and a `pageTitle(state)` that drives both
   `document.title` and each page's header eyebrow.

**Chosen approach and tradeoffs:**

- **Upstream first, then one re-vendor.** `load-modal.ts`, `feed-selection.ts`
  and `examples.ts` are `verbatim` rows in this repo's VENDORED.md. Every change
  to them lands in coloring-book and is copied down, so the rows stay `verbatim`
  and the two apps keep rendering the same modal. Phases 1 to 3 are coloring-book
  commits; Phase 4 is the single sync into test-track.
- **The canonical breadcrumb file is a builder shell, not a builder.**
  "Port test-track's sync builder up" does not survive contact with
  coloring-book, whose labels come out of IndexedDB and are inherently async.
  What is genuinely shared is the item shape, the type vocabulary, the render,
  and the title format. So the vendored module owns those and takes a
  per-app `BreadcrumbLookup`; test-track's and yard-master's lookups are
  synchronous reads wrapped in resolved values, coloring-book's is its existing
  `gtfs-breadcrumb-lookup.ts`. Each app's variant switch stays local, because the
  variant sets genuinely differ (five here, nine in coloring-book, six in
  yard-master after NEXT_PLAN3).
- **A crumb carries its type above its name.** Two lines per crumb: a dim
  uppercase type eyebrow over the label. The same type label feeds the panel
  header eyebrow and `document.title`, so a page cannot call itself one thing in
  the trail and another in the tab.
- **The last selection is persisted, the focus is not.** localStorage holds the
  `FeedSelection` plus a small summary for the card. A focus belongs to a link,
  not to a browser profile, so continuing lands on the feed status page.
- **The hash param renames with a fallback read.** `scheduled=` is written;
  `static=` is still read, forever, because links are already in the wild and in
  landing-zone's markup. landing-zone is updated to emit the new name in the same
  round.
- **yard-master is not edited here.** It is mid-NEXT_PLAN3 (Phases 6 and 7 open)
  with `breadcrumbs.ts` already rewritten as a `modified` row. It re-vendors the
  canonical file as part of its own Phase 7 settle, which already has a
  VENDORED.md step. Phase 10 is the handoff note, not the work.

## Relevant context

### This repo (test-track / viz.rt.gtfs.zone)

Boot and loading
- `src/index.ts`: shell setup, `showFeedControls` / `hideFeedControls`
  (lines ~117-145), the `load-btn` handler and `handleLoadResult` (~155-180),
  the reload handler, the clear handler (~204-216), and the boot tail
  `void appState.boot().then(...)` (~147).
- `src/modules/app-state.ts`: `boot()` (line ~81) reads the hash, loads a
  complete selection, applies the pending focus, and returns whether a feed
  loaded. Returns false with a warning when the hash names a partial selection.
- `src/modules/feed-url.ts`: `PARAM_KEYS` (line 19), `selectionToParams`,
  `paramsToSelection`, `isReproducible`, `labelForUrl`. The `static` key lives
  here and nowhere else.
- `src/modules/feed-selection.ts` (vendored): `FeedSelection.static`,
  `StaticSource`, `isComplete`, `describeMissing`, `describeSelection`,
  `resolveStaticUrl`.
- `src/modules/load-modal.ts` (vendored): the body template (line ~450), the
  Static GTFS section (~452-470), `rtSection` (~430), the search input (476) and
  `#load-results` (477), `ModalAction` / `extraActions` (~94), the `Static` badge
  in a result row (~269), the `'Static GTFS'` label (~351).
- `src/index.html`: `#clear-feed-btn` (line ~127), `#load-btn`, `#reload-feed-btn`,
  `#edit-feed-btn`, and the `<title>` / og tags (lines 6-13).

Pages and navigation
- `src/modules/breadcrumbs.ts`: `HOME`, `routeLabel`, `stopLabel`,
  `vehicleLabel`, `alertLabel`, `stopAncestors`, `vehicleRouteId`, `alertParent`,
  `buildBreadcrumbs`, `validateState`. Not in VENDORED.md today; yard-master
  vendors it from here.
- `src/modules/panel-renderer.ts`: `renderBreadcrumbs` (line 31) and the
  `data-nav` click delegation it depends on; `show(state, breadcrumbs)` (94).
- `src/types/page-state.ts` (vendored, `modified`): five variants,
  `BreadcrumbItem { label, pageState }` (line ~32).
- `src/modules/pages/route-page.ts` header block (line ~432): badge plus
  `ROUTE_TYPE_LABELS` eyebrow, then `<h2>`, then agency.
- `src/modules/pages/stop-page.ts` header block (line ~314): `LOCATION_TYPE_LABELS`
  eyebrow, `<h2>`, mono id, "Part of ..." line.
- `src/modules/pages/vehicle-page.ts` header (line ~221): hardcoded `Vehicle`
  eyebrow.
- `src/modules/pages/alert-page.ts`: `renderAlertList` (47) and the alert page;
  no header eyebrow today.
- `src/modules/status-page.ts`: `renderStaticSection` (247, heading
  `Static feed`), `renderEmpty` (485), `renderShare`'s uploaded-file sentence
  (477), `render()` (566).

### coloring-book (upstream)

- `src/modules/load-modal.ts`: same file as ours at SHA `e328ab1`, plus its own
  `CURRENT_PLAN.md` Phase 8 (boot into the modal, `continueWith`) and Phase 9
  (search-first reorder), both still unchecked.
- `src/modules/page-state-manager.ts`: `BreadcrumbLookup` (line 28),
  `setBreadcrumbLookup` (74), `getBreadcrumbs` (147), and the async build
  (260-450) that this plan lifts out.
- `src/modules/gtfs-breadcrumb-lookup.ts`: the DB-backed lookup implementation.
- `src/modules/browse-navigation.ts`: `renderBreadcrumbs` (542) and the
  `.breadcrumb-item` click handler (589).
- `src/types/page-state.ts`: nine variants including `agency`, `timetable`,
  `pathway`, `zone`, `location_group`.
- `src/index.html`: `<title>edit.gtfs.zone - GTFS Transit Data Editor</title>`.

### yard-master (downstream, in flight)

- `NEXT_PLAN3.md`: Phase 1 rewrote `breadcrumbs.ts` to six variants and it is
  checked off. Phase 3 already merged "Static load" and "Schedule source" into
  one **GTFS Scheduled** section, which is where this rename's vocabulary comes
  from. Phases 6 and 7 are open; Phase 7 already carries a VENDORED.md step and a
  `pnpm vendor:check` step.
- `VENDORED.md`: `breadcrumbs.ts` is `modified` from `test-track` at `fa12a57`,
  and the `adopted` tier exists precisely for a file feature work has taken over.

### landing-zone

- `src/content/feeds.ts`: the deep-link builder. Line 6 documents
  `#static=...&rt_vp=...`, line 82 emits `static: feed.feedUrl`, and
  `staticCors` (25, 53, 61, 70, 80) drives the `s` cors flag.
- `src/content/copy.ts` lines 58, 123, 128, 142 and the matching prose in
  `src/page.html` (112, 270, 281, 325).

### Invariants that constrain every phase

- A `verbatim` VENDORED.md row means byte-identical apart from the banner. Any
  edit to such a file either happens upstream first, or the row is demoted with
  an `@changes` list. There is no third option.
- `pnpm vendor:check` must be clean (bar deliberate `modified` rows) before a
  phase is called done. `--strict` also fails on staleness.
- Only `PageStateManager` writes the hash. Anything that changes the feed params
  goes through `setFeedParams`.
- The frontends never invent an API field name: whatever `cafe-car` sends is
  what is read, and any renaming happens on our side of the boundary.
- No browser automation. Every phase ends at `pnpm typecheck` and `pnpm build`,
  then hands off for visual verification.

---

## Phase 1: The scheduled-feed vocabulary, upstream in coloring-book

The word "static" is GTFS spec jargon that means "not realtime", and it reads as
"the file does not change" to everyone else. yard-master already settled on
**GTFS Scheduled** in its NEXT_PLAN3 Phase 3, so that is the vocabulary the other
frontends adopt. This phase does coloring-book, because three of the files
involved are vendored down into this repo and one of them is the load modal that
Phase 2 then rewrites.

The rename is total inside the frontend: strings, types, fields, filenames. It
stops at the network boundary. `cafe-car` keeps sending `static_url` and
`static_feed`, and the catalog adapter keeps reading those names and assigning
them to `scheduledUrl` on our side.

Naming decided once, here, so nothing drifts:

| Today | After |
|---|---|
| `Static GTFS` (section heading, labels) | `Scheduled GTFS` |
| `Static` (result-row badge) | `Scheduled` |
| "a static feed" / "the static feed" (prose) | "a scheduled feed" / "the schedule" |
| `StaticSource` | `ScheduledSource` |
| `FeedSelection.static` | `FeedSelection.scheduled` |
| `resolveStaticUrl` | `resolveScheduledUrl` |
| `staticUrl` / `staticCors` (catalog rows) | `scheduledUrl` / `scheduledCors` |
| `hasStatic` / `needStatic` locals | `hasScheduled` / `needScheduled` |
| `static_url` (cafe-car JSON) | unchanged, mapped at the read |

- [x] `src/modules/feed-selection.ts`: rename `StaticSource` to
      `ScheduledSource`, `FeedSelection.static` to `.scheduled`, and
      `resolveStaticUrl` to `resolveScheduledUrl`. Update the module doc comment
      and both `describeMissing` strings to "Choose a scheduled feed" and
      "Choose a scheduled feed and a realtime feed".
- [x] `src/modules/load-modal.ts`: rename the `'Static GTFS'` label and heading
      to `Scheduled GTFS`, the result-row badge to `Scheduled`, the element ids
      `#load-static-url` / `#load-static-label` to `#load-scheduled-url` /
      `#load-scheduled-label`, `staticUrl` / `staticCors` on the row types to
      `scheduledUrl` / `scheduledCors`, and `detachStatic` to `detachScheduled`.
      Map `feed.static_url` to `scheduledUrl` at the catalog read (line ~138)
      with a comment saying the API field name is deliberately unchanged.
- [x] `src/modules/examples.ts`: rename `selection.static` uses and the
      "Static only" comment; `realtime: null` entries now read "Schedule only".
- [x] `src/modules/feed-url-resolve.ts` and `scripts/generate-atlas-data.ts`:
      rename only what is ours. `--static-only` becomes `--schedule-only`, and
      the atlas row kinds keep whatever the DMFR corpus calls them.
- [x] Grep the whole of `src/` for `static` and triage every hit: JS keyword
      uses (`static readonly`, `@staticmethod`-alikes), CSS `position: static`,
      and the filename `gtfs-static.ts` are the only survivors, and
      `gtfs-static.ts` is renamed too (see next item).
- [x] ~~Rename `src/gtfs-static.ts`~~ — no such file in coloring-book. The
      `GTFSStatic` class is test-track's; it renames in Phase 5, and
      `route-source.ts`'s doc comment pointing at it is left alone until then.
- [x] ~~`src/index.html` / `about-modal.ts`~~ — neither mentions "static".
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm build`. Commit as
      `refactor(vocab): call a static feed a scheduled feed`.

Gotchas
- `FeedSelection.static` is a property named with a reserved word in some
  positions; after the rename `sel.scheduled` needs no bracket access anywhere,
  so watch for `sel['static']` forms while grepping.
- `resolveStaticUrl`'s doc comment explains why a path-only URL stays
  same-origin. That reasoning is about where scheduled feeds come from, not about
  the word, so rewrite it rather than word-swapping it.
- Do not touch `src/gtfs-spec/`: the spec files quote the GTFS specification
  verbatim, and the specification says "static". Verbatim means verbatim.


Discoveries
- The function is `resolvedStaticUrl`, not `resolveStaticUrl`; it became
  `resolvedScheduledUrl`.
- `AtlasRow.kind` stays `'static'` because it mirrors DMFR's `static_current`,
  so `atlasRow` maps it to `provides: 'scheduled'` the same way `catalogRow`
  maps `feed.static_url` to `scheduledUrl`. `AtlasRow.staticUrl` is ours, so it
  did rename — which meant rewriting the key in the committed
  `public/atlas-feeds.json` rather than refetching the corpus.
- `package.json`'s `atlas` script passes the renamed `--schedule-only`.

## Phase 2: Load modal, search first, with a continue card

coloring-book's own plan has this as its Phase 9, and the `continueWith` option
as part of its Phase 8. Both land here, in the shared file, so that this repo
inherits them by copy in Phase 4 rather than forking the modal.

The new body order, top to bottom: continue card, search input, results,
warning notes, Scheduled GTFS section, Realtime section. Results stay the only
scroller.

- [x] Add `continueWith?: { label: string; sublabel: string }` to
      `LoadModalOptions`, and render it as the first block in `body`: a full-width
      `btn btn-primary` card with the label on one line and the count sublabel
      dimmed beneath it. Only rendered when the option is present.
- [x] Resolving the modal from the continue card returns a distinct sentinel so
      the caller can tell "continue" from "the user picked this selection". Use a
      discriminated result (`{ kind: 'continue' } | { kind: 'selection'; selection }
      | null`) rather than a magic `FeedSelection`, and update both call sites.
- [x] Reorder the `body` template: continue card, `#load-search`,
      `#load-results`, the notes, the Scheduled GTFS section, `rtSection`.
- [x] Keep every section `shrink-0` and keep `#load-results` as
      `min-h-0 flex-1 overflow-y-auto`, so the fixed-height column still has
      exactly one scroller.
- [x] Keep `autofocus` on the search input. It is now also the first focusable
      element, so walk the tab order once: continue card, search, results,
      Scheduled block, Realtime block, action bar.
- [x] A result-row click still fills the Scheduled and Realtime slots, which are
      now below the fold. Scroll the Scheduled section into view (or flash its
      label) on a row click so the click visibly registers.
- [x] Verify the realtime variant does not overflow: four more URL fields sit
      below the results list now, and the results list is the flexible one, so it
      should shrink rather than push the action bar off. Check at 720px height.
- [x] Commit as `feat(load): lead the modal with search and a continue card`.

Gotchas
- The `continueWith` sublabel is built by the caller, not the modal. coloring-book
  counts routes/stops/trips from its `feedSummary` record; test-track counts from
  its own stored summary in Phase 6. The modal formats nothing.
- coloring-book's Phase 8 also moves its boot sequence around. That is its work,
  not this plan's; this phase only adds the option the boot sequence will pass.


Discoveries
- coloring-book had already landed its own Phase 8 and 9 in `eca835c` and
  `28c6964`, so the continue card, the body reorder, the `shrink-0` sections and
  the single `#load-results` scroller were all in place before this phase
  started. The `flashSection` helper that answers "the click landed" already
  fires for both the Scheduled and the Realtime slot on a row click, so no
  scroll-into-view was needed on top of it.
- The one thing those commits did differently from this plan was the result
  type: they used a `CONTINUE_STORED` string sentinel unioned with
  `FeedSelection`, which made every call site compare by identity. That is now
  the discriminated union the plan called for, and `ui.ts` switches on `kind` in
  both `openLoadModal` and `openBootLoadModal`.
- The modal title is already conditional: `Open a Feed` with a continue card,
  `Load Feed` without one.

## Phase 3: The canonical breadcrumb and title module

Extract one file that all three frontends carry: the item type, the type-label
vocabulary, the two-line crumb markup, the trail render, and the title format.
What stays per-app is the variant switch that decides which crumbs a page has,
because the variant sets genuinely differ.

New file `src/modules/breadcrumb-trail.ts` in coloring-book, exporting:

```ts
export interface BreadcrumbItem {
  /** Dim uppercase eyebrow, e.g. "Route", "Station", "Service alert". */
  typeLabel: string;
  label: string;
  pageState: PageState;
}

export function renderBreadcrumbTrail(
  items: BreadcrumbItem[],
  href: (s: PageState) => string,
): string;

export function pageTitle(items: BreadcrumbItem[], appName: string): string;
export function pageHeaderEyebrow(item: BreadcrumbItem): string;
```

- [x] Write the two-line crumb markup: each `<li>` renders
      `<span class="block text-[10px] uppercase tracking-wide opacity-50">` for
      the type over the label, all crumbs but the last as an `<a href>` carrying
      the app's own nav hook attribute. Keep daisyUI's `breadcrumbs` container so
      the separators come for free, and set `items-start` so the separator sits
      against the label line rather than centred across two lines.
- [x] Wrap the trail so it wraps rather than scrolls: a long chain of two-line
      crumbs in a 320px panel has to reflow, not clip.
- [x] `pageTitle(items, appName)` returns `<typeLabel> <label> | <appName>` for
      the last item, `<appName>` when the trail is empty. One format, three apps.
- [x] `pageHeaderEyebrow(item)` returns the same eyebrow markup the crumb uses,
      so a page header and its crumb cannot disagree.
- [x] The nav hook differs (`data-nav` here, `data-breadcrumb-index` in
      coloring-book's `browse-navigation.ts`). Settle on `data-nav` carrying the
      serialized page state, since it is the one that does not depend on the
      trail's array index surviving a re-render, and update
      `browse-navigation.ts`'s delegation to match.
- [x] Move coloring-book's async build out of `PageStateManager` and into a local
      `breadcrumbs.ts` that calls the shared render, keeping `BreadcrumbLookup`
      as the seam it already is. `PageStateManager.getBreadcrumbs` delegates.
- [x] Give every coloring-book variant a type label: Agency, Route, Timetable,
      Stop / Station / Entrance / Node / Boarding area (from `location_type`),
      Service, Pathway, Zone, Location group.
- [x] Set `document.title` from `pageTitle` on every navigation, with
      `edit.gtfs.zone` as the app name.
- [x] Add the file to coloring-book's own inventory if it keeps one, and commit as
      `feat(nav): verbose two-line breadcrumbs and page titles`.

Gotchas
- `escHtml` lives in a different module in each app. The shared file must take
  its escaping from a local import that all three provide, or inline a private
  copy. Inline it: one twelve-line function beats a fourth vendored row.
- The last crumb is not a link, but it still carries the eyebrow. A page whose
  header repeats the same eyebrow directly below the trail looks doubled; check
  it visually and drop the header eyebrow if it does (Phase 8 decides per page).
- daisyUI's `breadcrumbs` sets `white-space: nowrap` on its `<ul>` in some
  versions. Override it explicitly rather than relying on the theme.

Discoveries
- `BreadcrumbItem` moved out of `page-state.ts` and into `breadcrumb-trail.ts`,
  since the item now carries `typeLabel` and the render that reads it. Both
  vendored rows change as a result, so Phase 4 syncs `page-state.ts` too.
- `BreadcrumbLookup` moved with the build into coloring-book's new local
  `breadcrumbs.ts`; `page-state-manager.ts` re-exports the type so
  `gtfs-breadcrumb-lookup.ts` and every other importer keep working. The manager
  is 278 lines lighter and `getBreadcrumbs` is a one-line delegate.
- Stop crumbs need `location_type`, which the lookup did not expose. Ancestor
  entries became a named `StopAncestor` carrying it, and `getStopLocationType`
  was added for the leaf stop. A `stops` row stores the field as a string, so
  `parseLocationType` treats blank as a plain stop.
- The shared file owns the GTFS stop vocabulary (`STOP_TYPE_LABELS`,
  `stopTypeLabel`) because `location_type` is spec, not app opinion. Every other
  type label is decided by each app's own variant switch.
- `pageHeaderEyebrow` takes a `string`, not a `BreadcrumbItem`: page headers
  have a type label before they have a crumb, and the caller has the label
  either way.
- Home renders no trail at all now, rather than the old lone "Home" crumb in a
  bordered bar, so the home page does not open with an empty header strip.
- daisyUI's nowrap row is overridden on the container with
  `[&>ul]:flex-wrap [&>ul]:items-start [&>ul]:whitespace-normal` plus
  `overflow-x-visible`.
- `pnpm typecheck`, `pnpm lint`, `pnpm knip` and `pnpm build` are all clean in
  coloring-book. Committed as `fcb17b2`.

## Phase 4: Re-vendor sweep into test-track

One sync commit that pulls Phases 1 to 3 down, plus the one row that was already
stale before this plan started.

Done. Two commits: `7d39be9` for the flex row, `ecb40b2` for the sweep.

Discoveries:
- `feed-url-resolve.ts` had no upstream commits since `e328ab1`, so its copy is
  unchanged and only its banner and row SHA moved.
- `public/atlas-feeds.json` is checked in and carried the old `staticUrl` key.
  The re-vendored `load-modal.ts` reads `scheduledUrl`, so every atlas scheduled
  row would have loaded an empty URL until the file was regenerated. Ran
  `pnpm atlas` against the local `../transitland-atlas` corpus in the same
  commit; coloring-book did the same in its own rename commit.
- `generate-atlas-data.ts` carries no vendor banner in either repo, and
  `vendor-check` compares it whole. Left it banner-less rather than starting a
  convention on one file.
- The local divergence in `gtfs-flex.ts` was already exactly upstream-minus-the-
  helpers, so the re-sync was a SHA bump; the `@changes` banner was reworded
  because `isFlexStopTime` no longer exists upstream to be dropped.
- `showLoadModal` now returns a `LoadModalResult` union. The load button unwraps
  `{ kind: 'selection' }` and treats everything else as a dismissal, which is
  the adapt-don't-spread move: Phase 6 is what routes `{ kind: 'continue' }`.
- `ContinueOffer` requires an `edits` count and the card reads "Continue editing
  <name>", both of which are editor-shaped. Phase 6 has to either pass `edits: 0`
  or take the wording back upstream; deciding that is Phase 6's call, not a
  reason to demote a `verbatim` row here.

- [x] `src/types/gtfs-flex.ts`: re-sync against `52baec7` (dead flex/extension
      helpers and the file presence enum dropped upstream). It is a `modified`
      row, so re-apply the local divergence its banner lists.
- [x] Copy down `load-modal.ts`, `feed-selection.ts`, `examples.ts`,
      `feed-url-resolve.ts` and `scripts/generate-atlas-data.ts` at coloring-book
      HEAD, re-add each banner, and bump every SHA in VENDORED.md.
- [x] Copy down the new `breadcrumb-trail.ts` and add a `verbatim` row for it,
      with a note saying the per-app variant switch stays in each repo's own
      `breadcrumbs.ts`.
- [x] Fix the call sites the rename breaks in this repo's non-vendored files
      without renaming anything else yet: that is Phase 5's job, so this commit
      compiles by adapting, not by spreading.
- [x] `pnpm typecheck`, `pnpm build`, `pnpm vendor:check` clean of drift.
      `--strict` is **not** clean and cannot be at this phase: four `modified`
      rows are still behind. `basemap-control.ts` and `layer-manager.ts` are
      editor-map work unrelated to this plan and were stale before it started;
      `page-state.ts` and `page-state-manager.ts` are behind `fcb17b2` and
      `eca835c`, which are exactly what Phases 6 and 8 land here. Phase 10 is
      where `--strict` goes green.
- [x] Commit as `chore(vendor): re-sync the load modal, feed selection and crumbs`.

Gotchas
- `generate-atlas-data.ts` is invoked with `--static-only` by coloring-book and
  not at all by us, but the flag rename still has to land in both copies or the
  file is not `verbatim`.
- Do the flex re-sync as its own commit inside this phase. Mixing an unrelated
  stale row into the rename sync makes the next `git log --follow` unreadable.

## Phase 5: The scheduled-feed vocabulary in test-track

Phase 1's table, applied to this repo's own files, plus the hash param.

- [x] `src/gtfs-static.ts` becomes `src/gtfs-scheduled.ts`, `GTFSStatic` becomes
      `GTFSScheduled`, via `git mv`. Update every import, including
      `gtfs-static-route-source.ts`, which becomes
      `gtfs-scheduled-route-source.ts`.
- [x] `src/modules/feed-session.ts`: `staticFeed` becomes `scheduledFeed`,
      `staticLoadedAt` becomes `scheduleLoadedAt`, `staticError` becomes
      `scheduleError`, and the `staticloaded` event becomes `scheduleloaded`.
- [x] `src/modules/feed-url.ts`: write `scheduled=` and read `scheduled` first,
      falling back to `static`. Keep both in `PARAM_KEYS` so a legacy-only hash
      is still recognised as naming a feed. Rewrite the scheme comment.
- [x] `src/modules/status-page.ts`: `renderStaticSection` becomes
      `renderScheduledSection` with the heading `Scheduled feed`, and the
      uploaded-file sentence in `renderShare` is reworded.
- [x] `src/index.ts`: the `staticSrc` local and the editor-link comment, the
      notify strings, and the `scheduleloaded` listener.
- [x] ~~`src/index.html`~~ — nothing in the head or the tooltip says "static"
      (see discoveries).
- [x] Grep `src/` for `static` and triage to zero, same rule as Phase 1.
- [x] Note the rewrite in the module comment, because it means an old link
      silently upgrades. Left for hand verification: a `#static=...` link still
      loads and the address bar rewrites itself to `#scheduled=...`.
- [x] Commit as `refactor(vocab): call a static feed a scheduled feed`.

Gotchas
- `PageStateManager.setFeedParams` diffs the params it is handed. Handing it
  `scheduled` where it previously held `static` must clear the old key rather
  than leaving both in the hash; check `buildHash` drops unknown leftovers.
- `feed-selection.ts` is vendored and already renamed by Phase 4. Do not rename
  it again here, and do not let a stray edit demote the row.
- The `staticloaded` event name is listened for in three places
  (`index.ts`, `app-state.ts`, `panel-renderer.ts`). An event name is a string,
  so the compiler will not catch a missed one. Grep, do not trust.

Discoveries
- The rewrite is immediate, not deferred to the next focus change.
  `session.load` fires `change`, `AppState`'s handler calls
  `setFeedParams(selectionToParams(...))`, and `setFeedParams` writes the hash
  straight away. So a `#static=` link upgrades to `#scheduled=` the moment the
  feed finishes loading.
- The `buildHash` gotcha is a non-issue: it builds a fresh `URLSearchParams`
  from `feedParams`, and `setFeedParams` replaces that record wholesale, so the
  old `static` key cannot survive a write.
- `src/index.html` needed no edit. The title, og tags and both descriptions talk
  about GTFS Realtime and never say "static", and the `#edit-feed-btn` tooltip
  already read "Edit schedule in coloring-book". Phase 8 owns the titles anyway.
- `route-source.ts` is a `verbatim` row whose doc comment named `GTFSStatic`,
  which Phase 1 deliberately left for this phase. Editing it here would have
  demoted the row, so the one-line comment fix landed upstream as coloring-book
  `d7dd8e0` and was re-vendored in the same commit.
- `feed-session.ts`'s progress-indicator keys (`static-download` /
  `static-parse`) were not in the plan's list. They are strings the compiler
  cannot check, same class of hazard as the event name, and they renamed too.
- Three `modified` vendored files carry the old names in prose or types
  (`layer-manager.ts`, `route-colors.ts`, `types/gtfs-flex.ts`). Their local
  divergence is what the rename touches, so they were edited in place and the
  matching VENDORED.md notes were updated with them.
- `pnpm vendor:check` reports 22 verbatim entries matching and no drift; the
  four rows behind HEAD are the same `modified` four Phase 4 listed.

## Phase 6: Boot into the load modal, with a continue card

An empty hash currently renders a status page whose entire content is a sentence
telling the user to press Load. Open the modal instead. A last-selection record
in localStorage makes "continue" a one-click path, and the modal stays
dismissable so the empty status page remains reachable.

Behavior:
- Hash names a complete selection: load it, no modal, exactly as today.
- Hash names a partial selection: warn as today, then open the modal seeded with
  what the hash did name.
- Hash names nothing: open the modal. If a stored selection exists, it leads with
  "Continue with <label>" and a sublabel of its counts.
- Dismissing the modal leaves the app in its empty state on the status page.

- [x] Add `src/modules/last-feed.ts`: `readLastFeed()` / `writeLastFeed(selection,
      summary)` / `clearLastFeed()` over one localStorage key
      (`viz:last-feed`), storing `{ selection, summary: { label, routes, stops,
      trips }, savedAt }`. Version the record with a `v: 1` field and treat any
      other shape as absent, so a future change never has to migrate.
- [x] Write the record after every successful load, from the one place that
      already knows a load succeeded (`handleLoadResult` and `AppState.boot`'s
      success path). Counts come from the parsed feed, so write it on
      `scheduleloaded` rather than at the call site, and keep the selection and
      the counts in one write.
- [x] A file-backed scheduled source cannot be restored from localStorage. Store
      the record only when `isReproducible(selection)`, matching the rule the
      share link already uses.
- [x] Restructure the boot tail in `index.ts`: `await appState.boot()`, and when
      it returns false, open the load modal with `continueWith` built from
      `readLastFeed()`.
- [x] Route the modal's `{ kind: 'continue' }` result through the same
      `handleLoadResult` path as a fresh selection, using the stored selection.
      There is no separate restore path in this app, which is the whole reason
      this is cheaper here than it is in coloring-book.
- [x] Dismissal returns null and does nothing: no notify, no state change. The
      status page's empty state is the fallback, so Phase 9's rewrite of that copy
      matters more now than it did.
- [x] A stored selection that fails to load clears the record and re-opens the
      modal with an error toast, so a dead feed cannot trap boot in a loop.
      Guard with a "this is the second attempt" flag rather than recursion.
- [x] Log the chosen path: `[boot] hash selection loaded`,
      `[boot] modal opened, stored feed available`, `[boot] modal opened, nothing
      stored`, `[boot] modal dismissed`.
- [x] Commit as `feat(boot): open the load modal when no feed is in the link`.

Gotchas
- `showFeedControls()` currently runs only on the `boot().then` success path and
  in `handleLoadResult`. The continue path goes through `handleLoadResult`, so it
  is covered, but check that a dismissed modal leaves the controls hidden.
- The modal is opened before the map has necessarily settled its first render.
  It is a `<dialog>` over the map, so this is fine, but do not move the
  `mapCtrl.initialize` call behind it: an empty map behind a dismissable modal is
  the intended background.
- `notify` toasts stack above the modal's backdrop. A boot-time warning about a
  partial hash plus an open modal is two things at once; sequence the warning
  before the modal opens so it reads as context for it.
- localStorage can throw (private mode, quota). Wrap every read and write, and
  treat a throw as "no stored feed".

Discoveries
- The `edits` question Phase 4 left open was answered upstream. `ContinueOffer`
  now has `edits?: number` and the card drops the count when it is unset, and
  its title reads "Continue with <name>" rather than "Continue editing <name>",
  which is what this plan's summary specified in the first place. That is
  coloring-book `6a20621`, re-vendored here in `7cd6453`, so `load-modal.ts`
  stays `verbatim` and viz never prints "0 edits".
- The partial-hash seed needed a channel out of `boot()`. `AppState.bootSeed`
  holds the incomplete selection the hash named, and boot passes it as the
  modal's `current`, so a half link is completed in the form rather than
  retyped. The warning still fires inside `boot()`, before the modal opens.
- `handleLoadResult` now returns a boolean, which is what makes the retry guard
  a loop rather than recursion: the continue path reloads once, and on failure
  clears the record and goes round exactly one more time.
- The record is written from the `scheduleloaded` listener, which fires inside
  `session.load`, so it also covers the reload button and the status page's
  inline URL edit. `writeLastFeed` re-checks `isReproducible` itself and clears
  a stale record when a file upload replaces a URL feed.
- `readLastFeed` re-checks `isReproducible` on the way out too: a `File` cannot
  survive `JSON.stringify`, so a record holding a file source would deserialise
  as `{ kind: 'file' }` with no file and is treated as absent.
- A dismissed modal leaves the feed controls hidden, because `showFeedControls`
  is still only reachable from a successful load.

## Phase 7: Drop the trash button

A viz feed is a URL. Load reopens seeded with the current selection, the boot
modal now covers switching feeds, and clearing to an empty map is not a state
anyone wants to reach on purpose.

- [x] Delete `#clear-feed-btn` from `src/index.html`.
- [x] Delete the `clearBtn` binding, its click handler, and its lines in
      `showFeedControls` / `hideFeedControls` in `src/index.ts`.
- [x] Keep `FeedSession.clear()`: `session.load()` still needs to reset state
      between feeds, and the boot error path in Phase 6 uses it. Confirm it has a
      caller after the button is gone; if it does not, that is a sign the load
      path is leaking old state and is worth checking before deleting it.
- [x] `renderTrashIcon` in `modal-utils.ts` is a vendored file. Leave it alone:
      coloring-book uses it, and this repo carrying an unused export is not a
      reason to demote a `verbatim` row.
- [x] Commit as `feat(nav): drop the clear feed button`.

`FeedSession.clear()` has no caller left: Phase 6's boot error path forgets the
stored record and reopens the modal rather than clearing the session, and
`load()` already resets everything itself — `loadScheduled` replaces
`scheduledFeed`, and `startPoller` replaces the poller and resets the counts and
the vehicle/alert/tripUpdate maps. So the unused `clear()` is not a sign of a
leak; it is kept as session API per the plan.

Gotchas
- `hideFeedControls` was unreachable once the clear handler went, so it was
  deleted too. The feed controls now only ever appear.

## Phase 8: Verbose breadcrumbs and consistent titles in test-track

Rebuild this repo's `breadcrumbs.ts` on the vendored module, then make every page
header and the browser tab agree with it.

Type labels, decided once:

| Page state | Type label |
|---|---|
| `home` | Feed status |
| `route` | Route |
| `stop`, `location_type` 0 | Stop |
| `stop`, `location_type` 1 | Station |
| `stop`, `location_type` 2 | Entrance |
| `stop`, `location_type` 3 | Node |
| `stop`, `location_type` 4 | Boarding area |
| `vehicle` | Vehicle |
| `alert` | Service alert |

- [ ] `src/modules/breadcrumbs.ts`: keep the variant switch, the label helpers,
      `stopAncestors`, `vehicleRouteId`, `alertParent` and `validateState`. Every
      returned item now carries `typeLabel`. Import the labels from the vendored
      module so `LOCATION_TYPE_LABELS` has one home.
- [ ] Add a `breadcrumbs.ts` row to this repo's VENDORED.md as an **origin**
      note: not vendored itself, but the file yard-master vendors, and now a
      consumer of `breadcrumb-trail.ts`. The table is the place someone looks
      when diffing, and an origin file being absent from it is why yard-master's
      copy drifted.
- [ ] `panel-renderer.ts`: delete the local `renderBreadcrumbs` and call
      `renderBreadcrumbTrail(items, ctx.href)`. The `data-nav` delegation is
      unchanged, which is why that hook was the one chosen in Phase 3.
- [ ] `src/types/page-state.ts`: `BreadcrumbItem` now comes from the vendored
      module. Re-export it from here if that keeps import sites short, and note
      the move in the file's `@changes` banner.
- [ ] Set `document.title` on every focus change, from `pageTitle(breadcrumbs,
      'viz.rt.gtfs.zone')`. Home and the no-feed state keep the full marketing
      title from `index.html`.
- [ ] Normalize the four page headers onto one shape: eyebrow (from
      `pageHeaderEyebrow`), `<h2>` name, then a dim subtitle line.
      - Route: eyebrow `Route`, and move the `route_type` label into the subtitle
        next to the agency name, since the eyebrow now says what kind of object
        this is and `route_type` says what kind of route it is.
      - Stop: eyebrow from `location_type`, which is what it already renders, now
        via the shared helper. Subtitle keeps the mono id and the "Part of" line.
      - Vehicle: eyebrow `Vehicle`, unchanged in content, now shared.
      - Alert: gains a header block it does not have today, eyebrow
        `Service alert`, `<h2>` of the preferred header text, subtitle of the
        alert level and its active window.
- [ ] Decide the doubling question from Phase 3's gotcha by looking at it: if the
      trail's last crumb and the header eyebrow read as a stutter, drop the header
      eyebrow and keep the trail's. Do not keep both because the plan listed both.
- [ ] Commit as `feat(nav): two-line breadcrumbs, page titles and shared headers`.

Gotchas
- The trail is rebuilt on every `show()`, and `show()` runs on every realtime
  poll for a vehicle page. Setting `document.title` on an unchanged title is a
  no-op in every browser, but building the string every 15 seconds is still
  waste; set it from the navigation handler, not the render.
- A vehicle's label comes from the last poll. A vehicle that disappears keeps its
  crumb until the focus is invalidated, so the title can name a vehicle the feed
  no longer has. That is correct and matches the "gone" banner the page already
  renders; do not paper over it.
- `alertLabel` falls back to `Alert <id>`. With a type eyebrow now saying "Service
  alert", the fallback reads as "Service alert / Alert 42". Change the fallback to
  the bare id.

## Phase 9: Empty-state copy and landing-zone

The status page's empty state is now what a user sees after dismissing the boot
modal, which makes it a real screen rather than a placeholder. It gets rewritten
rather than word-swapped, and landing-zone's copy and link builder come along.

- [ ] `status-page.ts` `renderEmpty`: rewrite. It should say what this app is for
      in one line, name the two things a session needs (a scheduled feed and at
      least one realtime endpoint), and offer a button that reopens the load
      modal rather than pointing at the navbar. Wire the button through the same
      handler `#load-btn` uses.
- [ ] `about-modal.ts`: rewrite the blurb's "Point this at a static GTFS feed plus
      its realtime feeds" sentence around the new vocabulary.
- [ ] landing-zone `src/content/feeds.ts`: emit `scheduled=` in the visualizer
      deep link, rename `staticCors` to `scheduledCors`, and update the scheme
      comments on lines 5 to 11.
- [ ] landing-zone `src/content/copy.ts` and `src/page.html`: reword lines 58,
      123, 128 and 142 and their rendered twins. "The foundation: static,
      rider-facing service information" becomes a sentence about the schedule;
      check `page.html` is generated from `copy.ts` and, if it is not, edit both.
- [ ] landing-zone `README.md` and `docs/VERIFICATION.md`: any assertion about the
      `#static=` link shape.
- [ ] Verify one landing-zone link end to end by hand: click through to viz and
      confirm the feed loads and the hash reads `scheduled=`.
- [ ] Commit in landing-zone as `refactor(copy): scheduled feed vocabulary and
      link param`.

Gotchas
- landing-zone links are also in the wild in whatever form Google has indexed.
  The back-compat read in Phase 5 is what protects them; do not remove `static`
  from `PARAM_KEYS` as a tidy-up in a later phase.
- The editor deep link is `#load=<url>` and belongs to coloring-book. It is not
  affected by this rename and must not be touched.

## Phase 10: Settle, and the yard-master handoff

- [ ] `pnpm typecheck`, `pnpm build`, `pnpm vendor:check --strict` in this repo
      and in coloring-book.
- [ ] VENDORED.md in this repo: every SHA bumped, the new `breadcrumb-trail.ts`
      row added, the `breadcrumbs.ts` origin note added, and every note that says
      "static" reworded.
- [ ] Hand off for visual verification: boot with an empty hash, boot with a
      legacy `#static=` link, boot with a `#scheduled=` link, dismiss the modal,
      continue from the stored feed, and walk route, stop, vehicle and alert pages
      checking the trail, the header and the tab title on each.
- [ ] Write the yard-master note into its `NEXT_PLAN3.md` Phase 7 checklist
      rather than into its code:
      - re-vendor `breadcrumb-trail.ts` from coloring-book as `verbatim`, and
        rebuild its own `breadcrumbs.ts` on it, keeping its six variants and its
        tracker/managed-object labels;
      - promote its `breadcrumbs.ts` row to `adopted` if the rebuild leaves it far
        enough from this repo's copy, which is what the `adopted` tier is for;
      - apply the scheduled vocabulary to its remaining "Static load" strings.
        Its Phase 3 already merged the section into "GTFS Scheduled", so this is
        a sweep, not a redesign;
      - add `pageTitle` with `manage.rt.gtfs.zone` as the app name.
- [ ] Do not edit yard-master in this plan. Phases 6 and 7 of NEXT_PLAN3 are open
      and both touch the same files.

Gotchas
- yard-master's `VENDORED.md` pins `breadcrumbs.ts` to `test-track` at `fa12a57`.
  After Phase 8 that row is stale by design. Say so in the row's note now, so its
  next `vendor:check` reports a known state rather than a surprise.
- coloring-book's own CURRENT_PLAN has Phases 2 to 9 still open, including its
  boot rework. Phase 2 here adds the option that plan's Phase 8 consumes, and
  does not implement its boot flow. Do not check off anything in coloring-book's
  plan from this one.
