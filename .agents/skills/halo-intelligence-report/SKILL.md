---
name: halo-intelligence-report
description: Run the Halo Weekly Intelligence Report. Triggers the n8n workflow that scrapes TikTok and Instagram for top content in Halo's niche, scores and ranks posts by engagement + ICP relevance, analyzes with Claude, and delivers report to Slack, Google Sheets, and email. Trigger phrases: /halo-report, halo intelligence report, halo weekly intel.
metadata:
  short-description: Halo weekly social intelligence pipeline
---

## How to Trigger

This skill runs the n8n workflow via the n8n MCP or direct webhook once the workflow ID is confirmed.

- **n8n Workflow ID:** 5ZqTSaUEtxnAndiY
- **Manual test:** Execute workflow in n8n UI or via n8n MCP `execute_workflow`
- **Deploy script:** `n8n-workflows/deploy-halo-intelligence-report.js`

## What It Outputs

1. **Slack** — digest posted to channel `C0A22NPLV38` with trend synthesis + one-liner per top post
2. **Google Sheet** — one row per post appended to `1V_sjvMaCngWyB_5-ElMFdMetlsR2OdgD2QP42QQ5au4` (Posts tab). Columns aligned to Alleah's manual inspo sheet (adds Keyword, Format, Visual Style, Hook Type, CTA / Ending). Linked into the "Halo Post Inspiration Library" table in the **Ideas & Moodboard** Slack canvas (`F0A2ATP4D5L`) as the auto-updated TikTok feed; Alleah's manual sheet there is the IG-focused complement.
3. **Email** — full HTML analysis sent to shin@kravemedia.co, noa@kravemedia.co, john@kravemedia.co, alleahvargas@gmail.com, basteperez021198@gmail.com (Baste — ads inspo)

## Pipeline Summary

1. Fetch Social Data — Apify TikTok + Instagram scrapers run in parallel (Instagram in `reels` mode, not static posts). Both are **pay-per-result**; capped at 30/hashtag (TikTok `resultsPerPage`, IG `resultsLimit`) → ~240 results/platform/run (~$0.96 TikTok + ~$0.55 IG; URL `&limit` sits at 300 ≥ results/run). ⚠️ TikTok's cap is `resultsPerPage` (default 100) — `maxPostsPerPage` is not a valid field and is silently ignored (5× overspend if used)
2. Score & Rank — video/reels only; last 14 days; gate TikTok ≥5,000 likes, Instagram ≥10,000 views; weighted engagement formula × ICP relevance multiplier; top 10 per platform (max 2 per creator, ≥3 niche categories best effort)
3. Claude Analysis — per post: hook, hook type, format, visual style, keyword, CTA/ending, why it works, ICP match, content pillar, Halo adaptation + a sectioned trend synthesis (overview · TikTok/IG highlights · cross-platform format · 3 numbered Halo priorities — structured object, emoji-headed in Slack, mirrored in email) (Hook Type + Format constrained to fixed option lists matching Alleah's manual sheet)
4. Format + Deliver — Slack digest, email HTML, Sheet rows

## ICP Groups
- Skin Conditions (Eczema, Rosacea, Psoriasis, Acne-Prone, Sensitive Skin)
- Hair & Scalp Conditions (Hair Loss, Dandruff, Dry/Frizzy Hair, Color-Treated Hair)
- Context & Mindset (Hard Water Refugee, Wellness-Burned, Prevention-Focused)

## Related Files
- Claude Code skill: `.claude/skills/halo-intelligence-report/SKILL.md`
- Deploy script: `n8n-workflows/deploy-halo-intelligence-report.js`
- Project context: `projects/halo-home-us-expansion/`
