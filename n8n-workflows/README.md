# n8n Workflows

Automated workflows running on n8n Cloud (`noatakhel.app.n8n.cloud`).

## Workflows

| Workflow | Status | Schedule | File |
|----------|--------|----------|------|
| Payment Detection | Active | Every hour | [deploy-payment-detection.js](deploy-payment-detection.js) |
| Invoice Reminder Cron | Active | 9am ICT daily | [deploy-invoice-reminder-cron.js](deploy-invoice-reminder-cron.js) |
| EOD Triage Summary | Active | 6pm ICT weekdays | [deploy-eod-triage-summary.js](deploy-eod-triage-summary.js) |
| Start Of Day Report | Active | Manual trigger + production webhook | `deploy-sod-report.js` |
| Inbox Triage Daily | Active | 9am ICT weekdays + manual webhook | [deploy-inbox-triage-daily.js](deploy-inbox-triage-daily.js) |
| Slack Invoice Handler | Active | Slack slash command + modal submit | [deploy-slack-invoice-handler.js](deploy-slack-invoice-handler.js) |
| Invoice Request Intake | Paused (testing) | Slack modal / manual trigger | [deploy-invoice-request-intake.js](deploy-invoice-request-intake.js) |
| Client Invoice Creation | Active | Every 2 hrs Mon–Fri 9am–5pm PHT + manual webhook | [deploy-client-invoice-creation.js](deploy-client-invoice-creation.js) |

---

## Payment Detection

Scans `noa@kravemedia.co` for Airwallex deposit emails every hour, matches them to open invoices, updates the Client Invoice Tracker, and posts confirmations to `#payments-invoices-updates`. Silent when no new deposits found.

**Workflow ID:** `WqIvJqpKaLXPDfe3`

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

Scans the Client Invoice Tracker daily at 9am ICT, sends reminder emails from `john@kravemedia.co`, tags the correct strategist plus Amanda in `#payments-invoices-updates` for overdue states, and updates the tracker.

**Silent when nothing to do.** Slack alerts only fire for `due-today`, `overdue`, `late-fee`, `collections`, or missing client email.

**Strategist tagging:** Reads Col K (`Requested By`) and maps it to the Slack user ID used in overdue alerts.

**Workflow ID:** `Q3IqqLvmX9H49NdE`

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

---

## EOD Triage Summary

**Workflow ID:** `9hZcOcAqQdM7o1yZ`

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

## Start Of Day Report

**Workflow ID:** `vUunl0NuBA6t4Gw4`

Deployed in n8n and kept active so the production webhook stays registered. Run it from the webhook or from the editor once all required morning inputs are already present in `#airwallexdrafts`.

**Webhook (manual trigger):**
```text
POST https://noatakhel.app.n8n.cloud/webhook/krave-sod-report
```

**Deploy from scratch:**
```bash
node n8n-workflows/deploy-sod-report.js
```

**Required inputs before running:**
- yesterday's EOD message containing `Today's Wrap-up`
- John's same-day morning dump

**Optional input:**
- today's `Morning Triage`

**Validation behavior:** hard-stop if yesterday's EOD or John's morning dump is missing. If `Morning Triage` is missing, the workflow still sends the report and simply omits inbox-triage follow-ups.

**Outputs:**
- post the final SOD report to `#airwallexdrafts`
- send the same report to Noa's Slack DM

**Credentials required in n8n:**
- `Krave Slack Bot` - read/post access for `#airwallexdrafts` and Noa DM
- `OpenAI account` - OpenAI API credential for the report generation node

---

## Inbox Triage Daily

Reads inbox email from the last 24 hours in `noa@kravemedia.co`, classifies each message into the `EA/*` tier model, creates Gmail drafts for `EA/Urgent` and `EA/Needs-Reply` only when the thread is not already in motion, repairs Gmail labels when needed, leaves `EA/Unsure` in the inbox, and posts the final summary to both `#airwallexdrafts` and Noa's Slack DM.

**Workflow ID:** `3YyEjk1e6oZV786T`

**Draft-only behavior:** creates Gmail drafts only and never sends email automatically.

**Inbox retention:** `EA/Unsure` stays in the inbox for manual review after triage.

**Search scope:** `in:inbox newer_than:1d` so the run covers the last 24 hours of inbox mail, including both read and unread messages that are still in the inbox.

**Already-actioned detection:** if Noa already replied, a draft already exists, or the thread already has an `EA/*` label, the workflow still classifies the email and repairs labels if needed, but it does not create a duplicate draft.

**Morning Triage notes:** already-actioned emails stay in their normal sections with inline notes such as `already replied`, `draft exists`, or `already labeled`.

**Webhook (manual trigger):**
```text
POST https://noatakhel.app.n8n.cloud/webhook/krave-inbox-triage-daily
```

**Deploy from scratch:**
```bash
node n8n-workflows/deploy-inbox-triage-daily.js
```

**Credentials required in n8n:**
- `Gmail account` - `noa@kravemedia.co` OAuth2 for inbox reads, labels, archive, and Gmail drafts
- `Krave Slack Bot` - summary posts to `#airwallexdrafts` plus Noa DM delivery
- `OpenAI account` - classification and reply drafting

---

## Invoice Request Intake

**Workflow ID:** `5XHxhQ7wB2rxE3qz`

Accepts invoice requests from a **Structured Slack modal**, normalizes the submission, attempts full Airwallex draft invoice creation, writes the result into the existing Invoices sheet structure in the Client Invoice Tracker, and falls back to a manual-ready row plus John DM alert if any Airwallex step fails.

**Draft-only behavior:** v1 stops after the Airwallex `draft invoice created` state. It does not auto-finalize or auto-send.

**Tracker write behavior:** intake reuses the existing Invoices sheet structure and documented Invoices tab columns such as `Client Name`, `Email Address`, `Project Description`, `Airwallex Invoice ID`, `Amount`, `Currency`, `Due Date`, `Status`, and `Requested By`. Successful drafts land with status `Draft - Pending John Review`.

**Slack intake fields:** `Client Name or Company Name`, `Billing Address`, `Currency`, `Payout`, `Invoice Date`, `Memo / Project Description`, and freeform `Line Items`. Billing Address is captured as text and condensed into `Project Description` because the current tracker does not have a dedicated billing-address column.

**Date rules:** blank `Payout` defaults to `7 day payout`. Supported payout phrases in v1 are `7 day payout`, `14 day payout`, `30 day payout`, `due now`, and `due on <date>` such as `due on May 1, 2026`. `Invoice Date` accepts blank, `today`, `tomorrow`, `YYYY-MM-DD`, or clear month-name dates like `May 1, 2026`, and defaults to today in `Asia/Manila`.

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

## Slack Invoice Handler

**Workflow ID:** `t7MMhlUo5H4HQmgL`

**Current live state:** deployed in n8n and currently active.

Receives Slack slash-command and modal submission payloads, opens the invoice modal with `views.open`, normalizes the submitted fields, updates the modal to a submitted confirmation view, posts a structured receipt to `#payments-invoices-updates`, and forwards the final structured JSON into the existing invoice intake workflow.

**Slack app setup:** use the same Request URL for both `Slash Commands` and `Interactivity & Shortcuts`.

**Modal fields:** `Client Name or Company Name`, `Billing Address`, `Email`, `Currency`, `Payout`, `Invoice Date`, `Memo / Project Description`, and freeform `Line Items`. Freeform line items support inputs like `Krave Media x1 @ 1300`, `UGC package x2 @ 500`, or `April retainer 2500`. If quantity is omitted, the handler defaults it to `1`.

**Helper examples:** payout helper copy shows `7 day payout`, `14 day payout`, and `30 day payout`. Blank payout defaults to `7 day payout`. Invoice-date helper copy shows `today`, `2026-04-21`, and `May 1, 2026`.

**Request URL:**
```text
POST https://noatakhel.app.n8n.cloud/webhook/slack-invoice-handler
```

**Downstream handoff:**
```text
POST https://noatakhel.app.n8n.cloud/webhook/krave-invoice-request-intake
```

**Deploy from scratch:**
```bash
node n8n-workflows/deploy-slack-invoice-handler.js
```

**Credentials required in n8n:**
- `Krave Slack Bot` - used by the HTTP Request node to call Slack `views.open`

---

## Adding a new workflow

1. Build it in n8n
2. Export JSON: `curl -s https://noatakhel.app.n8n.cloud/api/v1/workflows/{id} -H "X-N8N-API-KEY: ..." > n8n-workflows/name.workflow.json`
3. Add a deploy script if needed
4. Add a row to the table above
