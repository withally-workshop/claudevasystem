# Skill: Payment Detection
**Trigger:** "check for payments", "scan for payments", "detect payments", "/payment-detection"
**Runs:** Daily via cron (9 AM ICT) — also invocable manually
**SOP:** references/sops/client-invoice-creation.md (Step 5)

---

## Purpose
Scan noa@kravemedia.co for Airwallex deposit notification emails **received since the last run**, match each deposit to an open invoice in the Client Invoice Tracker, update statuses, and notify the team in Slack only when a payment status changes. Eliminates the manual "check with Noa" loop for Amanda.

---

## Key Data
- **Client Invoice Tracker Sheet ID:** `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`
- **Client Invoice Tracker Tab:** `Invoices`
- **Noa Gmail MCP:** `mcp__gmail-noa__*` (service account impersonation — noa@kravemedia.co)
  - Fallback if gmail-noa not available: use global OAuth Gmail MCP (`mcp__claude_ai_Gmail__*`) — confirm which account it's authenticated to
- **Slack notification channel:** #payments-invoices-updates (C09HN2EBPR7)
- **Noa Slack handle:** @U06TBGX9L93

## Column Map (Client Invoice Tracker)
| Col | Field | Notes |
|-----|-------|-------|
| A | Date Created | |
| B | Client Name | |
| C | Email Address | |
| D | Project Description | |
| E | Invoice # | Primary match key |
| F | Airwallex Invoice ID | |
| G | Amount | Full invoice amount |
| H | Currency | |
| I | Due Date | |
| J | Status | Read/write |
| K | Requested By | |
| L | Reminders Sent | |
| M | Payment Confirmed Date | Write date when first/last payment confirmed |
| N | Status (display) | Formula-driven — **do NOT write to this column** |
| O | Notes | Read-only — contains "Osome" if invoice was created in Osome (no Airwallex record) |
| Q | Amount Paid | Cumulative amount paid to date — written by payment detection, read by reminder cron |

---

## Execution Steps

### Step 0 — Determine Search Window
For **manual skill runs**, use `newer_than:1d` as the search window — this is safe since manual runs are occasional and intentional.

The n8n automated workflow uses `$getWorkflowStaticData('global').lastRunTs` for precise time-windowing between runs. That state is internal to n8n and not accessible here.

### Step 1 — Scan Noa's Gmail for Deposit Notifications
Search noa@kravemedia.co for Airwallex payment confirmation emails:

```
from:airwallex.com (subject:payment OR subject:deposit OR subject:received) newer_than:1d
```

Also try:
```
from:no-reply@airwallex.com newer_than:1d
```

For each result, call `gmail_get_message` (or `gmail_read_message`) to extract:
- Sender
- Subject line
- Email body — look for: amount, currency, reference number, invoice number
- Date received

**Classify each email:**
- **Client payment:** rounded number (e.g. $3,400.00 USD, $4,590.00 SGD) — no Shopify reference
- **Shopify payment:** irregular amount (e.g. $588.93 SGD), reference contains "Shopify" — SKIP for client invoice matching
- **Unknown:** flag for manual review

### Step 2 — Pull Open Invoices from Tracker
Use `sheets_get_rows` on the Client Invoice Tracker:
- **Sheet ID:** `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`
- **Tab:** `Invoices`
- **Range:** `A:N`

Filter for rows where Column J (Status) is NOT `Payment Complete` and NOT `Collections`.

Build a lookup map: `{ invoice_number: row, amount: row, client_name: row }`

### Step 3 — Match Deposits to Invoices
For each deposit email, attempt to match using this priority order:

1. **Invoice number match** — extract invoice # from email body, find exact match in Column E
2. **Amount match** — match deposit amount to Column G (amount), cross-check Column B (client name) if possible
3. **No match** — flag as unmatched deposit, post to #payments-invoices-updates for manual review

**Match confidence rules:**
- Invoice # found in email → High confidence — proceed to Step 4
- Amount match only, one open invoice at that amount → Medium confidence — proceed with note
- Amount match, multiple invoices at same amount → Flag — post to Slack for manual confirmation
- No match at all → Flag — post to Slack for manual review

### Step 4 — Determine Full vs Partial Payment
After matching, compare the received amount to the invoice amount:

```
existingAmountPaid = Col Q (Amount Paid) — 0 if empty
newAmountPaid = existingAmountPaid + received amount
remaining = Col G (Amount) - newAmountPaid
isPartial = remaining > $1.00
```

**Partial payment (isPartial = true):**
- Update Col J → `Partial Payment`
- Update Col M → today
- Update Col Q → `newAmountPaid`
- Do NOT call Airwallex `mark_paid`
- Post Slack partial alert (see Step 6)

**Full payment (isPartial = false):**
- Proceed to Step 5 (tracker update + Airwallex)

### Step 5 — Update Client Invoice Tracker (full payment)
For each confirmed full payment, update the row:

| Column | Update |
|--------|--------|
| J — Status | `Payment Complete` |
| M — Payment Confirmed Date | Today (YYYY-MM-DD) |
| Q — Amount Paid | Full invoice amount |

**Range format note:** Use bare ranges like `J8` or `J8:M8`, not `Sheet1!J8` or `Invoices!J8`. The MCP server resolves to the correct tab automatically.

**Do NOT write to Column N** — it is formula-driven.

### Step 5 — Update Airwallex (Airwallex invoices only)
First check Col O (Notes) of the matched tracker row:
- If Notes contains "osome" (case-insensitive) → **skip this step entirely**. Osome has no API and the invoice does not exist in Airwallex.
- Otherwise:
  1. Use `airwallex_get_invoice` to retrieve current status
  2. If status is not already `PAID`:
     - Call `airwallex_mark_paid` with the Airwallex Invoice ID (Col F)
     - If `airwallex_mark_paid` fails → post to #payments-invoices-updates: `⚠️ Airwallex invoice [Invoice #] needs manual status update → mark as paid`

### Step 6 — Post Slack Alert

**Partial payment:**
```
🔄 *Partial Payment Received — [Client Name]*
• Invoice: [Invoice #]
• Received: [amount] [currency]
• Total paid: [newAmountPaid] / [invoiceAmount] [currency]
• Remaining: [remainingAmount] [currency]
• Tracker: Updated to Partial Payment
```

**Full payment:**
```
✅ *Payment Received — [Client Name]*
• Invoice: [Invoice #]
• Amount: [Amount] [Currency]
• Confirmed: [Date from email]
• Tracker: Updated to Payment Complete

[If Airwallex needs manual update]: ⚠️ Mark as paid in Airwallex → Invoices
```

Both post to #payments-invoices-updates (C09HN2EBPR7) — gives Amanda and the team full visibility without going through Noa.

### Step 7 — Output Run Summary
After processing all emails, output a summary:

```
*Payment Detection Run — [DATE]*
✅ Matched & updated: [n] invoices
⚠️ Airwallex manual updates needed: [n]
⏭️ Skipped (Shopify / unmatched / ambiguous): [n]
```

---

## Gmail MCP Fallback Logic
If `mcp__gmail-noa__gmail_search_messages` returns an auth error:
1. Try `mcp__claude_ai_Gmail__gmail_search_messages` — this may be authenticated to noa@ via OAuth
2. If both fail → post to #payments-invoices-updates: "Payment detection could not run — Gmail access issue. Manual check of noa@kravemedia.co required."
3. Alert john (operator) with the error details

---

## Notes
- Run daily at 9 AM ICT via cron (see: `.claude/skills/invoice-reminder-cron/SKILL.md`)
- Can also be triggered manually: "check for payments" or "/payment-detection"
- Shopify deposits are NOT client invoice payments — always skip for matching purposes
- **Time-windowed scanning (n8n):** the automated workflow uses `$getWorkflowStaticData('global').lastRunTs` to track the last run Unix timestamp, so each hourly run only searches emails that arrived in the new window. No external setup required.
- **Manual skill runs:** use `newer_than:1d` — safe for occasional manual use.
- **No duplicate Slack noise:** matched invoices are deduped by filtering out `Payment Complete` rows. Time-windowed queries prevent the same unmatched deposit from being re-alerted across runs.
- **Partial payments:** detected by comparing received amount to Col G (Amount) after accounting for any existing Col Q (Amount Paid). Sets status to `Partial Payment` — does NOT call Airwallex `mark_paid` until full payment is received.
- **Airwallex API poll (n8n only):** second detection path for SWIFT/bank-transfer payments that don't generate an Airwallex email. Polls `GET /api/v1/invoices/{id}` for each open Airwallex invoice. `paid_amount` field name is unconfirmed — verify on first run with a live partial invoice.
- **Second payment handling:** when a subsequent payment arrives, the workflow adds it to Col Q (cumulative) and checks remaining. If remaining ≤ $1, status becomes `Payment Complete` and Airwallex is marked paid.
