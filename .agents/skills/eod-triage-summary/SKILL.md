---
name: eod-triage-summary
description: Use when Codex needs to generate the daily End-of-Day Triage Summary. Triggers include "/eod-triage-summary", "EOD summary", "today's wrap-up", "end of day summary". Reads #ops-command and #payments-invoices-updates for today's activity, categorizes into Completed / Not Completed / Blockers / FYIs, and posts a formatted summary to #ops-command via the bot.
metadata:
  short-description: Generate and post EOD triage summary
---

# EOD Triage Summary

Generate the daily End-of-Day Triage Summary and post it to `#ops-command`. Runs automatically Monday–Friday at 6:00 PM Asia/Manila.

## How to Trigger

**Automated:** Scheduled remote Claude Code agent — Monday–Friday 6:00 PM Asia/Manila (UTC+8). Trigger ID: `trig_015YZhdGzPQNotUAruRVtSTg`.

**Manual:** "EOD summary", "today's wrap-up", "/eod-triage-summary"

## Key References

- **Full skill:** `.claude/skills/eod-triage-summary/SKILL.md`
- **Post to:** `#ops-command` (C0AQZGJDR38) via `mcp__slack__slack_post_message`
- **Data sources:** `#ops-command` (C0AQZGJDR38) + `#payments-invoices-updates` (C09HN2EBPR7)
- **Today-only filter:** discard messages before midnight Asia/Manila (UTC+8)

## What It Does

1. Reads both channels (limit 50), filters to today only
2. Categorizes into four buckets: Completed / Not Completed / Blockers / FYIs
3. Formats using Slack mrkdwn (`*bold*`, `•` bullets — never `**` or `-`)
4. Posts to `#ops-command` — no attribution footer, no preamble

## Output Template

```
*🏁 Today's Wrap-up — [Day, Date]*

*✅ Completed from Focus Goals*
• [item]

*🚧 Not Completed / Needs More Work / Planned Next Steps*
• [item]

*🔎 Blocker / Input Needed*
• [item] — waiting on [who/what]

*↔️ FYIs*
• [item]
```

Omit sections with zero items. If no activity: post "Quiet day — no notable activity logged."
