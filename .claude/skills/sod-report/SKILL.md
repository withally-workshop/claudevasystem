# Skill: Start of Day Report

**Purpose:** Generate Noa's daily Start of Day Report — pulls carry-overs from yesterday's EOD + John's morning goals dump, sends to Noa's DM before her day begins.

**Automated:** Runs **Monday–Friday at 9:00 AM GMT+8** via the hourly invoice trigger (trigger ID: `trig_0175RPhNgA1HaPH5w34W3QdN`, UTC hour 01 routing). Sends directly to Noa's DM. No confirmation step.

**Manual invoke:** Use this skill for off-schedule runs or if the automated send failed.

---

## Operator Input (Daily — by 9:00 AM GMT+8)

Post your focus goals and context for the day to `#airwallexdrafts` before 9 AM GMT+8. No specific format required — just dump what you're focusing on, any blockers you're aware of, and anything you want Noa to know about your day's priorities.

The agent reads your post + yesterday's EOD carry-overs and builds the report automatically.

---

## Data Sources

| Source | What it provides |
|---|---|
| `#airwallexdrafts` — yesterday's EOD bot message | Carry-over from Yesterday + unresolved Blockers |
| `#airwallexdrafts` — John's posts from today (before 9 AM) | Focus Goals + new Blockers |

---

## Instructions (Manual Invoke)

### Step 0 — Pull #airwallexdrafts

Use `mcp__slack__slack_get_channel_history` with `channel_id: C0AQZGJDR38`, limit: 100.

Split messages into two groups:

**Group A — Yesterday's EOD** (bot message from yesterday containing "Today's Wrap-up")
- Extract `Not Completed / Needs More Work / Planned Next Steps` → **Carry-over from Yesterday**
- Extract `Blocker / Input Needed` → carry forward only if still unresolved

**Group B — John's morning dump** (messages from `U0AM5EGRVTP` posted today before 9 AM GMT+8)
- Use for **Focus Goals** and any additional **Blocker / Input Needed**

### Step 1 — Collect additional context (manual only)

Ask: "Anything to add before I send? (Focus goals, blockers, priorities not yet posted in #airwallexdrafts)" If nothing to add, proceed.

### Step 2 — Format the message

Use this exact template:

```
### ✍️ Today's Goals

**Focus Goals**
- [from John's morning dump]

**Carry-over from Yesterday**
- [from yesterday's EOD Not Completed section — omit if none]

**Blocker / Input Needed**
- [from John's dump + unresolved yesterday blockers]

**BAU / Follow-ups (Business As Usual)**
- [recurring ops inferred from context: pending invoices, IM8 agency check-ins, etc.]
```

Rules:
- Bullets only. No paragraphs. No filler.
- Flag time-sensitive items with `[URGENT]` or include deadline inline.
- Group by business only if multi-business.
- Omit any section with zero items.
- If John posted no morning dump: note `John's morning goals not yet posted — carry-overs only.`
- If no yesterday EOD found: note `No EOD data from yesterday.`

### Step 3 — Send via Slack MCP

Send to both recipients:
- **Noa's DM:** `mcp__slack__slack_post_message` with `channel_id: U06TBGX9L93`
- **John's DM:** `mcp__slack__slack_post_message` with `channel_id: U0AM5EGRVTP`

Confirm `ts` returned for each — confirms delivery. If either send fails, output the formatted message for manual send.
