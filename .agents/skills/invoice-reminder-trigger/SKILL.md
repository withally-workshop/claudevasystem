---
name: invoice-reminder-trigger
description: Use when Codex needs to fire the n8n Invoice Reminder Cron workflow on demand. Triggers include "run invoice reminders", "check invoice reminders", "trigger invoice reminder", "/invoice-reminder-trigger". Fire-and-forget webhook — the workflow scans the Client Invoice Tracker, emails due/overdue reminders, updates statuses, and posts overdue alerts to #payments-invoices-updates.
metadata:
  short-description: Fire invoice reminder cron via webhook
---

# Trigger Invoice Reminder Cron

Fire the n8n Invoice Reminder Cron workflow on demand. Fire-and-forget — results appear in `#payments-invoices-updates` within ~30 seconds (silent if nothing is due).

## How to Trigger

**Manual:** "run invoice reminders", "trigger invoice reminder", "/invoice-reminder-trigger"

**Webhook:**
```bash
curl -s -X POST "https://noatakhel.app.n8n.cloud/webhook/krave-invoice-reminder" \
  -H "Content-Type: application/json" -d '{}'
```

## Key References

- **Full skill:** `.claude/skills/invoice-reminder-trigger/SKILL.md`
- **Workflow:** Krave — Invoice Reminder Cron (`Q3IqqLvmX9H49NdE`) on `noatakhel.app.n8n.cloud`
- **Deploy script:** `n8n-workflows/deploy-invoice-reminder-cron.js`
- **Scheduled run:** Mon–Fri 10:00 AM PHT (Asia/Manila) — manual trigger is for off-schedule checks

## Notes

- 200 response = workflow started; it runs asynchronously
- Workflow must be active for the production URL; test URL: `/webhook-test/krave-invoice-reminder`
- Report back: "Invoice reminder cron triggered — overdue alerts will appear in #payments-invoices-updates within ~30 seconds."
