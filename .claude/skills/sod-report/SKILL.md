# Skill: Start of Day Report

**Purpose:** Generate Noa's daily Start of Day Report from validated Slack inputs — yesterday's EOD carry-over, John's morning goals dump, and, when available, today's `Morning Triage` — then post the finished report to `#airwallexdrafts`.

**Automated:** Runs **Monday–Friday at 10:00 AM PHT** via scheduled Claude cron (trigger ID: `trig_019phkzu3nmSJnVHqHVn4wRZ`). Also invocable manually: "run sod report", "/sod-report".

**Hard-stop rule:** If yesterday's EOD or John's morning dump is missing, post an alert to `#airwallexdrafts` and stop. Do not send a partial report.

---

## Operator Input

Post your focus goals and context for the day to `#airwallexdrafts` before 10 AM. No specific format required — dump what you're focusing on, any blockers you're aware of, and anything you want Noa to know about your day's priorities.

---

## Data Sources

| Source | What it provides | Required? |
|---|---|---|
| `#airwallexdrafts` — yesterday's EOD bot message | Carry-over from Yesterday + unresolved Blockers | **Mandatory** |
| `#airwallexdrafts` — John's posts from today | Focus Goals + new Blockers | **Mandatory** |
| `#airwallexdrafts` — today's `Morning Triage` bot message | BAU / Follow-ups from Inbox Triage Daily, plus inbox items that stayed `EA/Unsure` | Optional |
| Client Invoice Tracker (Google Sheets) | Verify blocker invoices are still open before flagging | **Mandatory for invoice blockers** |

---

## Instructions

### Step 0 — Pull #airwallexdrafts

Use `mcp__slack__slack_get_channel_history` with `channel_id: C0AQZGJDR38`, limit: 100.

Split messages into three groups:

**Group A — Last business day's EOD** (bot message from the most recent weekday containing "Today's Wrap-up")
- On Monday (or after any holiday gap), look back to Friday — not Sunday.
- Scan back through channel history until you find a message containing "Today's Wrap-up". Stop at the first match. Do not use messages from today.
- Extract `Not Completed / Needs More Work / Planned Next Steps` → **Carry-over from Yesterday**
- Extract `Blocker / Input Needed` → carry forward only if still unresolved (verify invoice blockers against the Client Invoice Tracker — see Step 0a)

**Group B — John's morning dump** (messages from `U0AM5EGRVTP` posted today before the run)
- Use for **Focus Goals** and any additional **Blocker / Input Needed**
- Classify each bullet line by keyword:
  - "blocker", "waiting on", "need from" → Blockers
  - "focus", "goal", "priority", "today", "must", "follow up" → Focus Goals
  - Anything else → Notes (→ BAU)

**Group C — Today's inbox triage summary** (bot message from today containing "Morning Triage")
- Use for **BAU / Follow-ups (Business As Usual)**
- Pull forward any `Review These` items as candidate blockers or follow-ups when they still need human judgment

All date filtering uses **Asia/Manila timezone (PHT, UTC+8)**. "Yesterday" means last business day — on Monday, that is Friday.

### Step 0a — Verify invoice blockers against Client Invoice Tracker

Before carrying any invoice blocker forward from the EOD, check its current status in the tracker.

```
mcp__google-sheets__sheets_get_rows
  spreadsheet_id: 1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50
  sheet_name: Invoices
  range: A:R
```

For each invoice mentioned in the EOD's `Blocker / Input Needed` section:
- Match by invoice ID (Col F) or client name (Col B)
- Check the status column — if the invoice is marked `Paid`, `Finalized`, `Sent`, or otherwise resolved → **drop it from the SOD blockers**
- Only carry forward invoices that are still in an open/pending/overdue state

If the tracker is unavailable, carry forward all EOD blockers as-is and note `_(invoice status unverified)_` inline.

### Step 1 — Validate required inputs

These sources are mandatory:
- Last business day's EOD containing `Today's Wrap-up` (scan back through history — do not limit to strict "yesterday")
- John's same-day morning dump (at least one message from `U0AM5EGRVTP` today)

If either required source is missing → post alert to `#airwallexdrafts` (`C0AQZGJDR38`) and stop. Do not draft or send a partial SOD report.

`Morning Triage` is optional. If missing, continue and omit inbox-triage follow-ups from the report.

### Step 2 — Format the message (Slack mrkdwn)

**CRITICAL — Slack mrkdwn, NOT standard Markdown:**
- Bold: single asterisks `*bold*` (NOT `**bold**`)
- Italic: underscores `_italic_` (NOT `*italic*`)
- Bullets: bullet character `•` followed by a space (NOT `-` or `*`)
- No `###` headers — Slack ignores them. Use `*bold*` for section titles.
- Never use `**double asterisks**` — they render as literal asterisks.

Use this exact template:

```
*Today's Goals*

*Focus Goals*
• _Category headline_ — description from John's morning dump.
• _Another category_ — description.

*Carry-over from Yesterday*
• item from yesterday's EOD (omit entire section if empty)

*Blocker / Input Needed*
• _Topic_ — what's blocked and waiting on whom.

*BAU / Follow-ups (Business As Usual)*
• recurring item.
```

Rules:
- Bullets only. No paragraphs. No filler.
- Flag time-sensitive items with `[URGENT]` or include deadline inline.
- Group by business only if multi-business.
- Omit any section with zero items.
- Use only the validated Slack inputs — do not invent tasks or deadlines.
- Use `_italic_` for category headlines inside a bullet; `*bold*` for section titles only.

### Step 3 — Send via Slack MCP

Post to `#airwallexdrafts` only:
- `mcp__slack__slack_post_message` with `channel_id: C0AQZGJDR38`

Confirm `ts` returned — confirms delivery. If send fails, output the formatted message for manual send.

---

## Scheduling

- **Schedule:** Monday–Friday 10:00 AM PHT (Asia/Manila, UTC+8)
- **Cron expression:** `0 10 * * 1-5` in Asia/Manila timezone
- **Registered via:** `/schedule` skill — prompt: `Run /sod-report`
- **Trigger ID:** `trig_019phkzu3nmSJnVHqHVn4wRZ`
