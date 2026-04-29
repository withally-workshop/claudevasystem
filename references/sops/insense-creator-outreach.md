# SOP: Insense Creator Outreach - Database Invite

**Owner:** John (operator)
**Executor:** Local standalone Playwright runner
**Trigger:** Manual, per campaign
**Skill:** `.claude/skills/insense-creator-outreach/SKILL.md`
**Objective:** Invite strong but non-selected Insense applicants into the Krave Creator Database without duplicate outreach.

---

## Purpose

When creators apply to an Insense campaign, many are strong enough to keep in the network even if they are not the right fit for that specific brief. This flow captures those creators into Krave's own creator pipeline by sending a direct database invite through Insense chat.

---

## Quality Screening Criteria

A creator passes only if all three are true:

| Signal | Threshold | Where visible |
|--------|-----------|---------------|
| Portfolio uploads | >= 1 upload | Profile drawer -> `X uploads in Y different categories` |
| Finished deals | >= 1 | Profile drawer -> `X finished deals` |
| Engagement rate | >= 1% | Profile drawer -> `X.XX% Engagement rate` |

Fail any one:

- no invite
- record the skip reason

---

## Automatic Invite Policy

The runner now auto-populates invite decisions for quality-passing creators.

Current blocklist:

- `Previous Collaborator`

Policy behavior:

- quality fail -> skipped from outreach
- quality pass and not blocklisted -> `invite: true`
- quality pass and blocklisted -> `invite: false` with a `blockReason`

This keeps the flow automatic while enforcing an explicit exclusion rule in code.

---

## Operating Model

### Step 1: Review

Run:

```powershell
$env:INSENSE_PASSWORD='...'
node projects/insense-creator-database/run-insense-outreach.mjs --mode review --campaign "<Campaign Name>" --limit 10
```

This writes:

- `projects/insense-creator-database/data/runs/<campaign-slug>-review.json`
- `projects/insense-creator-database/data/decisions/<campaign-slug>.json`

The decision file contains only quality-passing creators and already includes the current invite decision.
When configured with a Slack bot token, the runner also posts a review summary to `#airwallexdrafts`.

### Step 2: Send

Run:

```powershell
$env:INSENSE_PASSWORD='...'
node projects/insense-creator-database/run-insense-outreach.mjs --mode send --campaign "<Campaign Name>"
```

The runner:

- skips records with `invite: false`
- only messages creators with `invite: true`
- writes a send artifact JSON locally
- posts a send summary to `#airwallexdrafts` when configured

---

## Deduplication

Before sending, the runner opens the creator chat thread and checks for:

`https://form.typeform.com/to/lAPIxgqv`

If that link is already in the thread:

- treat the creator as already messaged
- skip sending

The local cache in `projects/insense-creator-database/data/creator-cache.json` is helpful, but the thread check is the source-of-truth dedup rule.
The cache remains the durable local record even when Slack reporting is enabled.

---

## Invite Message

The runner uses the built-in message template in:

- `projects/insense-creator-database/lib/messaging.mjs`

Greeting rule:

- use first name when available
- otherwise use username

---

## Expected Outputs

Review run:

- review artifact JSON
- decision file JSON
- terminal summary

Send run:

- send summary in terminal
- updated local cache
- sent / skipped / already-messaged statuses in the result artifact

---

## Important Notes

- The current blocklist rule is `Previous Collaborator`.
- Expand the blocklist in code when campaign-specific exclusions become clear.
- Use bounded review runs first when validating a new campaign.
- The live runner has already been verified on real review extraction and live sends.
