# Skill: Invoice Reminder Cron
**Trigger:** Scheduled daily at 9:00 AM ICT — also invocable manually: "run invoice reminders", "/invoice-reminder-cron"
**Fully automated — no human input required at any step.**

---

## Purpose
Daily automated run that:
1. Detects any new client payments (via noa@ Gmail scan)
2. Sends pre-due and overdue reminder emails from john@kravemedia.co
3. Flags late fees at 7 days overdue (Slack alert — manual Airwallex step)
4. Flags and records collections at 60+ days
5. Posts a daily status digest to #payments-invoices-updates

---

## Key Data
- **Client Invoice Tracker Sheet ID:** `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`
- **Client Invoice Tracker Tab:** `Invoices`
- **Reminder emails sent from:** john@kravemedia.co (via `mcp__gmail-john__gmail_send`)
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
| F | Airwallex Invoice ID | Used for late fee customer lookup |
| G | Amount | |
| H | Currency | |
| I | Due Date | Used to calculate days_diff |
| J | Status | Read/write |
| K | Requested By | Strategist assigned — use for CC on all emails |
| L | Reminders Sent | Append-only log e.g. `7d 2026-04-10 \| overdue 2026-04-15` |
| M | Payment Confirmed Date | Write date when payment confirmed |
| N | Status (display) | Formula-driven — **do NOT write to this column** |

## Strategist Lookup
| Name | Email | Slack ID |
|------|-------|----------|
| Amanda | amanda@kravemedia.co | U07J8SRCPGU |
| Jeneena | jeneena@kravemedia.co | U07R7FU4WBV |
| Sybil | sybil@kravemedia.co | U0A2HLNV8NM |
| Noa | noa@kravemedia.co | U06TBGX9L93 |
| John | john@kravemedia.co | U0AM5EGRVTP |

Use `<@USER_ID>` (not `@name`) in all Slack posts for overdue, late-fee, and collections alerts.

**Always CC noa@kravemedia.co on every reminder email, regardless of strategist.**

---

## Execution Order

### Phase 1 — Payment Detection
Run the full `payment-detection` skill first.
Ensures any payments received overnight are marked before reminder logic runs — prevents sending a reminder to a client who already paid.

### Phase 2 — Reminder Scan
Pull all rows from Client Invoice Tracker (Sheet ID above, tab: `Invoices`, range `A:N`).

**Skip rows where Column J (Status):**
- Is `Payment Complete`
- Is `Collections`
- Starts with `Draft` (covers `Draft — Pending John Review` and `Draft - Pending John Review`)

For remaining rows, calculate: `days_diff = due_date (Col I) - today`

### Phase 3 — Apply Reminder Rules

| days_diff | Action | Reminder Type |
|-----------|--------|---------------|
| +7 | Send pre-due reminder | `7d` |
| +5 | Send pre-due reminder | `5d` |
| +3 | Send pre-due reminder | `3d` |
| +1 | Send pre-due reminder | `1d` |
| 0 | Send due-today reminder | `due-today` |
| -1 to -6 | Send overdue notice | `overdue` |
| -7 | Create late fee invoice + send notice | `late-fee` |
| -8 to -59 | Send late fee follow-up (weekly dedup) | `late-fee-followup` |
| ≤ -60 | Flag for Collections | `collections` |

**Deduplication rule:** Before sending any reminder, check Column L (Reminders Sent).
- Same reminder type within 2 days → skip
- `late-fee-followup` within 7 days of last `late-fee` or `late-fee-followup` → skip
- Format: `7d 2026-04-10 | 5d 2026-04-12 | overdue 2026-04-15`

### Phase 4 — Send Reminder Emails

Use `mcp__gmail-john__gmail_send` to send each email directly (no draft step).

**From:** john@kravemedia.co
**To:** client email from Column C
**CC:** strategist email (from Strategist Lookup table using Column K) + noa@kravemedia.co

If Column C is empty → skip email, flag in Slack: `⚠️ No email on file for [Client] — reminder not sent. Add email to Column C in tracker.`
If Column K strategist not in lookup table → still send email but skip that CC, flag in Slack: `⚠️ Unknown strategist "[name]" on [Invoice #] — CC not sent`

**Email templates:**

Pre-Due (7d / 5d / 3d / 1d):
```
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
Subject: Overdue Invoice — [Invoice #] — [Client Name]

Hi [Client Name],

Invoice [Invoice #] for [Amount] [Currency] was due on [Due Date] and remains unpaid.

Please arrange payment immediately. A USD $200 late fee will be applied after 7 days overdue per our payment terms.

Best regards,
John
Krave Media
```

Late Fee Notice (exactly -7 days and -8 to -59 followups):
```
Subject: Late Fee Applied — [Invoice #] — [Client Name]

Hi [Client Name],

As payment for invoice [Invoice #] has not been received, a late fee of USD $200 has been applied per our payment terms.

Updated invoice total: [Original Amount + $200] [Currency].

Please arrange payment at your earliest convenience to avoid additional fees.

Best regards,
John
Krave Media
```

Collections (60+ days):
```
Subject: Final Notice — [Invoice #] — [Client Name]

Hi [Client Name],

Invoice [Invoice #] for [Amount] [Currency] has been outstanding for more than 60 days. This matter has been escalated for collections.

Please arrange immediate payment to avoid further action.

Best regards,
John
Krave Media
```

### Phase 5 — Late Fee Flag (days_diff == -7 only)

For invoices exactly at -7 days, flag to Slack for manual addition in Airwallex. The skill handles the email and tracker update automatically; the Airwallex line item is a manual step.

**Action:**
1. Update Col J → `Late Fee Applied — [date]`
2. Append Col L → `| late-fee [date]`
3. Post to C09HN2EBPR7:
```
⚠️ *Late Fee Needed — [Client] — [Invoice #]*
Add "Late Payment Fee — [Month YYYY] — USD $200" as a line item in Airwallex → Invoices.
<@[strategist_id]> <@U07J8SRCPGU>
```

### Phase 6 — Update Tracker
After each reminder action, update the relevant row:
- Column J: update to current state
- Column L: append new entry (e.g. `| 7d 2026-04-12`)

For **collections** (days_diff ≤ -60):
- Col J → `Collections`
- Col L → append `| collections [date]`

Use `sheets_update_row` with the known row number.

**Do NOT write to Column N** — formula-driven.

**Range format note:** Use bare ranges like `J8` or `J8:L8`, not `Sheet1!J8` or `Invoices!J8`. The MCP server resolves to the correct tab automatically.

### Phase 7 — Post Daily Digest to Slack
After all processing, post to #payments-invoices-updates (C09HN2EBPR7):

```
*📋 Invoice Status — [DATE]*

*Payments confirmed today:* [n]
[• Client — Invoice # — Amount — ✅ Payment Complete]

*Reminders sent today:* [n]
[• Client — Invoice # — [X]-day reminder — Due [date]]

*Overdue (action needed):* [n]
[• Client — Invoice # — [X] days overdue — <@strategist_id>]

*Late fees applied today:* [n]
[• Client — Invoice # — $200 USD late fee invoice created]

*Collections (escalated):* [n]
[• Client — Invoice # — [X] days overdue — <@U06TBGX9L93> <@U07J8SRCPGU>]

*Upcoming (next 7 days):*
[• Client — Invoice # — Amount — Due [date]]

*No action needed:* [n invoices fully paid]
```

If nothing to report: post `✅ Invoice check complete — no outstanding items.`

---

## Scheduling This Cron
ICT is UTC+7, so 9:00 AM ICT = **2:00 AM UTC**.
Cron expression: `0 2 * * *`

To set up: run `/schedule` and configure with prompt: `Run /invoice-reminder-cron`

## Manual Invocation
- "run invoice reminders"
- "check invoice status"
- "/invoice-reminder-cron"