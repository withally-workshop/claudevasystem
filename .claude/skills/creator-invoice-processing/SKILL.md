# Skill: Creator Invoice Processing
**Trigger:** "process invoices", "run invoice triage", "check payment channel", "/invoice-triage"
**Channel:** #payments-invoices-updates (C09HN2EBPR7)
**SOP:** references/sops/creator-invoice-management.md

---

> **PREP & HANDOFF MODEL (2026-06-15).** We do **NOT** create the bill via API — Airwallex can't create a DRAFT or attach a PDF until ~Aug 2026, and an API-created bill lands `AWAITING_PAYMENT` (finalized, no PDF, unuploadable). The email-forward path is also broken (not forwarding). So: **the automation parses, validates, does the FX math, replies to the team (feels fully automated), and hands John a ready-to-create package in #ops-command. John creates the DRAFT bill manually in Airwallex (vendor → fields → upload PDF → submit).** No `airwallex_create_bill` in the flow. The n8n email workflow (`DbIJYYQ3FE4HKprB`) runs this same prep-and-handoff model and is **ACTIVE** (tested + activated 2026-06-15).

> **Incident guards (2026-06-12 + 2026-06-15) — apply to every path.** (1) **PDF-only** — never ingest images; (2) **classify is-this-an-invoice with context before trusting extraction**; (3) **one reply per message**, never per attachment; (4) **HARDCODED SENDER ALLOWLIST** — only reply to recognized Krave team: **John, Noa, Jeneena, Amanda, Shin, Sybil** (all `@kravemedia.co`). ANY other sender → **no reply at all**, just an #ops-command flag. This is the fix for the client-as-creator misfire. See [[external_autoreply_guards]].

## What This Skill Does
Receives creator/vendor invoices (Slack DM, channel @mention, manual sweep), validates each PDF, computes vendor match + FX conversion, **posts a ready-to-create prep package to #ops-command for John to create the draft manually**, and replies once to the team (allowlisted senders only). It does NOT write the Bills tracker — a separate EOD reconcile mirrors the real Airwallex bills into it. No API bill creation, no automated payment — Noa pays every Thursday.

---

## Trigger Paths

| Path | Channel | Latency | Handler | Method |
|------|---------|---------|---------|-------------|
| Manual | `/invoice-triage` | On-demand | **This skill** | Prep & handoff |
| Slack DM | DM to the bot | Real-time | Krave bot | Prep & handoff |
| Slack @mention | #payments-invoices-updates | Real-time | Krave bot | Prep & handoff |
| Email | john@kravemedia.co | ≤3h | n8n `DbIJYYQ3FE4HKprB` | Prep & handoff — **ACTIVE** (tested + activated 2026-06-15) |
| Email | john@kravemedia.co | ≤3h | n8n `DbIJYYQ3FE4HKprB` | email forward (Phase 2: API) |

**Strategists must @tag Claude EA** in #payments-invoices-updates to trigger processing. Non-@mention messages are informational.

---

## Key Data

- **#payments-invoices-updates:** C09HN2EBPR7 · **#ops-command (reports/flags):** C0AQZGJDR38
- **Creator & AP Bills Tracker:** `14kiX9MnWyel_4_OxvL2TlnOAqBqFwwECf7Dm24znuJc` — the spreadsheet has ONE tab named `Krave — Creator & AP Bills Tracker` (EM-DASH `—`, not a hyphen). Pass it exactly, or omit the tab name (defaults to the only tab).
- **Airwallex Spend:** org-scoped key `spendcreatekey` (`AIRWALLEX_SPEND_*` in `.mcp.json`; MCP routes `/api/v1/spend/*` through it). `legal_entity_id` = `le_Zxw2-ECjOaKKebIGraD1AA`
- **Strategists (senders):** Shin, Amanda, Sybil, Jeneena (Slack); editors/internal staff (John DMs)
- **External requesters who also self-invoice:** Marian Borynets, Paul Butanas, Baste Perez, JM Domingo

---

## Vendor Resolution

The bill's **vendor is the invoice payee** (parsed from the PDF), not the sender. Match against live Airwallex vendors (`airwallex_list_vendors`) plus this alias + payout-currency table:

| Payee on invoice (aliases) | Airwallex vendor | UUID | Payout currency |
|---|---|---|---|
| Paul Butanas | Paul Butanas (PH) | `1c584a1f-16ad-4ca9-a201-4f736e4f84dd` | **PHP** (convert if invoice USD) |
| JM / J.M. Domingo | Jeissa Maryce Manalili Domingo | `6a951c12-97ee-4661-b3ab-163d4468390f` | **USD** |
| Baste / Sebastian Perez | Sebastian Dimaculangan Perez | `a0a99771-54f7-43cc-a57b-3c7606d6b5a5` | **SGD** |
| Marian Borynets | Marian Borynets (UA) | `287b6774-22b1-462e-9c3b-01fe3acc824c` | invoice currency |

Other existing vendors (Alleah, Priscilla, Amanda Ng, Holly Crocker, Hailey Nolin, Asli Yerdelen, Nichole Zhang, Brianna Alvarran, Diamond Danielle, Jeneena Briones, Stashworks Pte Ltd, Reclaim Movement LLC, Kang Ying Xuan) resolve by name from the live list.

**Resolution order:**
1. Exact/alias match to a live vendor → use its UUID.
2. No confident match → **create the vendor** (`airwallex_create_vendor`): name + country (+ email if parsed). **Never bank details** — the PDF stays the payment source of truth. Then 🚨 flag NEW VENDOR.
3. Ambiguous multi-match → do **not** guess. Hold + 🚨 flag for John.

---

## Validation Rules (run in order)

| Check | Rule | On fail |
|-------|------|---------|
| Sender blocklist | Drop Airwallex / no-reply / notifications / mailer-daemon (never block kravemedia.co) | Leave untouched, never reply |
| PDF attached | PDF required (images never count) | **Bounce immediately** — ask for the invoice PDF (known-sender gate applies) |
| Is-invoice | Classify the PDF as a real invoice using message context | Not an invoice → skip, post #ops-command notice, no reply |
| Bank details | Account #, IBAN/SWIFT/BIC, BSB, or equivalent present | **Bounce immediately** — ask to reissue with bank details |
| Invoice number | Use the invoice's number | If missing → generate `INV-` + 7 random digits (e.g. `INV-4827193`) |
| Currency | Explicit on invoice | If missing → infer from the bank account's country; still unclear → bounce |
| Due date | Use the due date or payment terms printed on the invoice EXACTLY (e.g. "NET 30" = issued date + 30 days). Never invent/guess. | If missing → Friday of the current week (PHT); if today is Friday, use today |
| Invoice date | Use the invoice's date | If missing → today (PHT) |
| Amount vs request | If the requester's message states an amount, it must match the PDF | Mismatch → **do not create**, 🚨 flag for John |

---

## Currency & Conversion

Bill is created in the vendor's **payout currency** (table above; default = invoice currency).

- Invoice currency == payout currency → no conversion.
- Invoice currency != payout currency → **convert at live Airwallex rate × 0.97**. Put the rate and original amount in the bill description: `Converted from USD 500.00 @ 56.20 ×0.97 = PHP 27,257.00`.
- The `×0.97` is a 3% buffer absorbing FX movement between bill creation and Noa's Thursday payment (carried over from the SOP's HK rule). Always note it; always 🚨 flag a conversion.
- Legacy rule retained: USD invoice from an HK creator → HKD at the same `×0.97`.
- PayPal-only / no bank account → bounce (request ACH/bank wire).

---

## Execution Steps

### Step 0 — Slack cursor
`mcp__krave-tools__slack_get_last_read(channel_id: C09HN2EBPR7)` → timestamp (or null = first run, fetch last 50).

### Step 1 — Scan #payments-invoices-updates
`mcp__slack__slack_get_channel_history(channel: C09HN2EBPR7, oldest: <cursor>)`. Keep messages @mentioning Claude EA with a PDF. Skip non-@mention and ✅-reacted.

### Step 2 — Scan email
`mcp__gmail-john__gmail_search_messages(query: "has:attachment newer_than:7d -from:airwallex.com")`. For each: `gmail_get_message`, then `gmail_download_attachment` for each PDF. Multiple PDFs = multiple independent bills. (DMs are krave-bot's job, not this sweep.)

### Step 3 — Dedup (all layers)
1. Tracker row with same `external_id` (source Gmail message_id / Slack ts) → skip.
2. ✅ reaction on the Slack message → skip.
3. Live Airwallex: `airwallex_list_bills` — same vendor + invoice number already exists → skip, note as duplicate.
4. `request_id` (random UUID per create call) is the final idempotency backstop.

### Step 4 — Parse & classify each PDF
Document vision → payee name, email, invoice #, issued/due dates, amount, currency, line items, bank details. **Classify is-this-an-invoice** before trusting extraction (incident guard). Apply validation rules; any hardstop → handle per its row and skip creation.

### Step 5 — Derive fields
Invoice # (generate `INV-`+7 digits if blank) · due date (Friday PHT if blank) · invoice date (today if blank) · currency (infer from bank country if blank).

### Step 6 — Resolve vendor (report only)
Match the alias/live table (`airwallex_list_vendors`) → note "exists" + the name, or "NEW — John creates it". **Do not create the vendor.** Ambiguous → hold + flag.

### Step 7 — Currency conversion (if needed)
If invoice currency != payout currency, `airwallex_fx_rate` × 0.97 → billed amount. Record rate + source amount for the prep package + 🚨 CONVERTED flag.

### Step 8 — Post the prep package to #ops-command
Post the ready-to-create handoff to C0AQZGJDR38 (see Reporting). John creates the DRAFT bill manually from it. **No `airwallex_create_bill`.**

### Step 9 — Reply to requester (once, allowlisted senders only)
Only after the prep package is posted (never on receipt), and only if the sender is on the hardcoded allowlist (John, Noa, Jeneena, Amanda, Shin, Sybil). Plain confirmation, no Airwallex detail. Bounces reply immediately (same allowlist gate). Non-allowlisted sender → no reply, #ops-command flag only. See reply templates.

### Step 10 — Do NOT write the tracker at prep time
The Creator & AP Bills Tracker is populated **only** by the EOD reconcile job (`Krave — Creator Bills EOD Reconcile`, n8n `FdtmNRozitg711BQ` → bot `/cron/reconcile-bills`), which mirrors the real Airwallex bills (fills Bill IDs by invoice#+amount+currency, appends bills not yet in the sheet). A prep-time row would duplicate or mismatch on currency-converted bills. The prep package in #ops-command is the only output here.

### Step 11 — Save cursor
`slack_set_last_read(channel_id: C09HN2EBPR7, ts: <newest processed>)`.

---

## Reporting & Flagging (→ #ops-command C0AQZGJDR38)

All async, batched per the deep-work tiers — never DMs.

**A. Prep package** (every valid invoice — John's ready-to-create handoff):
```
🧾 Ready to create — [Creator]
Vendor: [name] (exists / NEW — create first) · payout [ccy]
Invoice #[num] · issued [date] · due [date] (source: on-invoice / NET-x / Friday default)
Bill amount: [payout ccy] [amount]   (from [orig] [amt] @ [rate] ×0.97, if converted)
Line items: [desc — qty × unit]
Bank: [bank / acct / SWIFT — validated]
PDF: [Slack thread link / DM]
→ New draft bill in Airwallex Spend → vendor above → fill fields → upload the PDF → submit.
```

**B. Run summary** (end of each run, only if anything happened):
```
Invoice run [HH:MM PHT] — 🧾 N prepped · ↩️ M bounced · ⏭️ K duplicate
↩️ [Creator] — [reason]
⏭️ [Creator] — already in tracker
```

**C. Loud flags (🚨, own message)** — only where money can go wrong silently:
| Flag | When | Why |
|------|------|-----|
| 🚨 NEW VENDOR | Payee not in the vendor list | John must create the vendor in Airwallex first; verify the name |
| 🚨 CONVERTED | Currency was converted | Conversion changes the paid amount; sanity-check the rate |
| 🚨 AMOUNT MISMATCH | Message amount ≠ PDF amount | Not prepped — confirm the correct figure |
| 🚨 UNKNOWN SENDER | Sender not on the hardcoded allowlist | No reply was sent; John decides whether it's legit |

**Not flagged** (expected, would be noise): routine prep (that's A), invoice-number generation, due-date defaulting.

---

## Reply Templates

Replies go **only** to the hardcoded allowlist: **John, Noa, Jeneena, Amanda, Shin, Sybil** (`@kravemedia.co`). Any other sender → no reply, #ops-command 🚨 UNKNOWN SENDER flag only.

**Success (once, after the prep package is posted).** EXACTLY one line, nothing else — no creator name, amount, currency, invoice #, vendor, dates, Airwallex detail, or summary of work. All detail stays in the #ops-command prep package.
- Slack (thread + ✅): `Received — staged for payment.`
- Email (in-thread): `Hi [First Name], Received — staged for payment. Cheers, John / Krave Media`

**Bounce — missing bank details:** `Hi [First Name], [Creator]'s invoice has no bank details. Please ask them to reissue with account number + SWIFT/BIC + bank name — can't stage payment without it.`

**Bounce — no PDF:** `No invoice PDF attached — please send the PDF before I can process this.`

---

## Sender Blocklist — Never Reply to Airwallex
Drop (no parse/reply/forward/log/mark-read) email from `airwallex.com` + subdomains, `no-reply`/`noreply`/`notifications@`, `mailer-daemon`. Leave untouched. Never block `kravemedia.co`. Enforced by `-from:airwallex.com` query + `isBlockedSender()` backstop.

---

## Multiple PDFs Per Request
One request with 2+ invoices = 2+ independent prep packages: each parsed, validated, vendor-matched, FX-converted, and tracker-logged on its own. One good + one bad → prep the good, bounce the bad.

---

## Notes
- VA: @U0AM5EGRVTP · Noa: @U06TBGX9L93
- John creates the DRAFT bill manually from each prep package (vendor → fields → upload PDF → submit), then fills the Bill ID in the tracker. Noa pays Thursday.
- **Aug 2026:** when Airwallex supports DRAFT creation + API attachments, this flips to auto-create (`airwallex_create_bill` + post-create guard + upload). The vendor/FX tools already exist for that day; `legal_entity_id` = `le_Zxw2-ECjOaKKebIGraD1AA`.
- Phase 2 promotes this exact logic to krave-bot + n8n (`DbIJYYQ3FE4HKprB`), with the Spend key as an n8n `httpCustomAuth` credential (auth in HTTP Request nodes — Code nodes lack `requestWithAuthentication`, see [[n8n_code_node_helpers]]).
