# Skill: Invoice Reminder Cron
**Trigger:** Scheduled Monday–Friday at 10:00 AM PHT — also invocable manually: "run invoice reminders", "/invoice-reminder-cron"
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
| C | Email Address | Client email(s) — comma, semicolon, or space-separated; all addresses receive the email |
| D | Project Description | |
| E | Invoice # | Primary match key |
| F | Airwallex Invoice ID | Used for late fee customer lookup |
| G | Amount | Full invoice amount |
| H | Currency | |
| I | Due Date | Used to calculate days_diff |
| J | Payment Status | Read/write — operational status; write `Late Fee Applied — date`, `Collections` here |
| K | Requested By | Strategist assigned — CC on all emails |
| L | Reminders Sent | Append-only log e.g. `7d 2026-04-10 \| overdue 2026-04-15` |
| M | Payment Confirmed Date | Write date when payment confirmed |
| N | Status | Read-only — formula-driven display; do NOT write to this column |
| Q | Amount Paid | Cumulative amount paid — read to compute remaining balance for `Partial Payment` rows |
| R | Invoice URL | Airwallex hosted payment link — included in all reminder emails when present |

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

**Skip rows where Column N (Status):**
- Is `Payment Complete`
- Is `Paid`
- Is `Collections`
- Starts with `Draft` (covers `Draft — Pending John Review` and `Draft - Pending John Review`)

**Process but adjust for `Partial Payment` rows:**
- Do NOT skip — a remaining balance is still owed
- Read Col Q (Amount Paid) to compute remaining: `remaining = Col G - Col Q`
- Use `remaining` in the email body instead of the full amount
- Append a partial payment note to every email body

For remaining rows, calculate: `days_diff = due_date (Col I) - today`

### Phase 3 — Apply Reminder Rules

**Payout term inference:** Derive from `Col I (Due Date) - Col A (Date Created)` gap in days.

| Gap | Inferred Term |
|-----|--------------|
| ≤ 10 days | 7d terms |
| 11–20 days | 15d terms |
| > 20 days | 30d terms |

If Col A is missing or unparseable, fall back to 30d terms (most conservative).

**Pre-due reminders by payout term:**

| Tier | 30d terms | 15d terms | 7d terms |
|------|-----------|-----------|----------|
| 7d   | ✅ | ✅ | — |
| 5d   | ✅ | ✅ | — |
| 3d   | ✅ | ✅ | ✅ |
| 1d   | — | — | ✅ |
| Due today | ✅ | ✅ | ✅ |

**Full reminder schedule:**

| days_diff | Action | Reminder Type |
|-----------|--------|---------------|
| +7 | Pre-due (30d/15d only) | `7d` |
| +5 | Pre-due (30d/15d only) | `5d` |
| +3 | Pre-due (all terms) | `3d` |
| +1 | Pre-due (7d terms only) | `1d` |
| 0 | Due-today (all terms) | `due-today` |
| -1 to -6 | Send overdue notice | `overdue` |
| -7 | Create late fee invoice + send notice | `late-fee` |
| -8 to -59 | Send late fee follow-up (weekly dedup) | `late-fee-followup` |
| ≤ -60 | Flag for Collections | `collections` |

**Deduplication rule:** Before sending any reminder, check Column L (Reminders Sent).
- Same reminder type within 2 days → skip
- `late-fee-followup` within 7 days of last `late-fee` or `late-fee-followup` → skip
- Format: `7d 2026-04-10 | 5d 2026-04-12 | overdue 2026-04-15`

### Phase 4 — Send Reminder Emails

Always compose a **new email** for every reminder type. No thread replies.

- **To:** all addresses from Column C (comma/semicolon/space-separated)
- **CC:** strategist (Column K lookup) + noa@kravemedia.co
- **Payment link:** include Col R (Invoice URL) when present — omit the line if empty
- **Tone:** friendly, warm, no specific penalty amounts mentioned
- **Signature:** `Warm regards, John, Krave Media`

If Column C is empty → skip email, flag in Slack.
If Column K strategist not in lookup → still send, skip CC, flag in Slack.

**Email templates:**

Pre-Due (7d / 5d / 3d / 1d):
```
Subject: Friendly Reminder — Invoice [Invoice #] Due [Due Date]

Hi [Client Name],

Just a quick heads-up that invoice [Invoice #] for [Amount] [Currency] is due on [Due Date].

[If Invoice URL present: You can view and pay your invoice here: [Invoice URL]]

Thank you so much for your continued partnership — we really appreciate it!

Warm regards,
John
Krave Media
```

Due Today:
```
Subject: Invoice [Invoice #] Due Today — [Client Name]

Hi [Client Name],

A friendly reminder that invoice [Invoice #] for [Amount] [Currency] is due today.

[If Invoice URL present: You can view and pay your invoice here: [Invoice URL]]

Thank you so much for your prompt attention — we truly appreciate it!

Warm regards,
John
Krave Media
```

Overdue (1–6 days):
```
Subject: Following Up — Invoice [Invoice #] — [Client Name]

Hi [Client Name],

I'm following up on invoice [Invoice #] for [Amount] [Currency], which was due on [Due Date] and hasn't come through yet.

[If Invoice URL present: You can view and pay your invoice here: [Invoice URL]]

Please don't hesitate to reach out if you have any questions or if there's anything we can help with on our end. As a reminder, our payment terms are outlined in our agreement.

Thank you for your attention to this — we appreciate it!

Warm regards,
John
Krave Media
```

Late-Fee / Late-Fee-Followup (-7 to -59 days):
```
Subject: Following Up — Invoice [Invoice #] — [Client Name]

Hi [Client Name],

I wanted to follow up again on invoice [Invoice #] for [Amount] [Currency], which has been outstanding since [Due Date].

[If Invoice URL present: You can view and pay your invoice here: [Invoice URL]]

We'd love to resolve this as soon as possible. As a reminder, our agreement includes provisions for overdue accounts, and we appreciate your understanding as we work through this together.

Thank you for your attention to this!

Warm regards,
John
Krave Media
```

Collections (60+ days):
```
Subject: Urgent Follow-Up — Invoice [Invoice #] — [Client Name]

Hi [Client Name],

I'm reaching out regarding invoice [Invoice #] for [Amount] [Currency], which has now been outstanding for more than 60 days.

[If Invoice URL present: You can view and pay your invoice here: [Invoice URL]]

We truly value our relationship with you and would appreciate your prompt attention to settling this balance in accordance with our payment terms.

Thank you for your immediate attention to this matter.

Warm regards,
John
Krave Media
```

**Partial payment note** (appended to all templates when status = `Partial Payment`):
```
Note: We've received your partial payment of [Amount Paid] [Currency]. The remaining balance of [Remaining] [Currency] is outstanding.
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
After all processing, a digest item is routed to the `Post Digest` node and posted to #payments-invoices-updates (C09HN2EBPR7). This fires on every run, including runs with no actions.

**Format:**
```
*📋 Invoice Reminder Digest — [DATE]*

*Reminders sent:* [n]
• [Client] — [Invoice #] — [Xd reminder / due today] — Due [date]

*Overdue (action needed):* [n]
• [Client] — [Invoice #] — [X] day(s) overdue

*Late fees triggered:* [n]
• [Client] — [Invoice #] — $200 USD late fee flagged

*Collections (escalated):* [n]
• [Client] — [Invoice #] — [X] days overdue
```

If nothing to report: `✅ Invoice check complete — no outstanding items.`

**Implementation note:** `PROCESS_CODE` always appends a `{ isDigest: true, digestText }` item to its output. The `Is Digest Item?` IF node routes it directly to `Post Digest`, bypassing the email/tracker chain. Action items (`isDigest: false`) flow through the normal path.

---

## Scheduling This Cron
PHT is UTC+8. n8n cloud runs in Asia/Manila timezone, so the cron expression is local PHT time. Weekdays only (Mon–Fri).
Cron expression: `0 10 * * 1-5` (fires at 10:00 AM PHT)

To set up: run `/schedule` and configure with prompt: `Run /invoice-reminder-cron`

## Manual Invocation
- "run invoice reminders"
- "check invoice status"
- "/invoice-reminder-cron"