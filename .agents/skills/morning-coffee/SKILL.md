---
name: morning-coffee
description: Use when Codex needs to generate or send Noa's Morning Coffee daily personal briefing. Triggers include "morning coffee", "run morning coffee", "send morning briefing", "Noa's morning briefing", "/morning-coffee", "what's on for Noa today". Pulls Noa's Gmail, today's calendar, ClickUp project pulse, key Slack channel highlights, and Noa's personal Slack DMs and mentions, then sends a warm personal DM from John to Noa at 10 AM PHT weekdays.
metadata:
  short-description: Send Noa's personal morning briefing DM
---

# Morning Coffee

Generate and send Noa's personal daily morning briefing as a Slack DM appearing to come from John.

**This skill runs locally via Windows Task Scheduler — not as a remote CCR routine and not as an n8n workflow.** The local-only MCP servers `gmail-noa` and `slack-noa` are required. _(As of 2026-06-18 the `slack` bot token is no longer used here — Step 4 removed; DM read/send use `claude_ai_Slack`. The bot MCP is still needed by other skills.)_

---

## Trigger

**Local Task Scheduler:** `KraveEA-MorningCoffee` — weekly Mon–Fri at 10:00 AM (Asia/Manila system time)
**Command:** `claude -p "/morning-coffee" --dangerously-skip-permissions` (working dir: `c:\Users\jopso\Desktop\claude-ea`)
**Manual:** "morning coffee", "run morning coffee", "/morning-coffee"

**Scope:** Gmail from the last 24h (classified by content, not read status) and new-since-last-run Slack activity; already-reacted messages are excluded.

**Personal-scope boundary (purely personal):** Morning Coffee covers Noa's *personal* day — calendar, human correspondence needing her reply, project/creative pulse, her own tasks, personal Slack mentions. It does **not** carry ops/finance (invoice approvals, payment receipts/confirmations, overdue alerts, AR/AP) — those are owned by the SOD report, which runs at the same 10 AM PHT. This split stops Noa seeing the same invoice/blocker in both briefings.

---

## Execution

For full step-by-step logic, read the Claude Code skill:

`.claude/skills/morning-coffee/SKILL.md`

Summary of execution order:
1. Resolve today's date in PHT (UTC+8)
1b. **Load carry-over state** from `.claude/skills/morning-coffee/state.json` (`open_tasks` + `open_replies`, each with `first_seen`). Missing/unreadable → treat as empty, never block the briefing.
2. Pull Noa's Google Calendar events for today
3. Read pre-classified triage labels via `label:` searches — `EA/Urgent` + `EA/Needs-Reply` (attention) and `EA/FYI` (FYI). Morning Coffee is Noa's single email surface: attention **and** FYI. (`label:` search finds FYI even though triage now archives it.)
4. Bucket: attention items (urgent first, then needs-reply, top 5–7) and a separate compact FYI section (one-liners, capped 5). Exclude internal `@kravemedia.co`, ClickUp mail, **and ops/finance mail (invoice/payment/overdue receipts — defer to SOD)**. Tag carried needs-reply emails `⏳ since [Day]`.
5. Project Pulse: ClickUp status changes via a **direct Gmail query** `from:notifications@tasks.clickup.com newer_than:1d` — NOT the label buckets (ClickUp mail is `EA/Auto-Sorted` + archived, so it never lands in the buckets; the direct query was the fix for a week of empty Project Pulse).
6. _(removed 2026-06-18)_ The bot-token channel scan is gone. `#payments-invoices-updates` → ops/finance (SOD); `#ad-production-internal` → IM8-ended + near-zero personal yield at high token cost. No bot-only channels are scanned now; skill no longer uses the `slack` bot MCP.
7. Broaden Slack: via `slack-noa`, take `is_member && !is_archived` channels, then **exclude bot-fed/broadcast channels** (`*-reporting` / `*-adreporting` / `*-updates`, `halo-home-shopify`, `general`/`random`/`emojis`/`inboundleads`/`automation-wishlist`/`freelanceleadspro-updates`, and `num_members >= 25`). Rank the rest (Tier A = `krave-x-`/`int-`/`creator`/`noa*` + small ≤4-member groups; Tier B by `updated`), **cap 10** (limit 10/channel, down from 20×15), surface `@Noa` mentions / direct asks / untouched human blockers, and skip channels whose 24h messages are all bot posts. Append per-run `{scanned, yielded}` to `scan-stats.jsonl` — after ~10 runs, cut never-yielding channels into the exclusion list (the 2026-06-18 cost-trim).
7b. Extract tasks from the John↔Noa DM and **reconcile against carried `open_tasks`**: completed → drop (optional `✅ Closed` line); still open → surface tagged `↳ from [Day] — still open?`; new → surface normally.
8. Compose warm personal briefing using the output template; build the `☕ Top of mind` one-line synthesis **last**.
9. Send via `mcp__claude_ai_Slack__slack_send_message` to `U06TBGX9L93` (appears from John personally)
10. **Persist state**: overwrite `state.json` with still-open tasks + unreplied emails (preserve `first_seen`). Local-only, gitignored — never commit.

---

## Key Data

| Item | Value |
|------|-------|
| Noa Slack ID | `U06TBGX9L93` |
| Gmail account | `noa@kravemedia.co` |
| Bot-token channels | None as of 2026-06-18 — `#ad-production-internal` (`C0AGEM919QV`) + `#payments-invoices-updates` (`C09HN2EBPR7`) both dropped (IM8-ended / ops→SOD); Step 4 removed |
| Carry-over state | `.claude/skills/morning-coffee/state.json` (local, gitignored) — open tasks + unreplied emails across runs |
| Slack scan stats | `.claude/skills/morning-coffee/scan-stats.jsonl` (local, gitignored) — per-run scan/yield log to cut Step 5 to a proven allowlist |
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

☕ *Top of mind:* [one-sentence synthesis — the single most important thing today]

Here's your Morning Coffee for [Day, Date]:

*📅 Today's Calendar*
- [HH:MM] — [Event Title] with [Person]

*📬 Email — Needs Your Attention*
- [Sender] | [Subject] — [1-line context] [URGENT if applicable] [⏳ since [Day] if carried]

*📥 Just So You Know (FYI)*
- [Sender] | [Subject] — [one-line, no action needed]

*📁 Project Pulse*
- [N] tasks advanced
- Notable: [Project] — [Old Status] → [New Status]

*💬 Slack — Open Threads*
- [Person] DM'd you about [topic]
- @Noa mentioned in #[channel]: [1-line context]

*✅ Tasks*
- [New task]
- [Carried task] ↳ from [Day] — still open?

_Deep work starts at 1:30 PM — have a good one._
```

`☕ Top of mind` is always present; every other section is omitted when it has no data.

**Note:** the claude.ai Slack connector auto-appends a `*Sent using* Claude` footer to messages sent via `mcp__claude_ai_Slack__slack_send_message`. It is injected by the platform after the message text and cannot be removed from within this skill — this is expected, not a failure.

---

## Failure Handling

- Gmail unavailable: send with available sections; append `_(email data unavailable today)_`
- Calendar unavailable: omit section silently
- `slack-noa` unavailable: omit DMs sub-section silently; channel highlights can still appear
- All sources down: do not send empty briefing; report the failure
- Never send on behalf of Noa; never draft replies
