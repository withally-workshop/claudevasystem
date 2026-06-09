---
name: invoice-reminder-cron
description: Use when Codex needs to run the daily invoice reminder pass — detect new payments, send pre-due and overdue reminder emails from john@kravemedia.co, flag late fees and collections, and post a digest to #payments-invoices-updates. Triggers include "run invoice reminders", "/invoice-reminder-cron". Scheduled Mon–Fri 10:00 AM PHT; fully automated, no human input.
metadata:
  short-description: Daily invoice reminder + escalation run
---

# Invoice Reminder Cron

Daily automated pass over the Client Invoice Tracker: payment detection first, then payout-term-aware reminders, late-fee flags at 7 days overdue, collections at 60+ days, and a status digest.

## How to Trigger

**Automated:** Mon–Fri 10:00 AM PHT (Asia/Manila). On-demand webhook: see `.agents/skills/invoice-reminder-trigger/SKILL.md`.

**Manual:** "run invoice reminders", "/invoice-reminder-cron"

## Key References

- **Full skill (column map, strategist lookup, email templates):** `.claude/skills/invoice-reminder-cron/SKILL.md`
- **Deploy script:** `n8n-workflows/deploy-invoice-reminder-cron.js`
- **Tracker:** Sheet `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`, tab `Invoices`
- **Digest channel:** #payments-invoices-updates (C09HN2EBPR7)

## Core Rules

1. **Run payment detection first** — never remind a client who already paid
2. Skip rows with Status (N) `Payment Complete`/`Paid`/`Collections`/`Draft…`; for `Partial Payment` use remaining balance (G − Q)
3. Payout-term-aware: 30d/15d invoices get 7d/3d/due-today reminders; 7d invoices get 3d/due-today only
4. Emails from john@kravemedia.co, always CC noa@ + strategist (Col K); include payment link (R) when present
5. Reminders Sent (L) is an append-only log; never write Col N
6. Slack alerts tag strategists by `<@SLACK_ID>`, never plain @name
