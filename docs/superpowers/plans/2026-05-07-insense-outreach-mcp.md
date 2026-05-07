# Plan: Insense Outreach v2 — Playwright MCP

**Spec:** `docs/superpowers/specs/2026-05-07-insense-outreach-mcp.md`
**Date:** 2026-05-07

Build order is bottom-up: MCP wired in first, send skill validated against a real conversation manually, triage built on top.

---

## Phase 0 — MCP wiring (no Insense yet)

1. Add `playwright` server to `.mcp.json`
2. Restart Claude Code so the MCP loads
3. Verify with a smoke check: have Claude `browser_navigate` to `https://example.com` and read the title via Playwright MCP
4. Create `scripts/launch-chrome-cdp.cmd` and document it in the SOP

**Done when:** Playwright MCP tool list is visible to Claude and a basic navigate works.

---

## Phase 1 — Data + template scaffolding

1. Create `data/insense/` with:
   - `cache.json` → `{ "creators": {} }`
   - `templates.md` → message text from spec verbatim
   - `campaigns.json` → `{ "campaigns": [] }` (operator fills as needed)
2. Add `data/insense/runs/` (gitkeep)
3. Add `data/insense/` to `.gitignore` if it shouldn't be committed (decision: cache yes-commit, runs no-commit, password never)

**Done when:** template + empty cache exist, runs dir exists, gitignore matches intent.

---

## Phase 2 — `insense-send` skill (manual, attaches to Chrome)

Reason for ordering before triage: send is the simplest path that proves Playwright MCP can do real Insense work, and it's the only path where wrong selectors actually message a real creator — easier to validate one-at-a-time first.

1. Write `.claude/skills/insense-send/SKILL.md`:
   - Trigger phrases, manual invocation, inputs (`--campaign`, usernames)
   - Step-by-step CDP attach + send recipe Claude follows
   - Selectors documented with TODO links to verify against current Insense DOM
   - Cache update format
   - Failure modes (Chrome not on 9222, conversation not found, prior Typeform URL detected)
2. Mirror `.agents/skills/insense-send/SKILL.md` with frontmatter
3. **Validation:** with a known-safe test creator (or staging campaign), do one full dry-run end-to-end. Confirm:
   - CDP attach works
   - Conversation opens
   - Template renders correctly
   - Send button click registers and Insense confirms
   - Cache updates correctly

**Done when:** one real send completes successfully and cache reflects it.

---

## Phase 3 — `insense-triage` skill (headless, scheduled)

1. Write `.claude/skills/insense-triage/SKILL.md`:
   - Trigger phrases, manual invocation, inputs (`--campaign`, `--limit`)
   - Login recipe (env password, fallback if 2FA prompt)
   - Applicant pool scrape recipe (selectors, scroll, drawer)
   - Pass/fail filter logic (3 checks + blocklist + cache lookup + Typeform scan)
   - Slack post format (parent + replies)
   - Run JSON shape
   - Cache update rules
2. Mirror `.agents/skills/insense-triage/SKILL.md`
3. **Validation:** run against one campaign manually with `--limit 5`. Confirm:
   - Login works headless
   - Drawer extraction returns sane numbers (compare against the applicant manually)
   - Filter correctly tags pass/fail/block
   - Slack post lands with correct links
   - Run JSON written
4. Schedule via `/schedule` once the manual run looks right (daily 9am ICT, one routine per tracked campaign or one routine that loops `campaigns.json`)

**Done when:** scheduled triage runs end-to-end against a real campaign and the Slack output is usable.

---

## Phase 4 — Registry + docs

1. Update `.agents/skills/claude-ea-workflows/SKILL.md`:
   - Project Skill Map: add rows for `insense-triage`, `insense-send`
   - n8n Automation Map: N/A (no n8n workflow this time — both run as Claude skills)
2. Write `references/sops/insense-outreach.md`:
   - Daily operating ritual (start Chrome with helper, glance at Slack list, run send for picks)
   - DOM-change runbook (where to find selectors, how to test)
   - Cache reset procedure
   - Re-onboarding a creator who was previously messaged
3. Append `decisions/log.md`:
   ```
   [2026-05-07] DECISION: Insense outreach v2 uses Playwright MCP + two skills (triage headless cron, send manual CDP) | REASONING: Old standalone runner was heavy; Slack approval thread added a step the operator skipped in practice | CONTEXT: Old project deleted same day, template recovered from git
   ```
4. Update `CLAUDE.md` "Repo Map" projects bullet only if needed (no new project dir this time — both skills live under `.claude/skills/`, data under `data/insense/`)

**Done when:** registry, SOP, decision log, and CLAUDE.md are aligned with the running skills.

---

## Verification Checklist (final pass)

- [ ] Playwright MCP visible in Claude tool list
- [ ] `scripts/launch-chrome-cdp.cmd` launches Chrome on port 9222
- [ ] One real `insense-send` completed and cache shows it
- [ ] One real `insense-triage` completed and Slack shows the list
- [ ] Triage scheduled and ran on cron at least once
- [ ] Skill parity present in both `.claude/skills/` and `.agents/skills/`
- [ ] SOP, registry, decision log all updated

## Open Items / Defer

- Auto-detection of new campaigns (manual `campaigns.json` for now)
- Per-creator template variants (single template for now)
- Cross-account support (single login for now)
