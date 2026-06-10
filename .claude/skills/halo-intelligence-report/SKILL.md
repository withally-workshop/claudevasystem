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
- **ID:** 5ZqTSaUEtxnAndiY
- **URL:** `https://noatakhel.app.n8n.cloud/workflow/5ZqTSaUEtxnAndiY`
- **Deploy script:** `n8n-workflows/deploy-halo-intelligence-report.js`
- **Schedule:** Every Monday, 7:00 AM PHT (Asia/Manila)

## Key Config
- **Slack channel:** `C0A22NPLV38`
- **Google Sheet:** `1V_sjvMaCngWyB_5-ElMFdMetlsR2OdgD2QP42QQ5au4` — sheet tab: `Posts`. Columns aligned to Alleah's manual inspo sheet (adds Keyword, Format, Visual Style, Hook Type, CTA / Ending; Hook→Hook (0–3s), Why It Performed→Why It Works, Halo Angle→Halo Adaptation, URL→Post URL).
- **Inspiration Library:** Posts sheet is linked in the "Halo Post Inspiration Library" table of the **Ideas & Moodboard** Slack canvas (`F0A2ATP4D5L`) as the auto-updated TikTok feed; Alleah's manual sheet (`1dX0QCZvvb9W0pQIjNUieXTaO9WlYOObI9Hb6RzZlmEg`) there is the IG-focused complement.
- **Email recipients:** shin@kravemedia.co, noa@kravemedia.co, john@kravemedia.co, alleahvargas@gmail.com, basteperez021198@gmail.com (Baste — ads inspo)
- **Email sender:** john@kravemedia.co (gmail-john credential)
- **Apify TikTok actor:** `clockworks~tiktok-hashtag-scraper` (resultsType: posts)
- **Apify Instagram actor:** `apify~instagram-hashtag-scraper` (resultsType: reels)

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
- **TikTok:** minimum 5,000 likes (top/trending only)
- **Instagram:** minimum 10,000 views — IG reels earn thousands of likes, not millions, so the gate is views-based, not likes
- Instagram is scraped in **reels** mode (`resultsType: 'reels'`); the actor default `posts` returns static photos with near-zero engagement and is not used
- Video/Reels only — static posts and carousels are dropped (`isVideo` check)
- Last 14 days only — posts older than 14 days are dropped (posts with no parseable date are kept)
- Max 2 posts per creator across Top 10
- Top 10 per platform
- Diversity floor — best effort to include ≥3 distinct niche categories (skin / hair / shower / wellness) in each Top 10 when the data allows; cannot fabricate categories that aren't present

## Claude Output Per Post
- Hook breakdown (Hook (0–3s))
- Hook Type — one of: Question | Bold Claim | Curiosity Gap | Pain Point | POV / Empathy | Visual Shock | Social Proof (else Other)
- Format — one of: VSL | B-Roll | B-Roll VO | Talking Head | Skit | Tutorial | Listicle
- Visual Style (e.g. Raw & authentic, Polished/cinematic, Aesthetic/moody, Text-heavy)
- Keyword (core niche topic, e.g. Shower Filter, Hair Loss)
- CTA / Ending
- Why It Works (format, pacing, angle, emotion)
- ICP match (which group + why)
- Content pillar (Problem/Solution | Educational | Inspirational | Wellness Hack)
- Halo Adaptation (one sentence)
- 2-paragraph trend synthesis at the top of the report

Hook Type + Format taxonomies mirror Alleah's manual inspo sheet ("🪝 Hook Type Legend" tab) so the automated tracker and her manual pulls read in the same format.

## Manual Deploy
```bash
node n8n-workflows/deploy-halo-intelligence-report.js
```
Requires: `N8N_API_KEY`, `APIFY_API_KEY`, `ANTHROPIC_API_KEY` in environment.

## Key Rotation
API keys are baked into the n8n workflow Code nodes at deploy time (n8n Starter plan has no environment variable support). To rotate: update `.env` and redeploy with `node n8n-workflows/deploy-halo-intelligence-report.js`.
