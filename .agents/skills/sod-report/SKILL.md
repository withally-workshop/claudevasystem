---
name: sod-report
description: Use when Codex needs to generate and post Noa's Start of Day Report to #ops-command. Triggers include "run sod report", "sod report", "/sod-report", "start of day report", "morning report", or "post today's goals".
metadata:
  short-description: Post daily SOD report to Slack
---

# Skill: Start of Day Report

Generate Noa's daily Start of Day Report from validated Slack inputs and post it to `#ops-command`.

See the full skill spec at `.claude/skills/sod-report/SKILL.md` — that file is the source of truth for logic, output format, and hard-stop rules.

## Trigger

- Manual: "run sod report", "/sod-report", "start of day report"
- Automated: CCR routine `trig_019phkzu3nmSJnVHqHVn4wRZ`, runs Mon–Fri 10:00 AM PHT

## What It Does

1. Pulls `#ops-command` history (channel `C0AQZGJDR38`, limit 100)
2. Finds last business day's EOD (message containing "Today's Wrap-up" — on Monday looks back to Friday) — **hard-stop if missing**
3. Finds John's morning dump posted today (user `U0AM5EGRVTP`) — **optional**
4. If no morning dump: falls back to (a) carrying yesterday's uncompleted goals as today's focus, (b) scanning unread Gmail, (c) scanning key Slack channels for open action items
5. Optionally finds today's Morning Triage bot message
6. Formats and posts the SOD report to `#ops-command`

## Key IDs

| Item | Value |
|---|---|
| Channel | `#ops-command` — `C0AQZGJDR38` |
| John's Slack user | `U0AM5EGRVTP` |
| Routine ID | `trig_019phkzu3nmSJnVHqHVn4wRZ` |
| Slack post tool | `mcp__slack__slack_post_message` |
