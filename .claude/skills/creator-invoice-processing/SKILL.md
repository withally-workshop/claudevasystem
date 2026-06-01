# Skill: Creator Invoice Processing
**Trigger:** "process invoices", "run invoice triage", "check payment channel", "/invoice-triage"
**Channel:** #payments-invoices-updates (C09HN2EBPR7)
**SOP:** references/sops/creator-invoice-management.md

---

## What This Skill Does
Receives creator/vendor invoices from three channels (email, Slack channel, Slack DMs), validates each PDF, and creates draft bills in Airwallex Spend via API. John reviews and finalizes all drafts by EOD. No automated payment — Noa handles payments every Thursday.

---

## Trigger Paths

| Path | Channel | Latency | Handler |
|------|---------|---------|---------|
| Slack DM | John's personal DM | Real-time | Krave bot (automatic) |
| Slack @mention | #payments-invoices-updates (C09HN2EBPR7) | Real-time | Krave bot (automatic) |
| Email | john@kravemedia.co | ≤3 hours | Scheduled Claude agent (every 3h, weekdays) |
| Manual | Dashboard or `/invoice-triage` | On-demand | Full sweep of all channels |

**Strategists must @tag Claude EA** in #payments-invoices-updates to trigger processing. Messages without an @mention are informational — do not action them.

**Scheduled (email):** n8n workflow `Krave — Creator Invoice Email Scan` (`DbIJYYQ3FE4HKprB`) — every 3h Mon–Fri. Deploy: `n8n-workflows/deploy-creator-invoice-email-scan.js`. Manual trigger: `POST https://noatakhel.app.n8n.cloud/webhook/krave-creator-invoice-email-scan`.

---

## Key Data

- **#payments-invoices-updates:** C09HN2EBPR7
- **Creator & AP Bills Tracker:** `14kiX9MnWyel_4_OxvL2TlnOAqBqFwwECf7Dm24znuJc`, tab: `Krave — Creator & AP Bills Tracker`
- **Airwallex legal_entity_id:** TBD — discover via Airwallex dashboard → Settings → Legal Entities once Spend API access is granted. Add here as a constant once confirmed.
- **Strategists:** Shin, Amanda, Sybil, Jeneena (Slack channel); editors/internal staff (John DMs)

---

## Dedup Guardrails

All four layers apply on every run:

1. **Slack cursor** — `slack_get_last_read(channel_id: C09HN2EBPR7)` / `slack_set_last_read` — only fetch messages after last processed timestamp
2. **✅ reaction** — any Slack message with `white_check_mark` reaction = already processed, skip always
3. **Tracker lookup** — before creating a bill, check `Bills` tab for existing row with same `external_id`. If found → skip.
4. **Airwallex `request_id`** — unique UUID per bill creation call; Airwallex rejects exact duplicate `request_id` submissions

---

## Validation Rules

| Field | Rule |
|-------|------|
| Invoice attachment | **Hardstop** — no PDF = no bill. Reply asking for invoice before doing anything. |
| Bank details | **Hardstop** — if no bank account details found in PDF (IBAN, SWIFT, account number, BSB, etc.), return to sender and ask them to reissue with bank details. Do NOT create the bill. |
| Invoice number | If missing: generate as `MMDDYYYY-[FirstInitial][LastName]` — e.g. `5282026-AGMapula` for Alleah Grace Mapula on May 28 2026 |
| Due date | If missing: use **Friday of the current week** (PHT). If today is already Friday → use today. |
| Invoice date | If missing: use today's date |

---

## Execution Steps

### Step 0 — Slack Cursor
`mcp__krave-tools__slack_get_last_read(channel_id: C09HN2EBPR7)`
- If returns a timestamp → use as `oldest` in Step 1
- If returns null → first run; fetch last 50 messages

### Step 1 — Scan #payments-invoices-updates
`mcp__slack__slack_get_channel_history(channel: C09HN2EBPR7, limit: 50, oldest: <cursor>)`

Look for messages @mentioning Claude EA that include:
- A PDF/image file attachment, OR
- Text confirming "sent via email"

Skip:
- Messages without @mention of Claude EA
- Messages already reacted ✅

### Step 2 — Scan Email (john@kravemedia.co)
`mcp__gmail-john__gmail_search_messages(query: "subject:invoice OR subject:payment OR has:attachment newer_than:7d")`

For each result:
- `mcp__gmail-john__gmail_get_message(message_id: ...)` to extract sender, subject, attachment list
- For each PDF attachment: `mcp__gmail-john__gmail_download_attachment(message_id, attachment_id)` → base64 PDF
- Multiple PDFs in one email = treat each as a **separate bill**
- Tag as Source: "Email"

**Note on DMs:** John's Slack DMs are handled real-time by krave-bot — no scheduled scan needed.

### Step 3 — Dedup Check
For each candidate submission:
- Check Creator & AP Bills Tracker (Sheet ID: `14kiX9MnWyel_4_OxvL2TlnOAqBqFwwECf7Dm24znuJc`) for existing row where `Slack Thread TS` or `Notes` contains the origin Slack ts or Gmail message_id
- If found → skip. Already processed.

### Step 4 — Parse Each PDF

Use Claude's document vision to extract:

| Field | Source |
|-------|--------|
| Creator / vendor name | Invoice header |
| Creator email | Invoice contact |
| Invoice number | Invoice ref / number field |
| Issued date | Invoice date |
| Due date | Due date or payment terms |
| Amount + currency | Invoice total |
| Line items | Services rendered |
| Bank details | Payment details section |

Apply validation rules. If any hardstop condition is triggered → skip bill creation, send reply (Step 7), log exception to tracker.

### Step 5 — Apply Derived Field Rules

**Invoice number (if blank):** Generate as `MMDDYYYY-[FirstInitial][LastName]`
- Parse from vendor/creator name on invoice
- "Alleah Grace Mapula" → first initial A, last name Mapula → `5282026-AGMapula`

**Due date (if blank):** Next Friday in PHT (UTC+8)
- If today is already Friday → use today

### Step 6 — Create Bill in Airwallex

**6a — Vendor lookup:**
`mcp__krave-airwallex__airwallex_list_vendors(name: creator_name)`
- If found → extract `vendor_id`
- If not found → `mcp__krave-airwallex__airwallex_create_vendor(name: creator_name, email: creator_email)` → get `vendor_id`

**6b — Create bill:**
`mcp__krave-airwallex__airwallex_create_bill`:
```
external_id:    <Slack thread_ts or Gmail message_id>
vendor_id:      <from 6a>
invoice_number: <from PDF or generated>
issued_date:    <from PDF or today YYYY-MM-DD>
due_date:       <from PDF or Friday of current week YYYY-MM-DD>
currency:       <from PDF>
line_items:     [{description, quantity, unit_price}, ...]
legal_entity_id: <TBD — add once confirmed, omit until then>
```

Bill status will be DRAFT or AWAITING_APPROVAL.

**API fallback (Spend API returns 401 or 404):**
- Call `slack_download_file(url_private)` using the url_private from the attached file metadata in context (for Slack-sourced invoices), or use the pdfBase64 already in memory (for email-sourced invoices)
- Forward PDF to `kravemedia@bills.airwallex.com` via john@kravemedia.co with the PDF attached as `attachment_base64`
- Post bill prep report to John's channel (C0AQZGJDR38): creator, amount, currency, invoice number, due date, source
- Log to Creator & AP Bills Tracker with status `Forwarded via Email`

### Step 7 — Confirmation Replies

**On success:**

Slack (reply in origin thread + react ✅):
> Received! Invoice for [Creator] — [Amount] [Currency] staged in Airwallex. John will review by EOD.

Email (reply in same thread via `in_reply_to_message_id`):

Before replying, check if the sender is in the Slack workspace: `mcp__slack__slack_get_users` → search by email.

**If sender is in the Slack workspace (internal — @kravemedia.co or known external editors):**
> Hi [First Name],
>
> Received. The invoice for [Creator] ([Amount] [Currency]) has been staged in Airwallex for payment. John will review by end of day.
>
> Thanks!

**If sender is NOT in the Slack workspace (external vendor/creator):**
> Hi [First Name],
>
> Received — your invoice is being processed. We'll confirm once payment is staged.
>
> Thanks!

Do NOT send the detailed internal status to senders who are not in the Slack workspace.

**On hardstop — missing bank details:**

Slack:
> ⚠️ The invoice for [Creator] doesn't include bank details. Could you ask them to reissue the invoice with their bank account information (account number, SWIFT/BIC, bank name)? I can't stage a payment without it.

Email:
> Hi [First Name],
>
> Quick flag on [Creator]'s invoice — it doesn't include bank account details. Could you ask them to reissue with their bank information (account number, SWIFT/BIC, bank name)? We can't process payment without it.
>
> Thanks!

**On hardstop — no attachment:**

Slack:
> No invoice attached — please share the PDF or confirm it's been emailed to john@kravemedia.co before I can process this.

### Step 8 — Log to Tracker

Append row to Creator & AP Bills Tracker (Sheet ID: `14kiX9MnWyel_4_OxvL2TlnOAqBqFwwECf7Dm24znuJc`, tab: `Krave — Creator & AP Bills Tracker`):

| Col | Value |
|-----|-------|
| A | Date Received (YYYY-MM-DD) |
| B | Creator / Vendor name |
| C | Invoice # |
| D | Airwallex Bill ID (from API response, blank if fallback) |
| E | Amount (numeric only) |
| F | Currency |
| G | Due Date (YYYY-MM-DD) |
| H | Status (`Staged in Airwallex` / `Forwarded via Email` / `On hold — missing bank details`) |
| I | Slack Thread TS (or Gmail message_id for email-sourced) |
| J | Notes (fallback reason, currency conversion rate, etc.) |

### Step 9 — Save Slack Cursor
`mcp__krave-tools__slack_set_last_read(channel_id: C09HN2EBPR7, ts: <newest processed message ts>)`

---

## Currency Rules

| Scenario | Action |
|----------|--------|
| SGD invoice | Enter as SGD — no conversion |
| USD invoice, US creator | Enter as USD |
| USD invoice, HK creator | Convert: `HKD = USD × live_rate × 0.97` — note rate in bill description |
| PayPal only | Exception — reply asking for bank/wire details instead |

---

## Multiple PDFs Per Email

One email with 2+ PDF attachments → one bill per PDF. Each gets its own vendor lookup and bill creation. Send one consolidated reply covering all bills.

---

## Notes

- VA handle: @U0AM5EGRVTP | Noa: @U06TBGX9L93
- ✅ reaction = already actioned — never reprocess
- Manual AP bills (Stashworks etc.) use this same flow — triggered manually via DM or dashboard with PDF attached
- Old tracker references (`183bm4chIsw4Bf1w5_CoBVAuUODgPBfy6wk2-7I5zTFc` and `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50` Bills tab) are superseded — use Creator & AP Bills Tracker (`14kiX9MnWyel_4_OxvL2TlnOAqBqFwwECf7Dm24znuJc`)
