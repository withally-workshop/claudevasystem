# Skill: Weekly Invoice Summary
**Trigger:** Scheduled Monday at 9:00 AM ICT — also invocable manually: "run weekly invoice summary", "/weekly-invoice-summary"
**Fully automated — no human input required.**

---

## Purpose

Proactive Monday push to #payments-invoices-updates giving Noa a full portfolio snapshot: who's overdue, who needs chasing, and what's coming due this week. This is a state-of-portfolio view — not a log of what the reminder cron did today.

**Distinct from the daily digest:** The daily digest reports what actions fired in a given run. This summary reports the full open invoice portfolio regardless of whether reminders fired.

---

## Key Data

- **Client Invoice Tracker Sheet ID:** `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`
- **Client Invoice Tracker Tab:** `Invoices`
- **Slack digest channel:** #payments-invoices-updates (C09HN2EBPR7)
- **Schedule:** `0 2 * * 1` — Monday 9:00 AM ICT (2:00 AM UTC)
- **Webhook:** `POST https://noatakhel.app.n8n.cloud/webhook/krave-weekly-invoice-summary`

---

## Portfolio Buckets

Rows are classified by `days_diff = Col I (Due Date) - today`. Strategist mentions use `<@USER_ID>` from Col K lookup.

| Bucket | Condition | Action for Noa |
|--------|-----------|----------------|
| 🔴 Collections | `days_diff ≤ -60` OR Col J = `Collections` | Escalate immediately |
| 🟠 Late Fee Applied | `days_diff` between -8 and -59 | Confirm late fee added in Airwallex |
| 🟡 Overdue — Needs Chase | `days_diff` between -1 and -7 | Chase client directly |
| 🔵 Due This Week | `days_diff` between 0 and 7 | Monitor — reminders auto-firing |
| ⚪ Pending — Upcoming | `days_diff > 7` | No action needed yet |

**Skip conditions:**
- Col N (Status) = `Payment Complete`, `Paid`
- Col N or Col J starts with `Draft`
- Missing Col I (Due Date) or Col E (Invoice #)

**Partial payment rows:** shown with remaining balance (`Col G - Col Q`) and `_(partial — remaining)_` label.

---

## Output Format

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

If all clear: `✅ No outstanding invoices — all paid or no open items.`

Sections with zero items are omitted entirely.

---

## Strategist Lookup

| Name | Slack ID |
|------|----------|
| Amanda | U07J8SRCPGU |
| Jeneena | U07R7FU4WBV |
| Sybil | U0A2HLNV8NM |
| Noa | U06TBGX9L93 |
| John | U0AM5EGRVTP |

If Col K has an unrecognised name, the raw name is shown instead of a mention — no error thrown.

---

## Manual Invocation

- "run weekly invoice summary"
- "weekly invoice summary"
- "/weekly-invoice-summary"
- `POST https://noatakhel.app.n8n.cloud/webhook/krave-weekly-invoice-summary`
