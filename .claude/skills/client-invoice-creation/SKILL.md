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

## What This Skill Does
Two modes depending on trigger:

1. **Invoice Creation Mode** — reads #payments-invoices-updates for new client invoice requests, auto-drafts in Airwallex, replies to sender, reacts ✅. No PandaDoc check — Noa reviews drafts manually before submitting.
2. **Payment Follow-Up Mode** — reviews open Airwallex invoices for overdue status, generates reminder emails and late fee notices, flags collections cases

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

### Step 5 — Log for 5pm Digest
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

### Step 1 — Identify Overdue Invoices
Use `airwallex_list_invoices` with status filter. For each open invoice:
- Calculate days since due date
- Classify status per the table below

### Step 2 — Generate Actions by Status
| Days Overdue | Action |
|-------------|--------|
| 0 (due today) | Generate 5-day warning reminder email |
| 1–7 days | Generate 5-day warning reminder email |
| 8–14 days | Generate late fee notice + new line item (+USD $200) |
| 60+ days | Flag for Collections — draft owner notification |

### Step 3 — Draft Emails
**5-Day Warning:**
```
Subject: Payment Reminder — [Invoice #] — [Client Name]
Hi [Client Name],
This is a friendly reminder that invoice [Invoice #] for [Amount] is now due. Please arrange payment within 5 days to avoid late fees being applied.
You can view and pay your invoice here: [link]
Best regards, Krave Media
```

**Late Fee Notice:**
```
Subject: Updated Invoice with Late Fee — [Invoice #] — [Client Name]
Hi [Client Name],
As payment for invoice [Invoice #] has not been received, a late fee of USD $200 has been applied per our payment terms.
Updated total: [original + $200]. Please arrange payment at your earliest convenience to prevent further fees.
Best regards, Krave Media
```

**Collections Flag (post to Slack, tag Noa):**
```
⚠️ @Noa — [Client Name] invoice [Invoice #] for [Amount] is 2+ months overdue.
Recommend moving to Collections in ClickUp and initiating legal follow-up.
```

### Step 4 — Payment Matching (when deposit notification received)
When a payment notification email is shared:
- Identify if client payment (rounded number) or Shopify (irregular, reference = 'Shopify')
- Match to open invoice by: amount + invoice number (NOT customer reference)
- Output: "Match found: [Invoice #] — [Client] — [Amount]. Mark Payment Complete in ClickUp."

---

## Key Data
- VA handle: @U0AM5EGRVTP
- Noa handle: @U06TBGX9L93
- Late fee: always USD $200/month, starting 1 week after due date
- Line item format: `Late Payment Fee — [Month Year] — USD $200`
- ClickUp flow: Approved → Payment Complete (or → Collections if 2+ months overdue)

## Known Recurring Invoices (auto-create monthly, no Slack request needed)
| Invoice | Amount | Send To |
|---------|--------|---------|
| Nancy Creative Engine — Krave | SGD $6,877 | Ronald (search "Nancy Creative Engine Krave" in Noa's sent mail for contact) |
| IM8 Creative Engine — Krave | USD $5,250 | josh.kong@prenetics.com |
