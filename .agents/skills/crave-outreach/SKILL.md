---
name: crave-outreach
description: Run TikTok creator scraper for US or NL regions, push approved leads to Smartlead campaign, sync reply/open/bounce statuses back to Google Sheet, check campaign open rate. Trigger phrases: "scrape creators", "scrape US creators", "scrape NL creators", "push leads", "push approved leads", "sync outreach status", "check open rate", "campaign stats", "/crave-outreach".
metadata:
  short-description: TikTok creator outreach pipeline
---

# Crave Outreach

TikTok UGC creator discovery and cold email outreach pipeline for Krave Media.

**Full instructions:** `.claude/skills/crave-outreach/SKILL.md`

## How to Invoke

All commands run from `C:\Users\jopso\Desktop\claude-ea\projects\crave-outreach`.

### Scraping (Phase 1)
```
python src/main.py --search-term "UGC creator" --max-results 500 --region US
python src/main.py --search-term "UGC creator" --max-results 200 --region NL
python src/main.py --search-term "ugc nederland" --max-results 200 --region NL
```
Append `--dry-run` to any scrape command to preview without writing to Sheet.

### Campaign (Phase 2)
```
python src/smartlead.py --campaign-id 3375376 --push-leads
python src/smartlead.py --campaign-id 3375376 --push-leads --dry-run
python src/smartlead.py --campaign-id 3375376 --sync-status
python src/smartlead.py --campaign-id 3375376 --stats
```

## Key IDs

| Item | Value |
|---|---|
| Smartlead campaign | `3375376` |
| Google Sheet | `1eLQrDP3IX9ec9dtFN0UyRdlTplzkLfRG9Asyqj1gLrI` |
| Sending email | `hello@joinkravemedia.co` |

## n8n Automation

- **Crave - Daily Lead Push** — 9am PHT daily — pushes approved leads to Smartlead
- **Crave - Status Sync** — 9am PHT daily — syncs Smartlead statuses back to Sheet

Both are inactive during warm-up (activate after ~2026-06-12).
