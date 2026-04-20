# Skill: Trigger Invoice Reminder Cron

**Trigger:** "run invoice reminders", "check invoice reminders", "trigger invoice reminder", "/invoice-reminder-trigger"
**What it does:** Fires the n8n Invoice Reminder Cron workflow on demand via webhook. The workflow scans the Client Invoice Tracker, sends reminder emails for due/overdue invoices, updates tracker statuses, and posts overdue alerts to #payments-invoices-updates.

---

## Webhook Details

- **URL:** `https://noatakhel.app.n8n.cloud/webhook/krave-invoice-reminder`
- **Method:** POST
- **Auth:** none (URL is the secret)
- **Workflow:** Krave — Invoice Reminder Cron (ID: `QvHzslWExLjrH0mo`)
- **n8n instance:** `https://noatakhel.app.n8n.cloud`

---

## Execution Steps

### Step 1 — Fire the webhook
```bash
curl -s -X POST "https://noatakhel.app.n8n.cloud/webhook/krave-invoice-reminder" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Step 2 — Confirm trigger
- A 200 response means the workflow started successfully
- The workflow runs asynchronously — results appear in #payments-invoices-updates within ~30 seconds (only if overdue/late-fee/collections invoices are found)
- Completely silent if no action is needed

### Step 3 — Report back
```
Invoice reminder cron triggered — n8n is running the check now.
Any overdue alerts will appear in #payments-invoices-updates within ~30 seconds.
```

---

## Notes
- The workflow must be **active** in n8n for the production webhook URL to work
- If inactive, use the test URL: `https://noatakhel.app.n8n.cloud/webhook-test/krave-invoice-reminder`
- Runs automatically twice daily: 10:00 AM + 5:00 PM ICT (03:00 + 10:00 UTC)
- Emails currently send from noa@kravemedia.co — add john@ Gmail OAuth2 to n8n to switch sender
