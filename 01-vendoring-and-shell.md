# Plan 01 — Vendoring Convention & App Shell

## Summary

Establish how code copied from `coloring-book` is marked and tracked, then rebuild
test-track's shell to match coloring-book's look and feel: a two-column
`app-container` grid (map + always-visible right panel), a resizable panel that
collapses to a drag-snap bottom sheet on phones, the Load control moved into the
top navbar, a global top loading bar, and a toast notification system.

This plan produces no GTFS behavior changes. It is pure chrome. Everything after
it assumes the shell exists.

## Relevant Context

- Source repo: `../coloring-book` at commit **`f9c718c`** (2026-07-17). Every
  vendor banner in this transition records that SHA unless a later re-sync bumps it.
- coloring-book layout: `body > .app-container.h-screen.grid.grid-rows-[auto_1fr]`
  with `grid-template-columns: 1fr var(--panel-width, 650px)`. Navbar spans both
  columns (`col-span-2`), then a `relative` map container, then `#right-panel`.
  On `max-width: 767px` the grid drops to one column and `#right-panel` becomes
  `position: fixed` with an animated `height`.
- test-track today: single-column grid, map fills it, a `#feed-config` overlay card
  in the top-left holds the Load dropdown, and a `#stop-sheet` div slides up from the
  bottom via `translate-y-full`. All of that is replaced here.
- test-track's `src/styles/main.css` is currently 2 lines. coloring-book's is 171 and
  carries the daisyUI theme registration, the grid definition, and the mobile sheet rules.
- coloring-book's `PanelResizer` calls `mapController.resizeNow()` and
  `.forceMapResize()`. test-track's `MapController` has neither yet.
- coloring-book's `BottomSheetController` is coupled to `TabManager` and a
  `#mobile-dock` element. We are **not** taking the dock (decided: sheet only), so
  this file is vendored as `@status modified`.

## Phase 1 — Vendoring convention

Write the convention down before copying anything, so the first copied file already
follows it.

Every file copied from coloring-book gets a banner as the very first lines:

```ts
/* @vendored-from coloring-book:src/modules/basemap-control.ts
   @sha f9c718c
   @status verbatim */
```

`@status` is one of:
- `verbatim` — byte-identical apart from the banner. Re-sync = overwrite + re-add banner.
- `modified` — adapted. Must be followed by an `@changes` line listing what diverged,
  one bullet per change, so a re-sync knows what to re-apply.

`VENDORED.md` at the repo root holds a table of every copied file: local path, source
path, SHA, status, and a one-line note. It is the single place to look when diffing
against a newer coloring-book.

- [x] Write `VENDORED.md` with the table header and the convention explained at the top
- [x] Add a `pnpm vendor:check` script (`scripts/vendor-check.ts`) that walks
      `VENDORED.md`, diffs each `verbatim` entry against
      `../coloring-book` at the recorded SHA, and reports drift. Skip silently if
      `../coloring-book` is absent.

**Gotchas:** `vendor:check` must not fail the build when the sibling repo is missing —
CI won't have it. Exit 0 with a "skipped" message.

**Done.** `scripts/vendor-check.ts` parses the markdown table, strips the leading banner
block comment from the local file, and compares against `git -C ../coloring-book show
<sha>:<path>` — reading from the recorded SHA, not coloring-book's working tree, so a
dirty sibling checkout never produces false drift. Verified both directions: clean run
reports "3 verbatim entries match"; an injected edit reports `DRIFT` and exits 1.

## Phase 2 — Styles

Port `src/styles/main.css`. Take coloring-book's file and delete what test-track has no
use for: the CodeMirror overrides (`.cm-editor`, `.cm-focused`), the timetable
`td input.input` hack, `.file-required`, and the `#map-overlay` transition. Keep the
daisyUI `@plugin` theme block, the `.app-container` grid columns, the whole
`@media (max-width: 767px)` block, the `#map-controls` component styles, the tooltip
utilities, and the `.stop-name` z-index hacks.

Two adaptations to the mobile block: drop `--dock-height` (no dock — decided), so
`#right-panel` anchors to `bottom: 0` and `.basemap-control` sits at `bottom: 10px`.

- [x] Vendor `src/styles/main.css` as `@status modified`, banner + `@changes` list
- [x] Confirm the daisyUI theme list matches what the navbar theme toggle expects
      (`light --default, dark --prefersdark`); drop `cupcake`/`night` unless wanted
- [x] Delete the now-dead inline `.details-arrow` styling if the feed-config
      `<details>` card is gone

**Gotchas:** both repos are on daisyUI v5 (coloring-book `^5.5.19`, test-track `^5.1.13`)
and Tailwind v4, so the copy is safe — but note that coloring-book's `oklch(var(--b3))` /
`oklch(var(--p))` references are **daisyUI v4 syntax and are already dead rules there**.
v5 exposes `--color-base-300`, `--color-primary`, etc. Don't copy them forward
unexamined: either translate to v5 names (and accept that the styling changes, since it
was never taking effect) or drop the rules. Decide per rule; record the choice in the
`@changes` list.

**Decisions taken:** every v4 ref was translated rather than dropped —
`oklch(var(--b3))` → `var(--color-base-300)`, `oklch(var(--p))` → `var(--color-primary)`,
`oklch(var(--pc))` → `var(--color-primary-content)`, and the `oklch(var(--p) / 0.2)` ring
→ `color-mix(in oklch, var(--color-primary) 20%, transparent)`. These rules now take
effect where upstream they did not; `#map-controls .btn.btn-active` and the panel border
are the visible consequences. Theme list trimmed to `light --default, dark --prefersdark`.
`.file-required` was dropped outright, so its v4 ref went with it.

**Also renamed:** the mobile scroll-gating selector `.tab-content` → `.panel-scroll`,
since there are no tabs — just the one `#panel-content` host, which carries that class.

## Phase 3 — HTML shell

Rewrite `src/index.html` around coloring-book's structure.

Navbar (`col-span-2`): logo + version on the left; on the right, in order — the **Load
dropdown** (moved here from the map overlay, styled as `btn btn-primary btn-sm` with a
`dropdown-content menu`), an alerts button with its `indicator` badge, the about button,
and the theme swap. Keep the existing alerts modal wiring untouched for now; Plan 05
replaces its contents.

Map container: `relative bg-base-300` holding `#map`, plus a `#map-controls` bar copied
from coloring-book's absolute-positioned top bar — but with only the search input for
now (the pointer/add-stop/add-pathway tools are editor features we don't want).

`#right-panel`: same classes as coloring-book, containing the mobile drag handle
(`#sheet-top-handle`), the desktop `#panel-resizer`, and a single content host
`<div id="panel-content">`. Plan 03 fills that host by focus type; Plan 05 renders into it.

- [x] Restructure `src/index.html` to the two-column `app-container` grid
- [x] Move the Load dropdown into `navbar-end`; delete the `#feed-config` overlay card
- [x] Delete the `#stop-sheet` block entirely (replaced by `#right-panel`)
- [x] Add `#map-controls` with `#map-search` only
- [x] Add `#right-panel` with `#sheet-top-handle`, `#panel-resizer`, `#panel-content`
- [x] Keep `#alerts-modal` as-is; keep the file-input element if manual load needs it

**Gotchas:** the navbar must be `col-span-2` or the grid will place it in column 1 only
and the panel will slide up beside it. The map container needs `min-h-0` on mobile or
the fixed sheet's ancestor can force overflow.

**Discovery:** `#feed-status` and the `#feed-config` `<details>` both disappeared with the
overlay card, and `index.ts` read both — those reads are gone, replaced by a
`notify.success()` toast on load. The Refresh RT button moved into the Load dropdown as a
fourth `<li>` (still `hidden` until a feed loads) rather than becoming a fifth navbar
button.

**Decision (asked):** the `#stop-sheet` stop-click rendering was dropped outright rather
than ported into `#panel-content`. The panel shows a "No feed loaded" empty state until
Plan 05 renders into it. `mapCtrl.onStopClick` is therefore currently unsubscribed, and
`renderTripRow` / `formatDelay` were deleted along with the sheet.

## Phase 4 — Shell modules

Vendor the four chrome modules.

`notification-system.ts` and `feed-progress-indicator.ts` are self-contained — copy
verbatim. The progress indicator injects `#global-loading-indicator` into `document.body`
itself and exports a ready-made singleton (`feedProgressIndicator`), with a
`startLoading / updateProgress / finishLoading` keyed by operation name. That is the
"loading bar" for both static and RT loads; Plan 02 drives it.

`panel-resizer.ts` copies near-verbatim but needs `resizeNow()` and `forceMapResize()`
added to test-track's `MapController` (thin wrappers over `map.resize()`, the second one
deferred through a `requestAnimationFrame` + `setTimeout` pair like coloring-book's).
Persist `--panel-width` to `localStorage` on mouseup and restore it at boot.

`bottom-sheet.ts` is the biggest adaptation: strip the `TabManager` import, the
`setupDock` method, the `openHistoryModal` parameter, and the `#mobile-dock`
`ResizeObserver`. Keep the three snap points (`closed` / `half` at 45vh / `full` at 92vh),
the pointer-drag handling, the velocity-based `resolveSnap`, and the `onDismiss`
callbacks. Constructor becomes `new BottomSheetController(panel)`.

- [x] Vendor `src/modules/notification-system.ts` — verbatim
- [x] Vendor `src/modules/feed-progress-indicator.ts` — verbatim
- [x] Vendor `src/modules/panel-resizer.ts` — modified (localStorage persistence)
- [x] Vendor `src/modules/bottom-sheet.ts` — modified (dock and TabManager removed)
- [x] Add `resizeNow()` and `forceMapResize()` to `src/map-controller.ts`
- [x] Wire all four in `src/index.ts`; sheet only activates under 768px
- [x] Record all five entries in `VENDORED.md`

**Gotchas:** `BottomSheetController` early-returns when `window.innerWidth >= 768` and
never re-checks. Rotating a tablet leaves it inert. Either accept that (coloring-book
does) and note it, or add a `matchMedia` listener that re-initializes — decide during
implementation, don't silently diverge.

`feedProgressIndicator` is a module-level singleton constructed at import time, so it
touches `document.body` on import. Keep the import inside `index.ts` after DOM ready,
or it throws in any non-DOM context (e.g. the atlas script).

**Decision on the breakpoint gotcha:** we diverged rather than accepting the inert-sheet
bug. `BottomSheetController` now wires the drag handle unconditionally and flips an
`active` flag from a `matchMedia('(max-width: 767px)')` listener, so crossing 768px in
either direction activates or cleanly tears down sheet mode. Recorded in the file's
`@changes`.

**Discovery:** removing the stop-sheet left `staticFeed` and `latestTripUpdates` written
but never read, which `tsc` rejects under `noUnusedLocals`. Both were deleted; the
`tripUpdates` RT listener is now a comment pointing at the Plan 03 state store. Re-add
real state there, not here.

`feedProgressIndicator` is imported at the top of `index.ts` — safe because the module
script is at the end of `<body>`, so `document.body` exists when it evaluates. It is
wired minimally: `startLoading`/`finishLoading` bracket `handleLoadResult`. Plan 02 adds
the `updateProgress` calls.

## Phase 5 — Theme and boot

- [x] Vendor `src/modules/theme-controller.ts` if it is richer than the 5 lines currently
      inline in `index.ts`; otherwise keep the inline version and note the deliberate skip
      — **vendored verbatim.** It is richer, and the inline version was subtly broken: it
      persisted `theme` to localStorage but never set `data-theme` on `<html>`, so the
      hardcoded `data-theme="dark"` in `index.html` never changed. The vendored controller
      also honours `prefers-color-scheme` on first visit.
- [x] Ensure `#app-version` is still populated from `__APP_VERSION__`
- [ ] Verify the shell renders with no feed loaded (user-side: browser check): map fills the left column, right
      panel shows an empty state, navbar Load dropdown opens

**Not verified by this agent:** browser/visual verification is the user's (see the
Playwright rule in `CLAUDE.md`). `pnpm typecheck`, `pnpm build`, and `pnpm vendor:check`
all pass.

## Done when

The app looks like coloring-book with an empty panel. Load dropdown is in the navbar and
opens the three existing modals. Panel resizes on desktop, drags to three snaps on
mobile. `VENDORED.md` lists every copied file. Nothing about feed loading has changed yet.
