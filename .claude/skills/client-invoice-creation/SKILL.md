# Skill: Client Invoice Creation

**Trigger:** Run this skill to process pending invoice requests and approvals.
**Manual invoke:** `/client-invoice-creation`
**Current automation boundary:** Invoice request intake creates Airwallex drafts; Invoice Approval Polling is the only active approval/finalization workflow. The old Client Invoice Creation n8n finalization workflow is deprecated/inactive and should only be used for rollback.
**Channels monitored:**
- C0AQZGJDR38 — John's private channel (approval replies)
- C09HN2EBPR7 — #payments-invoices-updates (form submission receipts)

---

## Key Data

- John's Slack ID: @U0AM5EGRVTP
- Noa's Slack ID: @U06TBGX9L93
- John's private channel: C0AQZGJDR38
- #payments-invoices-updates: C09HN2EBPR7
- Late fee: always USD $200/month, starting 1 week after due date
- **Client Invoice Tracker Sheet ID:** `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`
- **Client Invoice Tracker Tab:** `Invoices`
- **Linked payment account:** `098284a3-e595-4c5c-a0bf-dabd4c8b97ec` (SGD Global Account — DBS)

---

## Column Map (Client Invoice Tracker)

| Col | Field | Notes |
|-----|-------|-------|
| A | Date Created | |
| B | Client Name | |
| C | Email Address | Client billing email |
| D | Project Description | Line items summary or memo |
| E | Invoice # | Airwallex invoice `number` (`INV-...`) |
| F | Airwallex Invoice ID | Airwallex invoice `id` (`inv_...`) - used as lookup key |
| G | Amount | Total of all line items |
| H | Currency | |
| I | Due Date | From form receipt |
| J | Payment Status | State machine — read/write; operational status |
| K | Requested By | Strategist/requester name from receipt; keep Slack ID separately for mentions |
| L | Reminders Sent | Append-only log |
| M | Payment Confirmed Date | Written by payment-detection skill |
| N | Status | Formula-driven display — **NEVER write to this column** |
| P | Origin Thread TS | Slack receipt thread; draft and final notifications reply here |
| Q | Amount Paid | Cumulative paid amount |
| R | Invoice URL | Airwallex hosted payment link — written on approval |

---

## Routing

Slack invoice receipts, draft confirmations, John approval notifications, and approval-finalized notifications must be posted by the `Krave Slack Bot` n8n credential. Do not use a user-profile Slack connector for operational corrections that are part of the invoice audit trail; route them through the bot/n8n path.

On every run, check channels in this order:

1. **C0AQZGJDR38** — scan for "approve" replies in invoice notification threads that do NOT yet have a ✅ reaction → **Mode 2**
2. **C09HN2EBPR7** — scan for form receipt messages that do NOT yet have a ✅ reaction → **Mode 1**

Process Mode 2 first (approval is time-sensitive), then Mode 1.
If nothing pending in either channel → exit cleanly.

**Dedup signal:** ✅ (`white_check_mark`) reaction on the message = already actioned. Never process a ✅-reacted message.

---

## Mode 1: Invoice Creation

Triggered by form receipts in #payments-invoices-updates posted by the `/invoice-request` Slack modal.

### Step 1 — Read receipts

`mcp__slack__slack_get_channel_history(channel: C09HN2EBPR7)`

Look for messages matching this format. Skip any already ✅-reacted.

```
✅ Invoice request received
- Requester: [slack_username]
- Client: [client_name]
- Billing Address: [address or -]
- Amount: [CURRENCY] [total]
- Invoice Date: [YYYY-MM-DD or 'Needs review']
- Payout: [payout_string]
- Due Date: [YYYY-MM-DD or 'Needs review']
- Memo: [text or -]
- Email: [email or -]
- Line Items: [raw_text; raw_text; ...]
- Status: Received and processing
```

### Step 2 — Parse and validate

Extract from each unprocessed receipt:

| Field | Source |
|-------|--------|
| `client_name` | "- Client:" line |
| `client_email` | "- Email:" line — **required**; if "-" or missing → post in thread asking for email, skip receipt, do NOT proceed |
| `currency` | "- Amount:" line — prefix before space (e.g. "USD") |
| `due_date` | "- Due Date:" line |
| `days_until_due` | difference between Invoice Date and Due Date in days; default 7 if either is "Needs review" |
| `memo` | "- Memo:" line (use "-" as empty) |
| `requester` | "- Requester:" line (Slack username) |
| `requester_id` | Resolve via `mcp__slack__slack_get_users` — match `name` or `display_name` to `requester` → get `id`. Use `<@{id}>` for all Slack mentions. Fall back to `@{requester}` only if lookup fails. |
| `receipt_ts` | message timestamp — retain for ✅ react and thread replies |
| `line_items` | "- Line Items:" line — split by "; ", then parse each entry freeform: |

**Line item parsing (freeform, in order of attempt):**
1. Pipe: `description | quantity | unit_price`
2. @ format: `description x quantity @ unit_price`
3. Trailing number: `description unit_price` (quantity = 1)
4. Natural language: use judgment to extract description, quantity, unit_price

If any line item has no parseable `unit_price` after all attempts → post note in the receipt thread asking requester to clarify that specific item, skip the entire receipt, do NOT proceed.

### Step 3 — React to receipt

`mcp__slack__slack_add_reaction(channel: C09HN2EBPR7, timestamp: receipt_ts, reaction: white_check_mark)`

Do this immediately before any API calls to prevent double-processing.

### Step 4 — Airwallex API flow

**4a — Customer lookup/create:**
1. `mcp__krave-airwallex__airwallex_list_customers(email: client_email)` — email-first lookup
2. If no results → `airwallex_list_customers(name: client_name)` — name fallback
3. If still no results → `airwallex_create_customer(name: client_name, email: client_email, type: BUSINESS)`
4. → get `billing_customer_id`

**4b — Per line item (create product + price):**
For each parsed line item:
- `airwallex_create_product(name: "[client_name] — [description]")` → `product_id`
- `airwallex_create_price(product_id, currency, unit_amount: unit_price)` → `price_id`

Retain `{price_id, quantity}` for each item.

**4c — Create invoice shell:**
`airwallex_create_invoice`:
- `billing_customer_id`: from 4a
- `currency`: from receipt
- `days_until_due`: from receipt (default 7)
- `collection_method`: `CHARGE_ON_CHECKOUT`
- `memo`: from receipt (omit if "-")
→ `invoice_id`

Note: `linked_payment_account_id` is omitted — the API auto-assigns the account's default payment account.

**4d — Add line items:**
`airwallex_add_invoice_line_items(invoice_id, [{price_id, quantity}, ...])`

**Do NOT finalize yet.** Draft holds for John's approval.

### Step 5 — Log to tracker

`mcp__google-sheets__sheets_append_row` — Sheet ID `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`, tab `Invoices`:

| Col | Value |
|-----|-------|
| A | Today YYYY-MM-DD |
| B | client_name |
| C | client_email |
| D | Line items summary (descriptions joined by ", ") or memo if no items |
| E | Invoice number from Airwallex response |
| F | invoice_id (e.g. `inv_xxx`) |
| G | Total amount (sum of quantity × unit_price across all line items) |
| H | currency |
| I | due_date |
| J | `Draft - Pending John Review` (Payment Status) |
| K | requester username |
| L | (blank) |
| M | (blank) |

### Step 6 — Notify John

`mcp__slack__slack_post_message(channel: C0AQZGJDR38)`:

```
📋 *New Invoice Draft — [client_name]*
• Amount: [total] [currency]
• Line Items: [descriptions summary]
• Client email: [client_email]
• Due: [due_date] ([days_until_due]-day terms)
• Invoice ID: [invoice_id]
• Airwallex Invoice #: [invoice_number]
• Requested by: <@[requester_id]>
• 🔗 Request thread: https://krave.slack.com/archives/C09HN2EBPR7/p[receipt_ts with dots removed]

Reply *approve* in this thread to finalize and share payment link with requester.
```

The thread link encodes `receipt_ts` so Mode 2 can extract it without a separate lookup.

---

## Mode 2: Invoice Approval

Triggered by John replying "approve" in an invoice notification thread in C0AQZGJDR38.

### Step 1 — Detect pending approvals

`mcp__slack__slack_get_channel_history(channel: C0AQZGJDR38)`

Find messages containing "New Invoice Draft" (Mode 1 notifications). For each, check replies via `mcp__slack__slack_get_thread_replies`. Look for replies containing "approve" that do NOT have a ✅ reaction.

Extract from the parent notification message:
- `invoice_id` — from "Invoice ID:" line (format `inv_xxx`)
- `receipt_ts` — from the 🔗 thread URL (the digits after `/p`, re-insert dot before last 6 digits)
- `requester` — from "Requested by:" line
- `client_name`, `currency`, `due_date` — from respective lines
- `approval_reply_ts` — timestamp of John's "approve" reply

**Before proceeding**, cross-check the tracker to guard against double-processing:
`mcp__google-sheets__sheets_find_row(spreadsheet_id: 1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50, sheet_name: Invoices, column: F, value: invoice_id)`
- If the row's Payment Status (Col J) is already `Invoice Sent`, `Payment Complete`, or `Collections` → skip this approval entirely. The n8n workflow already processed it.
- Only proceed if Payment Status is `Draft - Pending John Review`.

### Step 2 — React to approval reply

`mcp__slack__slack_add_reaction(channel: C0AQZGJDR38, timestamp: approval_reply_ts, reaction: white_check_mark)`

Do this immediately to prevent double-processing.

### Step 3 — Finalize invoice

`mcp__krave-airwallex__airwallex_finalize_invoice(invoice_id: invoice_id)`

→ status becomes OPEN/UNPAID.

### Step 4 — Get payment link

`mcp__krave-airwallex__airwallex_get_billing_invoice(invoice_id: invoice_id)`

→ extract `hosted_invoice_url`

### Step 5 — Reply to original request thread

`mcp__slack__slack_reply_to_thread(channel: C09HN2EBPR7, thread_ts: receipt_ts)`:

```
<@[requester_id]> Invoice finalized. Here's the payment link:
[hosted_invoice_url]
Due: [due_date]

Please download the file and send to the client along with the digital invoice link.
```

### Step 6 — Update tracker

`mcp__google-sheets__sheets_find_row(spreadsheet_id: 1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50, sheet_name: Invoices, column: F, value: invoice_id)`
→ `mcp__google-sheets__sheets_update_row(...)`:
- Col J (Payment Status) → `Sent — Awaiting Payment`
- Col R (Invoice URL) → `hosted_invoice_url`

---

## Mode 3: Payment Detection Callback

Called by the `payment-detection` skill when a payment is confirmed.

- Col J → `Payment Complete`
- Col M → confirmed date (YYYY-MM-DD)
- Post to #payments-invoices-updates: `✅ [client_name] — [Invoice #] — [Amount] [Currency] paid`

---

## Known Recurring Invoices

Already set up as Airwallex subscriptions — no action needed:

| Invoice | Amount | Status |
|---------|--------|--------|
| Nancy Creative Engine — Krave | SGD $6,877 | Airwallex subscription, starts 2026-05-01 |
| IM8 Creative Engine — Krave | USD $5,250 | Airwallex subscription, starts 2026-05-01 |

---

## WhatsApp Client Exception

One client communicates via WhatsApp only and does not use the Slack form. That client is handled manually outside this skill entirely. The skill enforces email as required — no exceptions within the skill flow.
