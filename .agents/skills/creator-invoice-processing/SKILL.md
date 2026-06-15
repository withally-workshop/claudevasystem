---
name: creator-invoice-processing
description: Use when Codex needs to process creator or vendor invoices for Airwallex bill creation. Triggers include "/invoice-triage", "process invoices", "run invoice triage", "check payment channel", "stage invoice", "create bill". Handles PDF invoices from email (john@kravemedia.co), Slack #payments-invoices-updates, and Slack DMs. Validates each invoice (bank details hardstop, due date, invoice number), creates draft bills in Airwallex Spend via API, confirms to requester, and logs to the Bills tab on the Client Invoice Tracker.
metadata:
  short-description: Process creator invoices into Airwallex draft bills
---

# Creator Invoice Processing

> **MIGRATION (2026-06-12).** Manual `/invoice-triage` (this skill) now **creates bills via the Airwallex Spend API**. The n8n email-scan (`DbIJYYQ3FE4HKprB`) and krave-bot still **forward-by-email** until Phase 2. PDFs can't be attached via API until ~Aug 2026 — bills are created without the PDF and John uploads it in the webapp, prompted by an #ops-command 🧾 flag per bill.

> **Incident guards (2026-06-12, John-approved) — all paths incl. manual.** PDF-only intake; classify is-invoice with context before extraction; one reply per email; known-sender gate — bounces only to @kravemedia.co senders or tracker vendors; unknown senders get NO email, just an #ops-command flag + "On hold" tracker row. See [[external_autoreply_guards]].

Receive PDF invoices from email, Slack channel, or Slack DMs → validate → resolve vendor → create draft bill in Airwallex Spend → flag #ops-command for PDF upload → confirm to requester once → log to tracker. Noa pays Thursdays.

## How to Trigger

**Real-time (krave-bot):** Fires automatically when John receives a Slack DM with PDF or a strategist @mentions Claude EA in #payments-invoices-updates with a PDF attached.

**Scheduled (email):** n8n workflow `Krave — Creator Invoice Email Scan` (`DbIJYYQ3FE4HKprB`) runs every 3 hours Mon–Fri — scans john@kravemedia.co inbox. Manual trigger: `POST https://noatakhel.app.n8n.cloud/webhook/krave-creator-invoice-email-scan`.

**Manual skill run:** Follow `.claude/skills/creator-invoice-processing/SKILL.md` step-by-step.

## Key References

- **Full SOP:** `references/sops/creator-invoice-management.md`
- **Claude Code skill:** `.claude/skills/creator-invoice-processing/SKILL.md`
- **#payments-invoices-updates:** C09HN2EBPR7
- **Creator & AP Bills Tracker:** `14kiX9MnWyel_4_OxvL2TlnOAqBqFwwECf7Dm24znuJc`, tab: `Krave — Creator & AP Bills Tracker`

## What It Does (manual `/invoice-triage` — API path)

1. Scans email (john@kravemedia.co) and #payments-invoices-updates for unprocessed invoice PDFs (Slack cursor + ✅ + tracker `external_id` dedup)
2. Parses + **classifies is-invoice** (incident guard) — extracts payee, invoice #, dates, amount, currency, line items, bank details
3. Validates: hardstop no PDF / no bank details. Invoice # missing → `INV-`+7 digits. Currency missing → infer from bank country. Due date missing → Friday PHT.
4. **Resolves vendor** (payee, not sender) against live `airwallex_list_vendors` + alias table; unmatched → `airwallex_create_vendor` profile-only (name + country, no bank details) + 🚨 NEW VENDOR
5. **Converts currency** if invoice currency ≠ vendor payout currency (Butanas→PHP, Domingo→USD, Baste→SGD) — live rate × 0.97, noted in description + 🚨 CONVERTED
6. **`airwallex_create_bill`** (no attachment — API can't until ~Aug 2026), `legal_entity_id` `le_Zxw2-ECjOaKKebIGraD1AA`; then `airwallex_get_bill` post-create guard
7. **#ops-command 🧾 flag** per bill so John uploads the PDF in the webapp
8. Replies to requester **once** after all bills staged (bounces immediately, known-sender gated) — plain confirmation only, NEVER the Airwallex link/bill ID (that goes only to the #ops-command 🧾 flag; only John has Airwallex access)
9. Logs to tracker with **Airwallex Bill ID**, status `Staged in Airwallex`

**n8n email + krave-bot paths still forward-by-email** (Phase 2 promotes this logic): forward PDF to `kravemedia@bills.airwallex.com` via `gmail_send(attachment_base64=...)`, status `Forwarded via Email`.

## Dedup Signals

- ✅ (`white_check_mark`) reaction = already processed — never reprocess
- Slack cursor — only fetch messages after last processed ts
- Tracker `external_id` check — skip if row already exists

## Validation Hardstops

- **Blocked sender** → drop entirely. Never parse, reply to, forward, log, or mark read any email from `airwallex.com` (+ subdomains), `no-reply`/`noreply`, `notifications@`, or `mailer-daemon`. Leave untouched in inbox. **NEVER reply to Airwallex.** Do **not** block `kravemedia.co` — strategists manage creators and send/forward invoices, sometimes from that domain. Enforced by `-from:airwallex.com` query + `isBlockedSender()` backstop in the email-scan workflow.
- **No PDF** → reply asking for invoice, do nothing else
- **No bank details in PDF** → return to sender, ask to reissue

## Codex Invocation Notes

- Run order (manual/API): dedup → parse + classify → validate → resolve vendor → convert currency → create_bill → get_bill guard → #ops-command 🧾 flag → reply once → log → cursor
- Create step: `airwallex_create_bill` with NO attachment field (removed from the API 2026-06-11; native attachments ~Aug 2026). John uploads the PDF manually in the webapp after the 🧾 flag.
- Vendor = invoice payee, not sender. Never write bank details into a vendor profile — the PDF is the payment source of truth.
- Multiple PDFs in one request = one bill each, independent.
- Multiple PDFs in one email = one bill per PDF, each resolved/created/logged/replied independently
- Full step-by-step + reporting/flagging design: `.claude/skills/creator-invoice-processing/SKILL.md` and `references/sops/creator-invoice-management.md`
