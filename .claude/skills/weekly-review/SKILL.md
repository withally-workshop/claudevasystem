# Skill: Weekly Review

**Purpose:** Generate Noa's weekly review — synthesizes the week's EOD summaries + Slack activity into a structured recap by business, surfaces unresolved items, and sets next-week priorities.

**Cadence:** Manual invoke. Recommended: **Fridays at or after 5:00 PM ICT** before the EOD summary fires.

**Manual invoke:** Run `/weekly-review` at end of week, or any time Noa needs a cross-business status snapshot.

---

## Operator Input (Weekly)

Before running, optionally post any offline context to `#airwallexdrafts` — decisions made off-channel, client calls not logged, Halo Home supplier updates from WhatsApp/WeChat, etc.

---

## Data Sources

| Source | Channel ID | What to pull |
|--------|-----------|-------------|
| `#airwallexdrafts` | `C0AQZGJDR38` | All EOD bot summaries + John's posts from Mon–Fri this week |
| `#ad-production-internal` | `C0AGEM919QV` | IM8 ad production updates, agency activity, Frame.io status |
| `#payments-invoices-updates` | `C09HN2EBPR7` | Invoice requests, payment confirmations, outstanding AR |

---

## Instructions

### Step 0 — Pull the week's Slack data

Use `mcp__slack__slack_get_channel_history` on all three channels with limit: 200.

**Week filter:** Messages from Monday 00:00 ICT through now. Discard anything older.

From `#airwallexdrafts`, extract all messages containing "Today's Wrap-up" — these are the EOD summaries. Pull all five (Mon–Fri) if available.

---

### Step 1 — Collect offline context from operator

Ask: "Anything from the week not captured in Slack? (Client calls, WhatsApp supplier updates, Halo Home decisions, offline meetings)"

If nothing to add, proceed.

---

### Step 2 — Synthesize by business

Group everything pulled into four business buckets:

| Business | What to look for |
|----------|-----------------|
| **Krave Media** | Client deliverables, video QA, Amanda/Joshua updates, invoices sent/paid |
| **IM8 / Prenetics** | Agency brief completion, ad production velocity, blockers with any of the 9 agencies |
| **Halo Home** | US expansion progress, Amy/Shuo Shimpa supplier updates, creator outreach |
| **Skyvane** | Consulting deliverables, Meta ad funnel work |

For each bucket, identify:
- What got done
- What didn't get done / rolled over
- Blockers still open

---

### Step 3 — AR / Finance snapshot

Pull from `#payments-invoices-updates` and EOD summaries:
- Invoices sent this week (not yet paid)
- Payments received this week
- Any overdue flags or late fee triggers

---

### Step 4 — Format the message

Use this exact template:

```
### 📋 Weekly Review — [Week of Mon DD MMM]

**Krave Media**
✅ Done: [items]
🚧 Rolled over: [items]
🔎 Blockers: [items — omit if none]

**IM8 / Prenetics**
✅ Done: [items]
🚧 Rolled over: [items]
🔎 Blockers: [items — omit if none]

**Halo Home**
✅ Done: [items]
🚧 Rolled over: [items]
🔎 Blockers: [items — omit if none]

**Skyvane**
✅ Done: [items — omit section if no activity this week]

---

**💰 AR / Finance**
- [Invoice sent / payment received / overdue items]

---

**🎯 Next Week — Top Priorities**
1. [highest leverage item]
2. [second]
3. [third]

**⚠️ Needs Noa's Attention**
- [decisions or inputs required — use 3-and-1 framework if options exist]
```

Rules:
- Bullets only. No paragraphs. No filler.
- Omit any business section with zero activity.
- Flag overdue items or hard deadlines with `[URGENT]` or inline date.
- Keep "Needs Noa's Attention" to max 3 items — escalate only what genuinely requires her input.
- Next Week priorities must be ranked — no unordered lists.

---

### Step 5 — Send via Slack MCP

- **John's DM only:** `mcp__slack__slack_post_message` with `channel_id: U0AM5EGRVTP`
- **Archive copy:** Post to `#airwallexdrafts` (`C0AQZGJDR38`) for reference

Do NOT send to Noa. John reviews and forwards manually.

Confirm `ts` returned for each send. If any send fails, output the formatted message for manual send.