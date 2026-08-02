# Vendored files

Files copied from [coloring-book](../coloring-book) are marked with a banner as the
very first lines of the file:

```ts
/* @vendored-from coloring-book:src/modules/basemap-control.ts
   @sha f9c718c
   @status verbatim */
```

`@status` is one of:
- `verbatim` — byte-identical apart from the banner. Re-sync = overwrite + re-add banner.
- `modified` — adapted. Must be followed by an `@changes` line listing what diverged,
  one bullet per change, so a re-sync knows what to re-apply.

This table is the single place to look when diffing against a newer coloring-book.
Run `pnpm vendor:check` to diff every `verbatim` entry below against the recorded SHA
in `../coloring-book` (skipped if that sibling repo isn't present).

| Local path | Source path | SHA | Status | Note |
|---|---|---|---|---|
| `src/styles/main.css` | `src/styles/main.css` | f9c718c | modified | Editor-only rules dropped, no mobile dock, daisyUI v4 color refs translated to v5 |
| `src/modules/notification-system.ts` | `src/modules/notification-system.ts` | f9c718c | verbatim | Toast system; `notify` singleton needs `.initialize()` |
| `src/modules/feed-progress-indicator.ts` | `src/modules/feed-progress-indicator.ts` | f9c718c | verbatim | Top loading bar; singleton touches `document.body` at import time |
| `src/modules/theme-controller.ts` | `src/modules/theme-controller.ts` | f9c718c | verbatim | Replaces the inline theme toggle that never applied `data-theme` |
| `src/modules/panel-resizer.ts` | `src/modules/panel-resizer.ts` | f9c718c | modified | Persists `--panel-width` to localStorage; adds `restorePanelWidth()` |
| `src/modules/bottom-sheet.ts` | `src/modules/bottom-sheet.ts` | f9c718c | modified | Dock and TabManager stripped; re-activates across the 768px breakpoint |
