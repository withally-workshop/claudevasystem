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

## Thread Context Rule

**Never ask for information already present in the current thread.** Before asking any question, read the full thread and extract what is already known. This applies to every trigger — price replies, email requests, approval requests, anything. If the thread contains the invoice ID, client name, email, amount, payment link, or any other field, use it directly. Asking for it is an error.

When asked to email an invoice in a thread that already has the finalization message:
1. Extract client email from the earlier receipt in the thread
2. Extract payment link and invoice number from the finalization message
3. Download the PDF from Airwallex and attach it
4. CC anyone mentioned in the thread (e.g. "CC me" = CC the requester)
5. Send — do not ask any questions

---

## Routing

Slack invoice receipts, draft confirmations, John approval notifications, and approval-finalized notifications must be posted by the `Krave Slack Bot` n8n credential. Do not use a user-profile Slack connector for operational corrections that are part of the invoice audit trail; route them through the bot/n8n path.

On every run, check channels in this order:

1. **C09HN2EBPR7** — scan for bot price-prompt messages that have an unprocessed amount reply → **Mode 0**
2. **C0AQZGJDR38** — scan for "approve" replies in invoice notification threads that do NOT yet have a ✅ reaction → **Mode 2**
3. **C09HN2EBPR7** — scan for form receipt messages that do NOT yet have a ✅ reaction → **Mode 1**

Run Mode 0 first. Then Mode 2 (approval is time-sensitive). Then Mode 1.
If nothing pending in any channel → exit cleanly.

**Dedup signal:** ✅ (`white_check_mark`) reaction on the message = already actioned. Never process a ✅-reacted message.

---

## Mode 0: Price Reply Resubmit

Handles the case where the intake workflow posted a "price missing" prompt in a thread and the requester replied with the amount. This mode prevents losing all original invoice context and asking for information already present in the thread.

**Critical rule:** Never ask for client name, project description, email, due date, or any other field when a price reply is detected. All context comes from the original receipt in the thread. The requester only needed to provide the amount.

### Step 1 — Find price-prompt threads

`mcp__slack__slack_get_channel_history(channel: C09HN2EBPR7)`

Look for messages posted by the bot that match the pattern:
```
the invoice for * failed to create — the price is missing from the line item
```

For each matching message:
- Note the `thread_ts` (this is the origin thread of the original receipt)
- Skip if the message has a ✅ reaction (already processed)

### Step 2 — Check thread for amount reply

`mcp__slack__slack_get_thread_replies(channel: C09HN2EBPR7, thread_ts: [thread_ts from Step 1])`

The thread will contain:
- **Thread parent** (index 0): the original form receipt with all invoice details
- **Bot message**: the price-prompt message ("the invoice for … failed to create")
- **Requester reply**: an amount like "USD 7,400" or "7400" or "$7,400"

Look for a reply from a non-bot user that contains a number (the amount). Skip replies that are the bot's own messages. Skip replies that already have a ✅ reaction.

If no matching amount reply → skip this thread, move on.

### Step 3 — Parse original receipt from thread parent

Re-parse the original receipt message (thread parent or first non-bot message in thread) using the standard Mode 1 parsing rules:

| Field | Source |
|-------|--------|
| `client_name` | "- Client:" line |
| `client_email` | "- Email:" line |
| `currency` | "- Amount:" line prefix |
| `payout_raw` | "- Payout:" line |
| `due_date` | "- Due Date:" line |
| `memo` | "- Memo:" line |
| `submitted_by` | "- Requester:" line |
| `line_items` | "- Line Items:" line — same parsing rules as Mode 1 |
| `origin_thread_ts` | the thread_ts used to fetch this thread |

### Step 4 — Parse amount from reply

Extract the numeric value from the requester's reply. Examples:
- "USD 7,400" → `{ currency: "USD", unit_price: 7400 }`
- "7400 USD" → `{ currency: "USD", unit_price: 7400 }`
- "7,400" → `{ unit_price: 7400, currency: from receipt }`
- "$7,400" → `{ unit_price: 7400, currency: from receipt }`

Use the currency from the original receipt if not specified in the reply.

Apply the parsed `unit_price` to the missing-price line item(s) identified in the bot's price-prompt message.

### Step 5 — React to the amount reply

`mcp__slack__slack_add_reaction(channel: C09HN2EBPR7, timestamp: [reply_ts], reaction: white_check_mark)`

Do this immediately before re-submitting to prevent double-processing.

### Step 6 — Re-submit to intake webhook

`POST https://noatakhel.app.n8n.cloud/webhook/krave-invoice-request-intake`

Payload:
```json
{
  "client_name": "[from receipt]",
  "client_email": "[from receipt]",
  "currency": "[from receipt]",
  "payout_raw": "[from receipt, e.g. '7 day payout']",
  "invoice_date": "[today YYYY-MM-DD]",
  "memo": "[from receipt]",
  "origin_channel_id": "C09HN2EBPR7",
  "origin_thread_ts": "[thread_ts]",
  "submitted_by_slack_user_id": "[resolved Slack ID of requester]",
  "line_items": [
    {
      "description": "[from receipt line item]",
      "quantity": 1,
      "unit_price": [parsed amount]
    }
  ]
}
```

The intake webhook will run the full Airwallex creation flow with this complete payload.

### Step 7 — React to the original receipt

`mcp__slack__slack_add_reaction(channel: C09HN2EBPR7, timestamp: [origin_thread_ts], reaction: white_check_mark)`

Mark the original receipt as processed so Mode 1 doesn't pick it up again.

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
- `memo`: Always include the standard bank memo below. If the receipt has a project memo, append it after a blank line.

Standard memo (always included):
```
Kindly make payment by the due date to
Bank Name: DBS Bank Ltd
Bank Address: DBS Asia Central, Marina Bay Financial Centre Tower 3, 12 Marina Boulevard, Singapore 018982
Account Name: Eclipse Ventures Pte Ltd
Account Number: 8853795725
BIC/SWIFT: DBSSSGSG
or by paying via the invoice link directly.

Please note that a US$200 per month late fee applies to invoices not paid on time.
```

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
| N | (skip — formula column, never write) |
| O | (blank) |
| P | `'[receipt_ts]` (prepend apostrophe to prevent date formatting) |

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
If there's a ClickUp task for this project, include the URL: `approve https://app.clickup.com/t/...`
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

### Step 5 — Email invoice to client (automated via n8n Approval Polling)

**This step is now fully automated.** The Invoice Approval Polling workflow (uCS9lzHtVKWlqYlk) handles email sending automatically via the Render endpoint (`/api/send-invoice-email`) after finalization. No manual action required.

The automated flow:
- Downloads PDF from Airwallex `pdf_url`
- Sends via Gmail (john@kravemedia.co) with PDF attached — To: client_email, CC: noa@kravemedia.co
- Subject: `Invoice [invoice_number] - [client_name]`
- Confirms in the origin thread: "Invoice emailed to [client_email] with PDF attached."

**Manual fallback (only if automation fails):**
1. Download PDF: `GET [pdf_url]` from Airwallex invoice — follow redirects
2. Send via `mcp__gmail-john__gmail_send` with `attachment_paths` — To: client_email, CC: noa@kravemedia.co
3. Subject: `Invoice [invoice_number] - [client_name]` (ASCII dash, not em dash)
4. Reply in origin thread: `<@[requester_id]> Invoice emailed to [client_email] with PDF attached.`

### Step 6 — Reply to original request thread

`mcp__slack__slack_reply_to_thread(channel: C09HN2EBPR7, thread_ts: receipt_ts)`:

```
<@[requester_id]> Invoice finalized. Payment link:
[hosted_invoice_url]
Invoice #: [invoice_number]
Due: [due_date]
```

**Note on subject encoding:** always use ` - ` (ASCII hyphen) not ` — ` (em dash) in email subjects.

### Step 6 — Update tracker

`mcp__google-sheets__sheets_find_row(spreadsheet_id: 1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50, sheet_name: Invoices, column: F, value: invoice_id)`
→ `mcp__google-sheets__sheets_update_row(...)`:
- Col J (Payment Status) → `Invoice Sent`
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
