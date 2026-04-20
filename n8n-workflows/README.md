# n8n Workflows

Automated workflows running on n8n Cloud (`noatakhel.app.n8n.cloud`).

## Workflows

| Workflow | Status | Schedule | File |
|----------|--------|----------|------|
| Payment Detection | Active | 10am + 5pm ICT | [payment-detection.workflow.json](payment-detection.workflow.json) |
| Invoice Reminder Cron | Active | 10am ICT daily | [deploy-invoice-reminder-cron.js](deploy-invoice-reminder-cron.js) |
| EOD Triage Summary | Planned | 6pm ICT weekdays | [deploy-eod-triage-summary.js](deploy-eod-triage-summary.js) |
| Invoice Request Intake | Planned | Slack modal / manual trigger | [deploy-invoice-request-intake.js](deploy-invoice-request-intake.js) |

---

## Payment Detection

Scans `noa@kravemedia.co` for Airwallex deposit emails, matches them to open invoices, updates the Client Invoice Tracker, and posts confirmations to `#payments-invoices-updates`.

**Webhook (manual trigger):**
```text
POST https://noatakhel.app.n8n.cloud/webhook/krave-payment-detection
```

**Deploy from scratch:**
```bash
node n8n-workflows/deploy-payment-detection.js
```

**Credentials required in n8n:**
- `Gmail account` - `noa@kravemedia.co` OAuth2
- `Google Sheets account` - access to Client Invoice Tracker
- `Krave Slack Bot` - bot token for `#payments-invoices-updates`

---

## Invoice Reminder Cron

Scans the Client Invoice Tracker daily at 10am ICT, sends reminder emails from `john@kravemedia.co`, tags the correct strategist plus Amanda in `#payments-invoices-updates` for overdue states, and updates the tracker.

**Silent when nothing to do.** Slack alerts only fire for `due-today`, `overdue`, `late-fee`, `collections`, or missing client email.

**Strategist tagging:** Reads Col K (`Requested By`) and maps it to the Slack user ID used in overdue alerts.

**Webhook (manual trigger):**
```text
POST https://noatakhel.app.n8n.cloud/webhook/krave-invoice-reminder
```

**Deploy from scratch:**
```bash
node n8n-workflows/deploy-invoice-reminder-cron.js
```

**Credentials required in n8n:**
- `Gmail account` - `john@kravemedia.co` OAuth2
- `Google Sheets account` - access to Client Invoice Tracker
- `Krave Slack Bot` - bot token for `#payments-invoices-updates`

**Workflow ID:** `QvHzslWExLjrH0mo`

---

## EOD Triage Summary

Reads same-day Slack activity from `#airwallexdrafts`, `#ad-production-internal`, and `#payments-invoices-updates`, builds a compact AI prompt, uses OpenAI to generate Noa's EOD summary, sends Noa a Slack DM, and posts the same summary to `#airwallexdrafts` for SOD carry-over.

**Webhook (manual trigger):**
```text
POST https://noatakhel.app.n8n.cloud/webhook/krave-eod-triage-summary
```

**Deploy from scratch:**
```bash
node n8n-workflows/deploy-eod-triage-summary.js
```

**Credentials required in n8n:**
- `Krave Slack Bot` - read/post access for the three source channels and Noa DM
- `OpenAI account` - OpenAI API credential for the summary node

---

## Invoice Request Intake

Accepts invoice requests from a **Structured Slack modal**, normalizes the submission, attempts full Airwallex draft invoice creation, writes the result into the existing Invoices sheet structure in the Client Invoice Tracker, and falls back to a manual-ready row plus John DM alert if any Airwallex step fails.

**Draft-only behavior:** v1 stops after the Airwallex `draft invoice created` state. It does not auto-finalize or auto-send.

**Tracker write behavior:** intake reuses the documented Invoices tab columns such as `Client Name`, `Email Address`, `Project Description`, `Airwallex Invoice ID`, `Amount`, `Currency`, `Due Date`, `Status`, and `Requested By`. Successful drafts land with status `Draft - Pending John Review`.

**Webhook (manual trigger):**
```text
POST https://noatakhel.app.n8n.cloud/webhook/krave-invoice-request-intake
```

**Deploy from scratch:**
```bash
node n8n-workflows/deploy-invoice-request-intake.js
```

**Credentials required in n8n:**
- `Krave Slack Bot` - modal intake, requester confirmations, and John DM testing alerts
- `Google Sheets account` - access to Client Invoice Tracker
- `Airwallex admin API access` - billing auth plus customer/product/price/invoice endpoints

---

## Adding a new workflow

1. Build it in n8n
2. Export JSON: `curl -s https://noatakhel.app.n8n.cloud/api/v1/workflows/{id} -H "X-N8N-API-KEY: ..." > n8n-workflows/name.workflow.json`
3. Add a deploy script if needed
4. Add a row to the table above
