# Skill: Creator Invoice Processing
**Trigger:** "process invoices", "run invoice triage", "check payment channel", "/invoice-triage"
**Channel:** #payments-invoices-updates (C09HN2EBPR7)
**SOP:** references/sops/creator-invoice-management.md

---

## What This Skill Does
Receives creator/vendor invoices from three channels (email, Slack channel, Slack DMs), validates each PDF, and **forwards each valid invoice to Airwallex billing** (`kravemedia@bills.airwallex.com`), which auto-creates a draft. John reviews and finalizes all drafts by EOD on the Airwallex side. No automated payment — Noa handles payments every Thursday. **The Airwallex Spend/Bills API is not released for us — there is no direct bill-creation call; forwarding is the only path.**

---

## Trigger Paths

| Path | Channel | Latency | Handler |
|------|---------|---------|---------|
| Slack DM | John's personal DM | Real-time | Krave bot (automatic) |
| Slack @mention | #payments-invoices-updates (C09HN2EBPR7) | Real-time | Krave bot (automatic) |
| Email | john@kravemedia.co | ≤3 hours | n8n workflow `DbIJYYQ3FE4HKprB` (every 3h, weekdays) |
| Manual | Dashboard or `/invoice-triage` | On-demand | Full sweep of all channels |

**Strategists must @tag Claude EA** in #payments-invoices-updates to trigger processing. Messages without an @mention are informational — do not action them.

**Scheduled (email):** n8n workflow `Krave — Creator Invoice Email Scan` (`DbIJYYQ3FE4HKprB`) — every 3h Mon–Fri. Deploy: `n8n-workflows/deploy-creator-invoice-email-scan.js`. Manual trigger: `POST https://noatakhel.app.n8n.cloud/webhook/krave-creator-invoice-email-scan`.

---

## Key Data

- **#payments-invoices-updates:** C09HN2EBPR7
- **Creator & AP Bills Tracker:** `14kiX9MnWyel_4_OxvL2TlnOAqBqFwwECf7Dm24znuJc`, tab: `Krave — Creator & AP Bills Tracker`
- **Airwallex billing inbox:** `kravemedia@bills.airwallex.com` — forward valid invoice PDFs here; Airwallex auto-creates the draft. (No Spend/Bills API access yet, so there is no `legal_entity_id` / vendor / bill API to call.)
- **Strategists:** Shin, Amanda, Sybil, Jeneena (Slack channel); editors/internal staff (John DMs)

---

## Dedup Guardrails

All four layers apply on every run:

1. **Slack cursor** — `slack_get_last_read(channel_id: C09HN2EBPR7)` / `slack_set_last_read` — only fetch messages after last processed timestamp
2. **✅ reaction** — any Slack message with `white_check_mark` reaction = already processed, skip always
3. **Tracker lookup** — before creating a bill, check `Bills` tab for existing row with same `external_id`. If found → skip.
4. **Airwallex `request_id`** — unique UUID per bill creation call; Airwallex rejects exact duplicate `request_id` submissions

---

## Sender Blocklist — Never Reply to Airwallex

**Hard rule:** Creator invoices come from real people — strategists/team forwarding on behalf of creators, or creators directly. They never come from the payment platform itself.

Drop (do not parse, reply to, forward, log, or mark read) any email from:
- `airwallex.com` and any subdomain (e.g. `bills.airwallex.com`, `notifications.airwallex.com`)
- `no-reply` / `noreply` / `notifications@` automated senders
- `mailer-daemon` bounce notifications

These are left **untouched** in the inbox. Do **not** block `kravemedia.co` — strategists manage the creators and send/forward invoices, sometimes from that domain. The email-scan workflow enforces this via a `-from:airwallex.com` query exclusion plus an `isBlockedSender()` backstop in `Extract PDF Attachments`.

---

## Validation Rules

| Field | Rule |
|-------|------|
| Sender | **Hardstop** — block Airwallex / no-reply / notification / mailer-daemon senders (see Sender Blocklist). Never block kravemedia.co. |
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

### Step 6 — Forward to Airwallex Billing

> **No Spend API.** The Airwallex Spend/Bills API is not released for us yet. Do **not** call `airwallex_create_bill`, `airwallex_list_vendors`, or `airwallex_create_vendor`. The only path is forward-by-email — Airwallex auto-creates the draft from the forwarded PDF, and John finalizes it on the Airwallex side.

For each validated invoice PDF:

1. Get the PDF bytes — `slack_download_file(url_private)` for Slack-sourced, or the `pdfBase64` already in memory for email-sourced.
2. Forward the PDF to `kravemedia@bills.airwallex.com` from john@kravemedia.co, with the PDF **attached** (`attachment_base64`). Subject: `Creator Invoice - [Creator] | [Invoice #] | [Currency] [Amount]`.
3. Post a bill prep report to John's channel (C0AQZGJDR38): creator, amount, currency, invoice number, due date, source.
4. Log to the Creator & AP Bills Tracker with status `Forwarded via Email` (Step 8).

The forwarded email must actually carry the PDF — an email without the attachment is useless to Airwallex.

### Step 7 — Confirmation Replies

**On success:**

Slack (reply in origin thread + react ✅):
> Received! Invoice for [Creator] — [Amount] [Currency] forwarded to Airwallex billing. Staged for payment.

Email (reply in same thread via `in_reply_to_message_id`):

> Hi [First Name],
>
> Received. Staged for payment.
>
> Cheers,
> John
> Krave Media

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
| D | Airwallex Bill ID (leave blank — set later from the Airwallex side once the draft exists) |
| E | Amount (numeric only) |
| F | Currency |
| G | Due Date (YYYY-MM-DD) |
| H | Status (`Forwarded via Email` / `On hold — missing bank details`) |
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

One email with 2+ invoice attachments = **2+ separate bills**. Each attachment is handled fully independently:

1. Parsed and validated on its own (an email can have one good invoice and one missing bank details — handle each per its own outcome).
2. Forwarded to `kravemedia@bills.airwallex.com` separately, so Airwallex creates **one draft per PDF**.
3. Logged as its own row in the tracker.
4. Gets its own brief confirmation reply to the sender.

No vendor lookup or merging — each PDF stands alone. This is exactly how the n8n workflow behaves (it splits one email into one item per attachment). Validation is per-attachment: if PDF A is valid and PDF B has no bank details, A is forwarded and B gets the reissue reply.

---

## Notes

- VA handle: @U0AM5EGRVTP | Noa: @U06TBGX9L93
- ✅ reaction = already actioned — never reprocess
- Manual AP bills (Stashworks etc.) use this same flow — triggered manually via DM or dashboard with PDF attached
- Old tracker references (`183bm4chIsw4Bf1w5_CoBVAuUODgPBfy6wk2-7I5zTFc` and `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50` Bills tab) are superseded — use Creator & AP Bills Tracker (`14kiX9MnWyel_4_OxvL2TlnOAqBqFwwECf7Dm24znuJc`)
