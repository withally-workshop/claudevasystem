---
name: morning-coffee
description: Use when Codex needs to generate or send Noa's Morning Coffee daily personal briefing. Triggers include "morning coffee", "run morning coffee", "send morning briefing", "Noa's morning briefing", "/morning-coffee", "what's on for Noa today". Pulls Noa's Gmail, today's calendar, ClickUp project pulse, key Slack channel highlights, and Noa's personal Slack DMs and mentions, then sends a warm personal DM from John to Noa at 10 AM PHT weekdays.
metadata:
  short-description: Send Noa's personal morning briefing DM
---

# Morning Coffee

Generate and send Noa's personal daily morning briefing as a Slack DM appearing to come from John.

**This skill runs locally via Windows Task Scheduler — not as a remote CCR routine and not as an n8n workflow.** The local-only MCP servers (`gmail-noa`, `slack-noa`, `slack`) are required.

---

## Trigger

**Local Task Scheduler:** `KraveEA-MorningCoffee` — weekly Mon–Fri at 10:00 AM (Asia/Manila system time)
**Command:** `claude -p "/morning-coffee" --dangerously-skip-permissions` (working dir: `c:\Users\jopso\Desktop\claude-ea`)
**Manual:** "morning coffee", "run morning coffee", "/morning-coffee"

**Scope:** Only unread Gmail (`is:unread`) and new-since-last-run Slack activity. Already-read mail and already-reacted messages are excluded.

---

## Execution

For full step-by-step logic, read the Claude Code skill:

`.claude/skills/morning-coffee/SKILL.md`

Summary of execution order:
1. Resolve today's date in PHT (UTC+8)
2. Pull Noa's Google Calendar events for today
3. Scan `noa@kravemedia.co` Gmail — last 24h inbox; split into `clickup_emails` and `candidate_emails`
4. Filter candidates: include clients/partners needing reply, contracts, billing alerts, opportunities; exclude noise
5. Aggregate ClickUp notifications into Project Pulse (tasks closed, status moves, stuck signals)
6. Pull `#ad-production-internal` and `#payments-invoices-updates` channel history (last 24h) via bot MCP
7. Pull Noa's Slack DMs and `@Noa` mentions via `slack-noa` user token
8. Compose warm personal briefing using the output template
9. Send via `mcp__claude_ai_Slack__slack_send_message` to `U06TBGX9L93` (appears from John personally)

---

## Key Data

| Item | Value |
|------|-------|
| Noa Slack ID | `U06TBGX9L93` |
| Gmail account | `noa@kravemedia.co` |
| Key channels | `#ad-production-internal` (`C0AGEM919QV`), `#payments-invoices-updates` (`C09HN2EBPR7`) |
| ClickUp sender | `notifications@tasks.clickup.com` |
| Noa Slack token MCP | `slack-noa` (personal user token — configured in `.mcp.json`) |
| Delivery method | `mcp__claude_ai_Slack__slack_send_message` (John's personal OAuth — not bot token) |
| Schedule | Local Task Scheduler `KraveEA-MorningCoffee` — weekly Mon–Fri 10:00 AM Asia/Manila |
| Claude Code skill | `.claude/skills/morning-coffee/SKILL.md` |

---

## Output

A Slack DM to Noa with up to four sections (omit any with no data):

```
Good morning Noa ☀️

Here's your Morning Coffee for [Day, Date]:

*📅 Today's Calendar*
- [HH:MM] — [Event Title] with [Person]

*📬 Email — Needs Your Attention*
- [Sender] | [Subject] — [1-line context] [URGENT if applicable]

*📁 Project Pulse*
- [N] tasks advanced
- Notable: [Project] — [Old Status] → [New Status]

*💬 Slack — Open Threads*
- [Person] DM'd you about [topic]
- @Noa mentioned in #[channel]: [1-line context]

_Deep work starts at 1:30 PM — have a good one._
```

---

## Failure Handling

- Gmail unavailable: send with available sections; append `_(email data unavailable today)_`
- Calendar unavailable: omit section silently
- `slack-noa` unavailable: omit DMs sub-section silently; channel highlights can still appear
- All sources down: do not send empty briefing; report the failure
- Never send on behalf of Noa; never draft replies
