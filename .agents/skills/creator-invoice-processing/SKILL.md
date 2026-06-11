---
name: creator-invoice-processing
description: Use when Codex needs to process creator or vendor invoices for Airwallex bill creation. Triggers include "/invoice-triage", "process invoices", "run invoice triage", "check payment channel", "stage invoice", "create bill". Handles PDF invoices from email (john@kravemedia.co), Slack #payments-invoices-updates, and Slack DMs. Validates each invoice (bank details hardstop, due date, invoice number), creates draft bills in Airwallex Spend via API, confirms to requester, and logs to the Bills tab on the Client Invoice Tracker.
metadata:
  short-description: Process creator invoices into Airwallex draft bills
---

# Creator Invoice Processing

Receive PDF invoices from email, Slack channel, or Slack DMs → validate → create draft bill in Airwallex Spend → confirm to requester → log to tracker. John reviews and finalizes all drafts by EOD.

## How to Trigger

**Real-time (krave-bot):** Fires automatically when John receives a Slack DM with PDF or a strategist @mentions Claude EA in #payments-invoices-updates with a PDF attached.

**Scheduled (email):** n8n workflow `Krave — Creator Invoice Email Scan` (`DbIJYYQ3FE4HKprB`) runs every 3 hours Mon–Fri — scans john@kravemedia.co inbox. Manual trigger: `POST https://noatakhel.app.n8n.cloud/webhook/krave-creator-invoice-email-scan`.

**Manual skill run:** Follow `.claude/skills/creator-invoice-processing/SKILL.md` step-by-step.

## Key References

- **Full SOP:** `references/sops/creator-invoice-management.md`
- **Claude Code skill:** `.claude/skills/creator-invoice-processing/SKILL.md`
- **#payments-invoices-updates:** C09HN2EBPR7
- **Creator & AP Bills Tracker:** `14kiX9MnWyel_4_OxvL2TlnOAqBqFwwECf7Dm24znuJc`, tab: `Krave — Creator & AP Bills Tracker`

## What It Does

1. Scans email (john@kravemedia.co) and #payments-invoices-updates for unprocessed invoice PDFs (respects Slack cursor + ✅ dedup)
2. Parses each PDF via document vision — extracts creator name, invoice number, dates, amount, currency, line items, bank details
3. Validates: hardstop if no bank details (return to sender), hardstop if no PDF. Generates invoice number if missing (`MMDDYYYY-[FirstInitial][LastName]`). Uses Friday of current week if no due date.
4. Forwards each valid PDF to `kravemedia@bills.airwallex.com` via `gmail_send` with the PDF attached (`attachment_base64`) — Airwallex auto-creates the draft. **Spend/Bills API is live (2026-06-11, via the `spendcreatekey` scoped key) but this flow has NOT switched** — flow switch pending John's decision; do not call `airwallex_create_bill`/`list_vendors`/`create_vendor` in this workflow yet.
5. Posts a bill prep report to John's channel (C0AQZGJDR38)
6. Replies to requester:
   - **Slack:** "Received! Invoice for [Creator] — [Amount] [Currency] forwarded to Airwallex billing. John will review by EOD."
   - **Email:** "Hi [First Name], Received. Staged for payment. Cheers, John / Krave Media"
7. Reacts ✅ to Slack message; replies in email thread for email-sourced invoices
8. Logs to Creator & AP Bills Tracker (Sheet ID: `14kiX9MnWyel_4_OxvL2TlnOAqBqFwwECf7Dm24znuJc`)

## Dedup Signals

- ✅ (`white_check_mark`) reaction = already processed — never reprocess
- Slack cursor — only fetch messages after last processed ts
- Tracker `external_id` check — skip if row already exists

## Validation Hardstops

- **Blocked sender** → drop entirely. Never parse, reply to, forward, log, or mark read any email from `airwallex.com` (+ subdomains), `no-reply`/`noreply`, `notifications@`, or `mailer-daemon`. Leave untouched in inbox. **NEVER reply to Airwallex.** Do **not** block `kravemedia.co` — strategists manage creators and send/forward invoices, sometimes from that domain. Enforced by `-from:airwallex.com` query + `isBlockedSender()` backstop in the email-scan workflow.
- **No PDF** → reply asking for invoice, do nothing else
- **No bank details in PDF** → return to sender, ask to reissue

## Codex Invocation Notes

- Run order: dedup check → parse → validate → forward to Airwallex billing → reply → log → update cursor
- Forward step: call `slack_download_file(url_private)` first to get `{ base64 }` (Slack-sourced) or use PDF bytes in memory (email-sourced), then forward to kravemedia@bills.airwallex.com via `gmail_send(attachment_base64=<that base64>)`. NEVER call gmail_send without attachment_base64 — an email without the PDF is useless. If download fails, post a Slack message instead asking for manual forwarding. Post prep report to C0AQZGJDR38.
- Multiple PDFs in one email = one bill per PDF, each forwarded/logged/replied independently (no merging, no vendor lookup)
- **No Spend/Bills API** — forward-by-email is the only path until Airwallex releases Spend API access to us
