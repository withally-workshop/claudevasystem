# n8n Workflows

Automated workflows running on n8n Cloud (`noatakhel.app.n8n.cloud`).

## Workflows

| Workflow | Status | Schedule | File |
|----------|--------|----------|------|
| Payment Detection | ✅ Active | Every 2 hrs | [payment-detection.workflow.json](payment-detection.workflow.json) |

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

## Adding a new workflow

1. Build it in n8n
2. Export JSON: `curl -s https://noatakhel.app.n8n.cloud/api/v1/workflows/{id} -H "X-N8N-API-KEY: ..." > n8n-workflows/name.workflow.json`
3. Add a deploy script if needed
4. Add a row to the table above
