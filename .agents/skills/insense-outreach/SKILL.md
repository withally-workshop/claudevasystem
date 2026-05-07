---
name: insense-outreach
description: Use when the operator wants to walk an Insense campaign's applicant pool, apply a pass/fail filter, and send the templated invite to passing creators in one combined pass. Triggers include "run insense outreach", "insense outreach", "/insense-outreach". Attaches to the operator's everyday Chrome via Playwright Extension. Defaults to dry-run; pass `--send` to actually message.
metadata:
  short-description: Walk Insense applicants and send invites in one pass
---

# Insense Outreach

One combined pass: walk one campaign's applicants, drawer-check each against pass/fail filter + blocklist + cross-campaign cache, and message passing creators immediately. No Slack approval gate. Slack gets a final summary log.

**Defaults to dry-run.** Pass `--send` for real outreach.

---

## Trigger

**Manual:** "run insense outreach", "/insense-outreach"
**Scheduled:** via `/schedule` per campaign, daily at 09:00 PHT (recommended only after a manual `--dry-run` validates the run)
**Inputs:** `--campaign "<Name>"` (required), `--limit N` (default 25), `--send` (default off)

---

## Execution

For full step-by-step logic, DOM selectors (validated 2026-05-07), filter rules, drawer extraction recipe, send recipe, run JSON shape, Slack format, and failure handling, read the Claude Code skill:

`.claude/skills/insense-outreach/SKILL.md`

Key references:
- Cache: `data/insense/cache.json`
- Template: `data/insense/templates.md`
- Run audit: `data/insense/runs/<campaign-slug>-<iso>.json`
- Spec: `docs/superpowers/specs/2026-05-07-insense-outreach-mcp.md`

---

## Output

Slack summary to `#airwallexdrafts` (`C0AQZGJDR38`) using the bot token: walked / passed / sent / skipped / failed / blocked counts, plus per-creator detail.
