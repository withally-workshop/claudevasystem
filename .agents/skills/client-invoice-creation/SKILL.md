---
name: client-invoice-creation
description: Use when Codex needs to process pending Slack invoice request receipts (Mode 1 — create Airwallex draft, log to tracker, notify John) or John's approval replies (Mode 2 — finalize invoice, get payment link, notify strategist). Triggers include "/client-invoice-creation", "process invoice requests", "client invoice creation", "create invoice", "new invoice draft".
metadata:
  short-description: Process invoice requests and approval replies
---

# Client Invoice Creation

Process Slack invoice request receipts into Airwallex drafts (Mode 1) and finalize them when John approves (Mode 2). ClickUp task sync is optional — activated when John includes a task URL in his approval reply.

## How to Trigger

**Mode 1 — Invoice creation** fires automatically via the n8n Invoice Request Intake workflow when a strategist submits `/invoice-request` in Slack.

**Mode 2 — Approval** fires automatically via the n8n Invoice Approval Polling workflow (every 2 hrs Mon–Fri 9–5 PHT) or the Approval Reply Trigger workflow (`arUrmWEgjzuVc27Y`) when John replies "approve".

**Manual skill run:** Follow `.claude/skills/client-invoice-creation/SKILL.md` step-by-step.

## Key References

- **Full SOP:** `.claude/skills/client-invoice-creation/SKILL.md`
- **Invoice Request Intake workflow ID:** `5XHxhQ7wB2rxE3qz`
- **Invoice Approval Polling workflow ID:** `uCS9lzHtVKWlqYlk`
- **Approval Reply Trigger workflow ID:** `arUrmWEgjzuVc27Y`
- **Deploy scripts:** `n8n-workflows/deploy-invoice-request-intake.js`, `n8n-workflows/deploy-invoice-approval-polling.js`
- **Client Invoice Tracker:** `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50` (tab: Invoices)
- **John's approval channel:** `C0AQZGJDR38`
- **Payments channel:** #payments-invoices-updates (`C09HN2EBPR7`)

## What It Does

### Mode 1 — Invoice Creation
1. Reads unprocessed receipts from #payments-invoices-updates (no ✅ reaction)
2. Parses client, email, line items, currency, due date from receipt format
3. Looks up or creates Airwallex customer → creates products + prices → creates invoice draft
4. Logs row to Client Invoice Tracker (Col J = `Draft - Pending John Review`)
5. Notifies John in his private channel — includes ClickUp URL hint for optional sync
6. Reacts ✅ to the receipt to prevent double-processing

### Mode 2 — Approval
1. Detects "approve" replies in John's private channel threads (no ✅ reaction)
2. Guards against double-processing via tracker Col J status check
3. Finalizes Airwallex invoice → extracts payment link
4. Updates tracker (Col J → `Invoice Sent`, Col R → payment link)
5. Replies in John's thread + tags strategist in original #payments-invoices-updates thread
6. If John's reply includes a ClickUp task URL → activates ClickUp sync (see `.agents/skills/clickup-invoice-sync/SKILL.md`)

## Codex Invocation Notes

- Dedup signal: ✅ (`white_check_mark`) reaction = already actioned — never reprocess
- Mode 2 processes before Mode 1 on every manual run (approvals are time-sensitive)
- Never finalize an invoice that is not in `Draft - Pending John Review` status
- ClickUp URL in approval reply is optional — omitting it skips sync silently
- WhatsApp-only clients are handled fully outside this skill
