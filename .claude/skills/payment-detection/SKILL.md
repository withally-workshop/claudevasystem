# Skill: Payment Detection
**Trigger:** "check for payments", "scan for payments", "detect payments", "/payment-detection"
**Runs:** Hourly via cron (n8n workflow `NurOLZkg3J6rur5Q`) — also invocable manually
**SOP:** references/sops/client-invoice-creation.md (Step 5)

---

## Purpose
Scan noa@kravemedia.co for Airwallex deposit notifications **and** John's forwarded receipts received since the last run, match each deposit to an open invoice in the Client Invoice Tracker using **strict client-name + amount matching**, update statuses, and notify the team in Slack. Eliminates the manual "check with Noa" loop for Amanda.

**Airwallex mark-as-paid (v7, 2026-06-11):** the n8n workflow auto-marks invoices paid in Airwallex **only** behind a confidence gate plus a runtime verification guard (re-fetch the live Airwallex invoice; require currency + total match and not already paid). Anything below the gate or failing verification keeps the tracker write but flags "NEEDS MANUAL mark-as-paid" in the Slack alert. Unconditional auto-mark stays banned (May 2026 WELLE incident — see WORKFLOWS.md "Hardening Notes" v4 and v7).

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
| J | Payment Status | Read/write operational lifecycle state |
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

The n8n automated workflow uses `$getWorkflowStaticData('global').lastRunTs` for precise time-windowing between runs. That state is internal to n8n and not accessible here. The Gmail search must run once per workflow execution from that last-scan timestamp; never feed tracker rows into the Gmail search node.

### Step 1 — Scan Noa's Gmail for Deposit Notifications
Search noa@kravemedia.co for Airwallex deposit notifications **and** John's forwarded client receipts. The n8n workflow's combined query is:

```
((from:airwallex.com (subject:payment OR subject:deposit OR subject:received))
 OR (from:john@kravemedia.co to:noa@kravemedia.co
     (subject:receipt OR subject:wire OR subject:transfer OR subject:paid OR subject:confirmation OR subject:fwd OR subject:fw OR subject:INV)
     -subject:reminder -subject:"following up" -subject:"due today" -subject:overdue))
 after:{lastRunTs}
```

The forwarded clause requires `to:noa@kravemedia.co` (skips reminder CCs) AND excludes reminder phrases as a belt-and-suspenders guard. For manual skill runs, fall back to `newer_than:1d`.

For each result, call `gmail_get_message` (or `gmail_read_message`) to extract:
- Sender
- Subject line
- Email body — extraction order: `text/plain` → `text/html` (strip tags) → PDF attachment (if Airwallex email + empty body + `application/pdf` attachment present) → `msg.snippet`
- Date received

**Body extraction order (v6.3):** Node `n3` uses a recursive MIME walker (`findBodyParts`) for text parts. If body is still empty AND source is `airwallex-email` AND the MIME tree contains an `application/pdf` attachment: download via Gmail Attachments API (`requestWithAuthentication`, gmailOAuth2 `vxHex5lFrkakcsPi`), inflate FlateDecode streams, parse ToUnicode CMaps, decode CID content stream operators (BT/ET/Tf/Tj/TJ) → plain text. This handles Airwallex Global Account "Confirmation of Receipt of Funds" PDFs (Typst 0.13.1, NotoSans Identity-H encoding) whose email body is completely empty. If Gmail search returns a stripped payload, a full-message fetch is performed first (same credential).

**Body extraction order (v6.2):** Node `n3` uses a recursive MIME walker (`findBodyParts`) that traverses the full MIME tree at any nesting depth. Airwallex invoice-paid notification emails nest `text/html` at level 3+ (`multipart/mixed → multipart/alternative → text/html`) — the invoice reference is in the HTML body. The v6.3 PDF path handles the deposit confirmation email type which v6.2 could not (empty body, no HTML).

**Classify each email:**
- **Client payment:** rounded number (e.g. $3,400.00 USD, $4,590.00 SGD) — no Shopify reference
- **Shopify payment:** irregular amount (e.g. $588.93 SGD), reference contains "Shopify" — SKIP for client invoice matching
- **Unknown:** flag for manual review

### Step 2 — Pull Open Invoices from Tracker
Use `sheets_get_rows` on the Client Invoice Tracker:
- **Sheet ID:** `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`
- **Tab:** `Invoices`
- **Range:** `A:R`

Filter for rows where Column N (Status) is `Unpaid`, `Overdue`, or blank, and Column J (Payment Status) is NOT `Payment Complete`, NOT `Collections`, and not a draft. Column N may be read for eligibility, but it must never be written.

Build a lookup map: `{ invoice_number: row, amount: row, client_name: row }`

### Step 3 — Match Deposits to Invoices (STRICT — May 2026, hardened through v5.1)

The matcher runs in this order:

**Tier 0 — Pre-checks (silent skip):**
- **Depositor denylist** (parse stage) — `STRIPE PAYMENTS`, `SHOPIFY`, `PAYPAL HOLDINGS`, `GUSTO` deposits silently skipped (Krave's own Shopify/Stripe payouts, not client invoice payments)
- **Already-reconciled check** — if the deposit's client + amount + currency matches a tracker row already in `Payment Complete`, silently dedup. Same for invoice-number matches against paid rows. Prevents Needs Review noise from late-arriving Airwallex notifications of payments we manually reconciled.
- **PDF-extraction fallback dedup (v6.3)** — for `airwallex-email` where PDF extraction failed (clientName still null after PDF parse), check `completedRows` by amount + currency within a 90-day payment window. If matched, silently dedup. Belt-and-suspenders against the deposit confirmation email type routing to Needs Review repeatedly.
- **EmailId idempotency** — every processed email is added to `staticData.processedEmailIds` (last 500); re-runs skip already-seen.
- **Body keyword filter** — emails containing "shopify" silently skipped.

**Tier 1 — Invoice number match (`high`):**
Extract `INV-XXX` (must have dash prefix) from subject + body. Find exact Col E match among open rows. For forwarded emails, additionally require client-name fuzzy match if both depositor and tracker client name present.

**Tier 1b — Forwarded receipts with no parseable amount (`high-tracker-amount`):**
When an invoice number matches but body has no amount (e.g., John forwarded a screenshot), use the tracker's invoice amount.

**Tier 2 — Airwallex deposit emails: amount + currency + client-name (`medium-client`):**
Token-based fuzzy match drops corporate suffixes (LLC, LTD, INC, PTE, PTY, etc.). Forwarded receipts skip this tier — they must hit Tier 1.

**No amount-only fallback.** If none of the above tiers produce a high-confidence match → route to `Slack Needs Review` with parsed signals. Never silently drop, never auto-write.

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
| J — Payment Status | `Payment Complete` |
| M — Payment Confirmed Date | Today (YYYY-MM-DD) |
| Q — Amount Paid | Full invoice amount |

**Range format note:** Use bare ranges like `J8` or `J8:M8`, not `Sheet1!J8` or `Invoices!J8`. The MCP server resolves to the correct tab automatically.

**Do NOT write to Column N** — it is formula-driven.

### Step 5b — Airwallex Mark Paid (v7: confidence-gated + verified)

The n8n workflow re-introduced `mark_as_paid` on 2026-06-11, gated twice:

**Confidence gate (`awMarkEligible`, computed in the matcher)** — eligible only when ALL hold:
- Full payment (not partial), non-Osome, tracker row has an Airwallex Invoice ID
- Match confidence is `high` / `high-tracker-amount` (invoice-number match), OR `medium-client` where a single payment settles the exact full invoice amount (Col Q was 0 and |received − Col G| < $0.01)

**Runtime verification guard (`Airwallex Guarded Mark Paid` node)** — before writing, re-fetches the live Airwallex invoice and requires: currency matches the deposit, `total_amount` matches the tracker amount (±0.01), and `payment_status` is not already `PAID`/void. Any mismatch, auth failure, or API error → no write, Slack flags "NEEDS MANUAL mark-as-paid — [reason]".

Auth uses the n8n credential `Airwallex API (login headers)` (`httpCustomAuth`, ID `Ry37bj6SFVD1zcd0`) via the `Airwallex Auth` HTTP Request node — no API keys in workflow code. (Code nodes on this instance lack `this.helpers.requestWithAuthentication`; only `this.helpers.httpRequest` works.)

For **manual skill runs** where you've human-verified the payment, you may call `airwallex_mark_paid` deliberately — but never automate it from a parsed email without the gate + guard above.

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
• Airwallex: [✅ marked paid automatically (…) | already PAID in Airwallex | ⚠️ NEEDS MANUAL mark-as-paid — reason]
```

**Needs review (parsed signal but no high-confidence match):**
```
⚠️ *Payment email needs human review*
• Subject: [...]
• Source: [airwallex-email | forwarded]
• Parsed amount / currency / invoice / depositor: [...]
• Reason: [why no match was made]
```

All three post to #payments-invoices-updates (C09HN2EBPR7).

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
- Runs hourly via n8n cron (`NurOLZkg3J6rur5Q`). Manually invocable: "check for payments" or "/payment-detection"
- Shopify deposits are NOT client invoice payments — always skip for matching purposes
- **Time-windowed scanning (n8n):** the workflow uses `$getWorkflowStaticData('global').lastRunTs` to track last-run Unix timestamp; first run falls back to `newer_than:1d`. **Never reset `lastRunTs` to backfill** — the email-ID dedup log is the supported backfill mechanism.
- **Manual skill runs:** use `newer_than:1d` and verify each match manually.
- **Idempotency:** `staticData.processedEmailIds` (last 500) prevents reprocessing the same email twice across runs.
- **Airwallex mark-paid (v7):** auto-marks only behind the confidence gate + live verification guard (Step 5b). Unconditional auto-mark stays banned (May 2026 WELLE incident). Slack always reports the Airwallex outcome — no silent gaps.
- **Partial payments:** detected by comparing received amount to Col G after accounting for Col Q. Sets Col J `Partial Payment` and updates Col Q.
- **Airwallex API poll:** runs in parallel with the Gmail scan. Uses `this.helpers.httpRequest` (the v3 fix — `$helpers` was undefined). Polls `GET /api/v1/invoices/{id}` for each open Airwallex tracker row.
- **Second payment handling:** when a subsequent payment arrives, accumulates Col Q and flips to `Payment Complete` when remaining ≤ $1.
