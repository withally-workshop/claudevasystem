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

**Scheduled:** Windows Task Scheduler runs this skill every 3 hours on weekdays — scans john@kravemedia.co inbox for new invoice emails.

**Manual skill run:** Follow `.claude/skills/creator-invoice-processing/SKILL.md` step-by-step.

## Key References

- **Full SOP:** `references/sops/creator-invoice-management.md`
- **Claude Code skill:** `.claude/skills/creator-invoice-processing/SKILL.md`
- **#payments-invoices-updates:** C09HN2EBPR7
- **Client Invoice Tracker:** `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`, tab: `Bills`

## What It Does

1. Scans email (john@kravemedia.co) and #payments-invoices-updates for unprocessed invoice PDFs (respects Slack cursor + ✅ dedup)
2. Parses each PDF via document vision — extracts creator name, invoice number, dates, amount, currency, line items, bank details
3. Validates: hardstop if no bank details (return to sender), hardstop if no PDF. Generates invoice number if missing (`MMDDYYYY-[FirstInitial][LastName]`). Uses Friday of current week if no due date.
4. Looks up or creates vendor in Airwallex Spend (`airwallex_list_vendors` → `airwallex_create_vendor` if not found — name + email only)
5. Creates draft bill via `airwallex_create_bill` (external_id, vendor_id, invoice_number, issued_date, due_date, currency, line_items)
6. Replies to requester: "Received! Invoice for [Creator] — [Amount] [Currency] staged in Airwallex. John will review by EOD."
7. Reacts ✅ to Slack message; replies in email thread for email-sourced invoices
8. Logs to Bills tab on Client Invoice Tracker

## Dedup Signals

- ✅ (`white_check_mark`) reaction = already processed — never reprocess
- Slack cursor — only fetch messages after last processed ts
- Tracker `external_id` check — skip if row already exists

## Validation Hardstops

- **No PDF** → reply asking for invoice, do nothing else
- **No bank details in PDF** → return to sender, ask to reissue

## Codex Invocation Notes

- Run order: dedup check → parse → vendor lookup → create bill → reply → log → update cursor
- API fallback if Spend returns 401: forward PDF to kravemedia@bills.airwallex.com, post prep report to C0AQZGJDR38
- Multiple PDFs in one email = one bill per PDF, one consolidated reply
- legal_entity_id is TBD — omit until confirmed in the skill file
