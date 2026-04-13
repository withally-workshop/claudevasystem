# Skill: Client Invoice Creation & Payment Tracking
**Trigger:** "check client invoices", "run invoice creation", "check overdue invoices", "payment follow-up", "/client-invoice"
**Channel:** #payments-invoices-updates (C09HN2EBPR7)
**SOP:** references/sops/client-invoice-creation.md

---

## Trigger Rules
- Strategists must **@tag Claude EA** in #payments-invoices-updates to trigger invoice creation
- Messages without a Claude EA @mention are informational — do NOT process them
- **No invoice attachment required for client invoices.** As long as the strategist provides client name, amount, currency, and payout terms, draft the invoice. Noa reviews Airwallex drafts before submitting.

---

## Key Data
- VA handle: @U0AM5EGRVTP
- Noa handle: @U06TBGX9L93
- Late fee: always USD $200/month, starting 1 week after due date
- Line item format: `Late Payment Fee — [Month Year] — USD $200`
- ClickUp flow: Approved → Payment Complete (or → Collections if 2+ months overdue)
- **Client Invoice Tracker Sheet ID:** `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`
- **Client Invoice Tracker Tab:** `Invoices`

---

## What This Skill Does
Two modes depending on trigger:

1. **Invoice Creation Mode** — reads #payments-invoices-updates for new client invoice requests, auto-drafts in Airwallex, logs to Client Invoice Tracker sheet, replies to sender, reacts ✅.
2. **Payment Follow-Up Mode** — reviews open invoices in Client Invoice Tracker, generates reminder emails and late fee notices, flags collections cases.

---

## Mode 1: Invoice Creation (Auto-Draft)

### Step 1 — Pull New Requests from Slack
Read recent messages in C09HN2EBPR7. Look for:
- Messages from strategists requesting invoice creation (e.g. "can you please get a invoice", "billing details", "please create invoice")
- Extract: client name, project description, amount, currency, payout terms (14/30 day)
- Skip: ✅ white_check_mark reacted messages (already actioned), creator payment submissions, casual replies

### Step 2 — Validate Minimum Required Info
Before drafting, check:
- Client name present? ✓/✗
- Amount present? ✓/✗
- Currency present? (if missing, flag — do not assume)
- Payout terms present? (if missing, flag — do not assume)

If any required field is missing → reply to the message thread asking for the missing info. Do NOT draft.
If all present → proceed to Step 3.

### Step 3 — Reply to Sender
Post a reply in the message thread immediately:
```
Got it! Processing your invoice request for [Client Name] — [Amount]. I'll have the draft ready in Airwallex shortly.
```

### Step 4 — Draft in Airwallex
Use Airwallex MCP tools:
1. `airwallex_list_customers` — find the billing_customer_id for the client
2. If customer not found → create it first (or flag to john's private channel)
3. `airwallex_create_invoice` — draft the invoice with:
   - Customer: [client name]
   - Currency: [from request]
   - Line items: [description + amount from request]
   - Due date: today + payout days
   - collection_method: OUT_OF_BAND
4. React ✅ to the original Slack message
5. Note the Airwallex invoice ID and invoice number returned

### Step 5 — Log to Client Invoice Tracker (Google Sheets)
After drafting in Airwallex, append a row to the Client Invoice Tracker:
**Sheet ID:** `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`
**Tab:** `Invoices`

Use `sheets_append_row` with values in this exact column order:

| Col | Field | Value |
|-----|-------|-------|
| A | Date Created | Today (YYYY-MM-DD) |
| B | Client Name | From request |
| C | Project Description | From request |
| D | Invoice # | From Airwallex response |
| E | Airwallex Invoice ID | From Airwallex response |
| F | Amount | From request |
| G | Currency | From request |
| H | Due Date | Today + payout days (YYYY-MM-DD) |
| I | Status | `Draft — Pending Noa Review` |
| J | Requested By | Strategist name from Slack |
| K | Reminders Sent | (blank) |
| L | Payment Confirmed Date | (blank) |
| M | Notes | (blank) |

### Step 6 — Log for 5pm Digest
Track: invoice draft ID, client name, amount, requested by, timestamp

At 5pm ICT, post a consolidated digest to John's private channel (C0AQZGJDR38):
```
📋 *Invoice Digest — [DATE] 5pm ICT*
*Drafts ready for submission:*
• [Client] — [Amount] [Currency] — Draft ID: [ID] — requested by [strategist]

*Exceptions pending:*
• [Creator/Client] — [issue summary]

Submit all drafts in Airwallex → Invoices. Tag @Noa when submitted.
```

---

## Mode 2: Payment Follow-Up (Weekly)

### Step 1 — Pull Open Invoices from Tracker
Use `sheets_get_rows` on the Client Invoice Tracker (tab: `Invoices`, range `A:M`).
Filter for rows where:
- Column I (Status) is NOT `Payment Complete` and NOT `Collections`
- Column H (Due Date) is populated

### Step 2 — Calculate Days and Classify
For each open invoice, calculate: `days_diff = due_date - today`

| days_diff | Classification |
|-----------|---------------|
| +7 | Due in 7 days — send reminder |
| +5 | Due in 5 days — send reminder |
| +3 | Due in 3 days — send reminder |
| +1 | Due tomorrow — send reminder |
| 0 | Due today — send reminder |
| -1 to -6 | Overdue (early) — send overdue notice |
| -7 | 1 week overdue — apply $200 late fee |
| -8 to -59 | Overdue (ongoing) — send late fee notice if not already sent |
| -60 or less | Collections — flag to Noa |

### Step 3 — Generate Reminder Emails (draft via gmail — john@kravemedia.co)
Use `mcp__gmail__gmail_create_draft` (or equivalent) to draft each email. Do NOT send automatically — output drafts for review unless the cron skill is running in auto-send mode.

**Pre-Due Reminder (7d / 5d / 3d / 1d / due today):**
```
Subject: Payment Reminder — [Invoice #] — [Client Name]

Hi [Client Name],

This is a friendly reminder that invoice [Invoice #] for [Amount] [Currency] is due on [Due Date].

Please arrange payment at your earliest convenience to avoid late fees.

Best regards,
Krave Media
```

**Overdue Notice (1–6 days overdue):**
```
Subject: Overdue Invoice — [Invoice #] — [Client Name]

Hi [Client Name],

Invoice [Invoice #] for [Amount] [Currency] was due on [Due Date] and remains unpaid.

Please arrange payment immediately. A late fee of USD $200 will be applied after 7 days overdue per our payment terms.

Best regards,
Krave Media
```

**Late Fee Notice (7+ days overdue):**
```
Subject: Updated Invoice with Late Fee — [Invoice #] — [Client Name]

Hi [Client Name],

As payment for invoice [Invoice #] has not been received, a late fee of USD $200 has been applied per our payment terms.

Updated total: [original + $200]. Please arrange payment at your earliest convenience to prevent further fees.

Best regards,
Krave Media
```

**Collections Flag (post to Slack, tag Noa):**
```
⚠️ @Noa — [Client Name] invoice [Invoice #] for [Amount] is 2+ months overdue.
Recommend moving to Collections in ClickUp and initiating legal follow-up.
```

### Step 4 — Update Tracker After Action
After each reminder or late fee action, update the row in the Client Invoice Tracker:
- Column I (Status): update to reflect current state (e.g. `Overdue — Reminder Sent`, `Late Fee Applied`)
- Column K (Reminders Sent): append the reminder type + date (e.g. `7d 2026-04-10 | 5d 2026-04-12`)

Use `sheets_find_row` to locate the row by Invoice # (Column D), then `sheets_update_row` to update.

### Step 5 — Apply Late Fee in Airwallex
When 7 days overdue:
1. Use `airwallex_get_invoice` with the Airwallex Invoice ID (Column E) to retrieve current invoice
2. Add late fee line item: `Late Payment Fee — [Month Year] — USD $200`
3. Note: Airwallex may require re-finalizing — flag to John if API doesn't support direct edit

---

## Mode 3: Payment Detection (Auto-triggered by payment-detection skill)
When the `payment-detection` skill confirms a payment, it will call back here to:
- Update Column I (Status) → `Payment Complete`
- Update Column L (Payment Confirmed Date) → date confirmed
- Post to #payments-invoices-updates: `✅ [Client] — [Invoice #] — [Amount] paid`
- Update ClickUp: Approved → Payment Complete

---

## Known Recurring Invoices (auto-create monthly, no Slack request needed)
| Invoice | Amount | Send To |
|---------|--------|---------|
| Nancy Creative Engine — Krave | SGD $6,877 | Ronald (search "Nancy Creative Engine Krave" in Noa's sent mail for contact) |
| IM8 Creative Engine — Krave | USD $5,250 | josh.kong@prenetics.com |
