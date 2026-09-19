# Test Track — Claude Guide

## Project Overview

A static frontend for visualizing GTFS realtime feeds

## Commands

```bash
pnpm dev
pnpm typecheck    # the gate before any commit
pnpm build
pnpm vendor:check # diff vendored files against their source repo, per VENDORED.md

git config core.hooksPath .githooks   # once per clone; runs vendor:check pre-commit
```

## Shared modules (`interlocking`)

A third of `src/` is no longer in this repo. The 44 files that have moved out
of the apps live in the `interlocking` package, a git dependency shipping raw
TypeScript with no build step. The scheduled feed parser is one of them, as
`interlocking/gtfs/scheduled`, along with the feed clock, the load modal and
the curated examples. Import them as `interlocking/ui/...`,
`interlocking/gtfs/...`, `interlocking/map/...` and `interlocking/util/...`;
`tsconfig.json` `paths` and a `resolve.alias` in `vite.config.js` both point at
`node_modules/interlocking/src`.

A shared change is a commit in interlocking, a tag, and a bump in each of the
three consumers. It is not edited here and `vendor:check` does not cover it.

What is still hand-copied is in `VENDORED.md`, and for that half the one-way
flow rule still holds: coloring-book -> test-track -> yard-master.

## Rules

- Do NOT use Playwright (or any browser automation) to verify changes. The user does
  visual/browser verification themselves. Stop at `pnpm typecheck` / `pnpm build` and
  hand off.

## Related Repos

| Repo | Description | URL |
|---|---|---|
| cafe-car | GTFS-RT HTTP API serving real-time feeds | https://git.kcfam.us/gtfs.zone/cafe-car |
| vehicle-poser | Worker that tracks and posts vehicle positions | https://git.kcfam.us/gtfs.zone/vehicle-poser |
| trip-updogger | Worker that generates trip update predictions | https://git.kcfam.us/gtfs.zone/trip-updogger |
| schedule-foamer | Worker that ingests and processes GTFS schedule data | https://git.kcfam.us/gtfs.zone/schedule-foamer |
| railroad-club | Shared Python library for GTFS types and utilities | https://git.kcfam.us/gtfs.zone/railroad-club |
| music-student | Orchestration repo for deployments and infra | https://git.kcfam.us/gtfs.zone/music-student |
| landing-zone | Static marketing/status site | https://git.kcfam.us/gtfs.zone/landing-zone |

