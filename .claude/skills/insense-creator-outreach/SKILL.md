# Skill: Insense Creator Outreach
**Trigger:** "run insense outreach", "process insense applications", "send database invites", "/insense-creator-outreach"
**SOP:** references/sops/insense-creator-outreach.md
**Mode:** Standalone local Playwright runner

---

## What This Skill Does

Uses the local runner in `projects/insense-creator-database/` to:

- review a campaign's visible applicants in Insense
- extract quality signals from the real profile drawer
- compute a 0–100 score and tag detected niches per candidate
- enforce a cross-campaign dedup rule against prior outreach
- post candidates to a Slack approval thread for explicit ✅ / ❌ decisions
- send the Krave Creator Database invite only for creators approved in Slack

---

## Prerequisites

- local dependencies installed in `projects/insense-creator-database/`
- Playwright Chromium installed for that project
- `INSENSE_PASSWORD` available in the environment
- target campaign name provided

Optional:

- `INSENSE_EMAIL` — defaults to `noa@kravemedia.co`
- `INSENSE_SLACK_BOT_TOKEN` or `SLACK_BOT_TOKEN` — required for the approval thread
- `INSENSE_SLACK_CHANNEL_ID` — defaults to `C0AQZGJDR38` (`#airwallexdrafts`)
- `INSENSE_SLACK_OPERATOR_USER_ID` — when set, only this user's reactions count

---

## Quality Pass Criteria

A creator must meet all three:

| Check | Minimum |
|-------|---------|
| Portfolio uploads | >= 1 |
| Finished deals on Insense | >= 1 |
| Engagement rate | >= 1% |

Fail any one: skipped, not added to the decision file.

---

## Score and Niches

Quality-passing candidates are ranked by a 0–100 score:

| Signal | Weight | Cap |
|--------|--------|-----|
| Engagement rate | 40 | 10% |
| Finished deals | 30 (log) | 20 deals |
| Followers | 15 (log) | 500k |
| Portfolio uploads | 15 | 10 uploads |

Niches are extracted from the profile drawer text against a fixed vocabulary (Beauty, Skincare, Fashion, Lifestyle, Food, Fitness, Tech, etc.). Both fields are written into the decision file and shown in the Slack thread.

---

## Blocklist Rules

Enforced in code:

- `Previous Collaborator` — `invite: false`, `blockReason: 'Previous collaborator'`
- Cross-campaign dedup — if `creator-cache.json` already shows this creator as `messaged` / `ready_to_send` / `already_messaged` from any prior campaign, `invite: false` with `blockReason: 'Already invited from <prior campaign>'`

---

## Three-step Flow

### 1. Review

```powershell
$env:INSENSE_PASSWORD='...'
node projects/insense-creator-database/run-insense-outreach.mjs --mode review --campaign "<Campaign Name>" --limit 10
```

Writes:

- `data/runs/<campaign-slug>-review.json`
- `data/decisions/<campaign-slug>.json` — quality-passing creators are written with `invite: 'pending'`
- review history updated

When Slack is configured, the runner posts a parent message to `#airwallexdrafts` and one reply per candidate (sorted by score desc), each pre-stamped with ✅ and ❌. Thread/reply timestamps are saved into the decision file under `slack`.

### 2. Approve (in Slack)

Operator opens the thread and reacts on each candidate:

- ✅ → invite
- ❌ → skip
- no reaction → stays pending

Then collect:

```powershell
$env:INSENSE_SLACK_BOT_TOKEN='...'
node projects/insense-creator-database/run-insense-outreach.mjs --mode approve --campaign "<Campaign Name>"
```

Reads reactions, rewrites the decision file (`pending` → `true` / `false`), posts a summary back into the thread.

### 3. Send

```powershell
$env:INSENSE_PASSWORD='...'
node projects/insense-creator-database/run-insense-outreach.mjs --mode send --campaign "<Campaign Name>"
```

Only records with `invite === true` are messaged. Pending records are skipped (run `--mode approve` first).

---

## Dedup Rules

Two layers, both source-of-truth:

- thread scan for `https://form.typeform.com/to/lAPIxgqv` — skip if present
- `creator-cache.json` — durable per-creator status used by both `send` and the decision-time cross-campaign check

---

## Message Template

Single template in `lib/messaging.mjs`. Substitutes the creator's first name when available, otherwise the username.

---

## Current Limits

- review still bounded by `--limit` and visible-pool scroll
- niche vocabulary is a fixed list; unknown niches are dropped
- the Slack approval thread requires a bot token; without one, the runner falls back to legacy auto-`invite: true` for quality-passing non-blocklisted creators