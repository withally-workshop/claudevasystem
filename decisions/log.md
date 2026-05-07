# Decision Log

Append-only. When a meaningful decision is made, log it here.

Format: [YYYY-MM-DD] DECISION: ... | REASONING: ... | CONTEXT: ...

---

[2026-04-08] DECISION: Paused Osome reconciliation automation build. | REASONING: Too many upstream blockers to make meaningful progress — Airwallex MCP needs Admin API key + transfers endpoint, takhelnoa@gmail.com auth failed, n8n not yet built. Manual SOP + Osome ingestion email are in place; automation resumes when blockers are cleared. | CONTEXT: 700 transactions remaining (Dec 2024–Dec 2025), deadline end of April 2026 for Eclipse Ventures tax submission.

**Osome automation status snapshot (2026-04-08):**
- Working: SOP documented (FIN-001), skill built, Osome ingestion email confirmed (977e06fe7c21-628067@my.osome.com), noa@kravemedia.co Gmail MCP connected
- Blocked: Airwallex MCP (401 — needs Admin API key), Airwallex transfers endpoint missing from MCP, takhelnoa@gmail.com not connected
- Next actions to unblock:
  1. Noa generates Admin API key in Airwallex → Settings → Developers → replace key in .mcp.json
  2. Add `list_transfers` + `get_transfer` endpoints to mcp-servers/airwallex/index.js
  3. Set up Gmail forwarding filter in takhelnoa@gmail.com → noa@kravemedia.co
  4. Build n8n workflow: Airwallex API → confirmation letter PDF → email to Osome ingestion address

[2026-05-07] DECISION: Deleted insense-creator-outreach skill, projects/insense-creator-database, SOP, and superpowers spec/plan | REASONING: Standalone Playwright runner approach is being scrapped; will replan around Playwright MCP | CONTEXT: User decision before kicking off fresh design

[2026-05-07] DECISION: Insense outreach v2 uses Playwright MCP + two skills (insense-triage headless cron, insense-send manual CDP attach) | REASONING: Old standalone Node runner was heavy (separate project, login each run, Slack approval thread the operator skipped in practice); MCP-driven flow with operator-attached Chrome removes the auth/dedup ceremony | CONTEXT: Old projects/insense-creator-database/ deleted same day, template recovered from git. Cache + template under data/insense/, scheduling via /schedule per-campaign

[2026-05-07] DECISION: Insense outreach v3 collapsed to a single combined skill `insense-outreach` (replaces v2 split of `insense-triage` + `insense-send`) using Playwright Extension MCP attach to operator everyday Chrome | REASONING: Operator workflow is "view application, if pass send right away" — the Slack approval gate added a step the operator did not actually use, and CDP-port-9222 launcher was friction (close-all-Chrome-first). Playwright Extension lets MCP attach to normal browser; combined skill matches actual ritual; defaults to dry-run for safety | CONTEXT: Validated extraction end-to-end on Little Saints campaign 2026-05-07; 4 candidates passed filter (elevatewithdai, ricthelisouza, byeri.ugc, ugc.nonie). Selectors and regexes recovered + corrected (anchor-walk strategy not ancestor-walk; lowercase "finished deals"; value-before-Engagement-rate label)

[2026-05-07] DECISION: Insense outreach v3.1 — collapse the per-candidate walk into a single browser_evaluate with in-page async loop | REASONING: Previous per-step MCP pattern (~10 roundtrips per candidate at ~1.5s each) was the bottleneck; the page itself runs each candidate in ~5s, so per-candidate cost was 90% MCP roundtrip overhead. Single in-page evaluate eliminates that. | CONTEXT: Validated on 3 Little Saints candidates 2026-05-07 — 17s total vs ~10 min projected with old pattern (~25x). Driver still does pre-filtering (cache lookup, prev-collab block, card-ER<1% short-circuit) before passing targets to the walker. Canonical script lives in .claude/skills/insense-outreach/SKILL.md.

[2026-05-07] DECISION: insense-outreach v3.2 — added staleness guard + drawer-load retry; confirmed Insense hard-rate-limit past ~280 cards/150 sends per session | REASONING: Run 9 sends went out but with stale-drawer values cached (all FD=2), risking incorrect filter decisions. Run 10 with patched logic correctly refused all 10 stale-drawer attempts (0 false positives). Insense throttle is session-scoped — recommend ending session past 150 sends and resuming fresh next time | CONTEXT: Day 1 totals: 147 invites sent across 9 runs on Little Saints (~28% of 521 applicants). Skill canonicalized in .claude/skills/insense-outreach/SKILL.md.
