# Replace Feed Config Form with Load Button Flow

## Summary

Replace the current "Feed Configuration" card (which has raw URL inputs + upload button inline) with a cleaner UX: a simplified card that shows current feed status and a **Load** button that opens a dropdown menu with three choices — **Examples**, **From TransitLand Atlas**, and **Manual**. Copied and adapted from coloring-book's `atlas-search.ts` / `modal-utils.ts` pattern. The Manual option opens a modal with URL/upload fields for all four feed types.

## Relevant Context

- `src/modules/modal-utils.ts` already exists but is behind coloring-book — sync it in Phase 0 before proceeding
- coloring-book's `atlas-search.ts` uses `showModal()` + fuzzy search against `public/atlas-feeds.json`; we adapt the same pattern
- coloring-book's `generate-atlas-data.ts` only fetches `gtfs` (static schedule) feeds; we extend it to also capture the three RT URL fields (`realtime_vehicle_positions`, `realtime_trip_updates`, `realtime_alerts`) from the DMFR spec
- The `FeedConfig` object (static URL or file, plus three RT URLs, plus CORS flag) threads through all three load paths
- `@leeoniya/ufuzzy` is already a dep in coloring-book — check whether it's already in test-track's `package.json` before adding it
- DaisyUI dropdown: `<div class="dropdown">` + `<ul class="dropdown-content menu">` — no extra JS needed for open/close
- The existing `loadFeeds()` function in `index.ts` reads directly from DOM inputs; we replace it with a function that accepts a `FeedConfig` argument

## Feed Config type (used across all phases)

```ts
interface FeedConfig {
  staticUrl?: string;
  staticFile?: File;
  vehiclesUrl?: string;
  tripUpdatesUrl?: string;
  alertsUrl?: string;
  useCors: boolean;
}
```

## Atlas feed type (extended for RT)

```ts
interface AtlasFeed {
  id: string;
  name: string;
  operator_name: string;
  location: string;
  staticUrl?: string;
  vehiclesUrl?: string;
  tripUpdatesUrl?: string;
  alertsUrl?: string;
}
```

---

## Phases

### Phase 0 — Sync modal-utils.ts from coloring-book

test-track's `src/modules/modal-utils.ts` was copied from coloring-book at an earlier point and has since fallen behind. Two behavioural changes and two helpers were added in coloring-book:

1. **`boxClassName?: string`** on `showModal` options — lets callers pass extra CSS classes to the modal box (e.g. `max-w-3xl` for the wide atlas search modal). Used in Phase 2.
2. **Backdrop-click-to-dismiss** — `modal.addEventListener('click', …)` closes the modal when clicking the backdrop, consistent with standard DaisyUI modal behaviour.
3. **`renderTrashIcon(sizeClass?)`** and **`renderUploadIcon(sizeClass?)`** SVG helper exports — not needed by this plan but keep parity with coloring-book so future copies don't diverge further.

Steps:
- [x] Replace `src/modules/modal-utils.ts` with the current coloring-book version verbatim (all three additions above are already present there)

**Gotchas:**
- The backdrop-click handler only fires when `escapeAction` is defined; no change to call sites needed

---

### Phase 1 — Extend and copy the atlas data script

Copy `generate-atlas-data.ts` from coloring-book to `scripts/generate-atlas-data.ts` and extend it to capture realtime feed URLs from the DMFR spec.

Changes vs. the coloring-book original:
- `AtlasFeed` gains `vehiclesUrl?`, `tripUpdatesUrl?`, `alertsUrl?`
- In the per-feed loop, read `feed.urls?.realtime_vehicle_positions`, `realtime_trip_updates`, `realtime_alerts` and map them into the output object
- Rename `url` field → `staticUrl` in the output (matches the new type)
- Change the skip-if-no-url guard: only skip feeds that have neither a static URL nor any RT URL
- Output path stays `public/atlas-feeds.json`

Also update `package.json`:
- Add `"atlas": "tsx scripts/generate-atlas-data.ts"` to `scripts`
- Add `tsx` to `devDependencies` if not already present

Do **not** run the script (takes minutes and hits GitHub API) — leave that to the user. Just note in the phase prose how to run it (`npm run atlas`).

- [x] Create `scripts/generate-atlas-data.ts`
- [x] Update `package.json` scripts + deps

**Gotchas:**
- DMFR files may not have `urls` at all — always optional-chain
- Some feeds have RT URLs but no static URL; keep those (they're useful for realtime-only mode)
- The coloring-book script raw-fetches GitHub blobs via `https://raw.githubusercontent.com/...`; that approach works fine here too

---

### Phase 2 — Add atlas-search module

Create `src/modules/atlas-search.ts` adapted from coloring-book's version.

Key differences from coloring-book:
- `AtlasFeed` uses the extended type above (`staticUrl`, `vehiclesUrl`, `tripUpdatesUrl`, `alertsUrl`)
- The search haystack string stays the same: `"${name} ${operator_name} ${location}"`
- Each result row shows name, operator, location — plus small badges indicating which feed types are available (e.g. "Static", "RT" or individual icons), so the user can see at a glance what data the feed offers
- `onSelect` returns a `FeedConfig` built from the selected feed's URLs, with `useCors` read from the checkbox in the `actionBarContent`
- `showAtlasSearchModal()` returns `FeedConfig | null` (null on cancel)
- The CORS checkbox and `?` tooltip carry over from coloring-book verbatim

If `@leeoniya/ufuzzy` is not yet in test-track's `package.json`, add it.

- [x] Create `src/modules/atlas-search.ts`
- [x] Add `@leeoniya/ufuzzy` to `package.json` if missing

**Gotchas:**
- The `cachedHaystack` still needs to be built from the extended feed objects; the field mapping changes but the logic is the same
- coloring-book's `filterAndRender` is self-contained; copy and update the row HTML only
- Pass `boxClassName: 'max-w-3xl'` (or similar) to `showModal` so the atlas results list is wide enough — `boxClassName` was added in Phase 0

---

### Phase 3 — Add examples list

Create `src/modules/examples.ts` that exports a typed array of hardcoded example feeds and a `showExamplesModal()` function.

```ts
export interface ExampleFeed {
  name: string;
  description?: string;
  config: FeedConfig;
}

export const EXAMPLES: ExampleFeed[] = [
  // Leave empty for now — easy to add later
];

export async function showExamplesModal(): Promise<FeedConfig | null> { ... }
```

The modal (via `showModal()`) lists `EXAMPLES` as clickable rows. Clicking a row resolves with its `FeedConfig`. If `EXAMPLES` is empty, show a "No examples configured yet" placeholder. Cancel returns `null`.

- [ ] Create `src/modules/examples.ts`

**Gotchas:**
- Keep the `EXAMPLES` array at the top of the file, clearly labelled, so it's trivially easy to add entries later

---

### Phase 4 — Add manual load modal

Create `src/modules/manual-load-modal.ts` with `showManualLoadModal()`.

The modal contains:
- Static GTFS section: URL text input + "Upload ZIP" button (triggers hidden file input) — matches current card's layout
- Vehicle Positions URL input
- Trip Updates URL input
- Service Alerts URL input
- CORS proxy checkbox (checked by default) + `?` tooltip (same text as current card)
- Actions: **Load** (primary), **Cancel**

`showManualLoadModal()` returns `FeedConfig | null`. On Load, it validates that at least one field is filled; if nothing is filled, keep the modal open (return `true` from `onClick`).

- [ ] Create `src/modules/manual-load-modal.ts`

**Gotchas:**
- The file input is inside the modal's body HTML string; after `onMount`, get the hidden `<input type="file">` and wire up the upload button click listener
- `showModal()` accepts `body` as an HTML string, so use `id` attributes and retrieve elements in `onMount`

---

### Phase 5 — Redesign the feed config card and wire everything up

**HTML changes (`src/index.html`):**

Replace the entire `#feed-config` card contents with a simpler layout:

```
[card header: "Feed Configuration"]
  [status line: "No feed loaded" or feed name after load]
  [Load ▼ dropdown button]
    ├── Examples
    ├── From TransitLand Atlas
    └── Manual…
  [Refresh RT button — hidden until a feed is loaded]
```

Use DaisyUI `dropdown` + `dropdown-end` on the card so the menu opens upward or downward correctly. The Load button is `btn btn-primary btn-sm`, the dropdown items are a `<ul class="dropdown-content menu">`.

Remove the old inline inputs, divider, CORS checkbox, and static file input entirely from the HTML.

**`src/index.ts` changes:**

- Remove DOM reads for `#static-gtfs-url`, `#static-gtfs-file`, `#rt-vehicles-url`, etc.
- Refactor `loadFeeds()` to accept `FeedConfig` instead of reading from DOM
- Add `maybeProxy(url, useCors)` signature update (pass flag explicitly)
- Wire up each dropdown item to call its respective modal, then call `loadFeeds(config)` on non-null result
- After a successful load, update the status line with a feed label (atlas feed name, "Custom feed", or example name)
- Add a `#refresh-rt-btn` click handler that re-polls RT feeds using the last `FeedConfig`

- [ ] Update `src/index.html` — replace card body
- [ ] Update `src/index.ts` — refactor loadFeeds + wire dropdown

**Gotchas:**
- DaisyUI dropdowns close on click-outside automatically; no JS needed
- The dropdown `<ul>` needs `z-50` or similar to appear above the map
- Keep the `#feed-config` `<details>` collapsible — the `<summary>` header and arrow toggle stay as-is
- The `#cors-proxy-checkbox` ID is currently referenced in `index.ts`; remove that reference since CORS is now per-modal
