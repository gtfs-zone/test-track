# Test Track — Claude Guide

## Project Overview

A static frontend for visualizing GTFS realtime feeds

<!-- Describe the service's role in the overall gtfs.zone system here -->

## Commands


<!-- Add project-specific commands here -->

## Architecture

<!-- Describe the service's role in the overall gtfs.zone system here -->

## Environment Variables


<!-- Add environment variables here -->


## Rules

- Never include `Co-Authored-By: Claude ...` trailers in commit messages.
- Do NOT use Playwright (or any browser automation) to verify changes. The user does
  visual/browser verification themselves. Stop at `pnpm typecheck` / `pnpm build` and
  hand off.

<!-- Add project-specific rules and invariants here -->

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

## Forgejo Workflow

This project uses an offline-first workflow. Claude reads/writes `CURRENT_PLAN.md` locally and only touches Forgejo when explicitly asked.

### Making a plan (triggered by "make a plan for issue #N" or "let's plan X")

1. If the user said "fetch issue #N", use `mcp__forgejo__get_issue_by_index` with `owner: "gtfs.zone"`, `repo: "deploy-gtfs-rt"` to retrieve the issue body; otherwise work from the context provided
2. Explore the codebase as needed
3. Ask clarifying questions inline; wait for answers before writing
4. Write the plan to `CURRENT_PLAN.md` in the repo root (format: Summary, Relevant Context, numbered Phases each with prose + checklist + gotchas)
5. Do not start implementation

### Completing a phase (triggered by "complete phase N" or "do phase N")

1. Read `CURRENT_PLAN.md` directly — do not fetch from Forgejo
2. Implement everything in the phase; commit as you go with conventional commits
3. After completing, update `CURRENT_PLAN.md`: check off completed items, append discoveries to that phase's prose
4. Do not update the Forgejo issue; do not start the next phase; stop for user review

### Updating Forgejo (triggered by "update issue #N")

1. Use `mcp__forgejo__update_issue` to overwrite the issue body with the current contents of `CURRENT_PLAN.md`

### Creating a PR (triggered by "make a PR closing #N")

1. Use `mcp__forgejo__create_pull_request` with `owner: "gtfs.zone"`, `repo: "test-track"`, current branch as `head`, `main` as `base`, issue title as PR title, `Closes #N` as body
