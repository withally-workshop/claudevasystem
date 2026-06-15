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
3. Read pre-classified triage labels via `label:` searches — `EA/Urgent` + `EA/Needs-Reply` (attention) and `EA/FYI` (FYI). Morning Coffee is Noa's single email surface: attention **and** FYI. (`label:` search finds FYI even though triage now archives it.)
4. Bucket: attention items (urgent first, then needs-reply, top 5–7) and a separate compact FYI section (one-liners, capped 5). Exclude internal `@kravemedia.co` and ClickUp mail.
5. Project Pulse: ClickUp status changes via a **direct Gmail query** `from:notifications@tasks.clickup.com newer_than:1d` — NOT the label buckets (ClickUp mail is `EA/Auto-Sorted` + archived, so it never lands in the buckets; the direct query was the fix for a week of empty Project Pulse).
6. Pull `#ad-production-internal` and `#payments-invoices-updates` history via bot MCP (channels Noa's own token can't see)
7. Broaden Slack: via `slack-noa`, scan all `is_member && !is_archived` channels (drop the `is_dormant` filter and the stale priority list) ranked by recent activity, cap 20, surface `@Noa` mentions / direct asks / untouched blockers
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
| Calendar source | `mcp__claude_ai_Google_Calendar__list_events` (primary, confirmed 2026-05-11); email fallback on error |
| Noa Slack token MCP | `slack-noa` (personal user token — configured in `.mcp.json`) |
| Delivery method | `mcp__claude_ai_Slack__slack_send_message` with `channel_id: U06TBGX9L93`, `message:` param (John's personal OAuth — not bot token) |
| Schedule | Local Task Scheduler `KraveEA-MorningCoffee` — weekly Mon–Fri 10:00 AM Asia/Manila |
| Claude Code skill | `.claude/skills/morning-coffee/SKILL.md` |

---

## Output

A Slack DM to Noa with up to five sections (omit any with no data; FYI is a compact one-line-per-item section that always sits below "Needs Your Attention"):

```
Good morning Noa ☀️

Here's your Morning Coffee for [Day, Date]:

*📅 Today's Calendar*
- [HH:MM] — [Event Title] with [Person]

*📬 Email — Needs Your Attention*
- [Sender] | [Subject] — [1-line context] [URGENT if applicable]

*📥 Just So You Know (FYI)*
- [Sender] | [Subject] — [one-line, no action needed]

*📁 Project Pulse*
- [N] tasks advanced
- Notable: [Project] — [Old Status] → [New Status]

*💬 Slack — Open Threads*
- [Person] DM'd you about [topic]
- @Noa mentioned in #[channel]: [1-line context]

_Deep work starts at 1:30 PM — have a good one._
```

**Note:** the claude.ai Slack connector auto-appends a `*Sent using* Claude` footer to messages sent via `mcp__claude_ai_Slack__slack_send_message`. It is injected by the platform after the message text and cannot be removed from within this skill — this is expected, not a failure.

---

## Failure Handling

- Gmail unavailable: send with available sections; append `_(email data unavailable today)_`
- Calendar unavailable: omit section silently
- `slack-noa` unavailable: omit DMs sub-section silently; channel highlights can still appear
- All sources down: do not send empty briefing; report the failure
- Never send on behalf of Noa; never draft replies
