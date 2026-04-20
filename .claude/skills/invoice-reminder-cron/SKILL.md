# Skill: Invoice Reminder Cron
**Trigger:** Scheduled daily at 9:00 AM ICT — also invocable manually: "run invoice reminders", "/invoice-reminder-cron"
**Runs both:** payment detection + reminder emails in one pass
**SOP:** references/sops/client-invoice-creation.md

---

## Purpose
Daily automated run that:
1. Detects any new client payments (via noa@ Gmail scan)
2. Sends pre-due and overdue reminder emails from john@kravemedia.co
3. Applies late fees in Airwallex at 7 days overdue
4. Posts a daily status digest to #payments-invoices-updates

Replaces all manual payment follow-up. Amanda gets full visibility via Slack. Noa is removed from the loop entirely.

---

## Key Data
- **Client Invoice Tracker Sheet ID:** `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`
- **Client Invoice Tracker Tab:** `Invoices`
- **Reminder emails sent from:** john@kravemedia.co (via `mcp__gmail__*`)
- **Slack digest channel:** #payments-invoices-updates (C09HN2EBPR7)
- **Today's date:** always use current date at runtime — do NOT hardcode

## Column Map
| Col | Field | Notes |
|-----|-------|-------|
| A | Date Created | |
| B | Client Name | |
| C | Email Address | Client email — use this directly, no Airwallex lookup needed |
| D | Project Description | |
| E | Invoice # | Primary match key |
| F | Airwallex Invoice ID | |
| G | Amount | |
| H | Currency | |
| I | Due Date | Used to calculate days_diff |
| J | Status | Read/write — `Invoice Sent`, `Payment Complete`, `Late Fee Applied`, `Collections` |
| K | Requested By | Strategist assigned — use for CC on all emails |
| L | Reminders Sent | Append-only log e.g. `7d 2026-04-10 \| overdue 2026-04-15` |
| M | Payment Confirmed Date | Write date when payment confirmed |
| N | Status (display) | Formula-driven — **do NOT write to this column** |

## Strategist Email Lookup
Map Column K values to email addresses for CC:

| Name | Email |
|------|-------|
| Amanda | amanda@kravemedia.co |
| Jeneena | jeneena@kravemedia.co |
| Sybil | sybil@kravemedia.co |
| Noa | noa@kravemedia.co |
| ??? | Skip CC, flag in Slack: `⚠️ Unknown strategist on [Invoice #] — CC not sent` |

**Always CC noa@kravemedia.co on every reminder email, regardless of who the assigned strategist is.**

---

## Execution Order

### Phase 1 — Payment Detection
Run the full `payment-detection` skill first.
This ensures any payments received overnight are marked before reminder logic runs — prevents sending a reminder to a client who already paid.

### Phase 2 — Reminder Scan
Pull all rows from Client Invoice Tracker (Sheet ID above, tab: `Invoices`, range `A:N`).

Skip rows where:
- Column J (Status) = `Payment Complete`
- Column J (Status) = `Collections`
- Column J (Status) = `Draft — Pending John Review` (invoice not sent yet — no reminder)

For remaining rows, calculate: `days_diff = due_date (Col I) - today`

### Phase 3 — Apply Reminder Rules

| days_diff | Action | Email Type |
|-----------|--------|------------|
| +7 | Send pre-due reminder | `7-day` |
| +5 | Send pre-due reminder | `5-day` |
| +3 | Send pre-due reminder | `3-day` |
| +1 | Send pre-due reminder | `1-day` |
| 0 | Send due-today reminder | `due-today` |
| -1 to -6 | Send overdue notice | `overdue` |
| -7 | Apply $200 late fee + send late fee notice | `late-fee` |
| -8 to -59 | Send late fee notice (if not already sent this week) | `late-fee` |
| ≤ -60 | Flag for Collections — post to Slack, tag Noa | `collections` |

**Deduplication rule:** Before sending any reminder, check Column L (Reminders Sent).
- If the same reminder type was already sent within the last 2 days → skip
- Format in Column L: `7d 2026-04-10 | 5d 2026-04-12 | overdue 2026-04-15`
- Parse this field to determine if reminder already sent

### Phase 4 — Send Reminder Emails
Use `mcp__gmail-john__gmail_create_draft` to create each email draft, then send.

**From:** john@kravemedia.co
**To:** client email from Column C (Email Address) — no Airwallex lookup needed
**CC:** strategist email (look up from Strategist Email Lookup table using Column K value) + noa@kravemedia.co

If Column C is empty → skip email, flag in Slack: `⚠️ No email on file for [Client] — reminder not sent. Add email to Column C in tracker.`
If Column K strategist not in lookup table → still send email but skip that CC, flag in Slack: `⚠️ Unknown strategist "[name]" on [Invoice #] — CC not sent`

**Email templates:**

Pre-Due (7d / 5d / 3d / 1d):
```
To: [Column C — client email]
CC: [strategist email], noa@kravemedia.co
Subject: Payment Reminder — [Invoice #] — [Client Name]

Hi [Client Name],

Just a reminder that invoice [Invoice #] for [Amount] [Currency] is due on [Due Date].

Please arrange payment at your earliest convenience.

Best regards,
John
Krave Media
```

Due Today:
```
To: [Column C — client email]
CC: [strategist email], noa@kravemedia.co
Subject: Invoice Due Today — [Invoice #] — [Client Name]

Hi [Client Name],

Invoice [Invoice #] for [Amount] [Currency] is due today.

Please arrange payment today to avoid a late fee being applied.

Best regards,
John
Krave Media
```

Overdue (1–6 days):
```
To: [Column C — client email]
CC: [strategist email], noa@kravemedia.co
Subject: Overdue Invoice — [Invoice #] — [Client Name]

Hi [Client Name],

Invoice [Invoice #] for [Amount] [Currency] was due on [Due Date] and remains unpaid.

Please arrange payment immediately. A USD $200 late fee will be applied after 7 days overdue per our payment terms.

Best regards,
John
Krave Media
```

Late Fee Notice (7+ days):
```
To: [Column C — client email]
CC: [strategist email], noa@kravemedia.co
Subject: Updated Invoice — Late Fee Applied — [Invoice #] — [Client Name]

Hi [Client Name],

As payment for invoice [Invoice #] has not been received, a late fee of USD $200 has been applied per our payment terms.

Updated invoice total: [Original Amount + $200] [Currency].

Please arrange payment at your earliest convenience to avoid additional fees.

Best regards,
John
Krave Media
```

### Phase 5 — Apply Late Fee in Airwallex (7 days overdue only)
For invoices exactly at -7 days:
1. `airwallex_get_invoice` using Column F (Airwallex Invoice ID)
2. Note the current line items and total
3. Flag to john via Slack: `⚠️ Late fee needed: [Client] — [Invoice #]. Add "Late Payment Fee — [Month Year] — USD $200" line item in Airwallex → Invoices`
   - Airwallex API may not support direct line item addition — manual step flagged, not auto-applied
4. Update Column J (Status) → `Late Fee Applied — [date]`

### Phase 6 — Update Tracker
After each action, update the relevant row:
- Column J (Status): update to current state
- Column L (Reminders Sent): append new entry (e.g. `| 7d 2026-04-12`)

Use `sheets_update_row` with the known row number.

**Do NOT write to Column N** — it is formula-driven and auto-populates based on Column J.

**Range format note:** Do NOT include a sheet tab prefix. Use bare ranges like `J8` or `J8:L8`, not `Sheet1!J8` or `Invoices!J8`. The MCP server resolves to the correct tab automatically.

### Phase 7 — Post Daily Digest to Slack
After all processing, post to #payments-invoices-updates (C09HN2EBPR7):

```
*📋 Invoice Status — [DATE]*

*Payments confirmed today:* [n]
[• Client — Invoice # — Amount — ✅ Payment Complete]

*Reminders sent today:* [n]
[• Client — Invoice # — [X]-day reminder — Due [date]]

*Overdue (action needed):* [n]
[• Client — Invoice # — [X] days overdue]

*Late fees applied today:* [n]
[• Client — Invoice # — $200 added]

*Upcoming (next 7 days):*
[• Client — Invoice # — Amount — Due [date]]

*No action needed:* [n invoices fully paid]
```

If nothing to report: post `✅ Invoice check complete — no outstanding items.`

---

## Scheduling This Cron
This skill is designed to run via the `/schedule` skill at **9:00 AM ICT daily**.

ICT is UTC+7, so 9:00 AM ICT = **2:00 AM UTC**.

Cron expression: `0 2 * * *`

To set up: run `/schedule` and configure with prompt: `Run /invoice-reminder-cron`

---

## Manual Invocation
Can be triggered any time by saying:
- "run invoice reminders"
- "check invoice status"
- "/invoice-reminder-cron"
