# KM-SOP-001 — Creator Invoice Management
**Frequency:** Every 3 hours (weekdays) via scheduled agent + real-time via Krave bot | **Owner:** VA / Finance | **Updated:** June 2026

> **Email intake: reworked + reactivated 2026-06-12 (John-approved) after a client-facing misfire** (client lead's proposal screenshots misclassified as invoices → two auto-replies). The n8n email-scan workflow (`DbIJYYQ3FE4HKprB`) now carries these guards: PDF-only intake; Claude classifies is-this-an-invoice with email context; one reply per email; missing-bank-details auto-reply restricted to known senders (@kravemedia.co or tracker vendors) — unknown senders get no email, just an #ops-command flag + "On hold" tracker row; not-invoice skips post an #ops-command notice. The known-sender rule applies to ALL runs, manual included.

## Overview
Collect creator and vendor invoices from three intake channels, validate each PDF, **create a draft bill in Airwallex Spend**, and log it. Noa processes approved payments every Thursday.

> **MIGRATION (2026-06-12).** The **manual `/invoice-triage` path now creates bills directly via the Airwallex Spend API** (org-scoped key `spendcreatekey`; `legal_entity_id` `le_Zxw2-ECjOaKKebIGraD1AA`). The **n8n email-scan (`DbIJYYQ3FE4HKprB`) and krave-bot still forward-by-email** (`kravemedia@bills.airwallex.com`) until Phase 2 promotes the API logic to them. PDFs cannot be attached via API until ~Aug 2026 (Q3) — bills are created without the PDF and **John uploads it manually in the Airwallex webapp**, prompted by an #ops-command flag per bill.

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
| Invoice number | Use the invoice's; if missing → generate `INV-` + 7 random digits (e.g. `INV-4827193`) |
| Currency | Explicit on invoice; if missing → infer from the bank account's country; still unclear → bounce |
| Due date | If missing → use Friday of the current week (PHT) |
| Invoice date | If missing → use today |
| Amount vs request | If the requester's message states an amount, it must match the PDF; mismatch → do not create, flag John |

### Step 3 — Create the Bill

**Manual `/invoice-triage` path (API — current):** for each validated invoice PDF:

1. **Resolve the vendor** — the bill's vendor is the invoice *payee*, not the sender. Match the parsed payee name against live vendors (`airwallex_list_vendors`) + the alias table below. No confident match → `airwallex_create_vendor` with **profile only** (name + country, email if parsed; **never bank details** — the PDF stays the payment source of truth) and flag NEW VENDOR. Ambiguous multi-match → hold + flag, do not guess.
2. **Convert currency** if the invoice currency differs from the vendor's payout currency (see Currency Rules) — live Airwallex rate × 0.97, rate + source amount recorded for the description.
3. **`airwallex_create_bill`** — `external_id` = source message id, `vendor_id`, `legal_entity_id` `le_Zxw2-ECjOaKKebIGraD1AA`, invoice #, issued/due dates, payout `currency`, `tax_status` TAX_EXCLUSIVE, `line_items` (sum = total), `description` (source + conversion note). **No attachment** — API can't attach until ~Aug 2026.
4. **Post-create guard** — `airwallex_get_bill`, verify amount/currency/vendor; mismatch → flag, don't reply success.
5. **#ops-command flag (C0AQZGJDR38)** so John uploads the PDF in the webapp (per-bill notice — see Reporting).
6. Log to the tracker with status `Staged in Airwallex` and the **Airwallex Bill ID**.

**Automated email + Slack paths (email forward — until Phase 2):** forward the PDF to `kravemedia@bills.airwallex.com` via `gmail_send` with `attachment_base64` set (the PDF must be attached). Subject: `Creator Invoice - [Creator] | [Invoice #] | [Currency] [Amount]`. Post prep report to C0AQZGJDR38; log with status `Forwarded via Email`.

### Step 4 — Confirm to Requester

Reply **once, only after all bills from the request are staged** (never on receipt). Subject to the known-sender gate.
- **Slack:** thread reply → "Done — staged [N] bill(s) for payment: [Creator] [Currency][Amount]; …" + react ✅
- **Email:** in-thread → "Hi [First Name], Done — staged for payment: [list]. Cheers, John / Krave Media"

Failed check → reply **immediately** with the specific issue (known senders only; unknown sender → no reply, #ops-command flag + "On hold" row).

### Step 5 — Log to Tracker

Append to **Creator & AP Bills Tracker** (`14kiX9MnWyel_4_OxvL2TlnOAqBqFwwECf7Dm24znuJc`), tab: `Krave — Creator & AP Bills Tracker`

Columns: Date Received | Creator/Vendor | Invoice # | Airwallex Bill ID | Amount | Currency | Due Date | Status | Slack Thread TS | Notes

### Step 6 — John Reviews & Uploads PDFs

For API-created bills, John's action shifts from "finalize drafts" to: open each #ops-command 🧾 flag, upload the invoice PDF on the bill's webapp page (API can't attach until ~Aug 2026), and scan 🚨 flags (new vendor, conversion, mismatch). Email-forwarded bills still appear as drafts auto-created by Airwallex.

### Step 7 — Noa Processes Payments

Every Thursday, Noa reviews approved bills and processes transfers in Airwallex.

## Reporting & Flagging (→ #ops-command C0AQZGJDR38)

Async, batched per deep-work tiers — never DMs.

- **Per-bill notice (🧾)** — every created bill: creator, invoice #, amount (+ conversion), bill link, source, "upload the PDF." This is John's upload queue.
- **Run summary** — end of each run: `✅ N created · ↩️ M bounced · ⏭️ K duplicate` with bounce/dupe detail.
- **Loud flags (🚨, own message)** — only where money can go wrong silently: NEW VENDOR (verify name), CONVERTED (check rate), AMOUNT MISMATCH (bill not created), GUARD MISMATCH (created ≠ parsed). Routine creation / invoice-number generation / due-date defaulting are **not** flagged (noise).

## Vendor Resolution & Payout Currency

Bill vendor = invoice **payee** (parsed), not the sender. Match live vendors + this table:

| Payee (aliases) | Airwallex vendor | UUID | Payout currency |
|---|---|---|---|
| Paul Butanas | Paul Butanas (PH) | `1c584a1f-16ad-4ca9-a201-4f736e4f84dd` | **PHP** (convert if invoice USD) |
| JM / J.M. Domingo | Jeissa Maryce Manalili Domingo | `6a951c12-97ee-4661-b3ab-163d4468390f` | **USD** |
| Baste / Sebastian Perez | Sebastian Dimaculangan Perez | `a0a99771-54f7-43cc-a57b-3c7606d6b5a5` | **SGD** |
| Marian Borynets | Marian Borynets (UA) | `287b6774-22b1-462e-9c3b-01fe3acc824c` | invoice currency |

All other existing vendors resolve by name from `airwallex_list_vendors`. Unmatched → create profile (name + country only), flag NEW VENDOR.

## Currency Rules

Bill is created in the vendor's **payout currency** (default = invoice currency).

| Scenario | Action |
|----------|--------|
| Invoice currency == payout currency | No conversion |
| Invoice currency != payout currency (e.g. Butanas USD → PHP) | Convert at **live Airwallex rate × 0.97**; note `from [orig] [amt] @ [rate] ×0.97` in description; flag CONVERTED |
| USD invoice, HK creator (legacy) | `HKD = USD × live_rate × 0.97` |
| No currency on invoice | Infer from bank account country; still unclear → bounce |
| PayPal only / no bank account | Bounce — request ACH/bank wire |

The `×0.97` is a 3% buffer for FX movement between bill creation and Noa's Thursday payment.

## Exception Types

| Exception | Action |
|-----------|--------|
| Email from Airwallex / no-reply / notifications / mailer-daemon | Hardstop — drop, leave untouched, never reply or forward |
| No PDF attached | Hardstop — ask for PDF first |
| Missing bank details | Hardstop — return to sender, ask to reissue with bank details |
| PayPal only | Flag — request ACH/bank wire |
| No invoice number | Generate `INV-` + 7 random digits |
| No due date | Use Friday of current week (PHT) |
| No currency | Infer from bank account country; unclear → bounce |
| Currency conversion needed | Convert at live rate × 0.97, note in description, flag CONVERTED |
| Unknown vendor | Create profile (name + country only, no bank details), flag NEW VENDOR |
| Duplicate submission | Check tracker `external_id` + live Airwallex (vendor + invoice #) — skip if exists |
| Amount doesn't match agreement | Flag to John — do not create bill without confirmation |
| Post-create guard mismatch | Created bill ≠ parsed values → flag, do not confirm to requester |
| Multiple PDFs in one email | One bill per PDF — process separately |
