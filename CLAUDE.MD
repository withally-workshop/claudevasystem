# Claude EA Workspace Guide

Last updated: 2026-04-22

This repo supports Noa Takhel's executive-assistant and ops work. The main build focus right now is Krave operational automation: `n8n` workflows, Slack/Gmail triage, invoicing, reporting, SOPs, and internal tooling.

John is the human operator and systems partner.

---

## Repo Map

```text
claude-ea/
|-- .agents/skills/         # codex/agent skills (invocable from Claude AI / codex)
|-- .claude/skills/         # claude code skills (invocable from Claude Code CLI)
|-- .claude/rules/          # standing rules applied to all sessions
|-- context/                # background context and priorities
|-- decisions/log.md        # append-only decisions
|-- docs/superpowers/       # specs and plans
|-- mcp-servers/            # local MCP servers
|-- n8n-workflows/          # deploy scripts, tests, workflow docs
|-- projects/               # active projects and local demos
|-- references/sops/        # SOPs used by skills and workflows
|-- templates/              # reusable templates
|-- .mcp.json               # local MCP config
|-- CLAUDE.MD               # shared repo instructions
`-- CLAUDE.local.md         # local-only overrides
```

**Invocation parity rule:** Every skill must exist in both `.claude/skills/` (Claude Code) and `.agents/skills/` (Codex), and be registered in `.agents/skills/claude-ea-workflows/SKILL.md`. See `.claude/rules/skill-and-workflow-creation.md` for the full creation checklist.

---

## What Matters Most

### `n8n-workflows/`

This is the highest-signal area of the repo.

Current live workflow family in repo:

- `deploy-payment-detection.js`
- `deploy-invoice-reminder-cron.js`
- `deploy-weekly-invoice-summary.js`
- `deploy-eod-triage-summary.js`
- `deploy-sod-report.js`
- `deploy-inbox-triage-daily.js`
- `deploy-slack-invoice-handler.js`
- `deploy-invoice-request-intake.js`

Important supporting files:

- `README.md`
- `WORKFLOWS.md`
- `connection-integrity.test.js`
- workflow-specific test files

Current SOD contract:

- hard-stop if yesterday's EOD is missing
- hard-stop if John's morning dump is missing
- `Morning Triage` is optional; if missing, SOD still sends without inbox follow-ups

For workflow work, treat deploy scripts plus `README.md` and `WORKFLOWS.md` as the source-of-truth set that should stay aligned.

### `.claude/skills/`

Current skills on disk:

- `client-invoice-creation`
- `creator-invoice-processing`
- `eod-triage-summary`
- `inbox-triage`
- `invoice-approval-polling`
- `invoice-reminder-cron`
- `invoice-reminder-trigger`
- `osome-reconciliation`
- `ops-report`
- `payment-detection`
- `payment-detection-trigger`
- `sod-report`
- `weekly-invoice-summary`
- `weekly-review`

Important note:

- `references/sops/inbox-triage.md` is not present right now.
- For inbox triage, use the skill file as the operational source of truth until that SOP exists.

### `projects/`

Current project folders:

- `halo-home-us-expansion`
- `insense-creator-database`
- `system-automation-build-out`
- `krave-ops-showcase`

`krave-ops-showcase` is a local internal demo, not a live integrated product by default.

### `references/sops/` and `decisions/log.md`

- Keep SOPs aligned with related skills and workflow docs.
- Keep `decisions/log.md` append-only using:
  - `[YYYY-MM-DD] DECISION: ... | REASONING: ... | CONTEXT: ...`

---

## Memory

Memory is part of the operating model for this repo.

- Use memory for recurring preferences, repo conventions, and past decisions.
- Do not treat memory as fresher than the repo. If memory and files disagree, verify the current repo state.
- Re-check drift-prone details before acting on them:
  - workflow IDs
  - credentials
  - webhook paths
  - schedules
  - live production status

Good memory candidates:

- planning vs implementation preferences
- workflow behavior decisions
- push-scope rules
- local-only vs publishable artifacts
- repeated repo conventions

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
- Keep the distinction clear between:
  - looks correct
  - passed local verification
  - validated live

### Documentation Discipline

- If behavior changes, update the related docs in the same round when practical.
- Keep these aligned when they describe the same workflow behavior:
  - `.claude/skills/`
  - `references/sops/`
  - `n8n-workflows/README.md`
  - `n8n-workflows/WORKFLOWS.md`
- Use docs to record real behavior and real constraints, not idealized future-state behavior.

### Repo Hygiene

- Preserve local-only artifacts unless explicitly asked to remove, publish, or commit them.
- Be deliberate about push scope; avoid accidentally staging archives, helper files, generated artifacts, or unrelated edits.
- In a dirty worktree, do not overwrite or revert unrelated user changes.

### Quality Bar

- Favor small, understandable changes over broad rewrites unless a rewrite is clearly warranted.
- Prefer concrete operational guidance over vague style advice.
- Do not overstate maturity; keep the distinction between `working`, `useful`, `needs proof`, and `fully proven`.

---

## MCP And Context

Local MCP config exists in `.mcp.json`.

Configured server names currently include:

- `krave-airwallex`
- `google-sheets`
- `gmail-noa`
- `gmail-john`
- `slack`

Treat `.mcp.json` as sensitive local config.

The `context/` folder remains useful background:

- `me.md`
- `work.md`
- `team.md`
- `current-priorities.md`
- `goals.md`

---

## Update Checklist

When refreshing this file, check:

1. `projects/`
2. `.claude/skills/`
3. `n8n-workflows/README.md`
4. `n8n-workflows/WORKFLOWS.md`
5. `references/sops/`
6. `docs/superpowers/specs/`
7. `docs/superpowers/plans/`
8. `decisions/log.md`
