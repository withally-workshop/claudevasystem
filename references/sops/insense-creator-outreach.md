# SOP: Insense Creator Outreach - Database Invite

**Owner:** John (operator)
**Executor:** Local standalone Playwright runner
**Trigger:** Manual, per campaign
**Skill:** `.claude/skills/insense-creator-outreach/SKILL.md`
**Objective:** Invite strong but non-selected Insense applicants into the Krave Creator Database without duplicate outreach, with explicit Slack-based approval before any message is sent.

---

## Purpose

When creators apply to an Insense campaign, many are strong enough to keep in the network even if they are not the right fit for that specific brief. This flow scores and ranks those candidates, posts them to a Slack approval thread, and only sends invites for creators the operator approves with a ✅ reaction.

---

## Quality Screening Criteria

A creator passes only if all three are true:

| Signal | Threshold | Where visible |
|--------|-----------|---------------|
| Portfolio uploads | >= 1 upload | Profile drawer -> `X uploads in Y different categories` |
| Finished deals | >= 1 | Profile drawer -> `X finished deals` |
| Engagement rate | >= 1% | Profile drawer -> `X.XX% Engagement rate` |

Fail any one: skipped from outreach, recorded with a skip reason.

---

## Score and Niches

Quality-passing creators are ranked by a 0–100 score weighted by engagement (40), finished deals (30), followers (15), and portfolio uploads (15). Niches are extracted from the profile drawer text against a fixed vocabulary and shown next to each candidate in the Slack thread.

---

## Invite Policy

- quality fail → skipped from outreach
- previous collaborator → `invite: false`, blocked in code
- creator already messaged from any prior campaign (cross-campaign dedup against `creator-cache.json`) → `invite: false`, blockReason names the prior campaign when known
- otherwise, when Slack reporting is configured → `invite: 'pending'` until approved in Slack
- Slack reporting not configured → falls back to legacy `invite: true` for quality-passing non-blocklisted creators

---

## Operating Model

### Step 1: Review

```powershell
$env:INSENSE_PASSWORD='...'
$env:INSENSE_SLACK_BOT_TOKEN='...'
node projects/insense-creator-database/run-insense-outreach.mjs --mode review --campaign "<Campaign Name>" --limit 10
```

Writes:

- `data/runs/<campaign-slug>-review.json`
- `data/decisions/<campaign-slug>.json` — quality-passing creators written with `invite: 'pending'`, plus `slack: { channelId, threadTs, replyTsByCreator }` when the candidate thread is posted

In Slack, a parent message lands in `#airwallexdrafts` followed by one reply per candidate (sorted by score desc), each pre-stamped with ✅ and ❌.

### Step 2: Approve in Slack

Operator opens the thread and reacts on each candidate:

- ✅ → invite
- ❌ → skip
- no reaction → stays pending and will not be sent

### Step 3: Collect approvals

```powershell
$env:INSENSE_SLACK_BOT_TOKEN='...'
node projects/insense-creator-database/run-insense-outreach.mjs --mode approve --campaign "<Campaign Name>"
```

- reads ✅ / ❌ reactions from the saved thread
- rewrites the decision file: `pending` → `true` / `false`
- posts a summary back into the thread (`X to send, Y rejected, Z still pending`)

Optional `INSENSE_SLACK_OPERATOR_USER_ID` restricts which user's reactions count.

### Step 4: Send

```powershell
$env:INSENSE_PASSWORD='...'
node projects/insense-creator-database/run-insense-outreach.mjs --mode send --campaign "<Campaign Name>"
```

The runner only messages creators with `invite: true`. Pending records are skipped — re-run approve or rerun review if you want them included.

---

## Deduplication

Two layers, both source-of-truth:

- thread scan for `https://form.typeform.com/to/lAPIxgqv` before each send
- `creator-cache.json` — durable per-creator status used at decision time (cross-campaign dedup) and at send time

The cache stores `{ status, updatedAt, campaign }` per creator key.

---

## Invite Message

Single template in `projects/insense-creator-database/lib/messaging.mjs`. Uses first name when available, otherwise username.

---

## Expected Outputs

Review run:

- review artifact JSON
- decision file JSON with `pending` records and `slack` block
- Slack candidate thread

Approve run:

- updated decision file with `true` / `false` per record
- Slack summary in the same thread

Send run:

- send artifact JSON
- updated `creator-cache.json` (status + campaign)
- Slack send summary

---

## Important Notes

- A bot token is required to use the approval gate. Without it, the runner falls back to legacy auto-`true` behavior so the flow still works.
- Cross-campaign dedup blocks based on the cache state at review time — it cannot block creators from two simultaneous reviews until one has run send.
- Niches use a fixed vocabulary; unknown niches are dropped silently.
- Use `--reset-review-history` on `review` to force-rescan a campaign.
