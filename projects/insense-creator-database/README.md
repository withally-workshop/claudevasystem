# Insense Creator Database Runner

This project is a local Insense creator outreach tool built with Node.js and Playwright.

In plain terms, it automates the Insense outreach workflow on your machine instead of relying on a chat-based browser plugin to do every click one by one.

It logs into Insense, opens a campaign, scans applications, checks each creator's profile, filters qualified creators, avoids duplicate outreach, sends the database invite, saves local records, and posts a summary to Slack.

## Executive Summary

The original workflow depended on an AI-driven Playwright plugin session. That worked, but it was slow, usage-heavy, brittle over long sessions, and hard to reuse consistently. Every action had to happen through a conversation loop: open the page, inspect it, click, inspect again, decide, and repeat.

This project replaces that workflow with a standalone local runner that uses Playwright directly. Instead of the AI driving the browser step by step, the script now performs the full workflow end-to-end: log in, open the selected campaign, scan applications, open creator profiles, extract qualification signals, apply the filtering rules, block excluded creators, check for duplicate outreach, send invites, save JSON artifacts locally, and post summaries to `#airwallexdrafts`.

This is not a local version of Playwright and not a replacement for Playwright. Playwright is still the browser automation engine underneath. What we built is a local automation tool on top of Playwright for the Insense creator outreach workflow.

## What Problem It Solves

The old approach depended on a chat-based browser workflow. That created a few problems:

- it was slower than a local script
- it consumed more model and tool usage
- it could become brittle during long outreach sessions
- it did not leave a clean local execution trail by default
- it made repeatable batch processing harder

This runner solves that by moving the repetitive browser work into local code while keeping the workflow observable through local records and Slack summaries.

## What The Runner Does

The runner has four operating modes:

### `review`

This is the scanning and qualification step.

It:

- opens the campaign's applicants page
- reads the visible applicant pool and skips creators already reviewed for that campaign
- opens each creator profile
- extracts stats like uploads, finished deals, and engagement rate
- applies the quality rules
- applies the blocklist rules
- writes review records locally
- posts a review summary to Slack when configured

### `approve`

This is the Slack approval collection step. It reads the saved candidate thread for the campaign, walks each candidate reply for ✅ / ❌ reactions, and rewrites the decision file: `pending` → `true` if approved, `false` if rejected. It posts a summary back into the thread.

### `send`

This is the outreach step.

It:

- reopens the campaign
- finds the eligible creators from the decision file
- opens the chat thread
- checks whether the Typeform invite was already sent
- skips duplicates
- sends the database invite when eligible
- updates the creator cache
- writes a send report
- posts a send summary to Slack when configured

### `daily-summary`

This is the daily rollup step.

It:

- reads today's local run artifacts from `data/runs/` using the local machine date
- combines all `review` and `send` runs across every campaign touched that day
- computes overall totals and per-campaign breakdowns
- writes a daily summary artifact locally
- posts one rollup summary to Slack when configured

## How To Describe It Simply

The simplest explanation is:

> We turned a slow, chat-driven browser workflow into a local automation tool that scans Insense applications, filters creators, sends outreach, keeps records, and posts summaries to Slack.

## Current Status

- `review` mode is live and can extract real applicant data from Insense
- `send` mode is live and can send real outreach through the Insense chat composer
- invite decisions are automatic for quality-passing creators, with blocklist rules enforced in code
- `review` and `send` can post summaries to `#airwallexdrafts` when a Slack bot token is configured

## Setup

From the repo root:

```powershell
npm --prefix projects/insense-creator-database install
npx --prefix projects/insense-creator-database playwright install chromium
```

Required environment variables:

- `INSENSE_PASSWORD`

Optional environment variables:

- `INSENSE_EMAIL`
  - defaults to `noa@kravemedia.co`
- `INSENSE_SLACK_BOT_TOKEN` or `SLACK_BOT_TOKEN`
  - enables Slack report delivery
- `INSENSE_SLACK_CHANNEL_ID`
  - defaults to `C0AQZGJDR38` (`#airwallexdrafts`)
- `INSENSE_SLACK_OPERATOR_USER_ID`
  - when set, only this Slack user's reactions are honored by `approve`

## Commands

Run tests:

```powershell
npm --prefix projects/insense-creator-database test
```

Run a bounded live review:

```powershell
$env:INSENSE_PASSWORD='...'
node projects/insense-creator-database/run-insense-outreach.mjs --mode review --campaign "Little Saints - US Based Creators" --limit 5
```

Reset a campaign's review memory and rescan from scratch:

```powershell
$env:INSENSE_PASSWORD='...'
node projects/insense-creator-database/run-insense-outreach.mjs --mode review --campaign "Little Saints - US Based Creators" --limit 5 --reset-review-history
```

Collect approvals from Slack:

```powershell
$env:INSENSE_SLACK_BOT_TOKEN='...'
node projects/insense-creator-database/run-insense-outreach.mjs --mode approve --campaign "Little Saints - US Based Creators"
```

Run live send mode:

```powershell
$env:INSENSE_PASSWORD='...'
node projects/insense-creator-database/run-insense-outreach.mjs --mode send --campaign "Little Saints - US Based Creators"
```

Run the daily summary rollup:

```powershell
$env:INSENSE_SLACK_BOT_TOKEN='...'
node projects/insense-creator-database/run-insense-outreach.mjs --mode daily-summary
```

## Files

- `run-insense-outreach.mjs`
  - CLI entrypoint for `review`, `send`, and `daily-summary`
- `lib/insense-session.mjs`
  - Playwright login/session handling
- `lib/applications.mjs`
  - campaign navigation, applicant discovery, drawer/chat helpers
- `lib/profile-parser.mjs`
  - parser helpers for applicant cards and profile drawer stats
- `lib/decide.mjs`
  - quality thresholds, invite policy, cross-campaign dedup
- `lib/scoring.mjs`
  - 0–100 score for ranking candidates
- `lib/approvals.mjs`
  - reads Slack reactions and applies them to decision records
- `lib/messaging.mjs`
  - dedup scan, message rendering, composer send helpers
- `lib/state-store.mjs`
  - review artifacts, decision files, cache reads/writes
- `data/runs/`
  - generated review, send, and daily summary artifacts
- `data/decisions/`
  - auto-generated invite decisions for quality-passing creators
- `data/creator-cache.json`
  - local dedup cache
- `data/review-history.json`
  - persistent per-campaign review memory used to avoid rescanning the same creators

## Review Flow

`review` mode:

1. logs into Insense
2. opens the named campaign applicants route
3. reads the first `--limit` visible applicants
4. skips creators already present in `data/review-history.json` for that campaign
5. opens each profile drawer
6. extracts:
   - username
   - country
   - rate
   - followers
   - engagement rate
   - finished deals
   - portfolio uploads
   - previous collaborator flag when visible
7. applies the quality thresholds
8. applies the invite policy
9. writes:
   - `data/runs/<campaign-slug>-review.json`
   - `data/decisions/<campaign-slug>.json`
   - `data/review-history.json`
10. posts a review summary to `#airwallexdrafts` when Slack reporting is configured

## Invite Policy

Quality rules:

- `portfolioUploads >= 1`
- `finishedDeals >= 1`
- `engagementRate >= 1`

Blocklist rules:

- `Previous Collaborator` -> `invite: false`
- creator already messaged from any prior campaign (cross-campaign dedup against `creator-cache.json`) -> `invite: false`, blockReason names the prior campaign when known

Current behavior:

- creators who fail quality are skipped in the review artifact
- creators who pass quality are written into the decision file with a 0–100 `score` and detected `niches`
- when a Slack bot token is configured, quality-passing non-blocklisted creators default to `invite: 'pending'` and are posted to a Slack approval thread; the operator reacts ✅/❌ and `--mode approve` rewrites the decisions
- when no Slack token is configured, quality-passing non-blocklisted creators fall back to `invite: true`
- blocklisted creators are written with `invite: false` and a `blockReason`

## Approve Flow

`approve` mode:

1. reads the decision file's `slack` block (channelId + threadTs + per-creator replyTs)
2. fetches the thread via `conversations.replies`
3. for each `pending` record, walks the candidate reply's reactions:
   - ✅ (or +1) from the operator -> `invite: true`
   - ❌ (or -1) from the operator -> `invite: false`, blockReason `Operator rejected`
   - mixed or no decisive reaction -> stays `pending`
4. rewrites the decision file
5. posts a summary back into the thread

Optional `INSENSE_SLACK_OPERATOR_USER_ID` restricts which user's reactions count.

## Send Flow

`send` mode:

1. reads the decision file
2. only sends for records with `invite: true`; `pending` and `false` are skipped
3. for `invite: true`:
   - reopens the campaign applicants route
   - searches by username to filter the row list
   - clicks the row's `Chat` button to open the in-place message composer
   - scans the thread for the Typeform link
   - skips if already messaged
   - otherwise sends the Krave Creator Database invite
4. writes `data/runs/<campaign-slug>-send.json`
5. posts a send summary to `#airwallexdrafts` when Slack reporting is configured

## Safety Rules

- live send only occurs for records with `invite: true`
- the current auto-policy blocklists `Previous Collaborator`
- local cache prevents obvious repeat sends
- review history prevents obvious repeat review scans inside the same campaign
- thread dedup checks for `https://form.typeform.com/to/lAPIxgqv` before sending
- `creator-cache.json` remains the durable per-creator status record even when Slack posting is enabled

## Daily Summary Flow

`daily-summary` mode:

1. reads today's JSON run artifacts from `data/runs/`
2. ignores prior `daily-summary-*.json` files so the rollup does not count itself
3. aggregates review and send totals across all campaigns touched that day
4. writes `data/runs/daily-summary-YYYY-MM-DD.json`
5. posts the rollup to `#airwallexdrafts` when Slack reporting is configured

## Known Limits

- review mode skips creators already reviewed for that campaign and now attempts to scroll for more visible applicants, but it still does not have explicit numbered-pagination support
- use `--reset-review-history` on `review` when you intentionally want to rescan a campaign from scratch
- send mode depends on the username search field on the applicants page
- docs and code assume the brand-side Insense workspace, not a creator account view
