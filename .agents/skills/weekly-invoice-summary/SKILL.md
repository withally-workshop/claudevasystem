---
name: weekly-invoice-summary
description: Use when the user asks for a weekly invoice portfolio view, "who to chase this week", "what invoices are overdue", "weekly invoice summary", "weekly payment status", or "run weekly summary". Posts a full open-invoice snapshot to #payments-invoices-updates bucketed by urgency. Distinct from the daily digest — this is a portfolio state view, not a log of what the reminder cron did.
metadata:
  short-description: Post weekly invoice portfolio snapshot to Slack
---

# Weekly Invoice Summary

Post a full open-invoice portfolio snapshot to #payments-invoices-updates (C09HN2EBPR7). Reads every open invoice from the Client Invoice Tracker, categorises by urgency bucket, and posts one consolidated Slack message Noa can act from.

**This skill fires the n8n workflow — it does not read the tracker directly.**

## Trigger

Fire the n8n webhook:

```
POST https://noatakhel.app.n8n.cloud/webhook/krave-weekly-invoice-summary
```

Use the `n8n-workflow-trigger` skill or call the webhook directly. No payload required.

**Workflow ID:** `WX1hHek0cNTyZXkS`  
**Schedule:** Fires automatically every Monday 9:00 AM ICT (`0 2 * * 1`).

## What the Workflow Posts

A single Slack message to #payments-invoices-updates with up to five sections, ordered by urgency. Empty sections are omitted.

```
*📊 Weekly Invoice Summary — [DATE]*

*🔴 Collections ([n]):*
• [Client] — [Invoice #] — [Amount] [Currency] — [X] days overdue — <@strategist>

*🟠 Late Fee Applied ([n]):*
• [Client] — [Invoice #] — [Amount] [Currency] — [X] days overdue — <@strategist>

*🟡 Overdue — Needs Chase ([n]):*
• [Client] — [Invoice #] — [Amount] [Currency] — [X] days overdue — <@strategist>

*🔵 Due This Week ([n]):*
• [Client] — [Invoice #] — [Amount] [Currency] — Due [date]

*⚪ Pending — Upcoming ([n]):*
• [Client] — [Invoice #] — [Amount] [Currency] — Due [date]
```

If nothing is open: `✅ No outstanding invoices — all paid or no open items.`

## Bucket Logic

| Bucket | Condition |
|--------|-----------|
| 🔴 Collections | days overdue ≥ 60 OR Payment Status = `Collections` |
| 🟠 Late Fee Applied | 8–59 days overdue |
| 🟡 Overdue — Needs Chase | 1–7 days overdue |
| 🔵 Due This Week | Due within 0–7 days |
| ⚪ Pending — Upcoming | Due in 8+ days |

Rows skipped: `Payment Complete`, `Paid`, anything starting with `Draft`, missing Due Date or Invoice #.  
Partial payments: shows remaining balance (`Col G - Col Q`) with `_(partial — remaining)_` label.

## Data Source

- **Client Invoice Tracker:** Sheet `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`, tab `Invoices`
- **Strategist mentions:** Col K lookup → `<@USER_ID>` in Slack

## Related Files

- Claude Code skill: `.claude/skills/weekly-invoice-summary/SKILL.md`
- Deploy script: `n8n-workflows/deploy-weekly-invoice-summary.js`
- Workflow docs: `n8n-workflows/WORKFLOWS.md` — Workflow 10
