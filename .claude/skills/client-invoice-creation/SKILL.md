# Skill: Client Invoice Creation
**Trigger:** Strategist @tags Claude EA in #payments-invoices-updates with billing details
**Channel:** #payments-invoices-updates (C09HN2EBPR7)
**SOP:** references/sops/client-invoice-creation.md

---

## Trigger Rules
- Strategists must **@tag Claude EA** in #payments-invoices-updates to trigger invoice creation
- Messages without a Claude EA @mention are informational — do NOT process them
- No invoice attachment required for client invoices

---

## Key Data
- VA handle: @U0AM5EGRVTP
- Noa handle: @U06TBGX9L93
- John's private channel: C0AQZGJDR38
- Late fee: always USD $200/month, starting 1 week after due date
- **Client Invoice Tracker Sheet ID:** `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`
- **Client Invoice Tracker Tab:** `Invoices`

---

## Column Map (Client Invoice Tracker)

| Col | Field | Notes |
|-----|-------|-------|
| A | Date Created | |
| B | Client Name | |
| C | Email Address | Client billing email — used for sending invoice email |
| D | Project Description | |
| E | Invoice # | From Airwallex response |
| F | Airwallex Invoice ID | From Airwallex response |
| G | Amount | |
| H | Currency | |
| I | Due Date | today + payout days (default 7) |
| J | Status | State machine — read/write |
| K | Requested By | Strategist name |
| L | Reminders Sent | Append-only log |
| M | Payment Confirmed Date | Written by payment-detection skill |
| N | Status (display) | Formula-driven — **NEVER write to this column** |

---

## Mode 1: Invoice Creation

### Step 1 — Pull New Requests from Slack
Read recent messages in C09HN2EBPR7. Look for:
- Messages from strategists with Claude EA @mention requesting invoice creation
- Extract: client name, project description, amount, currency, payout terms
- Skip: ✅ white_check_mark reacted messages (already actioned), casual replies

### Step 2 — Validate Required Fields
Before drafting, check:
- Client name present? ✓/✗
- Amount present? ✓/✗
- Currency present? ✓/✗ — if missing, ask. Do NOT assume.
- Payout terms not stated? → **Default to 7 days.** No need to ask.

If client name, amount, or currency missing → reply in thread:
```
Missing info needed to create this invoice:
• [list what's missing]
Please provide and re-tag me.
```
Do NOT draft.

If all required fields present → proceed to Step 3.

### Step 3 — Reply to Sender
Post a reply in the message thread immediately:
```
Got it! Drafting invoice for [Client Name] — [Amount] [Currency]. Will have it ready for John's review shortly.
```

### Step 4 — Draft in Airwallex
⚠️ **Airwallex Billing API is in Beta — not yet enabled on this account.**
Invoice creation via API is blocked until the Account Manager enables the Billing module.

**Current workaround:**
Skip API creation. Instead, post to John's private channel (C0AQZGJDR38) with all details needed to create the invoice manually in Airwallex:

```
📋 *New Invoice Request — manual creation needed*
• Client: [Client Name]
• Amount: [Amount] [Currency]
• Project: [Project Description]
• Due: [Due Date] ([N]-day terms)
• Collection method: CHARGE_ON_CHECKOUT (digital invoice)
• Requested by: [Strategist]

Create in Airwallex → Invoices → New Invoice, then reply with the Invoice ID.
```

**Once Billing API is enabled (contact Account Manager):**

Fixed IDs (already confirmed):
- `linked_payment_account_id`: `098284a3-e595-4c5c-a0bf-dabd4c8b97ec` (SGD Global Account — DBS)
- `legal_entity_id`: omit on first attempt — Airwallex may auto-resolve from account

**Step 4a — Customer lookup:**
1. `airwallex_list_customers(name: client_name)` — search for existing billing customer
   - Found → use `billing_customer_id`
   - Not found → `airwallex_create_customer(name, email, type: BUSINESS, default_billing_currency: currency)` → get new ID

**Step 4b — Create product:**
`airwallex_create_product(name: project_description)` → get `product_id`
- This represents the service being invoiced (e.g. "Krave Media Starter Pack")

**Step 4c — Create one-time price:**
`airwallex_create_price(product_id, currency, unit_amount: amount)` → get `price_id`
- Must be one-time (non-recurring) — the tool sets `recurring: false` automatically

**Step 4d — Create invoice (no line items yet):**
`airwallex_create_invoice`:
- `billing_customer_id`: from 4a
- `currency`: from request
- `days_until_due`: payout terms (default 7)
- `collection_method`: `CHARGE_ON_CHECKOUT`
- `linked_payment_account_id`: `098284a3-e595-4c5c-a0bf-dabd4c8b97ec`
- `legal_entity_id`: omit (add only if API returns a missing field error)

**Step 4e — Add line items:**
`airwallex_add_invoice_line_items(invoice_id, line_items)`:
- `price_id`: from 4c
- `quantity`: 1

Note the invoice ID returned from Step 4d.

### Step 5 — Log to Client Invoice Tracker
Use `sheets_append_row` with Sheet ID `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`, tab `Invoices`:

| Col | Value |
|-----|-------|
| A — Date Created | Today (YYYY-MM-DD) |
| B — Client Name | From request |
| C — Email Address | Leave blank — not available at creation time |
| D — Project Description | From request |
| E — Invoice # | From Airwallex response |
| F — Airwallex Invoice ID | From Airwallex response |
| G — Amount | From request |
| H — Currency | From request |
| I — Due Date | today + payout days (YYYY-MM-DD) |
| J — Status | `Draft — Pending John Review` |
| K — Requested By | Strategist name from Slack |
| L — Reminders Sent | (blank) |
| M — Payment Confirmed Date | (blank) |

### Step 6 — React and Notify John
1. React ✅ to the original Slack message
2. Post to John's private channel (C0AQZGJDR38):
```
📋 *New Invoice Draft — [Client Name]*
• Amount: [Amount] [Currency]
• Project: [Project Description]
• Due: [Due Date] ([N]-day terms)
• Requested by: [Strategist]
• Invoice ID: [inv_xxx]
• Airwallex Invoice #: [invoice_number]

Reply *approve* in this thread to finalize and send.
```

---

## Mode 2: Payment Detection Callback
Called by the `payment-detection` skill when a payment is confirmed.

When payment-detection confirms a match:
- Update Col J (Status) → `Payment Complete`
- Update Col M (Payment Confirmed Date) → confirmed date
- Post to #payments-invoices-updates: `✅ [Client] — [Invoice #] — [Amount] [Currency] paid`

---

## Known Recurring Invoices
Already set up as Airwallex subscriptions — no action needed:
| Invoice | Amount | Status |
|---------|--------|--------|
| Nancy Creative Engine — Krave | SGD $6,877 | Airwallex subscription, starts 2026-05-01 |
| IM8 Creative Engine — Krave | USD $5,250 | Airwallex subscription, starts 2026-05-01 |
