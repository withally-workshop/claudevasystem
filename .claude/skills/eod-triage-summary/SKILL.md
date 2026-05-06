# Skill: EOD Triage Summary

**Purpose:** Generate Noa's daily End-of-Day Triage Summary — a clean Slack DM (and #airwallexdrafts archive) consolidating everything handled during the day.

**Automated:** Runs **Monday–Friday at 6:00 PM Asia/Manila (UTC+8)** via scheduled remote Claude Code agent (trigger ID: `trig_015YZhdGzPQNotUAruRVtSTg`). Sends to Noa's DM and posts a copy to `#airwallexdrafts` for SOD carry-over reference.

**Manual invoke:** "EOD summary", "today's wrap-up", "/eod-triage-summary", or off-schedule testing.

**Delivery account:** John's personal Slack OAuth — use `mcp__claude_ai_Slack__slack_send_message`, NOT `mcp__slack__slack_post_message` (bot token). Same pattern as SOD report.

---

## Operator Input (Daily)

Post task updates to `#airwallexdrafts` throughout the day as things happen — completed tasks, blockers, decisions made. No specific format required. The agent reads everything at 6 PM and synthesizes it.

---

## Data Sources

| Channel | ID | Used for |
|---|---|---|
| `#airwallexdrafts` | `C0AQZGJDR38` | **Primary** — John's daily task dump + bot invoice drafts + inbox triage reports |
| `#ad-production-internal` | `C0AGEM919QV` | IM8 ad production updates, Frame.io status, blockers |
| `#payments-invoices-updates` | `C09HN2EBPR7` | Invoice requests, payment confirmations |

**Today-only filter:** Discard any message before midnight today in Asia/Manila (UTC+8). Do not surface old content.

---

## Instructions

### Step 0 — Pull Slack context

For each channel, call `mcp__claude_ai_Slack__slack_read_channel` with `limit: 50`. Filter to messages with `ts >= today_start_epoch` where `today_start_epoch` is midnight today in Asia/Manila.

### Step 1 — Categorize

| Bucket | Criteria |
|---|---|
| Completed from Focus Goals | Done, resolved, sent, closed |
| Not Completed / Needs More Work / Planned Next Steps | Unfinished, rolling to tomorrow; apply 3-and-1 for decisions |
| Blocker / Input Needed | Waiting on Noa, client, or third party — always name who/what |
| FYIs | Noa should know, no action needed |

Skip system messages (channel joins/leaves), bot heartbeats, and digests with no unique payload (e.g., "Invoice Reminder Digest" with zero new lines).

### Step 2 — Format the message (Slack mrkdwn)

**CRITICAL — Slack mrkdwn, NOT standard Markdown:**
- Bold: single asterisks `*bold*` (NOT `**bold**`)
- Italic: underscores `_italic_` (NOT `*italic*`)
- Bullets: bullet character `•` followed by a space (NOT `-` or `*`)
- No `###` headers — Slack ignores them. Use `*bold*` for section titles.
- Never use `**double asterisks**` — they render as literal asterisks.

Use this exact template:

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

Rules:
- Bullets only. No paragraphs. No filler.
- Flag time-sensitive items with `[URGENT]` or include deadline inline.
- Group by business (Krave / IM8 / Halo Home / Skyvane) only if multi-business and grouping aids clarity.
- Omit any section with zero items.
- Use `_italic_` for category headlines inside a bullet; `*bold*` for section titles only.
- Use only the validated Slack inputs — do not invent tasks or deadlines.

### Step 3 — Send via John's personal Slack

Post the same message to BOTH destinations using `mcp__claude_ai_Slack__slack_send_message`:

1. **Noa's DM:** `channel_id: U06TBGX9L93`
2. **#airwallexdrafts archive:** `channel_id: C0AQZGJDR38`

**Critical formatting rules for the send:**
- Do NOT append `*Sent using* Claude` or any attribution footer. Message must end exactly with the last bullet.
- The `text` parameter must contain ONLY the formatted summary — no preamble, postscript, or explanation.

Confirm `ts` returned from each send. If a send fails, output the formatted message for manual copy-paste and report which destination failed.

### Step 4 — Quiet day handling

If there are zero actionable items across all four buckets, still send a short summary:

```
*🏁 Today's Wrap-up — [Day, Date]*

Quiet day — no notable activity logged in the operating channels.
```

Send to both destinations as in Step 3.

---

## Scheduling

- **Schedule:** Monday–Friday 6:00 PM Asia/Manila (UTC+8)
- **Cron expression:** `0 10 * * 1-5` (UTC = 6 PM Asia/Manila)
- **Trigger ID:** `trig_015YZhdGzPQNotUAruRVtSTg`
- Runs as a scheduled remote Claude Code agent. NOT an n8n workflow.
