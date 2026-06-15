# KM-SOP-009 — Crave Creator Outreach (Weekly)
**Frequency:** Weekly (scrape + approve + import) | **Owner:** John (ops) + Noa (lead approval) | **Updated:** June 2026

> **CURRENT MODE (2026-06-15): Smartlead Base plan ($39/mo) — manual, no API.** API access (n8n auto-push, status sync, `smartlead.py`) requires Smartlead **Pro ($94/mo)** and is NOT active. On Base the flow is: scrape (script) → Noa approves in the Sheet → `export_approved.py` writes a CSV → John imports it in the Smartlead UI. Status tracking lives in the Smartlead dashboard, not the Sheet.

## Overview
Weekly TikTok UGC creator outreach for Krave Media. Discover creators → Noa approves → email them from `hello@joinkravemedia.co` (sender name **Mimi**) via one Smartlead campaign at ~25/day. The single CTA is a Typeform that invites creators into Krave's paid creator network.

## Key Facts
| Item | Value |
|---|---|
| Working dir | `projects/crave-outreach` |
| Google Sheet | `1eLQrDP3IX9ec9dtFN0UyRdlTplzkLfRG9Asyqj1gLrI` |
| Smartlead campaign | `3375376` ("UGC Creator Outreach May 2026") |
| Plan | Smartlead **Base $39/mo** — no API (Pro $94 needed for automation) |
| Sender | `hello@joinkravemedia.co`, From Name **Mimi** |
| Send pace | ~25/day, Mon–Fri, America/New_York, 09:00–17:00 |
| Plan caps | 2,000 contacts, 6,000 sends/month (well above current volume) |
| CTA | Typeform `https://form.typeform.com/to/lAPIxgqv` |
| Email copy | Noa-approved (Slack DM 2026-05-25); stored in `src/outreach.py` DEFAULT_SUBJECT/BODY |

## Key Rules
- **One mailbox = ~25/day, shared across ALL campaigns.** More campaigns do NOT add throughput. Add new leads to the SAME campaign; do not spin up parallel campaigns for the same audience.
- **Never auto-approve.** Only Noa flips `status: new → approved`. Rows with no email are skipped automatically (can't email a blank address).
- **Conversions go through the Typeform**, which John cannot see. Whoever owns the form (Noa / strategist) must action submissions, or warm leads stall.
- **Watch deliverability.** If bounce rate > ~5% or open rate < ~20%, pause and diagnose before adding more.
- New campaign only for a different audience/copy (e.g., NL creators → Dutch copy + Europe/Amsterdam timezone).
- To send more than ~125/week, add another warmed mailbox (each adds ~25/day) — not more campaigns.

## Weekly Steps

### 1. Scrape (John) — weekly
```
cd projects/crave-outreach
python src/main.py --search-term "UGC creator" --max-results 500 --region US
```
Writes new creators to the Sheet as `status=new`. Append `--dry-run` to preview.

### 2. Approve (Noa) — weekly
In the Sheet, column O (`status`), flip `new → approved` for chosen creators. Batch the week's review in one sitting.

### 3. Export (John)
```
cd projects/crave-outreach
python src/export_approved.py            # data/approved_leads.csv  (+ --dry-run to preview)
```
Pulls rows where `status=approved` AND email present; writes a Smartlead-ready CSV and marks those rows `outreach_queued` so next week only newly-approved leads export (no duplicates).

### 4. Import (John) — Smartlead UI
- Campaign `3375376` → **Leads → Add More Leads** → upload `data/approved_leads.csv`.
- Map `email → Email`, `first_name → First Name` (the only fields the copy uses). Others optional.
- Upload Settings: Global Block **OFF**, Unsubscribe **OFF**, Community Bounce **OFF** (= apply protection), Existing Campaign Leads OFF.
- Let verification run. After it finishes Smartlead sends to **valid + catch-all** and skips **invalid + unknown**. To also send to "unknown" leads (mostly Gmail that can't be probe-verified): export just the unknown segment from Smartlead and re-import it WITHOUT running verification.

### 5. Send (automatic)
New leads join the running campaign and send at ~25/day. No new campaign, no waiting for the current batch to finish.

### 6. Monitor (John)
Smartlead dashboard: opens, replies, bounces. Pause + diagnose if bounce > ~5% or open < ~20%. Raise the daily cap gradually as reputation holds.

## When Upgraded to Pro ($94)
API unlocks. Re-activate `Crave - Daily Lead Push` (`ke52OLrSUXk8mPVw`) and `Crave - Status Sync` (`uUGxA3GW1W0vq6el`), and `smartlead.py --push-leads/--sync-status/--stats` work. Push + status sync-back to the Sheet become automatic and steps 3–4 go hands-off.

## Notes
- 28 scraped creators have no email — parked as `approved` in the Sheet, not emailable. (Not handed to Alleah — she works Halo Home, not Krave Media.)
- Open-rate guide: healthy 25–45%; below 20% = likely spam. Reply healthy 5–15%. Bounce keep below 3%; above 5% = list quality issue.
- Legacy free Gmail path (`src/outreach.py` via `ivana@`, `main.py --outreach-only`) exists as a fallback but is NOT the live method; it sends unwarmed and has no tracking.
