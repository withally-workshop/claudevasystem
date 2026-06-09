# Claude EA Workspace Guide

Last updated: 2026-06-10

This repo supports Noa Takhel's executive-assistant and ops work. The main build focus is Krave operational automation: `n8n` workflows, Slack/Gmail triage, invoicing, reporting, SOPs, and internal tooling.

John is the human operator and systems partner.

---

## Repo Map

```text
claude-ea/
|-- .agents/skills/         # codex/agent skills (thin pointers back to .claude/skills/)
|-- .claude/skills/         # claude code skills — source of truth for workflow instructions
|-- .claude/rules/          # standing rules applied to all sessions
|-- .claude/hooks/          # doc-sync-reminder.js (PostToolUse nudge on synced-family edits)
|-- .githooks/              # pre-commit alignment + secret checks (core.hooksPath)
|-- context/                # background context and priorities
|-- decisions/log.md        # append-only decisions
|-- docs/superpowers/       # specs and plans (historical — do not retro-edit)
|-- mcp-servers/            # local MCP servers (all creds via env, never literals)
|-- n8n-workflows/          # deploy scripts, patches, tests, workflow docs
|-- projects/               # active projects and local demos
|-- references/sops/        # SOPs used by skills and workflows
|-- templates/              # reusable templates
|-- .mcp.json               # local MCP config — SENSITIVE, gitignored
`-- CLAUDE.local.md         # local-only overrides
```

## Source-of-Truth Rules (anti-staleness)

**This file never enumerates skills, projects, workflows, or MCP servers.** Inventories drift; directories don't. To know what exists, look where it lives:

| What | Source of truth |
|------|-----------------|
| Skills | `.claude/skills/` (full logic) + `.agents/skills/` (Codex pointers) |
| Skill routing map | `.agents/skills/claude-ea-workflows/SKILL.md` |
| n8n workflows | `n8n-workflows/WORKFLOWS.md` (registry) + `README.md` (index) — verify against live instance for IDs/schedules |
| Projects | `projects/` directory |
| MCP servers | `.mcp.json` (gitignored — holds live credentials) |
| Operating decisions | `decisions/log.md` (append-only) |

**Invocation parity rule:** every skill exists in both `.claude/skills/` and `.agents/skills/`, and is registered in the routing map. The pre-commit hook checks this on every commit — fix warnings, don't bypass them.

**Timezone:** canonical zone is **Asia/Manila (PHT, UTC+8)** for all docs, schedules, prompts, and workflow code. Never use ICT/GMT+7 or SGT labels. n8n crons are written in Asia/Manila local time (workflow `settings.timezone`), not UTC.

**Secrets:** live only in `.env` and `.mcp.json` (both gitignored). All code reads `process.env`. Never put credentials in `.claude/settings.json`, deploy scripts, or any committed file — the pre-commit hook blocks known token patterns. (History lesson: an Airwallex key was committed and publicly exposed Apr–Jun 2026; rotated 2026-06-10.)

---

## n8n Workflows

The highest-signal area of the repo. For workflow work, treat deploy scripts plus `README.md` and `WORKFLOWS.md` as the source-of-truth set that must stay aligned. One-off live fixes are `patch-*.js` scripts (kept for audit trail); local-only state snapshots live in `snapshots/` (gitignored).

Current SOD contract:

- hard-stop if yesterday's EOD is missing
- John's morning dump is **optional** — if missing, fall back to EOD carry-overs + live Gmail/Slack scan (see Step 1b in the skill); do NOT hard-stop
- `Morning Triage` is optional; if missing, SOD still sends without inbox follow-ups

---

## Memory

Memory is part of the operating model for this repo.

- Use memory for recurring preferences, repo conventions, and past decisions.
- Do not treat memory as fresher than the repo. If memory and files disagree, verify the current repo state.
- Re-check drift-prone details before acting on them: workflow IDs, credentials, webhook paths, schedules, live production status.

Good memory candidates: planning vs implementation preferences, workflow behavior decisions, push-scope rules, local-only vs publishable artifacts, repeated repo conventions.

Memory + repo files + decision log should reinforce each other.

---

## Engineering Rules

### Scope And Reuse

- Before creating a new workflow, project, skill, or doc, check whether an existing one already covers part of the need.
- Extend existing systems when the boundary is still clear; create new files only when the separation is real.
- Keep planning artifacts in `docs/superpowers/` and shipped implementation in the relevant source area.

### Build With Repo Reality

- Prefer repo-specific rules over generic best practices when they conflict.
- Match the style and operating pattern of the area you are editing.
- For local showcase or internal demo work, prefer static/local-first solutions unless live integration is explicitly requested.
- For workflow work, treat deploy scripts and workflow docs as an implementation pair.

### Testing And Verification

- Add or update tests when changing workflow logic, parsers, connections, or behavior contracts.
- Run the smallest useful verification first, then broader checks as needed.
- Do not claim something is working, live, or pushed without verification.
- Keep the distinction clear between: looks correct / passed local verification / validated live.

### Documentation Discipline

- If behavior changes, update the related docs in the same round — see `.claude/rules/cross-cutting-fixes.md` for the synced-file table.
- Use docs to record real behavior and real constraints, not idealized future-state behavior.
- Date-stamp this file's "Last updated" line whenever you edit it.

### Repo Hygiene

- Preserve local-only artifacts unless explicitly asked to remove, publish, or commit them.
- Be deliberate about push scope; avoid accidentally staging archives, helper files, generated artifacts, or unrelated edits.
- In a dirty worktree, do not overwrite or revert unrelated user changes.
- Push only to the `github` remote (private). Never push to `origin` (withally-workshop) without explicit confirmation.

### Quality Bar

- Favor small, understandable changes over broad rewrites unless a rewrite is clearly warranted.
- Prefer concrete operational guidance over vague style advice.
- Do not overstate maturity; keep the distinction between `working`, `useful`, `needs proof`, and `fully proven`.

---

## Context

The `context/` folder holds background: `me.md`, `work.md`, `team.md`, `current-priorities.md`, `goals.md`. If `current-priorities.md` disagrees with recent `decisions/log.md` entries, the decision log wins — and update the priorities file.

---

## Update Checklist

When refreshing this file: verify the Repo Map matches the directory tree, the Source-of-Truth table paths still exist, and the SOD contract matches `.claude/skills/sod-report/SKILL.md`. Do NOT add inventories of skills/projects/workflows — that is what the source-of-truth table is for.
