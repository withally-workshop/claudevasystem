# KM-SOP-001 — Creator Invoice Management
**Frequency:** Every 3 hours (weekdays) via scheduled agent + real-time via Krave bot | **Owner:** VA / Finance | **Updated:** June 2026

> **Email intake: reworked + reactivated 2026-06-12 (John-approved) after a client-facing misfire** (client lead's proposal screenshots misclassified as invoices → two auto-replies). The n8n email-scan workflow (`DbIJYYQ3FE4HKprB`) now carries these guards: PDF-only intake; Claude classifies is-this-an-invoice with email context; one reply per email; missing-bank-details auto-reply restricted to known senders (@kravemedia.co or tracker vendors) — unknown senders get no email, just an #ops-command flag + "On hold" tracker row; not-invoice skips post an #ops-command notice. The known-sender rule applies to ALL runs, manual included.

## Overview
Collect creator and vendor invoices from three intake channels, validate each PDF, and **forward each valid invoice to Airwallex billing** (`kravemedia@bills.airwallex.com`), which auto-creates a draft. John reviews and finalizes all drafts by EOD on the Airwallex side. Noa processes approved payments every Thursday. **The Airwallex Spend/Bills API is live as of 2026-06-11 (access via the `spendcreatekey` org-scoped key) but the flow switch is pending John's decision — forwarding by email remains the path; do not call the Spend/vendor/bill API in this flow yet.**

**Key Rules:**
- Never pay without John's approval. Create drafts only.
- **Never reply to Airwallex.** Drop any email from `airwallex.com` (+ subdomains like `bills.airwallex.com`), `no-reply`/`noreply`, `notifications@`, or `mailer-daemon` — do not parse, reply to, forward, log, or mark read. Leave it untouched. Invoices come from real people (strategists/team or creators), never the payment platform. Do **not** block `kravemedia.co` — strategists manage creators and send/forward invoices, sometimes from that domain.
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
| Sender | **Hardstop** — block Airwallex / no-reply / notifications / mailer-daemon; leave untouched, never reply. Never block kravemedia.co. |
| PDF attached | **Hardstop** — no PDF, ask for it first |
| Bank details | **Hardstop** — no bank account info in PDF → return to sender, ask them to reissue |
| Invoice number | If missing → generate: `MMDDYYYY-[FirstInitial][LastName]` (e.g. `5282026-AGMapula`) |
| Due date | If missing → use Friday of the current week (PHT) |
| Invoice date | If missing → use today |

### Step 3 — Forward to Airwallex Billing

> **Spend API live (2026-06-11) via dedicated key — but this flow has NOT switched.** Access verified through the org-level scoped key `spendcreatekey` (`AIRWALLEX_SPEND_*` env vars in `.mcp.json`; `legal_entity_id` = `le_Zxw2-ECjOaKKebIGraD1AA`). Switching off forward-by-email is still a pending John decision — until then, do **not** call `airwallex_list_vendors`, `airwallex_create_vendor`, or `airwallex_create_bill` in this flow. Forwarding remains the path — Airwallex auto-creates the draft from the forwarded PDF; John finalizes it on the Airwallex side.

For each validated invoice PDF:

1. Get the PDF bytes — `slack_download_file(url_private)` to get `{ base64 }` (Slack-sourced) or the PDF bytes already in memory (email-sourced).
2. Forward to `kravemedia@bills.airwallex.com` via `gmail_send` with `attachment_base64` set — the PDF **must** be attached or the forward is useless. Subject: `Creator Invoice - [Creator] | [Invoice #] | [Currency] [Amount]`. If the download fails, post a Slack message asking for manual forwarding instead.
3. Post a bill prep report to John's channel (C0AQZGJDR38).
4. Log to the tracker with status `Forwarded via Email`.

### Step 4 — Confirm to Requester

After forwarding:
- **Slack:** Reply in thread → "Received! Invoice for [Creator] — [Amount] [Currency] forwarded to Airwallex billing. Staged for payment." + react ✅
- **Email:** Reply in same thread → "Hi [First Name], Received. Staged for payment. Cheers, John / Krave Media"

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
| Email from Airwallex / no-reply / notifications / mailer-daemon | Hardstop — drop, leave untouched, never reply or forward |
| No PDF attached | Hardstop — ask for PDF first |
| Missing bank details | Hardstop — return to sender, ask to reissue with bank details |
| PayPal only | Flag — request ACH/bank wire |
| No invoice number | Generate: `MMDDYYYY-[FirstInitial][LastName]` |
| No due date | Use Friday of current week (PHT) |
| Currency mismatch | Convert per currency rules, note rate in description |
| Duplicate submission | Check tracker `external_id` — skip if already processed |
| Amount doesn't match agreement | Flag to John — do not create bill without confirmation |
| Multiple PDFs in one email | One bill per PDF — process separately |
