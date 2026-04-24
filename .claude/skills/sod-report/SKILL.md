# Skill: Start of Day Report

**Purpose:** Generate Noa's daily Start of Day Report from validated Slack inputs - yesterday's EOD carry-over, John's morning goals dump, and, when available, today's `Morning Triage` - then deliver the finished report to both `#airwallexdrafts` and Noa's DM.

**Automated:** Local/manual only for now. Run the `n8n` workflow manually or via `POST /webhook/krave-sod-report` only after all required inputs are present in `#airwallexdrafts`.

**Manual invoke:** Use this skill for off-schedule drafting, validation, or manual resend support when the workflow is unavailable.

---

## Operator Input

Post your focus goals and context for the day to `#airwallexdrafts` before running the workflow. No specific format required - just dump what you're focusing on, any blockers you're aware of, and anything you want Noa to know about your day's priorities.

The workflow reads your post + yesterday's EOD carry-overs + today's `Morning Triage` in `#airwallexdrafts`, validates the required sources, then builds the report.

---

## Data Sources

| Source | What it provides |
|---|---|
| `#airwallexdrafts` - yesterday's EOD bot message | Carry-over from Yesterday + unresolved Blockers |
| `#airwallexdrafts` - John's posts from today | Focus Goals + new Blockers |
| `#airwallexdrafts` - today's `Morning Triage` bot message | BAU / Follow-ups from Inbox Triage Daily, plus inbox items that stayed `EA/Unsure` |

---

## Instructions (Manual Invoke)

### Step 0 - Pull #airwallexdrafts

Use `mcp__slack__slack_get_channel_history` with `channel_id: C0AQZGJDR38`, limit: 100.

Split messages into three groups:

**Group A - Yesterday's EOD** (bot message from yesterday containing "Today's Wrap-up")
- Extract `Not Completed / Needs More Work / Planned Next Steps` -> **Carry-over from Yesterday**
- Extract `Blocker / Input Needed` -> carry forward only if still unresolved

**Group B - John's morning dump** (messages from `U0AM5EGRVTP` posted today before the run)
- Use for **Focus Goals** and any additional **Blocker / Input Needed**

**Group C - Today's inbox triage summary** (bot message from today containing "Morning Triage")
- Use for **BAU / Follow-ups (Business As Usual)**
- Pull forward any `Review These` items as candidate blockers or follow-ups when they still need human judgment

### Step 1 - Validate required inputs

These sources are mandatory:

- yesterday's EOD containing `Today's Wrap-up`
- John's same-day morning dump

If either required source is missing, stop and alert `#airwallexdrafts`. Do not draft or send a partial SOD report.

`Morning Triage` is optional. If it is missing, continue and omit inbox-triage follow-ups from the report.

### Step 2 - Collect additional context (manual only)

Ask: "Anything to add before I send? (Focus goals, blockers, priorities not yet posted in #airwallexdrafts)" If nothing to add, proceed.

### Step 3 - Format the message

Use this exact template:

```
### Today's Goals

**Focus Goals**
- [from John's morning dump]

**Carry-over from Yesterday**
- [from yesterday's EOD Not Completed section - omit if none]

**Blocker / Input Needed**
- [from John's dump + unresolved yesterday blockers]

**BAU / Follow-ups (Business As Usual)**
- [recurring ops inferred from validated context: pending invoices, IM8 agency check-ins, `Review These`, etc.]
```

Rules:
- Bullets only. No paragraphs. No filler.
- Flag time-sensitive items with `[URGENT]` or include deadline inline.
- Group by business only if multi-business.
- Omit any section with zero items.
- If John posted no morning dump: stop and alert. Do not send the report.
- If no `Morning Triage` summary is found yet: continue and omit inbox-triage follow-ups.
- If no yesterday EOD found: stop and alert. Do not send the report.

### Step 4 - Send via Slack MCP

Send to both recipients:
- **#airwallexdrafts:** `mcp__slack__slack_post_message` with `channel_id: C0AQZGJDR38`
- **Noa's DM:** `mcp__slack__slack_post_message` with `channel_id: U06TBGX9L93`

Confirm `ts` returned for each - confirms delivery. If either send fails, output the formatted message for manual send.
