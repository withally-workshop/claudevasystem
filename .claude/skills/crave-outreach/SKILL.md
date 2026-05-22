# Skill: Crave Outreach

## Purpose

Runs the TikTok UGC creator outreach pipeline for Krave Media. Wraps all Python scripts in `projects/crave-outreach/` so they can be invoked from Claude Code without remembering terminal commands.

Pipeline: Apify scrapes TikTok → Claude Haiku classifies niche → Google Sheet (Noa reviews) → Smartlead sends emails via `hello@joinkravemedia.co`.

## Key Data

| Item | Value |
|---|---|
| Working directory | `C:\Users\jopso\Desktop\claude-ea\projects\crave-outreach` |
| Google Sheet | [Crave Creator Outreach](https://docs.google.com/spreadsheets/d/1eLQrDP3IX9ec9dtFN0UyRdlTplzkLfRG9Asyqj1gLrI/edit) |
| Smartlead campaign ID | `3375376` |
| Sending email | `hello@joinkravemedia.co` |
| Warm-up completes | ~2026-06-12 — do not push leads before this date |
| Apify plan required | Starter ($29/month) — free tier is exhausted |

## Commands

Run all commands from the project working directory. Use `cd projects/crave-outreach` first, or prefix each command with it.

### Phase 1 — Scraping

| What you say | Command |
|---|---|
| Scrape US creators (dry run) | `python src/main.py --search-term "UGC creator" --max-results 100 --region US --dry-run` |
| Scrape US creators (live) | `python src/main.py --search-term "UGC creator" --max-results 500 --region US` |
| Scrape NL creators (dry run) | `python src/main.py --search-term "UGC creator" --max-results 100 --region NL --dry-run` |
| Scrape NL creators (live) | `python src/main.py --search-term "UGC creator" --max-results 200 --region NL && python src/main.py --search-term "ugc nederland" --max-results 200 --region NL` |

Scraping writes rows to the Sheet with `status=new`. Noa reviews and flips approved rows to `status=approved`.

### Phase 2 — Campaign Operations

| What you say | Command |
|---|---|
| Push approved leads (dry run) | `python src/smartlead.py --campaign-id 3375376 --push-leads --dry-run` |
| Push approved leads (live) | `python src/smartlead.py --campaign-id 3375376 --push-leads` |
| Sync replies/opens/bounces | `python src/smartlead.py --campaign-id 3375376 --sync-status` |
| Check campaign stats / open rate | `python src/smartlead.py --campaign-id 3375376 --stats` |
| List all campaigns | `python src/smartlead.py --list-campaigns` |

Push reads Sheet rows where `status=approved` and `outreach_sent_at` is blank. On push: sets `status=outreach_queued`, writes `outreach_sent_at`. Sync pulls Smartlead statuses back to Sheet (opens, replies, bounces).

## Open Rate Interpretation

| Rate | Healthy | Warning |
|---|---|---|
| Open rate | 25–45% | Below 20% = likely going to spam |
| Reply rate | 5–15% | Below 3% = template needs work |
| Bounce rate | Below 3% | Above 5% = list quality issue |

## n8n Automation

Two n8n workflows run daily at 9am PHT and handle Phase 2 automatically:
- **Crave - Daily Lead Push** — pushes approved leads to Smartlead
- **Crave - Status Sync** — syncs opens/replies/bounces back to Sheet

These replace the need to run `--push-leads` and `--sync-status` manually each day. Use those commands only for manual overrides or debugging.

## Notes

- The daily push and sync n8n workflows do NOT run during warm-up (before June 12). Leave them inactive until warm-up completes.
- `--dry-run` on any command prints what would happen without writing to Sheet or Smartlead.
- Apify runs take 3–10 minutes depending on volume.
- Enrichment (Claude Haiku) is cached by handle — re-runs for the same creator are free.
