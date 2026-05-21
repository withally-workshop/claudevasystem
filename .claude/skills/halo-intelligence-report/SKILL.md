# Skill: Halo Weekly Intelligence Report

## Trigger
- `/halo-report`
- "run halo intelligence report"
- "halo weekly intel"

## Purpose
Triggers the n8n Halo Weekly Intelligence Report workflow, which:
- Scrapes TikTok and Instagram for top-performing content in Halo's niche hashtag clusters
- Scores and ranks posts using engagement rate (40%), saves/shares (35%), raw views (25%) × ICP relevance multiplier
- Feeds top 10 per platform through Claude for structured analysis
- Delivers report to Slack, Google Sheets, and email

## n8n Workflow
- **ID:** 5ZqTSaUEtxnAndiY (update after first deploy)
- **URL:** `https://noatakhel.app.n8n.cloud/workflow/5ZqTSaUEtxnAndiY`
- **Deploy script:** `n8n-workflows/deploy-halo-intelligence-report.js`
- **Schedule:** Every Monday, 7:00 AM ICT (Asia/Manila)

## Key Config
- **Slack channel:** `C0A22NPLV38`
- **Google Sheet:** `1V_sjvMaCngWyB_5-ElMFdMetlsR2OdgD2QP42QQ5au4` — sheet tab: `Posts`
- **Email recipients:** shin@kravemedia.co, noa@kravemedia.co, john@kravemedia.co, alleahvargas@gmail.com
- **Email sender:** john@kravemedia.co (gmail-john credential)
- **Apify TikTok actor:** `clockworks~tiktok-scraper` (verify at apify.com/store)
- **Apify Instagram actor:** `apify~instagram-hashtag-scraper` (verify at apify.com/store)

## Hashtag Clusters Scraped
- **Skin:** sensitiveskin, skintok, skinbarrier, eczema, rosacea, acneskin
- **Hair:** hairloss, scalptok, dryhair, dandruff, colortreatedhair
- **Shower/Water:** showertok, hardwater, showerskincare
- **Wellness:** cleanbeauty, wellnesstok, skinconsciousliving, nontoxicbeauty, rituals

## ICP Groups (Scoring Multiplier)
| Group | Sub-ICPs | Emotional Driver |
|-------|----------|-----------------|
| Skin Conditions | Eczema · Rosacea · Psoriasis · Acne-Prone · Sensitive Skin | Pain, exhaustion, desperation — has tried everything |
| Hair & Scalp Conditions | Hair Loss · Dandruff · Dry/Frizzy Hair · Color-Treated Hair | Frustration, embarrassment, wasted money, identity threat |
| Context & Mindset | Hard Water Refugee · Wellness-Burned · Prevention-Focused | Attribution, skepticism, proactive protection |

Each matched ICP group adds +0.1 to the relevance multiplier (max 1.3×).

## Scoring Formula
```
Final Score = (Engagement Rate × 0.40 + Saves/Shares Rate × 0.35 + Views Normalized × 0.25) × Relevance Multiplier
```

## Filters Applied
- Last 14 days only
- Minimum 5,000 likes
- Video/Reels only (no static posts or carousels)
- Max 2 posts per creator across Top 10
- Min 3 different niche categories per platform

## Claude Output Per Post
- Hook breakdown
- Why it performed (format, pacing, angle, emotion)
- ICP match (which group + why)
- Content pillar (Problem/Solution | Educational | Inspirational | Wellness Hack)
- Halo angle (one sentence)
- 2-paragraph trend synthesis at the top of the report

## Manual Deploy
```bash
node n8n-workflows/deploy-halo-intelligence-report.js
```
Requires: `N8N_API_KEY`, `APIFY_API_KEY`, `ANTHROPIC_API_KEY` in environment.

## Key Rotation
API keys are baked into the n8n workflow Code nodes at deploy time (n8n Starter plan has no environment variable support). To rotate: update `.env` and redeploy with `node n8n-workflows/deploy-halo-intelligence-report.js`.
