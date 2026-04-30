# Insense Outreach Runner Implementation Plan

Date: 2026-04-29
Status: Completed

## Goal

Build a standalone local Playwright runner for Insense creator outreach with `review` and `send` modes, persistent local state, automated invite decisions, blocklist enforcement, and structured reports.

## Completed Work

- scaffolded the local Node/Playwright package under `projects/insense-creator-database/`
- implemented tested pure modules for CLI parsing, decision logic, state storage, reporting, profile parsing, and messaging
- wired real Insense login and campaign navigation
- implemented live applicant review extraction from the applicants page
- added automatic invite policy evaluation in code
- enforced the first blocklist rule: `Previous Collaborator`
- wired live send mode through profile search, chat open, dedup scan, and composer send
- synced the skill, SOP, and project README to the standalone runner

## Final Policy

Quality thresholds:

- `portfolioUploads >= 1`
- `finishedDeals >= 1`
- `engagementRate >= 1`

Blocklist:

- `Previous Collaborator`

Invite behavior:

- quality fail -> skipped
- quality pass and not blocklisted -> `invite: true`
- quality pass and blocklisted -> `invite: false`

## Verification

- local package tests pass via `npm --prefix projects/insense-creator-database test`
- browser smoke path passed against the live Insense brand dashboard
- live review extraction succeeded on `Little Saints - US Based Creators`
- live send path was exercised successfully with real outbound messaging

## Operational Flow

1. Run `review` to generate the campaign review artifact and decision file.
2. Inspect the resulting decision file if needed.
3. Run `send` to message only `invite: true` creators while dedup protects against repeats.

## Follow-On Improvements

- add more blocklist rules as campaign exclusions become clearer
- improve pagination and multi-page applicant coverage
- add CSV export or Slack reporting if needed
