# Skill: Payment Detection
**Trigger:** "check for payments", "scan for payments", "detect payments", "/payment-detection"
**Runs:** Daily via cron (9 AM ICT) — also invocable manually
**SOP:** references/sops/client-invoice-creation.md (Step 5)

---

## Purpose
Scan noa@kravemedia.co for Airwallex deposit notification emails, match each deposit to an open invoice in the Client Invoice Tracker, update statuses, and notify the team in Slack. Eliminates the manual "check with Noa" loop for Amanda.

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
| G | Amount | |
| H | Currency | |
| I | Due Date | |
| J | Status | Read/write |
| K | Requested By | |
| L | Reminders Sent | |
| M | Payment Confirmed Date | Write date when payment confirmed |
| N | Status (display) | Formula-driven — **do NOT write to this column** |

---

## Execution Steps

### Step 1 — Scan Noa's Gmail for Deposit Notifications
Search noa@kravemedia.co for Airwallex payment confirmation emails:

```
from:airwallex.com subject:payment OR subject:deposit OR subject:received newer_than:7d
```

Also try:
```
from:no-reply@airwallex.com newer_than:7d
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

### Step 4 — Update Client Invoice Tracker
For each confirmed match, update the row using `sheets_update_row`:

| Column | Update |
|--------|--------|
| J — Status | `Payment Complete` |
| M — Payment Confirmed Date | Today (YYYY-MM-DD) |

**Range format note:** Use bare ranges like `J8` or `J8:M8`, not `Sheet1!J8` or `Invoices!J8`. The MCP server resolves to the correct tab automatically.

**Do NOT write to Column N** — it is formula-driven.

### Step 5 — Update Airwallex
For each matched invoice:
1. Use `airwallex_get_invoice` to retrieve current status
2. If status is not already `PAID`:
   - Call `airwallex_mark_paid` with the Airwallex Invoice ID (Col F)
   - If `airwallex_mark_paid` succeeds → no Slack flag needed
   - If `airwallex_mark_paid` fails → post to #payments-invoices-updates: `⚠️ Airwallex invoice [Invoice #] needs manual status update → mark as paid`

### Step 6 — Post Payment Confirmation to Slack
For each matched payment, post to #payments-invoices-updates (C09HN2EBPR7):

```
✅ *Payment Received — [Client Name]*
• Invoice: [Invoice #]
• Amount: [Amount] [Currency]
• Confirmed: [Date from email]
• Tracker: Updated to Payment Complete

[If Airwallex needs manual update]: ⚠️ Mark as paid in Airwallex → Invoices
```

This gives Amanda and the team full visibility without going through Noa.

### Step 7 — Handle Unmatched Deposits
For any deposit email with no invoice match:

```
⚠️ *Unmatched Deposit Detected*
• Amount: [Amount] [Currency]
• Date: [Date]
• Email subject: [Subject]
• Action needed: Match this to an invoice manually and confirm in tracker
```

Post to #payments-invoices-updates and tag @john (or VA).

### Step 8 — Output Run Summary
After processing all emails, output a summary:

```
*Payment Detection Run — [DATE]*
✅ Matched & updated: [n] invoices
⚠️ Unmatched deposits: [n] (posted to Slack)
⚠️ Airwallex manual updates needed: [n]
⏭️ Shopify payments skipped: [n]
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
- If the same deposit email is seen twice across runs, deduplicate by checking if Column J is already `Payment Complete`
