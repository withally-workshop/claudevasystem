# KM-SOP-001 — Creator Invoice Management
**Frequency:** Every 3 hours (weekdays) via scheduled agent + real-time via Krave bot | **Owner:** VA / Finance | **Updated:** June 2026

> **PREP & HANDOFF MODEL (2026-06-15).** The automation does NOT create the bill. Airwallex can't create a DRAFT or attach a PDF until ~Aug 2026, and an API-created bill lands `AWAITING_PAYMENT` (finalized, no PDF, unuploadable); email-forward is also broken. So the automation parses, validates, does the FX math, replies to the team (feels automated), and **posts a ready-to-create prep package to #ops-command. John creates the DRAFT bill manually** in Airwallex (vendor → fields → upload PDF → submit). Flips to auto-create in Aug 2026. The n8n email workflow (`DbIJYYQ3FE4HKprB`) is **DEACTIVATED** (ungated success reply + broken forward) pending a prep-and-handoff rebuild — John handles emailed invoices manually for now.

## Overview
Collect creator and vendor invoices, validate each PDF, compute vendor match + FX, **post a prep package to #ops-command for John to create the draft manually**, reply to the team, and log it. Noa processes payments every Thursday.

**Key Rules:**
- Never pay without John's approval.
- **HARDCODED SENDER ALLOWLIST (2026-06-15):** reply ONLY to recognized Krave team — **John, Noa, Jeneena, Amanda, Shin, Sybil** (`@kravemedia.co`). ANY other sender → **no reply at all**, just an #ops-command flag. This is the fix for the 2026-06-12 client-as-creator misfire (a client's proposal was misclassified and got auto-replies).
- **Never reply to Airwallex.** Drop any email from `airwallex.com` (+ subdomains), `no-reply`/`noreply`, `notifications@`, or `mailer-daemon` — do not parse, reply, forward, log, or mark read.
- Strategists must **@tag @Claude EA** in #payments-invoices-updates to trigger processing. Untagged messages are informational.
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
├── Slack DM (to bot)    → Krave Bot (real-time)  → prep package → John creates draft
├── Slack @mention       → Krave Bot (real-time)  → prep package → John creates draft
├── Email                → n8n `DbIJYYQ3FE4HKprB` — DEACTIVATED (rebuild pending); John handles manually
└── /invoice-triage      → Manual on-demand sweep → prep packages
```

## Steps

### Step 1 — Receive Invoice

- Krave bot handles Slack DMs (to the bot) and @mentions instantly when a PDF is attached
- Email path (n8n `DbIJYYQ3FE4HKprB`) is **deactivated** — John processes emailed invoices manually until the prep-and-handoff rebuild
- Manual run (`/invoice-triage`) sweeps the Slack channel for anything pending

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

### Step 3 — Prep the Bill (handoff to John)

For each validated invoice PDF:

1. **Match the vendor** — the bill's vendor is the invoice *payee*, not the sender. Match the parsed payee name against live vendors (`airwallex_list_vendors`) + the alias table below. Report "exists" or "NEW — John creates it". **Do NOT create the vendor.** Ambiguous multi-match → hold + flag.
2. **Convert currency** if the invoice currency differs from the vendor's payout currency (see Currency Rules) — `airwallex_fx_rate` × 0.97, rate + source amount recorded for the package.
3. **Post the prep package to #ops-command (C0AQZGJDR38)** — vendor (exists/NEW) + payout ccy, invoice #, issued/due dates (+ due-date source), billed amount (+ conversion), line items, validated bank details, and a link to the PDF (Slack thread / DM). This is John's ready-to-create handoff.
4. Log to the tracker with status `Prepped — awaiting manual creation`; **Airwallex Bill ID left blank** (John fills it after creating the draft).

**No `airwallex_create_bill` / `airwallex_create_vendor` in this flow** (kept for the Aug 2026 auto-create flip). No email forward.

### Step 4 — Confirm to Requester

Reply **once, only after the prep package is posted** (never on receipt), and **only to a hardcoded-allowlist sender** (John, Noa, Jeneena, Amanda, Shin, Sybil). Plain confirmation only — no Airwallex link/ID, no mention of manual creation (team experiences it as automated).
- **Slack:** thread reply → "Received — [Creator]'s invoice is staged for payment." + react ✅
- **Email:** in-thread → "Hi [First Name], Received — staged for payment. Cheers, John / Krave Media"

Failed check → reply **immediately** with the specific issue (allowlisted senders only). **Non-allowlisted sender → no reply at all, #ops-command 🚨 flag only.**

### Step 5 — Log to Tracker

Append to **Creator & AP Bills Tracker** (`14kiX9MnWyel_4_OxvL2TlnOAqBqFwwECf7Dm24znuJc`), single tab `Krave — Creator & AP Bills Tracker` (EM-DASH `—`, not a hyphen — pass exactly or omit to default to the only tab)

Columns: Date Received | Creator/Vendor | Invoice # | Airwallex Bill ID (blank until John creates) | Amount | Currency | Due Date | Status | Slack Thread TS | Notes

### Step 6 — John Creates the Draft & Uploads the PDF

For each #ops-command 🧾 prep package: John creates a new DRAFT bill in Airwallex Spend (select/create the vendor, paste the pre-filled fields, upload the invoice PDF, submit), scans 🚨 flags (new vendor, conversion, amount mismatch), and fills the Airwallex Bill ID back into the tracker.

### Step 7 — Noa Processes Payments

Every Thursday, Noa reviews approved bills and processes transfers in Airwallex.

## Reporting & Flagging (→ #ops-command C0AQZGJDR38)

Async, batched per deep-work tiers — never DMs.

- **Prep package (🧾)** — every valid invoice: vendor (exists/NEW) + payout ccy, invoice #, issued/due dates (+ source), billed amount (+ conversion), line items, validated bank details, PDF link. This is John's ready-to-create queue.
- **Run summary** — end of each run: `🧾 N prepped · ↩️ M bounced · ⏭️ K duplicate` with bounce/dupe detail.
- **Loud flags (🚨, own message)** — only where money can go wrong silently: NEW VENDOR (John creates it; verify name), CONVERTED (check rate), AMOUNT MISMATCH (not prepped), UNKNOWN SENDER (no reply sent; John decides). Routine prep / invoice-number generation / due-date defaulting are **not** flagged (noise).

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
| Missing bank details | Hardstop — bounce to allowlisted sender, ask to reissue with bank details |
| Sender not on allowlist | No reply at all — #ops-command 🚨 UNKNOWN SENDER flag only |
| PayPal only | Flag — request ACH/bank wire |
| No invoice number | Generate `INV-` + 7 random digits |
| No due date | Use the invoice's date/terms exactly; only if absent → Friday of current week (PHT) |
| No currency | Infer from bank account country; unclear → bounce |
| Currency conversion needed | Convert at live rate × 0.97, note in package, flag CONVERTED |
| Unknown vendor | Report NEW — John creates the vendor in Airwallex (do NOT auto-create), flag NEW VENDOR |
| Duplicate submission | Check tracker `external_id` — skip if exists |
| Amount doesn't match agreement | Flag to John — do not prep without confirmation |
| Multiple PDFs in one request | One prep package per PDF — process separately |
