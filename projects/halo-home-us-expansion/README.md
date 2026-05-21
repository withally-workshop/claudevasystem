# Halo Home US Expansion

**Description:** Expanding Halo Home's DTC physical e-commerce operations and creator marketing campaigns into the US market.

**Status:** Active

**Key contacts:** Amy / Shuo Shimpa (suppliers — WhatsApp/WeChat)

**Key dates:** Q2 2026 — US operational and marketing foothold established.

---

## Automation

### Halo Weekly Intelligence Report

Weekly social intelligence pipeline — live as of 2026-05-21.

- **What it does:** Scrapes TikTok and Instagram for top content in Halo's niche hashtag clusters, scores by engagement × ICP relevance, analyzes with Claude, delivers to Slack + Google Sheet + email every Monday 7AM ICT.
- **Deploy script:** `n8n-workflows/deploy-halo-intelligence-report.js`
- **Skill:** `.claude/skills/halo-intelligence-report/SKILL.md`
- **Google Sheet:** `1V_sjvMaCngWyB_5-ElMFdMetlsR2OdgD2QP42QQ5au4` (Posts tab)
- **Slack channel:** `C0A22NPLV38`

**ICP groups scored against:**
1. Skin Conditions — Eczema, Rosacea, Psoriasis, Acne-Prone, Sensitive Skin
2. Hair & Scalp Conditions — Hair Loss, Dandruff, Dry/Frizzy Hair, Color-Treated Hair
3. Context & Mindset — Hard Water Refugee, Wellness-Burned, Prevention-Focused

**Before first deploy:**
- Set `APIFY_API_KEY` and `ANTHROPIC_API_KEY` in n8n Settings → Environment Variables
- Create `Posts` tab in Google Sheet with required columns (see WORKFLOWS.md Workflow 15)
- Verify Apify actor IDs at apify.com/store
