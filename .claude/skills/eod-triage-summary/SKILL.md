# Skill: EOD Triage Summary

**Purpose:** Generate Noa's daily End-of-Day Triage Summary — a clean Slack DM consolidating everything handled during the day.

**Automated:** Runs **Monday–Friday at 6:00 PM GMT+8** via scheduled remote agent (trigger ID: `trig_015YZhdGzPQNotUAruRVtSTg`). Sends directly to Noa's DM and posts a copy to `#airwallexdrafts` for SOD carry-over reference. No confirmation step.

**Manual invoke:** Use this skill for off-schedule runs (earlier send, mid-day check-in, testing).

---

## Operator Input (Daily)

Post task updates to `#airwallexdrafts` throughout the day as things happen — completed tasks, blockers, decisions made. No specific format required. The agent reads everything at 6 PM and synthesizes it.

---

## Instructions (Manual Invoke)

### Step 0 — Pull Slack context proactively

Pull recent messages from these channels using `mcp__slack__slack_get_channel_history` (limit: 50 each):

| Channel | ID | What to look for |
|---|---|---|
| `#airwallexdrafts` | `C0AQZGJDR38` | **Primary** — John's daily task dump + bot invoice drafts + inbox triage reports |
| `#ad-production-internal` | `C0AGEM919QV` | IM8 ad production updates, Frame.io status, blockers |
| `#payments-invoices-updates` | `C09HN2EBPR7` | Invoice requests, payment confirmations |

**Today-only filter:** Discard any message before midnight today in GMT+8 (UTC+8). Do not surface old content.

### Step 1 — Collect additional items from operator

Present a brief summary of what was pulled. Ask: "Anything to add that's not in the channel? (ClickUp tasks, calls, decisions made offline, etc.)" If nothing to add, proceed directly to Step 2.

### Step 2 — Categorize

| Bucket | Criteria |
|---|---|
| Completed from Focus Goals | Done, resolved, sent, closed |
| Not Completed / Needs More Work / Planned Next Steps | Unfinished, rolling to tomorrow; apply 3-and-1 for decisions |
| Blocker / Input Needed | Waiting on Noa, client, or third party — always name who/what |
| FYIs | Noa should know, no action needed |

### Step 3 — Format the message

Use this exact template:

```
### 🏁 Today's Wrap-up

**✅ Completed from Focus Goals**
- [item]

**🚧 Not Completed / Needs More Work / Planned Next Steps**
- [item]

**🔎 Blocker / Input Needed**
- [item] — waiting on [who/what]

**↔️ FYIs**
- [item]
```

Rules:
- Bullets only. No paragraphs. No filler.
- Flag time-sensitive items with `[URGENT]` or include deadline inline.
- Group by business (Krave / IM8 / Halo Home / Skyvane) only if multi-business and grouping aids clarity.
- Omit any section with zero items.

### Step 4 — Send via Slack MCP

- Noa's user ID: `U06TBGX9L93` (hardcoded)
- Call `mcp__slack__slack_post_message` with `channel_id: U06TBGX9L93`
- Confirm `ts` returned — confirms delivery
- Also post same message to `#airwallexdrafts` (`C0AQZGJDR38`) for SOD carry-over reference
- If Slack MCP returns an error, output the formatted message for manual send
