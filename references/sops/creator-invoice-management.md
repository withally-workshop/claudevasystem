# KM-SOP-001 — Creator Invoice Management
**Frequency:** Every 3 hours (weekdays) via scheduled agent + real-time via Krave bot | **Owner:** VA / Finance | **Updated:** May 2026

## Overview
Collect creator and vendor invoices from three intake channels, validate each PDF, and create draft bills in Airwallex Spend via API. John reviews and finalizes all drafts by EOD. Noa processes approved payments every Thursday.

**Key Rules:**
- Never pay without John's approval. Create drafts only.
- Strategists must **@tag @Claude EA** in #payments-invoices-updates to trigger invoice processing. Messages without this tag are informational — do not action them.
- **No PDF = no bill.** If a strategist tags Claude EA but provides no invoice, reply asking for the PDF before drafting anything.
- **No bank details = no bill.** If the invoice PDF has no bank account details, return to sender and ask them to reissue. Do not create the bill.

## Intake Channels

| Channel | Who | Type |
|---------|-----|------|
| Email john@kravemedia.co | Strategists (Shin, Amanda, Sybil, Jeneena) | PDF attachments; multiple PDFs = multiple separate bills |
| #payments-invoices-updates (C09HN2EBPR7) | Strategists @mentioning Claude EA | PDF/image attachment |
| John's Slack DMs | Editors, internal staff | PDF for salary/ad-hoc payments |

## Automation Architecture

```
Invoice Input
├── Slack DM             → Krave Bot (real-time)
├── Slack @mention       → Krave Bot (real-time)
├── Email                → n8n workflow `DbIJYYQ3FE4HKprB` (every 3h, Mon–Fri)
└── /invoice-triage      → Manual on-demand sweep
```

## Steps

### Step 1 — Receive Invoice

- Krave bot handles Slack DMs and @mentions instantly when a PDF is attached
- n8n workflow (`DbIJYYQ3FE4HKprB`) scans john@kravemedia.co inbox every 3 hours on weekdays for new invoices. Manual trigger: `POST https://noatakhel.app.n8n.cloud/webhook/krave-creator-invoice-email-scan`
- Manual run (`/invoice-triage`) sweeps email + Slack channel for anything pending

### Step 2 — Validate Invoice

Run these checks in order:

| Check | Rule |
|-------|------|
| PDF attached | **Hardstop** — no PDF, ask for it first |
| Bank details | **Hardstop** — no bank account info in PDF → return to sender, ask them to reissue |
| Invoice number | If missing → generate: `MMDDYYYY-[FirstInitial][LastName]` (e.g. `5282026-AGMapula`) |
| Due date | If missing → use Friday of the current week (PHT) |
| Invoice date | If missing → use today |

### Step 3 — Create Bill in Airwallex (API)

1. Look up vendor by name in Airwallex Spend → `airwallex_list_vendors`
2. If not found → create vendor (name + email only) → `airwallex_create_vendor`
3. Create draft bill → `airwallex_create_bill` with: vendor_id, invoice_number, issued_date, due_date, currency, line_items
4. Bill status: DRAFT or AWAITING_APPROVAL

**API fallback** (if Spend API returns 401 or 404): call `slack_download_file(url_private)` first to get `{ base64 }` (Slack-sourced) or retrieve PDF bytes already in memory (email-sourced), then forward to `kravemedia@bills.airwallex.com` via `gmail_send` with `attachment_base64` set — the PDF must be attached or the forwarding is useless. If download fails, post a Slack message asking for manual forwarding instead. Post bill prep report to John's channel. Log as "Forwarded via Email."

### Step 4 — Confirm to Requester

After staging:
- **Slack:** Reply in thread → "Received! Invoice for [Creator] — [Amount] [Currency] staged in Airwallex. John will review by EOD." + react ✅
- **Email:** Reply in same thread → "Hi [First Name], Received. Staged for payment — John will review by EOD. Cheers, John / Krave Media"

If validation fails (missing bank details etc.) → reply with the specific issue instead.

### Step 5 — Log to Tracker

Append to **Creator & AP Bills Tracker** (`14kiX9MnWyel_4_OxvL2TlnOAqBqFwwECf7Dm24znuJc`), tab: `Krave — Creator & AP Bills Tracker`

Columns: Date Received | Creator/Vendor | Invoice # | Airwallex Bill ID | Amount | Currency | Due Date | Status | Slack Thread TS | Notes

### Step 6 — John Reviews & Finalizes

John reviews all drafts in Airwallex → Bills by EOD. He does not need to take any action in Slack or email — the bills are already staged.

### Step 7 — Noa Processes Payments

Every Thursday, Noa reviews approved bills and processes transfers in Airwallex.

## Currency Rules

| Scenario | Action |
|----------|--------|
| SGD invoice | Enter as SGD — no conversion |
| USD invoice, US creator | Enter as USD |
| USD invoice, HK creator | Convert: `HKD = USD × live_rate × 0.97` — note rate in bill description |
| PayPal only | Flag — ask strategist for bank/wire details |

## Exception Types

| Exception | Action |
|-----------|--------|
| No PDF attached | Hardstop — ask for PDF first |
| Missing bank details | Hardstop — return to sender, ask to reissue with bank details |
| PayPal only | Flag — request ACH/bank wire |
| No invoice number | Generate: `MMDDYYYY-[FirstInitial][LastName]` |
| No due date | Use Friday of current week (PHT) |
| Currency mismatch | Convert per currency rules, note rate in description |
| Duplicate submission | Check tracker `external_id` — skip if already processed |
| Amount doesn't match agreement | Flag to John — do not create bill without confirmation |
| Multiple PDFs in one email | One bill per PDF — process separately |
