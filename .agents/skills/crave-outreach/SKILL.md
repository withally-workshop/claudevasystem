---
name: crave-outreach
description: Run TikTok creator scraper (US/NL), export Noa-approved leads to a Smartlead-ready CSV for manual import, check campaign status. Smartlead is on the Base plan (no API) so push/sync are done manually in the UI. Trigger phrases: "scrape creators", "scrape US creators", "scrape NL creators", "export approved leads", "crave outreach", "/crave-outreach".
metadata:
  short-description: TikTok creator outreach pipeline
---

# Crave Outreach

TikTok UGC creator discovery + cold email outreach for Krave Media.

**Full instructions:** `.claude/skills/crave-outreach/SKILL.md`
**Operating runbook:** `references/sops/crave-creator-outreach.md` (KM-SOP-009)

## Current Mode (Base plan — manual, no API)
Smartlead Base ($39/mo) has no API, so the n8n auto-push/sync and `smartlead.py` (push/sync/stats) do NOT work (need Pro $94). Live flow: scrape → Noa approves in Sheet → `export_approved.py` → John imports CSV in the Smartlead UI.

## How to Invoke
From `C:\Users\jopso\Desktop\claude-ea\projects\crave-outreach`:

### Scrape (Phase 1)
```
python src/main.py --search-term "UGC creator" --max-results 500 --region US
python src/main.py --search-term "UGC creator" --max-results 200 --region NL
```
Append `--dry-run` to preview. Writes `status=new` rows for Noa to approve.

### Export approved leads (Phase 2 — Base/manual, LIVE)
```
python src/export_approved.py            # data/approved_leads.csv (+ --dry-run)
```
Writes a Smartlead-ready CSV of approved+emailed rows and marks them `outreach_queued`. Import the CSV into campaign `3375376` via Smartlead UI (Leads → Add More Leads).

### API path (Pro only — INACTIVE on Base)
```
python src/smartlead.py --campaign-id 3375376 --push-leads   # 401 on Base
python src/smartlead.py --campaign-id 3375376 --sync-status
python src/smartlead.py --campaign-id 3375376 --stats
```

## Key IDs
| Item | Value |
|---|---|
| Smartlead campaign | `3375376` |
| Google Sheet | `1eLQrDP3IX9ec9dtFN0UyRdlTplzkLfRG9Asyqj1gLrI` |
| Sending email | `hello@joinkravemedia.co` (From Name: Mimi) |
| Plan | Base $39/mo (no API) |

## Cadence
Weekly: scrape → approve → export → import into the SAME campaign. One mailbox = ~25/day shared across campaigns; don't run parallel campaigns. New campaign only for different audience/copy (e.g., NL).

## n8n Automation (INACTIVE — Pro-gated)
- **Crave - Daily Lead Push** (`ke52OLrSUXk8mPVw`)
- **Crave - Status Sync** (`uUGxA3GW1W0vq6el`)

Both inactive; require Smartlead Pro API. Re-activate after upgrade.
