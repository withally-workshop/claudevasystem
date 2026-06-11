---
name: payment-detection
description: Use when Codex needs to scan noa@kravemedia.co for Airwallex deposit notifications and client payment receipts, match them to open invoices in the Client Invoice Tracker, update payment statuses, and notify the team in Slack. Triggers include "check for payments", "scan for payments", "detect payments", "/payment-detection", "did we get paid", "any new payments", "payment status check".
metadata:
  short-description: Scan emails, match deposits to invoices, update tracker
---

# Payment Detection

Scan noa@kravemedia.co for Airwallex deposit notifications and John's forwarded receipts, match each deposit to an open invoice, update tracker statuses, and notify #payments-invoices-updates.

## How to Trigger

**Webhook (n8n):** `POST https://noatakhel.app.n8n.cloud/webhook/krave-payment-detection`

**Manual skill run:** Follow the steps in `.claude/skills/payment-detection/SKILL.md`.

## Key References

- **Full SOP:** `.claude/skills/payment-detection/SKILL.md`
- **n8n workflow ID:** `NurOLZkg3J6rur5Q`
- **Deploy script:** `n8n-workflows/deploy-payment-detection.js`
- **Workflow docs:** `n8n-workflows/WORKFLOWS.md` (Workflow 1 — Payment Detection)
- **Client Invoice Tracker:** `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50` (tab: Invoices)
- **Slack channel:** #payments-invoices-updates (`C09HN2EBPR7`)

## What It Does

1. Gmail search on `noa@kravemedia.co` (Airwallex emails + John's forwarded receipts)
2. Parse email body → extract amount, currency, invoice number, client name
   - For Airwallex deposit confirmation emails (empty body): extract text from PDF attachment
3. Match against open invoices — strict: INV# match OR amount+currency+client-name fuzzy
4. Silently dedup already-reconciled deposits (completed rows, 90-day window for PDF-only emails)
5. Update Col J/M/Q in tracker; post Slack alert (✅ full, 🔄 partial, ⚠️ needs review)
6. v7 (2026-06-11): for high-confidence full payments, auto-mark the invoice paid in Airwallex after re-verifying amount/currency/status against the live Airwallex record; otherwise the Slack ✅ alert carries "⚠️ Airwallex: NEEDS MANUAL mark-as-paid — [reason]"

## Codex Invocation Notes

- Trigger the n8n webhook for automated runs
- For manual runs: use `.claude/skills/payment-detection/SKILL.md` step-by-step via Gmail MCP + Sheets MCP
- In manual runs, call `airwallex_mark_paid` only after human-verifying the payment against the invoice (the n8n workflow auto-marks only behind its confidence gate + live verification guard — v7)
- Shopify deposits are NOT client invoice payments — always skip
