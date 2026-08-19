# Plan: vendor refresh, shared feed download with cancel, About and SEO links

## Summary

Four threads of work, all authored in `../coloring-book` first (the canonical
source for every vendored file) and then pulled into test-track:

1. **Vendor refresh.** Every entry in `VENDORED.md` is re-synced against
   coloring-book HEAD (`a4b5ee1`), SHAs bumped, and `vendor:check` grows a
   staleness mode so "ok" stops meaning "matches an old SHA".
2. **Shared feed download.** The byte-accurate download helper that only
   test-track has today moves into coloring-book as `feed-download.ts`, gets an
   `AbortSignal`, and is vendored back. coloring-book's `parseFromURL` stops
   faking 5% and shows real percent-of-file progress.
3. **Cancel a load.** The top progress indicator grows an optional Cancel
   button, wired to an `AbortController` that aborts the *fetch only*. Parsing,
   once bytes are in hand, always runs to completion, so neither app can end up
   with a half-ingested feed.
4. **About and SEO.** Both apps get a unified About modal shell with links to
   gtfs.zone, the sibling app, a Forgejo new-issue link, and
   `inquiry@gtfs.zone`. Each app ships its own `sitemap.xml` / `robots.txt`,
   and landing-zone lists both app URLs cross-domain (all hosts are verified in
   Search Console) plus adds them to the page's link table.

## Relevant Context

**Vendoring direction.** `VENDORED.md` is the whole contract: banner comment at
the top of each file, `@status verbatim|modified`, and a table row with the
source SHA. Flow is always coloring-book to test-track, even for code that
originated here (`route-sequence.ts` says so explicitly). Phase 2 is the awkward
case, since the download helper exists only in test-track; it is written into
coloring-book first so the direction of flow stays uniform.

**`vendor:check` is a drift check, not a freshness check.** It diffs each
`verbatim` local file against the *recorded* SHA, so a file 10 commits behind
HEAD still prints `ok`. Right now 4 entries print DRIFT, and all four are the
same already-applied CORS proxy fix (`e328ab1`, `cors.kcfam.us`) whose SHA was
never recorded. Meanwhile `layer-manager.ts` is 10 real commits behind and
reports nothing. Both halves need fixing.

**Load path today.**
- test-track: `FeedSession.loadStatic` (`src/modules/feed-session.ts`) drives
  `feedProgressIndicator` through two operations, `static-download` (byte
  percent from `LoadHooks.onDownload`) then `static-parse` (per-file). The
  actual fetch is the module-private `downloadWithProgress` at
  `src/gtfs-static.ts:541`, which reads the `Content-Length` header and pumps
  the response body reader.
- coloring-book: `GTFSParser.parseFromURL`
  (`src/modules/gtfs-parser.ts:998`) does `await response.blob()`, then
  `updateProgress(operation, 5, 'Preparing...')`. No byte progress at all, and
  the operation name is `parseFile` for both download and parse.
- Neither repo contains a single `AbortController`.

**`FeedProgressIndicator`** (vendored `verbatim`, identical in both repos) is a
singleton that appends `#global-loading-indicator` to `document.body` at import
time, keyed by an operation string, with no affordance for a button.

**About modals diverge.** test-track's is 23 lines (blurb, version, source,
changelog). coloring-book's has the same head, then Keyboard Shortcuts, a Map
Key built from `pathway-modes.ts`, and a Resources list. The shared shape is
head plus resources plus footer; the middles are app-specific.

**landing-zone** keeps every off-site URL in `src/content/links.ts` (`editor`,
`visualizer`, `manager`, `source`, `CONTACT_EMAIL = inquiry@gtfs.zone`), and a
vite plugin stamps `target="_blank" rel="noopener noreferrer"` onto every
external anchor at build time and fails the build if one is missed.
`public/sitemap.xml` currently lists only `https://gtfs.zone/`.

---

## Phase 1: refresh every vendored file to coloring-book HEAD

Work through `VENDORED.md` top to bottom against coloring-book `a4b5ee1`. The
`verbatim` rows are mechanical (overwrite, re-add banner, bump SHA). The
`modified` rows need the upstream diff read commit by commit and each hunk
decided on, with any new divergence appended to that row's `@changes`.

What is actually waiting upstream:

| Entry | Behind | Notable upstream commits |
|---|---|---|
| `layer-manager.ts` (modified) | 10 | pathway/station styling `f7084c5`, station zoom fade `d5be033`, shared stop layer styles `cfecd04`, flex zones `1dbef88`/`63af1c9`/`26b87e2`, transfers `c48eede`/`b5e30d1`, timetable stop focus `69dd3f6` |
| `route-sequence.ts` | 2 | **`846d9fe` LCS alignment of stop visit indices across patterns** (a real correctness fix for the route strip), `850caff` flex stop_time refs |
| `route-source.ts` | 1 | `850caff` generalized stop_time references |
| `scs.ts` | 2 | `a776450` drops unused alignment helpers |
| `page-state-manager.ts`, `page-state.ts` (modified) | 1-2 | `136329b` zone/location-group browse pages |
| `main.css` (modified) | 1 | `ba983ca` fuzzy map search styles |
| `theme-controller.ts` | 1 | `f7084c5` theme-aware map styling |
| `route-colors.ts`, `route-sort.ts`, `search-controller.ts`, `bottom-sheet.ts`, `basemap-control.ts` | 1-2 | `a2bf4cf` emoji/em-dash removal, `f456bbb` knip |
| `load-modal.ts`, `feed-selection.ts`, `feed-url-resolve.ts`, `examples.ts` | 1 | `e328ab1` CORS proxy, already applied locally; SHA bump only |

- [x] Bump the four DRIFT rows to the SHA that carries `e328ab1` and confirm
      `vendor:check` goes green on them with no file edits
- [x] Re-sync the `verbatim` rows: `scs.ts`, `route-source.ts`,
      `route-sequence.ts`, `route-colors.ts`, `route-sort.ts`,
      `search-controller.ts`, `theme-controller.ts`, plus any other row whose
      count is non-zero
- [x] Adapt `route-sequence.ts` + `route-source.ts` together; `850caff`
      generalizes what a stop_time points at, so `GTFSStaticRouteSource`
      (app-specific, not vendored) has to satisfy the widened interface
- [x] Walk `layer-manager.ts` commit by commit; take the styling and stop-layer
      commits, skip the flex-zone and transfer-editing work test-track has no
      data for, and record every skip in the row's `@changes`
- [x] Re-sync `main.css`, `page-state.ts`, `page-state-manager.ts`,
      `bottom-sheet.ts`, `basemap-control.ts` the same way
- [x] Extend `scripts/vendor-check.ts` with a freshness pass: for every row,
      `git -C ../coloring-book log <sha>..HEAD -- <sourcePath>` and print
      `STALE  <path>  (n commits behind)`. Non-fatal by default so a routine
      build is not blocked, fatal under `--strict`
- [x] `pnpm vendor:check` clean, `pnpm typecheck`, `pnpm build`

**Gotchas.** `f7084c5` and `cfecd04` both touch how a stop circle is painted,
and `stop-layer-style.ts` is already vendored at `cfecd04`; re-sync
`layer-manager.ts` *after* confirming that file is current or the two will
disagree about who owns the paint expressions. `a2bf4cf` is a pure text commit,
so those rows should produce zero behavioral diff, which makes them a good
sanity check that the banner-strip comparison is working. The `modified` rows
are the only place where a careless overwrite silently deletes test-track
behavior; re-read each `@changes` bullet before touching the file, and treat the
bullet list as the checklist for what to re-apply.

**What the re-sync actually turned up.**

- `d5be033` (station zoom fade) and `cfecd04` (shared stop layer styles) were
  already applied to `layer-manager.ts`; only its recorded SHA was stale. The
  `stop-layer-style.ts` row was current, so the gotcha about the two disagreeing
  never materialized.
- `f456bbb` (knip) deleted `routeTextColor` upstream as unused, but
  `gtfs-static.ts` calls it for route badge text. It is kept locally and
  `route-colors.ts` is now a `modified` row rather than `verbatim`.
- `850caff` needed a new vendored file: `src/types/gtfs-flex.ts`, carrying
  `StopTimeRef` alone. The two row helpers there parse coloring-book's
  `StopTimes` entity, which test-track does not have, so the row is `modified`.
  `GTFSStaticRouteSource` now maps its `StopTime`s to `{ kind: 'stop', id }`
  refs and answers the three name lookups (`locationGroupName`, `zoneName`,
  `refName`); `route-page.ts` reads `stop.ref.id`.
- The accent half of `f7084c5` was worth taking on its own: `utils/theme-color.ts`
  is now vendored, the hardcoded `#e74c3c` focus accent is gone, and
  `LayerManager.refreshAccentColor()` is wired to `ThemeController.onThemeChange`
  through `MapController`. The vendored `theme-controller.ts` gained that hook in
  the same upstream commit, so the re-sync supplied both halves.
- `a2bf4cf` was very nearly a no-op: `basemap-control.ts` had already dropped the
  emoji `console.log`s it rewrites, and `main.css`'s `ba983ca` is a deletion of
  search rules that were not in the local copy either.
- Skipped and recorded in `@changes`: `136329b` (zone / location_group page
  states), `69dd3f6` (timetable stop focus), `1dbef88` / `63af1c9` / `26b87e2`
  (Flex zones), `c48eede` / `b5e30d1` (transfer edges and table-row hover).
- `vendor:check` now runs the staleness pass over *every* row, `modified`
  included, printing `STALE <path> (n commits behind <sha>)` plus the commit
  subjects. Warning by default, fatal under `--strict`.

---

## Phase 2: extract `feed-download.ts` into coloring-book and vendor it back

New module `coloring-book:src/modules/feed-download.ts`, lifted from
test-track's private `downloadWithProgress` at `src/gtfs-static.ts:541` and
widened:

```ts
export interface DownloadOptions {
  onProgress?: (loaded: number, total: number | null) => void;
  signal?: AbortSignal;
}
export async function downloadWithProgress(
  url: string,
  options?: DownloadOptions
): Promise<ArrayBuffer>;
export function formatBytes(bytes: number): string;
export class LoadCancelledError extends Error {}
```

The error describers (`describeNetworkError`, `describeHttpError`) that
test-track's copy calls live in `feed-selection.ts`, which is already vendored
in both repos, so the new module imports them there rather than carrying its own
copies; that also upgrades coloring-book's inline error strings to the shared
wording for free. `formatBytes` moves out of `feed-session.ts` and into this
module, since both apps need it to render the percent line.

`parseFromURL` then swaps `await response.blob()` for
`downloadWithProgress(url, { onProgress, signal })`, reporting
`Downloading <label>, 3.1 MB of 8.4 MB` on the same operation key it already
uses, and wraps the result in a `Blob` for the existing `parseFile` path so
nothing downstream changes.

- [x] Write `feed-download.ts` in coloring-book, importing the describers from
      `feed-selection.ts`
- [x] Route `GTFSParser.parseFromURL` through it, keeping the `parseFile`
      operation key and its finish/error paths intact
- [x] Confirm the inner-zip descent (`splitInnerZipPath` / `extractInnerZip`)
      still works on an `ArrayBuffer` wrapped as a `Blob` (SEPTA's
      `google_bus.zip` is the fixture for this)
- [x] Commit in coloring-book, note the SHA (`e7d7fe0`)
- [x] In test-track: delete the private `downloadWithProgress` from
      `gtfs-static.ts`, delete `formatBytes` from `feed-session.ts`, import both
      from the vendored module, add the banner and a `verbatim` row
- [x] `pnpm typecheck` and `pnpm build` in both repos

**Gotchas.** Servers that omit `Content-Length`, and any response behind the
CORS proxy where the header may be stripped, must still show an indeterminate
"Downloading, 3.1 MB" line rather than a progress bar stuck at 0; that is why
`total` is `number | null` and why the existing `onDownload` call site passes
`0` for the percent in that case. Gzipped transfers report the *compressed*
length in `Content-Length` while the reader yields decompressed bytes, so
`loaded` can exceed `total`; clamp the percent at 100 rather than letting the
`<progress>` element overflow. Keep the module free of DOM references so it
stays vendorable and testable.

**What the extraction actually turned up.**

- `downloadPercent(loaded, total)` came along as a fourth export. Both call
  sites had to clamp for the gzip case anyway, and neither should own that
  arithmetic; it returns `null` when the size is unknown so the caller decides
  what an indeterminate bar looks like.
- coloring-book's `parseFromURL` has one operation key for both download and
  parse, so the bar now runs 0-100 on bytes and then `parseFile` immediately
  drops it to 10 for its own scale. The status text carries the phase change
  (`Downloading feed, 3.1 MB of 8.4 MB` then `Preparing...`), so the reset reads
  as a new stage rather than a regression. Splitting the key the way test-track
  does is the alternative if it looks wrong in the browser.
- `LoadCancelledError` is exported but unreferenced until Phase 3 wires an
  `AbortController`; `downloadWithProgress` already translates the `AbortError`
  `DOMException` out of both `fetch` and `reader.read()`.
- The inner-zip descent is unchanged: `extractInnerZip` only ever calls
  `outer.arrayBuffer()`, so `new Blob([buffer])` satisfies it. Verified by
  reading the path, not by loading SEPTA in a browser.
- `gtfs-static.ts` no longer imports the error describers directly; they reach
  it through the vendored module now.

---

## Phase 3: cancel a load from the progress indicator

Cancel aborts the fetch, nothing else. Once the bytes are in hand the parse runs
to completion, which is what keeps this safe: coloring-book ingests into its
GTFS database as it parses, and there is no rollback path today, so no signal is
ever checked mid-parse.

`FeedProgressIndicator` grows an optional per-operation cancel affordance:

```ts
startLoading(operation: string, status?: string, options?: { onCancel?: () => void }): void;
```

When the operation in front has an `onCancel`, a small ghost button renders
inside the bar; it calls the handler once, then disables itself and swaps the
status to `Cancelling...`. `finishLoading` clears the handler along with the
state. Because the indicator is a singleton keyed by operation and several
operations can be live at once (test-track polls RT while a static load runs),
the button belongs to the operation currently displayed, and the handler map is
cleared per operation, never globally.

Call sites: coloring-book's `parseFromURL` and test-track's
`FeedSession.loadStatic` each create an `AbortController`, pass `signal` into
`downloadWithProgress`, and pass `onCancel: () => controller.abort()` into
`startLoading('static-download' | 'parseFile', ...)`.

A cancelled load must land as a no-op, not an error toast:
`LoadCancelledError` propagates out of the loader, the call site catches it,
calls `notify.show('Load cancelled', 'info')`, and returns without touching
`staticFeed`, `staticError`, `selection`, or the RT poller. In test-track,
`loadStatic` throws before `this.staticFeed = feed`, so the previously loaded
feed simply stays live, and `startPoller` is never reached.

- [x] Add the `onCancel` option, the button, and the `Cancelling...` state to
      `feed-progress-indicator.ts` in coloring-book
- [x] Wire `parseFromURL` in coloring-book: controller, signal, handler,
      `LoadCancelledError` catch, info toast, no state mutation
- [x] Commit, then re-vendor `feed-progress-indicator.ts` into test-track
      (still `verbatim`) and update its SHA
- [x] Wire `FeedSession.loadStatic` the same way; verify the `finally` block
      still finishes both `static-download` and `static-parse`
- [x] Verify a cancel followed by a fresh load works: the old controller must
      not be reused, and `startLoading` must overwrite the stale handler
- [x] `pnpm typecheck` / `pnpm build` in both repos, then hand off for visual
      verification

**Gotchas.** An `AbortController` fires a `DOMException` named `AbortError` out
of both `fetch` and `reader.read()`, so the catch has to check
`err.name === 'AbortError'` and translate, or the generic network describer will
report a cancelled load as a connection failure. File uploads
(`source.kind === 'file'`) have no fetch to abort, so they get no cancel button;
pass no `onCancel` there rather than showing a button that does nothing. Cancel
must not race the completion path: if the abort lands after the last chunk, the
load may already have succeeded, in which case swallow the abort and keep the
loaded feed. Per the project rules, stop at `pnpm build`; the user does the
browser verification.

**What the wiring actually turned up.**

- coloring-book's single `parseFile` key covers both the abortable download and
  the unabortable parse, so the indicator needed a third method,
  `clearCancel(operation)`, to drop the button when the bytes land without
  ending the operation. test-track splits the keys, so `finishLoading` on
  `static-download` already clears its handler.
- The button follows the *displayed* operation, and `updateProgress` now claims
  the display for its own operation. Late chunks keep arriving after a cancel,
  so a `cancellingOperations` set suppresses their status text and the
  `Cancelling...` line stays put until the abort lands.
- `LoadHooks` gained `signal` rather than `loadFromUrl` gaining a parameter;
  it is already the per-load options bag.
- Three test-track call sites catch `LoadCancelledError`, not one:
  `handleLoadResult`, the reload button, and `AppState`'s link restore.
- `FeedSession.load` assigns `this.selection` before awaiting the static load,
  so a cancel restores the previous selection instead of leaving the abandoned
  one in place. `staticError` is left untouched on cancel for the same reason.
- coloring-book's `loadGTFSFromURL` calls `scheduleController.resetForNewFeed()`
  before `parseFromURL`, so a cancel there still leaves the schedule controller
  reset while the old feed is live. Pre-existing to this phase and not moved,
  but worth a follow-up.

---

## Phase 4: About modal, cross-links, and SEO

**Shared shell.** Restructure both About modals onto one vendored shape. New
`coloring-book:src/modules/about-links.ts` owns the URLs and the shared blocks:

```ts
export interface AboutApp {
  name: string;          // 'viz.rt.gtfs.zone'
  blurb: string;         // one paragraph, app-specific
  repo: string;          // 'test-track' | 'coloring-book'
  sibling: { name: string; href: string; note: string };
}
export function renderVersionAndSource(app: AboutApp, version: string): string;
export function renderProjectSection(app: AboutApp): string;  // gtfs.zone + sibling app
export function renderResourcesSection(): string;             // gtfs.org, TransitLand
export function renderFeedbackSection(app: AboutApp): string; // new issue + mailto
```

`showAboutModal` in each app then reads as blurb, version/source, project,
app-specific middle (coloring-book keeps Keyboard Shortcuts and Map Key,
test-track has none for now), resources, feedback. Links resolve to
`https://gtfs.zone`, the sibling app, `https://git.kcfam.us/gtfs.zone/<repo>/issues/new`,
and `mailto:inquiry@gtfs.zone`. Every anchor carries
`target="_blank" rel="noopener noreferrer"` except the mailto.

**Per-app SEO files.** Each app's `public/` gets:

```
robots.txt   User-agent: *  /  Allow: /  /  Sitemap: https://<host>/sitemap.xml
sitemap.xml  a single <loc> for the app root
```

Both apps are single-page and hash-routed, so one `<loc>` per origin is the
whole sitemap; hash fragments are never crawled as separate URLs. Both also need
a `<meta name="description">` and Open Graph tags in `index.html`, which neither
has today, since a sitemap entry pointing at a page with no description is
worth very little.

**landing-zone.** Add the two app URLs to `public/sitemap.xml` as cross-domain
entries, and add a `newIssue` link plus reuse of `CONTACT_EMAIL` in
`src/content/links.ts` so the footer names where to file a bug.

- [ ] Write `about-links.ts` in coloring-book and restructure its
      `showAboutModal` onto it
- [ ] Commit, vendor `about-links.ts` into test-track (`verbatim`, new
      `VENDORED.md` row), restructure test-track's `showAboutModal`
- [ ] Expand test-track's blurb: what a GTFS-RT feed is, what the map shows,
      that nothing is uploaded anywhere
- [ ] Add `robots.txt` + `sitemap.xml` to `test-track/public/` and
      `coloring-book/public/`
- [ ] Add description and Open Graph meta tags to both `index.html` heads
- [ ] landing-zone: cross-domain `<loc>` entries for both apps in
      `public/sitemap.xml`
- [ ] landing-zone: `newIssue` in `links.ts`, surfaced in the footer next to the
      existing contact address
- [ ] Build all three repos

**Gotchas.** Cross-domain sitemap entries are only honored when every listed
host is verified in Search Console, which the user confirms is the case; the
per-app sitemaps are still the primary signal and the landing-zone entries are
the boost. Check whether `git.kcfam.us` serves `/issues/new` to anonymous
visitors before shipping the link as the only feedback channel; the mailto is
the fallback that always works, so it goes first in the list if the repo turns
out to require a login. landing-zone's vite plugin will fail the build if a new
external anchor is added without the new-tab attributes, so add links through
`links.ts` and let the plugin stamp them. Vite copies `public/` verbatim, so
`sitemap.xml` needs no build wiring in any of the three repos.
