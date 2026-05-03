# Issue #57 — Add Version & About Modal to test-track

## Summary

Add an "About" button to the navbar that opens a modal showing the app version (from git) and links to the source repo and changelog. Pattern is copied directly from coloring-book.

## Relevant Context

- coloring-book uses `modal-utils.ts` (programmatic `showModal()`) and `about-modal.ts` — both get copied verbatim or with minor edits
- coloring-book injects `__APP_VERSION__` at build time via `vite.config.js` `define`, using the `git-describe` npm package
- test-track doesn't have `git-describe` in its dependencies; we'll use `execSync('git describe ...')` directly (same fallback coloring-book already has), so no new dependency needed
- The navbar already has `navbar-end` with room for another button, matching the pattern of the alerts button next to it
- test-track's existing alerts modal uses native `<dialog>` elements; the about modal will use the JS-driven `showModal()` approach from coloring-book (no conflict)

## Phases

### Phase 1 — Wire up `__APP_VERSION__` in the build

Edit `vite.config.js` to inject the app version at build time and add a TypeScript declaration for the global.

- [x] Edit `vite.config.js`: add `import { execSync } from 'child_process'`, compute version with `execSync('git describe --tags --long --always')` + fallback to `'0.0.0-development'`, inject via `define: { __APP_VERSION__: JSON.stringify(version) }`
- [x] Add `declare const __APP_VERSION__: string` to a new file `src/env.d.ts`

**Gotchas:**
- `git describe` will fail if there are no tags — the fallback handles this
- Pass the raw `git describe --tags --long --always` output (trimmed) as-is; it produces a human-readable string like `v0.1.0-3-gabc1234`

### Phase 2 — Add modal infrastructure

Copy the modal utilities from coloring-book and create an adapted about modal.

- [x] Create `src/modules/modal-utils.ts` — copy verbatim from `~/Documents/coloring-book/src/modules/modal-utils.ts`
- [x] Create `src/modules/about-modal.ts` — adapted from coloring-book:
  - Remove the keyboard shortcuts section and the `shortcuts` parameter entirely
  - Update the description text to describe viz.rt.gtfs.zone
  - Update source/changelog links to the test-track repo (`https://git.kcfam.us/gtfs.zone/test-track`)

**Gotchas:**
- `about-modal.ts` in coloring-book accepts a `shortcuts` arg — drop that parameter entirely

### Phase 3 — Add the About button to the navbar and wire it up

- [x] Add an info icon button in `src/index.html` navbar-end (before the theme toggle), `id="about-btn"`, `title="About"`
- [x] In `src/index.ts`, import `showAboutModal` and add a click listener on `#about-btn` that calls `showAboutModal(__APP_VERSION__)`
