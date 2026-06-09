---
name: invoice-approval-polling
description: Use when Codex needs to process John's "approve" replies on pending invoice drafts — finalize the invoice in Airwallex, retrieve the payment link, update the Client Invoice Tracker, and notify the strategist. Triggers include "check approvals", "/invoice-approval-polling", "process invoice approvals". Normally runs inside the Invoice Ops cron (every 2 hrs, Mon–Fri 9 AM–5 PM PHT).
metadata:
  short-description: Finalize approved invoice drafts
---

# Invoice Approval Polling

Scan John's private channel for "approve" replies on `Draft - Pending John Review` invoices, finalize each in Airwallex, write the payment link to the tracker, and notify the requester in the origin thread.

## How to Trigger

**Automated:** part of the Invoice Ops cron — every 2 hrs, Mon–Fri 9 AM–5 PM PHT. Do not schedule separately.

**Manual:** "check approvals", "/invoice-approval-polling"

## Key References

- **Full skill (step-by-step logic):** `.claude/skills/invoice-approval-polling/SKILL.md`
- **Deploy script:** `n8n-workflows/deploy-invoice-approval-polling.js` (workflow `uCS9lzHtVKWlqYlk`)
- **John's channel:** C0AQZGJDR38 · **Payments channel:** C09HN2EBPR7
- **Tracker:** Sheet `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`, tab `Invoices`

## Core Rules

1. Only process rows where Payment Status (J) = `Draft - Pending John Review`
2. Match drafts to Slack messages by Airwallex Invoice ID (F) — never by Invoice # (the number changes on finalize)
3. `airwallex_finalize_invoice` → extract payment link (`hosted_invoice_url` / `digital_invoice_link` / etc.); fall back to `airwallex_get_invoice`; if still missing, flag in C0AQZGJDR38 and continue
4. Tracker update: E = finalized number, J = `Invoice Sent`, R = payment link. Never write Col N.
5. Reply in John's approval thread + tag requester (Col K → Slack ID) in the origin thread (Col P as `thread_ts`); CC instruction is noa@ + requester, never john@
