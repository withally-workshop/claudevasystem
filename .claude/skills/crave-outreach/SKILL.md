# Skill: Crave Outreach

## Purpose

Runs the TikTok UGC creator outreach pipeline for Krave Media. Wraps the Python scripts in `projects/crave-outreach/` so they can be invoked from Claude Code.

Pipeline: Apify scrapes TikTok → Claude Haiku classifies niche → Google Sheet (Noa reviews) → Smartlead sends cold email from `hello@joinkravemedia.co` (sender name Mimi).

**Full operating runbook:** `references/sops/crave-creator-outreach.md` (KM-SOP-009).

## Current Mode (2026-06-15): Base plan — manual, no API

Smartlead is on the **Base plan ($39/mo)**, which has **no API access**. The n8n auto-push / status-sync workflows and `smartlead.py` (push/sync/stats) DO NOT work — they need **Pro ($94/mo)**. The live flow is:

`scrape (script)` → `Noa approves in Sheet` → `export_approved.py` → `John imports CSV in Smartlead UI`

Status tracking (opens/replies/bounces) lives in the Smartlead dashboard, not the Sheet, until Pro.

## Key Data

| Item | Value |
|---|---|
| Working directory | `C:\Users\jopso\Desktop\claude-ea\projects\crave-outreach` |
| Google Sheet | [Crave Creator Outreach](https://docs.google.com/spreadsheets/d/1eLQrDP3IX9ec9dtFN0UyRdlTplzkLfRG9Asyqj1gLrI/edit) |
| Smartlead campaign | `3375376` ("UGC Creator Outreach May 2026") |
| Plan | Smartlead Base $39/mo (no API; Pro $94 for automation) |
| Sending email | `hello@joinkravemedia.co` — From Name **Mimi** |
| Send pace | ~25/day, Mon–Fri, America/New_York 09:00–17:00 |
| Warm-up | Complete (100% sender reputation) |
| Email copy | Noa-approved; in `src/outreach.py` DEFAULT_SUBJECT/BODY; CTA = Typeform |
| Apify plan | Starter ($29/mo) |

## Commands

Run from the project working directory.

### Phase 1 — Scraping
| What you say | Command |
|---|---|
| Scrape US creators (dry run) | `python src/main.py --search-term "UGC creator" --max-results 100 --region US --dry-run` |
| Scrape US creators (live) | `python src/main.py --search-term "UGC creator" --max-results 500 --region US` |
| Scrape NL creators (live) | `python src/main.py --search-term "UGC creator" --max-results 200 --region NL` |

Writes rows with `status=new`. Noa flips approved rows to `status=approved`.

### Phase 2 — Export approved leads (Base / manual — LIVE)
| What you say | Command |
|---|---|
| Export approved → CSV (dry run) | `python src/export_approved.py --dry-run` |
| Export approved → CSV (live) | `python src/export_approved.py` |

Writes `data/approved_leads.csv` (rows where `status=approved` AND email present) and marks them `outreach_queued`. John imports the CSV into Smartlead campaign 3375376 via the UI (Leads → Add More Leads). See KM-SOP-009 for import + verification handling.

### Phase 2 — API path (Pro only — currently INACTIVE)
These require Smartlead Pro and will 401 on Base. Do not use until upgraded:
```
python src/smartlead.py --campaign-id 3375376 --push-leads
python src/smartlead.py --campaign-id 3375376 --sync-status
python src/smartlead.py --campaign-id 3375376 --stats
```

## Weekly Cadence

Run weekly: scrape → Noa approves → `export_approved.py` → import the CSV into the SAME campaign. One mailbox = ~25/day shared across all campaigns, so never run parallel campaigns for the same audience; just add leads (~125/week capacity per mailbox). To go faster, add another warmed mailbox (future), not more campaigns. New campaign only for a different audience/copy (e.g., NL → Dutch copy + EU timezone).

## Open Rate Interpretation
| Rate | Healthy | Warning |
|---|---|---|
| Open rate | 25–45% | Below 20% = likely going to spam |
| Reply rate | 5–15% | Below 3% = template needs work |
| Bounce rate | Below 3% | Above 5% = list quality issue |

## n8n Automation

**ACTIVE — Phase 1 scrape (replaces running `src/main.py` by hand):**
- **Crave - Weekly Creator Scrape** (`9VtIbccU1dFkoko9`) — Mondays 11 AM PHT. Scrapes US + NL (all search terms) → enrich (new handles) → dedupe → **status-preserving** upsert to the Sheet (`status=new` for new; existing `approved`/`outreach_queued` never reset) → reports to #krave-creator-outreach + #ops-command. Deploy: `n8n-workflows/deploy-crave-weekly-scrape.js`. Full docs: WORKFLOWS.md Workflow 24.
  - Volume is capped low (US 120 / NL 80) because n8n Cloud Starter OOMs above a few hundred items; the Apify URL also projects `fields=authorMeta,text`. For a bigger pull, run the Python `src/main.py` locally instead, or raise `REGIONS` in the deploy script and re-test.
  - The Sheets credential is **noa@kravemedia.co** and must keep **Editor** on the Crave sheet (the sheet is link-shared read-only by design; granting edit was the one manual setup step).

**INACTIVE — Phase 2 (Pro-gated):**
- **Crave - Daily Lead Push** (`ke52OLrSUXk8mPVw`) — pushes approved leads to Smartlead
- **Crave - Status Sync** (`uUGxA3GW1W0vq6el`) — syncs opens/replies/bounces back to Sheet

Both Phase-2 workflows depend on the Smartlead API (Pro). Leave off on Base; re-activate after upgrading to Pro.

## Notes
- Conversions go through the Typeform (`https://form.typeform.com/to/lAPIxgqv`); John can't see submissions — Noa/strategist must action them.
- `--dry-run` previews without writing.
- Apify runs take 3–10 min. Enrichment (Claude Haiku) is cached by handle.
- 28 scraped creators have no email — parked as `approved`, not emailable.
