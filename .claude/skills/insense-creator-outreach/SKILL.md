# Skill: Insense Creator Outreach
**Trigger:** "run insense outreach", "process insense applications", "send database invites", "/insense-creator-outreach"
**SOP:** references/sops/insense-creator-outreach.md
**Mode:** Standalone local Playwright runner

---

## What This Skill Does

Uses the local runner in `projects/insense-creator-database/` to:

- review a campaign's visible applicants in Insense
- extract quality signals from the real profile drawer
- auto-classify invite eligibility for quality-passing creators
- block known exclusions in code
- send the Krave Creator Database invite for creators marked `invite: true`

---

## Prerequisites

- local dependencies installed in `projects/insense-creator-database/`
- Playwright Chromium installed for that project
- `INSENSE_PASSWORD` available in the environment
- target campaign name provided

Optional:

- `INSENSE_EMAIL`
  - defaults to `noa@kravemedia.co`
- `INSENSE_SLACK_BOT_TOKEN` or `SLACK_BOT_TOKEN`
  - posts review and send summaries to `#airwallexdrafts`
- `INSENSE_SLACK_CHANNEL_ID`
  - defaults to `C0AQZGJDR38`

---

## Quality Pass Criteria

A creator must meet all three:

| Check | Minimum |
|-------|---------|
| Portfolio uploads | >= 1 |
| Finished deals on Insense | >= 1 |
| Engagement rate | >= 1% |

Fail any one:

- skip the creator
- record the skip reason
- do not include them in the invite decision file

---

## Blocklist Rules

Current enforced blocklist:

- `Previous Collaborator`

Blocklisted creators:

- remain in the quality-passing decision file
- are written with `invite: false`
- carry a `blockReason`
- are skipped by `send` mode

---

## Review Flow

Run:

```powershell
$env:INSENSE_PASSWORD='...'
node projects/insense-creator-database/run-insense-outreach.mjs --mode review --campaign "<Campaign Name>" --limit 10
```

This produces:

- `projects/insense-creator-database/data/runs/<campaign-slug>-review.json`
- `projects/insense-creator-database/data/decisions/<campaign-slug>.json`
- Slack review summary to `#airwallexdrafts` when configured

Decision behavior:

- quality-passing creators default to `invite: true`
- blocklisted creators are written as `invite: false`
- skipped creators stay only in the review artifact

---

## Send Flow

Run:

```powershell
$env:INSENSE_PASSWORD='...'
node projects/insense-creator-database/run-insense-outreach.mjs --mode send --campaign "<Campaign Name>"
```

The runner will:

1. reopen the campaign applicants route
2. search by username
3. open the creator profile
4. open the message composer
5. scan the thread for the Typeform link
6. skip if already messaged
7. send the invite only for `invite: true`
8. write `projects/insense-creator-database/data/runs/<campaign-slug>-send.json`
9. post a send summary to `#airwallexdrafts` when configured

---

## Dedup Rule

The presence of:

`https://form.typeform.com/to/lAPIxgqv`

anywhere in the existing chat thread means:

- already messaged
- do not send again

---

## Message Template

The runner uses the built-in template in `lib/messaging.mjs` and substitutes the creator's first name when available, otherwise the username.

---

## Current Limits

- review mode currently works on the first visible applicants, bounded by `--limit`
- the current auto-policy only blocklists `Previous Collaborator`
- the local cache helps avoid accidental repeats, but thread dedup is still the source-of-truth check
- `creator-cache.json` remains the local durable record for creator statuses
