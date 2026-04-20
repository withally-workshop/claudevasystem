# n8n Workflows

Automated workflows running on n8n Cloud (`noatakhel.app.n8n.cloud`).

## Workflows

| Workflow | Status | Schedule | File |
|----------|--------|----------|------|
| Payment Detection | ✅ Active | 10am + 5pm ICT | [payment-detection.workflow.json](payment-detection.workflow.json) |
| Invoice Reminder Cron | ✅ Active | 10am ICT daily | [deploy-invoice-reminder-cron.js](deploy-invoice-reminder-cron.js) |

---

## Payment Detection

Scans noa@kravemedia.co for Airwallex deposit emails → matches to open invoices → updates Client Invoice Tracker → posts to #payments-invoices-updates.

**Webhook (manual trigger):**
```
POST https://noatakhel.app.n8n.cloud/webhook/krave-payment-detection
```

**Deploy from scratch:**
```
node n8n-workflows/deploy-payment-detection.js
```

**Credentials required in n8n:**
- `Gmail account` — noa@kravemedia.co OAuth2
- `Google Sheets account` — access to Client Invoice Tracker
- `Krave Slack Bot` — bot token for #payments-invoices-updates

---

## Invoice Reminder Cron

Scans Client Invoice Tracker twice daily → sends pre-due and overdue reminder emails from noa@kravemedia.co → tags correct strategist + Amanda in #payments-invoices-updates for overdue/late-fee/collections → updates tracker (Status + Reminders Sent).

**Silent when nothing to do.** Slack alerts only fire for: due-today, overdue, late-fee, collections, or missing client email.

**Strategist tagging:** Reads Col K (Requested By) → maps to Slack user ID → tags in overdue alerts.

**Webhook (manual trigger):**
```
POST https://noatakhel.app.n8n.cloud/webhook/krave-invoice-reminder
```

**Deploy from scratch:**
```
node n8n-workflows/deploy-invoice-reminder-cron.js
```

**Credentials required in n8n:**
- `Gmail account` — noa@kravemedia.co OAuth2 (swap to john@ once that credential is added)
- `Google Sheets account` — access to Client Invoice Tracker
- `Krave Slack Bot` — bot token for #payments-invoices-updates

**Workflow ID:** `QvHzslWExLjrH0mo`

---

## Adding a new workflow

1. Build it in n8n
2. Export JSON: `curl -s https://noatakhel.app.n8n.cloud/api/v1/workflows/{id} -H "X-N8N-API-KEY: ..." > n8n-workflows/name.workflow.json`
3. Add a deploy script if needed
4. Add a row to the table above
