---
name: halo-intelligence-report
description: Run the Halo Weekly Intelligence Report. Triggers the n8n workflow that scrapes TikTok and Instagram for top content in Halo's niche, scores and ranks posts by engagement + ICP relevance, analyzes with Claude, and delivers report to Slack, Google Sheets, and email. Trigger phrases: /halo-report, halo intelligence report, halo weekly intel.
metadata:
  short-description: Halo weekly social intelligence pipeline
---

## How to Trigger

This skill runs the n8n workflow via the n8n MCP or direct webhook once the workflow ID is confirmed.

- **n8n Workflow ID:** 5ZqTSaUEtxnAndiY (update after first deploy)
- **Manual test:** Execute workflow in n8n UI or via n8n MCP `execute_workflow`
- **Deploy script:** `n8n-workflows/deploy-halo-intelligence-report.js`

## What It Outputs

1. **Slack** — digest posted to channel `C0A22NPLV38` with trend synthesis + one-liner per top post
2. **Google Sheet** — one row per post appended to `1V_sjvMaCngWyB_5-ElMFdMetlsR2OdgD2QP42QQ5au4` (Posts tab)
3. **Email** — full HTML analysis sent to shin@kravemedia.co, noa@kravemedia.co, john@kravemedia.co, alleahvargas@gmail.com

## Pipeline Summary

1. Fetch Social Data — Apify TikTok + Instagram scrapers run in parallel
2. Score & Rank — weighted engagement formula × ICP relevance multiplier, top 10 per platform
3. Claude Analysis — hook, why it performed, ICP match, content pillar, Halo angle per post + 2-paragraph trend synthesis
4. Format + Deliver — Slack digest, email HTML, Sheet rows

## ICP Groups
- Skin Conditions (Eczema, Rosacea, Psoriasis, Acne-Prone, Sensitive Skin)
- Hair & Scalp Conditions (Hair Loss, Dandruff, Dry/Frizzy Hair, Color-Treated Hair)
- Context & Mindset (Hard Water Refugee, Wellness-Burned, Prevention-Focused)

## Related Files
- Claude Code skill: `.claude/skills/halo-intelligence-report/SKILL.md`
- Deploy script: `n8n-workflows/deploy-halo-intelligence-report.js`
- Project context: `projects/halo-home-us-expansion/`
