# Skill: Creator Invoice Processing
**Trigger:** "process invoices", "run invoice triage", "check payment channel", "/invoice-triage"
**Channel:** #payments-invoices-updates (C09HN2EBPR7)
**SOP:** references/sops/creator-invoice-management.md

---

> **MIGRATION IN PROGRESS (2026-06-12).** The **manual `/invoice-triage` path (this skill) now creates bills directly via the Airwallex Spend API** — no more forward-by-email. The **n8n email-scan workflow (`DbIJYYQ3FE4HKprB`) and krave-bot still forward-by-email** until Phase 2 promotes this logic to them. So during migration: manual sweep = API; automated email + Slack = email forward. Both end in the same tracker.

> **Incident guards (2026-06-12, John-approved) — apply to every path including manual.** A client lead's proposal screenshots were misclassified as invoices and got two auto-replies. Hard rules now: (1) **PDF-only** — never ingest images; (2) **classify is-this-an-invoice with context before trusting any extraction**; (3) **one reply per email/message**, never per attachment; (4) **known-sender gate** — bounces (missing bank details / no invoice) only go to `@kravemedia.co` senders or vendors already in the Bills tracker. Unknown sender → **no reply**, just an #ops-command flag + an "On hold" tracker row. See [[external_autoreply_guards]].

## What This Skill Does
Receives creator/vendor invoices (email, Slack channel, Slack DMs), validates each PDF, **creates a draft bill in Airwallex Spend via API**, posts an #ops-command flag so John uploads the PDF (API can't attach until Aug 2026), replies to the requester once, and logs to the Bills tracker. No automated payment — Noa pays every Thursday.

---

## Trigger Paths

| Path | Channel | Latency | Handler | Bill method |
|------|---------|---------|---------|-------------|
| Manual | `/invoice-triage` | On-demand | **This skill** | **Airwallex API** |
| Slack DM | John's personal DM | Real-time | Krave bot | email forward (Phase 2: API) |
| Slack @mention | #payments-invoices-updates | Real-time | Krave bot | email forward (Phase 2: API) |
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

### Step 6 — Resolve vendor
Match the alias/live table → UUID, or create vendor (profile only) + 🚨 NEW VENDOR flag. Ambiguous → hold + flag.

### Step 7 — Currency conversion (if needed)
If invoice currency != payout currency, fetch the live Airwallex rate, multiply by 0.97, compute the billed amount. Record rate + source amount for the description and the 🚨 CONVERTED flag.

### Step 8 — Create the bill
`airwallex_create_bill`:
- `external_id` = source message id · `vendor_id` · `legal_entity_id` = `le_Zxw2-ECjOaKKebIGraD1AA`
- `invoice_number` · `issued_date` · `due_date` · `currency` (payout) · `tax_status` TAX_EXCLUSIVE
- `line_items` from the invoice (quantity, unit_price; sum must equal the total)
- `description` = source + conversion note if any
- **No attachment** — API can't attach until Aug 2026.

### Step 9 — Post-create guard
`airwallex_get_bill(bill_id)` → verify billed amount, currency, vendor match what we parsed/computed. Mismatch → 🚨 GUARD MISMATCH, note in tracker, do not reply success.

### Step 10 — #ops-command flag (per bill)
Post to C0AQZGJDR38 (see Reporting below) so John uploads the PDF.

### Step 11 — Reply to requester (once)
Only after **all** bills from that request are created (never on receipt). Bounces are the exception — reply immediately on a failed check, subject to the known-sender gate. See reply templates below.

### Step 12 — Log to tracker
Append per bill (columns A–J): Date Received · Creator/Vendor · Invoice # · **Airwallex Bill ID** · Amount · Currency · Due Date · **Status** · external_id (Slack ts / Gmail id) · Notes (conversion rate, new-vendor, flags). Status = `Staged in Airwallex` / `On hold — <reason>` / `Duplicate — <bill id>`.

### Step 13 — Save cursor
`slack_set_last_read(channel_id: C09HN2EBPR7, ts: <newest processed>)`.

---

## Reporting & Flagging (→ #ops-command C0AQZGJDR38)

All async, batched per the deep-work tiers — never DMs.

**A. Per-bill creation notice** (every bill — this is John's PDF-upload queue):
```
🧾 Bill created — upload PDF
[Creator] · [Invoice #]
[Currency] [Amount]   (converted: from [orig] [amt] @ [rate] ×0.97)
Bill: https://www.airwallex.com/app/spend/bills/[id]
Source: [Email from X / Slack @Y]
→ Open the bill and upload the invoice PDF (API can't attach until Aug).
```

**B. Run summary** (end of each run, only if anything happened):
```
Invoice run [HH:MM PHT] — ✅ N created · ↩️ M bounced · ⏭️ K duplicate
↩️ [Creator] — [reason]
⏭️ [Creator] — already bill [id]
```
Replaces the old "review drafts by EOD" glance.

**C. Loud flags (🚨, own message)** — only where money can go wrong silently:
| Flag | When | Why |
|------|------|-----|
| 🚨 NEW VENDOR | A vendor profile was created | Parse error → wrong/duplicate vendor; verify name before Noa pays (bank details are in the PDF you upload) |
| 🚨 CONVERTED | Currency was converted | Conversion changes the paid amount; sanity-check the rate |
| 🚨 AMOUNT MISMATCH | Message amount ≠ PDF amount | Bill NOT created — confirm the correct figure |
| 🚨 GUARD MISMATCH | Created bill ≠ parsed values | Catches API-side surprises; rare, critical |

**Not flagged** (expected, would be noise): routine creation (that's A), invoice-number generation, due-date defaulting.

---

## Reply Templates

**Success (once, after all bills staged).** Plain confirmation only — NEVER include the Airwallex bill link, bill ID, or any Airwallex internal detail (only John has Airwallex access; requesters are often strategists). The bill link/ID go ONLY to the #ops-command 🧾 flag.
- Slack (thread + ✅): `Done — staged [N] bill(s) for payment: [Creator] [Currency][Amount]; …`
- Email (in-thread): `Hi [First Name], Done — staged for payment: [list]. Cheers, John / Krave Media`

**Bounce — missing bank details** (known-sender gate):
- `Hi [First Name], [Creator]'s invoice has no bank details. Please ask them to reissue with account number + SWIFT/BIC + bank name — can't stage payment without it.`

**Bounce — no PDF:** `No invoice PDF attached — please send the PDF before I can process this.`

**Unknown sender** (any bounce condition): no reply. Post #ops-command flag + "On hold" tracker row.

---

## Sender Blocklist — Never Reply to Airwallex
Drop (no parse/reply/forward/log/mark-read) email from `airwallex.com` + subdomains, `no-reply`/`noreply`/`notifications@`, `mailer-daemon`. Leave untouched. Never block `kravemedia.co`. Enforced by `-from:airwallex.com` query + `isBlockedSender()` backstop.

---

## Multiple PDFs Per Request
One request with 2+ invoices = 2+ independent bills: each parsed, validated, vendor-resolved, created, flagged, and tracker-logged on its own. One good + one bad → good is created, bad bounces. Single combined success reply lists all created bills.

---

## Notes
- VA: @U0AM5EGRVTP · Noa: @U06TBGX9L93
- Never pay without approval — API bills land `AWAITING_PAYMENT`; Noa runs payments Thursday.
- John's review shifts from "finalize drafts" to "upload the PDF + scan flags" — money still can't move without Noa.
- Phase 2 promotes this exact logic to krave-bot + n8n (`DbIJYYQ3FE4HKprB`), with the Spend key as an n8n `httpCustomAuth` credential (auth in HTTP Request nodes — Code nodes lack `requestWithAuthentication`, see [[n8n_code_node_helpers]]).
