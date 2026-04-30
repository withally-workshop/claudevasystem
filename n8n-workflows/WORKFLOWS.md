# Krave Media - n8n Automation Workflows

**Instance:** `noatakhel.app.n8n.cloud`  
**Last updated:** `2026-04-21`  
**Maintained by:** John (Systems Partner) - `john@kravemedia.co`

---

## Table of Contents

1. [Workflow Index](#workflow-index)
2. [Shared Infrastructure](#shared-infrastructure)
3. [Workflow 1 - Payment Detection](#workflow-1---payment-detection)
4. [Workflow 2 - Invoice Reminder Cron](#workflow-2---invoice-reminder-cron)
5. [Workflow 3 - EOD Triage Summary](#workflow-3---eod-triage-summary)
6. [Workflow 4 - Start Of Day Report](#workflow-4---start-of-day-report)
7. [Workflow 5 - Inbox Triage Daily](#workflow-5---inbox-triage-daily)
8. [Workflow 6 - Slack Invoice Handler](#workflow-6---slack-invoice-handler)
9. [Workflow 7 - Invoice Request Intake](#workflow-7---invoice-request-intake)
10. [Credential Reference](#credential-reference)
11. [Runbook - Common Scenarios](#runbook---common-scenarios)
12. [Handover Checklist](#handover-checklist)

---

## Workflow Index

| # | Name | ID | Status | Schedule | Purpose |
|---|------|----|--------|----------|---------|
| 1 | Krave - Payment Detection | `NurOLZkg3J6rur5Q` | Active | Hourly | Detect Airwallex deposits, match invoices, update tracker |
| 2 | Krave - Invoice Reminder Cron | `Q3IqqLvmX9H49NdE` | Active | 10am ICT daily | Send invoice reminders, alert overdue, update tracker |
| 3 | Krave - EOD Triage Summary | `9hZcOcAqQdM7o1yZ` | Active | 6pm ICT weekdays | Summarize daily Slack activity, DM Noa, archive to `#airwallexdrafts` |
| 4 | Krave - Start Of Day Report | `vUunl0NuBA6t4Gw4` | Active | Manual trigger + `POST /webhook/krave-sod-report` | Build the SOD report from validated Slack inputs and deliver to `#airwallexdrafts` plus Noa DM |
| 5 | Krave - Inbox Triage Daily | `3YyEjk1e6oZV786T` | Active | 9am ICT weekdays + manual webhook | Read inbox email, create Gmail drafts, apply labels, keep `EA/Unsure` in inbox, and post summary to `#airwallexdrafts` plus Noa |
| 6 | Krave - Slack Invoice Handler | `t7MMhlUo5H4HQmgL` | Active | Slash command + modal submit | Open the Slack modal and forward normalized submissions to invoice intake |
| 7 | Krave - Invoice Request Intake | `5XHxhQ7wB2rxE3qz` | Active | Structured Slack modal / manual webhook | Capture invoice requests, create Airwallex drafts, and fall back to manual-ready tracker rows |
| 8 | Krave - Invoice Approval Polling | `uCS9lzHtVKWlqYlk` | Active | Every 2 hrs Mon-Fri 9am-5pm PHT + `POST /webhook/krave-invoice-approval-polling` | Poll tracker for pending drafts, detect John's "approve" replies, finalize in Airwallex, write tracker link, and reply in the original strategist thread |
| 9 | Krave - Client Invoice Creation | `9eqWz6oJI5dqBesa` | Inactive legacy | Do not trigger | Deprecated finalization path; approval polling is canonical |

---

## Shared Infrastructure

### Data Sources

| Resource | Type | ID / Location | Access |
|----------|------|---------------|--------|
| Client Invoice Tracker | Google Sheets | `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50` | Tab: `Invoices` |
| Slack channel | `#payments-invoices-updates` | `C09HN2EBPR7` | Bot posts and reads |
| Slack channel | `#airwallexdrafts` | `C0AQZGJDR38` | Bot reads and archives EOD |
| Slack channel | `#ad-production-internal` | `C0AGEM919QV` | Bot reads |
| Slack DM destination | Noa Takhel | `U06TBGX9L93` | Bot sends EOD DM |
| Slack DM destination | John | `U0AM5EGRVTP` | Bot sends invoice intake testing alerts |
| Gmail inbox (scan) | `noa@kravemedia.co` | OAuth2 | Read only (payment detection) |
| Gmail inbox (send) | `john@kravemedia.co` | OAuth2 | Send + CC |

### Invoice Tracker Column Map

| Col | Header | Used By |
|-----|--------|---------|
| A | Date Created | - |
| B | Client Name | Payment Detection, Invoice Reminder Cron |
| C | Email Address | Invoice Reminder Cron |
| D | Project Description | - |
| E | Invoice # | Airwallex invoice `number` (`INV-...`); Payment Detection, Invoice Reminder Cron, Invoice Approval Polling |
| F | Airwallex Invoice ID | Airwallex invoice `id` (`inv_...`); Payment Detection, Invoice Approval Polling |
| G | Amount | Payment Detection, Invoice Reminder Cron |
| H | Currency | Payment Detection, Invoice Reminder Cron |
| I | Due Date | Invoice Reminder Cron |
| J | Payment Status | Payment Detection, Invoice Reminder Cron, Invoice Approval Polling |
| K | Requested By | Invoice Reminder Cron |
| L | Reminders Sent | Invoice Reminder Cron |
| M | Payment Confirmed Date | Payment Detection |
| N | Status | Formula-driven display (`Paid`, `Overdue`, `Unpaid`); read-only, never write |
| O | Notes | Payment Detection (Osome check) |
| P | Origin Thread TS | Invoice Request Intake, Invoice Approval Polling; stored as text to preserve Slack decimal timestamps |
| Q | Amount Paid | Payment Detection (write), Invoice Reminder Cron (read) — cumulative amount paid |
| R | Invoice URL | Invoice Approval Polling, Invoice Reminder Cron |

### Status Value Reference

| Value | Set By | Meaning |
|-------|--------|---------|
| `Invoice Sent` | Manual / invoice creation flow | Invoice delivered to client |
| `Draft - Pending John Review` | Invoice creation flow | Not sent yet, skip reminders |
| `Partial Payment` | Payment Detection | Instalment received; remaining balance still owed |
| `Payment Complete` | Payment Detection | Full payment confirmed |
| `Late Fee Applied - YYYY-MM-DD` | Invoice Reminder Cron | 7+ days overdue, fee logged |
| `Collections` | Invoice Reminder Cron | 60+ days overdue, escalated |

---

## Workflow 1 - Payment Detection

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/NurOLZkg3J6rur5Q`
**Deploy script:** `n8n-workflows/deploy-payment-detection.js`

### Purpose

Replaces the manual daily task of checking whether clients have paid. Runs two detection paths in parallel: (1) scans `noa@kravemedia.co` for Airwallex deposit emails, and (2) polls the Airwallex invoice API directly — catching SWIFT bank-transfer payments that may not generate an email. Matches deposits to open invoices, handles partial payments (records amount paid, defers Airwallex mark-paid), marks full payments complete, and posts Slack alerts for all outcomes.

### Triggers

| Type | Details |
|------|---------|
| Schedule | `0 * * * *` - hourly |
| Webhook | `POST https://noatakhel.app.n8n.cloud/webhook/krave-payment-detection` |

### Node Flow

```text
[Schedule / Webhook]
        |
[Claim Window]              ← reads/writes lastRunTs; builds after:{ts} Gmail query
        |
   ┌────┴────────────────────────────┐
   │                                 │
[Search Airwallex Emails]   [Get Invoice Tracker]      ← tracker lookup; never feeds Gmail
   │                                 │
[Parse All Emails]          [Poll Airwallex Invoices]  ← API poll: SWIFT/bank transfers
   │                                 │
   └────────────┬────────────────────┘
                │
   [Combine Payment Signals]         ← waits for both paths
                │
   [Match Deposits To Invoices]      ← dedupes signals; unmatched exits silently
                │
           [Is Partial?]
            /         \
     TRUE              FALSE
      |                  |
[Update Partial     [Is Osome?]
  Tracker]          /        \
      |           TRUE       FALSE
[Slack Partial      |           |
   Alert]   [Update Osome]  [Airwallex Auth]
            [Status]           |
                |         [Airwallex Mark Paid]
            [Slack Osome]      |
            [Confirmed]   [Update Invoice Status]
                               |
                          [Slack Payment Confirmed]
```

### Matching Logic

1. Candidate rows must have Column N `Status` of `Unpaid`, `Overdue`, or blank and Column J `Payment Status` must not be `Payment Complete`, `Collections`, or a draft state.
2. Invoice number match against Col E (high confidence).
3. Exact amount + currency match against a single eligible invoice (medium confidence).
4. Ambiguous matches are skipped silently.
5. Unmatched deposits exit silently — no Slack alert.
6. **Time-windowing:** Gmail query uses `after:{lastRunTs}` — only emails since last run. Stored in n8n static data. First run falls back to `newer_than:1d`. Gmail search runs once per execution and must never be fed by tracker rows.
7. **Deduplication:** signals are deduped before tracker writes or Slack posts, using invoice/amount/currency/date when invoice number is available.

### Partial Payment Detection

After a match, the workflow checks if the received amount covers the full invoice:

- `existingAmountPaid` = Col Q (Amount Paid) — 0 if empty
- `newAmountPaid` = existingAmountPaid + received amount
- `remaining` = Col G (Amount) − newAmountPaid
- **Partial** if remaining > $1.00 → Col J Payment Status `Partial Payment`, Col Q updated, Airwallex NOT marked paid
- **Full** if remaining ≤ $1.00 → existing full-payment flow (mark paid, Col J Payment Status `Payment Complete`)

Second payments on the same invoice: Col Q carries over, so the second run's `newAmountPaid` accumulates correctly and triggers full-payment flow when the total is reached.

### Airwallex API Poll

`Poll Airwallex Invoices` (Code node, `continueOnFail: true`) runs in parallel with the Gmail scan:
- Authenticates with Airwallex API
- For each open non-Osome tracker row with an Airwallex Invoice ID, calls `GET /api/v1/invoices/{id}`
- Checks `paid_amount` / `amount_paid` / `total_paid` field (field name unconfirmed — verify on first run with a live partial invoice)
- If API shows more paid than Col Q records, injects a payment signal for the difference
- Gmail and API signals are merged, then deduped before matching so one payment event can produce only one tracker update and one Slack post.

### Outputs

| Outcome | Action |
|---------|--------|
| Full payment matched (Airwallex) | Sheets Col J → Payment Complete, Col M date, Col Q = full amount, Airwallex marked paid, Slack ✅ |
| Full payment matched (Osome) | Sheets Col J → Payment Complete, Col M date, Col Q = full amount, Slack ✅ (no Airwallex call) |
| Partial payment matched | Sheets Col J → Partial Payment, Col M date, Col Q = cumulative paid, Slack 🔄 |
| No emails / no API signals | Silent |
| Unmatched deposit | Silent — no alert |
| Shopify / payout noise | Skipped silently |

### Error Handling

| Failure | Behaviour |
|---------|-----------|
| First run (no static data yet) | `lastRunTs` defaults to 0 — falls back to `newer_than:1d`, continues normally |
| Airwallex API poll auth fails | `continueOnFail: true` — returns empty emails array; Gmail scan still runs |
| Per-invoice API fetch fails | Silent — that invoice skipped in poll; Gmail scan is fallback |
| Airwallex `paid_amount` field missing | Poll returns nothing for that invoice — no false positives |
| Airwallex mark paid fails | `continueOnFail: true` — Sheets still update |
| Gmail auth error | Workflow errors and n8n emails the instance owner |

---

## Workflow 2 - Invoice Reminder Cron

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/Q3IqqLvmX9H49NdE`  
**Deploy script:** `n8n-workflows/deploy-invoice-reminder-cron.js`

### Purpose

Replaces manual invoice follow-up. Once daily, it scans every open invoice in the tracker, calculates days until or since due date, sends tiered reminder emails from `john@kravemedia.co`, updates the tracker, and posts Slack alerts for overdue and escalated invoices.

### Triggers

| Type | Details |
|------|---------|
| Schedule | `0 3 * * *` - 10:00 AM ICT daily |
| Webhook | `POST https://noatakhel.app.n8n.cloud/webhook/krave-invoice-reminder` |

### Node Flow

```text
[Schedule / Webhook]
        |
[Get Invoice Tracker]
        |
[Process Invoices]
        |
[Has Client Email?]
   | true                     | false
   v                          v
[Send Reminder Email]   [Slack Missing Email Warning]
        |
[Update Tracker Row]
        |
[Needs Slack Alert?]
   | true
   v
[Slack Overdue Alert]
```

### Reminder Schedule

| Days Until/Since Due | Trigger | Email Type | Slack Alert |
|----------------------|---------|-----------|-------------|
| +7 | Pre-due | Payment Reminder | No |
| +5 | Pre-due | Payment Reminder | No |
| +3 | Pre-due | Payment Reminder | No |
| +1 | Pre-due | Payment Reminder | No |
| 0 | Due today | Invoice Due Today | Yes |
| -1 to -6 | Overdue | Overdue Invoice | Yes |
| -7 | Late fee | Late Fee Applied | Yes |
| -8 to -59 | Late fee follow-up | Late Fee Applied | Yes |
| <= -60 | Collections | FINAL NOTICE | Yes |

### Deduplication

- Same reminder type sent within 2 days -> skip
- `late-fee-followup` sent within 7 days -> skip

### Outputs

| Scenario | Email | Slack |
|----------|-------|-------|
| Pre-due | Sent | Silent |
| Due today / Overdue | Sent | Alert |
| Late fee | Sent | Alert |
| Collections | Sent | Alert |
| Missing client email | Skipped | Warning |
| Unknown strategist | Sent, CC skipped | Warning appended |
| Nothing to action | - | Silent |

### Error Handling

| Failure | Behaviour |
|---------|-----------|
| Gmail send error | `continueOnFail: true`, downstream Slack path can still run |
| Missing client email | Warning posted, no send |
| Bad due date / missing invoice key | Row skipped |

---

## Workflow 3 - EOD Triage Summary

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/9hZcOcAqQdM7o1yZ`  
**Deploy script:** `n8n-workflows/deploy-eod-triage-summary.js`

### Purpose

Replaces the scheduled Claude-based EOD summary. Every weekday at 6:00 PM ICT, the workflow reads same-day Slack activity from the three operating channels, compacts the activity into an AI-ready context block, generates Noa's final EOD wrap-up with OpenAI, sends it to Noa via Slack DM, and posts the exact same message to `#airwallexdrafts` for next-day SOD carry-over.

### Triggers

| Type | Details |
|------|---------|
| Schedule | `0 10 * * 1-5` - 6:00 PM ICT weekdays |
| Webhook | `POST https://noatakhel.app.n8n.cloud/webhook/krave-eod-triage-summary` |

### Node Flow

```text
[Schedule / Webhook]
        |
[Get Airwallex Drafts History]
        |
[Get Ad Production History]
        |
[Get Payments History]
        |
[Build EOD Context]
        |
[Generate EOD Summary]
        |
[Send EOD to Noa]
        |
[Did Noa Send Fail?]
   | false                  | true
   v                        v
[Post Archive Copy]    [Retry Send to Noa]
                              |
                        [Did Retry Fail?]
                         | false          | true
                         v                v
                  [Post Archive Copy] [Post Failure Alert]
```

### Source Channels

| Channel | ID | Used For |
|---------|----|----------|
| `#airwallexdrafts` | `C0AQZGJDR38` | John's task dump, invoice drafts, inbox triage |
| `#payments-invoices-updates` | `C09HN2EBPR7` | Invoice requests, payment confirmations |

### AI Output Rules

- Uses the EOD template headed by `### 🏁 Today's Wrap-up`
- Bullets only, no paragraphs or filler
- Empty sections omitted
- Blockers must name who or what is blocking
- Quiet days still send a short summary
- Only same-day GMT+8 Slack activity is included

### Outputs

| Scenario | Action |
|----------|--------|
| Normal day | DM Noa and archive same message to `#airwallexdrafts` |
| Quiet day | DM Noa a short quiet-day summary and archive same message |
| First Slack DM fails | Retry once |
| Retry succeeds | Archive same message |
| Retry fails | Post failure alert plus formatted summary to `#airwallexdrafts` |

### Error Handling

| Failure | Behaviour |
|---------|-----------|
| One Slack DM failure | Retry once automatically |
| Two Slack DM failures | Post manual-send fallback to `#airwallexdrafts` |
| OpenAI node error | Workflow errors and n8n emails the instance owner |

---

## Workflow 4 - Start Of Day Report

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/vUunl0NuBA6t4Gw4`  
**Deploy script:** `n8n-workflows/deploy-sod-report.js`

### Purpose

Builds Noa's Start Of Day report from `#airwallexdrafts` after the required morning inputs are present. The workflow reads yesterday's EOD carry-over, John's same-day morning dump, and, when available, today's `Morning Triage`, then posts the final SOD report to both `#airwallexdrafts` and Noa's Slack DM.

### Triggers

| Type | Details |
|------|---------|
| Manual Trigger | Available in the editor for manual execution |
| Webhook | `POST https://noatakhel.app.n8n.cloud/webhook/krave-sod-report` |

### Required Inputs

| Source | Requirement |
|--------|-------------|
| Yesterday EOD | Prior-day bot message in `#airwallexdrafts` containing `Today's Wrap-up` |
| John morning dump | Same-day messages from John in `#airwallexdrafts` before the run |

### Optional Input

| Source | Requirement |
|--------|-------------|
| `Morning Triage` | Same-day bot message in `#airwallexdrafts` containing `Morning Triage`, used when available for BAU / inbox follow-ups |

### Validation

- Hard-stop if yesterday's EOD is missing
- Hard-stop if John's morning dump is missing
- If `Morning Triage` is missing, continue without inbox-triage follow-ups
- On validation failure, post the alert to `#airwallexdrafts` and do not DM Noa

### Outputs

| Scenario | Action |
|----------|--------|
| All required inputs found | Post report to `#airwallexdrafts`, then DM Noa |
| `Morning Triage` missing | Post report to `#airwallexdrafts`, then DM Noa, omitting inbox-triage follow-ups |
| Any required input missing | Stop and alert `#airwallexdrafts` |

### Error Handling

| Failure | Behaviour |
|---------|-----------|
| Missing yesterday EOD | Stop before generation and alert `#airwallexdrafts` |
| Missing John morning dump | Stop before generation and alert `#airwallexdrafts` |
| Missing `Morning Triage` | Continue without inbox-triage follow-ups |
| First Noa DM failure after archive post | Retry once automatically |
| Second Noa DM failure after archive post | Raise a compact failure alert for manual resend without rerunning generation |

---

## Workflow 5 - Inbox Triage Daily

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/3YyEjk1e6oZV786T`  
**Deploy script:** `n8n-workflows/deploy-inbox-triage-daily.js`

### Purpose

Reads inbox email from the last 24 hours in `noa@kravemedia.co`, classifies each message into the `EA/Urgent`, `EA/Needs-Reply`, `EA/FYI`, `EA/Auto-Sorted`, and `EA/Unsure` tier model, creates Gmail drafts for reply-needed messages only when the thread is not already in motion, repairs Gmail labels when needed, leaves `EA/Unsure` in the inbox, and posts the final summary to both `#airwallexdrafts` and Noa's Slack DM.

### Triggers

| Type | Details |
|------|---------|
| Schedule | `0 1 * * 1-5` - 9:00 AM ICT weekdays |
| Webhook | `POST https://noatakhel.app.n8n.cloud/webhook/krave-inbox-triage-daily` |

### Tier Model

| Tier | Meaning |
|------|---------|
| `EA/Urgent` | Requires Noa's action today |
| `EA/Needs-Reply` | Draft ready in Gmail for Noa to review |
| `EA/FYI` | No action, but Noa should know |
| `EA/Auto-Sorted` | Newsletters, receipts, and notifications |
| `EA/Unsure` | Ambiguous, stays in inbox for manual review |

### Starter Context Labels

`Krave`, `Halo-Home`, `Skyvane`, `Invoices`, `Contracts`, `Receipts`, `Suppliers`

### Search Scope

- Gmail query: `in:inbox newer_than:1d`
- Includes both read and unread emails that are still in the inbox
- Does not scan the full inbox by default

### Already-Actioned Detection

- Treat a thread as already actioned if Noa already replied, a draft already exists, or the thread already has an `EA/*` label
- Still classify and repair labels when the fresh classification is better
- Do not create a duplicate draft for already-actioned threads
- Keep already-actioned items in their normal Morning Triage sections with inline notes like `already replied`, `draft exists`, or `already labeled`

### Outputs

| Scenario | Action |
|----------|--------|
| `EA/Urgent` / `EA/Needs-Reply` | Create Gmail drafts when not already actioned, apply labels, include `Draft ready in Gmail` in summary |
| `EA/FYI` / `EA/Auto-Sorted` | Apply labels, archive after triage |
| `EA/Unsure` | Apply labels, keep in inbox, surface under `Review These` |

### Error Handling

| Failure | Behaviour |
|---------|-----------|
| Slack send failure | Retry once per destination, then post failure alert to `#airwallexdrafts` |
| Gmail draft or label issue | Workflow carries failure context into the final summary |
| Email send | Never send automatically; draft only |

---

## Workflow 6 - Slack Invoice Handler

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/t7MMhlUo5H4HQmgL`  
**Deploy script:** `n8n-workflows/deploy-slack-invoice-handler.js`

**Current live state:** present in n8n and currently active.

### Purpose

Handles the Slack-facing part of invoice intake. It accepts both the `/invoice-request` slash command and the matching modal submission payload, opens the modal with `views.open`, normalizes the submitted fields, updates the modal to a submitted confirmation view, posts a channel receipt to `#payments-invoices-updates`, and forwards the final structured JSON to `krave-invoice-request-intake`.

### Triggers

| Type | Details |
|------|---------|
| Webhook | `POST https://noatakhel.app.n8n.cloud/webhook/slack-invoice-handler` |
| Slack app usage | Use the same Request URL for both `Slash Commands` and `Interactivity & Shortcuts` |

### Node Flow

```text
[Webhook Trigger]
        |
[Parse Slack Payload]
        |
[Route Slack Event]
   | slash command           | interaction payload
   v                         v
[Open Invoice Modal]   [Route Interaction Type]
                               |
                               v
                     [Normalize Modal Submission]
                          |        |        |
                          v        v        v
            [Post Channel Receipt] [Acknowledge Modal Submission]
                      |
                      v
               [Inject Thread TS]
                      |
                      v
             [Send To Invoice Intake]
```

### Modal Rules

- Uses callback ID `invoice_request_modal`
- Opens the modal with Slack `views.open`
- Collects `client_name_or_company_name`, `billing_address`, `currency`, `payout`, `invoice_date`, `memo`, and `line_items_raw`
- The payout helper text shows `7 day payout`, `14 day payout`, and `30 day payout`
- The invoice-date helper text shows `today`, `2026-04-21`, and `May 1, 2026`
- Blank payout defaults to `7 day payout`
- The line item helper text is freeform, with examples like `Krave Media x1 @ 1300`
- Parses one line item per line and forwards the resulting `line_items[]` array to `krave-invoice-request-intake`
- Defaults quantity to `1` whenever the requester omits it

### Outputs

| Scenario | Action |
|----------|--------|
| Slash command received | Opens the invoice request modal in Slack |
| Modal `view_submission` received | Normalizes fields, updates the modal with a confirmation view, posts a channel receipt via `Krave Slack Bot`, injects the receipt `ts`, and POSTs to `krave-invoice-request-intake` |
| Unrelated Slack interaction | Ignored silently |

---

## Workflow 7 - Invoice Request Intake

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/5XHxhQ7wB2rxE3qz`  
**Deploy script:** `n8n-workflows/deploy-invoice-request-intake.js`

### Purpose

Replaces unstructured Slack invoice requests with a Structured Slack modal intake that captures clean billing inputs, attempts Airwallex draft creation automatically, writes the result to the tracker, and preserves a manual fallback when the API chain breaks.

### Triggers

| Type | Details |
|------|---------|
| Webhook | `POST https://noatakhel.app.n8n.cloud/webhook/krave-invoice-request-intake` |
| Intake source | Structured Slack modal submission forwarded into the webhook payload |

### Node Flow

```text
[Webhook Trigger]
        |
[Normalize Slack Submission]
        |
[Route Validation Outcome]
   | invalid                  | valid
   v                          v
[Hydrate Fallback Context] [Airwallex Auth]
        |                          |
        |                    [Route Airwallex Outcome]
        |                     | fail           | pass
        |                     v                v
        |              [Hydrate Fallback] [Merge Auth Token]
        |                                       |
        |                              [Lookup Billing Customer]
        |                                       |
        |                                [Resolve Customer]
        |                                       |
        |                              [Route Customer Exists]
        |                               | create     | reuse
        |                               v            v
        |                    [Create Billing Customer] [Prepare Product Payload]
        |                               |                    |
        |                    [Route Customer Create Outcome]-+
        |                                                    |
        |                                             [Create Products]
        |                                                    |
        |                                             [Prepare Price Payload]
        |                                                    |
        |                                               [Create Prices]
        |                                                    |
        |                                           [Aggregate Price IDs]
        |                                                    |
        |                                      [Prepare Draft Invoice Payload]
        |                                                    |
        |                                            [Create Draft Invoice]
        |                                                    |
        |                                         [Prepare Invoice Line Items]
        |                                                    |
        |                                        [Attach Invoice Line Items]
        |                                                    |
        |                                           [Mark Draft Success]
        |                                                    |
        +-------------------------[Write Tracker Fallback]   [Write Tracker Success]
                                      |                               |
                                      v                               v
                           [DM John Failure Alert]       [Requester Success Confirmation]
                                                                    |
                                                                    v
                                                      [Post Origin Channel Success]
```

### Intake Rules

- Uses a Structured Slack modal so required fields arrive in a predictable payload.
- Captures `Client Name or Company Name` and `Billing Address` instead of separate company and email fields.
- Captures `Payout` and `Invoice Date`, then computes the final `Due Date` inside intake.
- Supports payout phrases `7 day payout`, `14 day payout`, `30 day payout`, `due now`, and `due on <date>`.
- Supports multiple line items per request.
- Uses email-first Airwallex customer reuse: exact email match wins, name matching is only a fallback, and a new billing customer is created only if neither lookup resolves.
- Posts a success receipt back to the originating Slack receipt thread via `Krave Slack Bot` when a draft is created.

### Outputs

| Scenario | Action |
|----------|--------|
| Draft invoice created | Existing Invoices sheet structure row is updated with Airwallex IDs, the requester gets a success confirmation, and the originating Slack channel gets a receipt |
| Validation failure | Tracker fallback row is written for manual follow-up |
| Any Airwallex failure | Status becomes `fallback_manual_required`, tracker captures `failure_stage` and `failure_reason`, and John DM fires |

### Error Handling

| Failure | Behaviour |
|---------|-----------|
| Missing required modal fields | Mark `failed_validation` and write a manual-ready fallback row |
| Unparseable payout or invoice date | Mark `failed_validation`, preserve the raw text, and write a manual-ready fallback row |
| Airwallex auth / customer / product / price / invoice failure | Mark `fallback_manual_required`, preserve the line items payload, and send a John DM testing alert |
| Draft creation succeeds | Stop at draft only; no auto-finalize and no auto-send in v1 |

### Run Notes

- V1 is draft-only and stops once the Airwallex draft invoice exists.
- John DM is the temporary testing alert path while the workflow is being stabilized.
- Intake writes into the existing Invoices sheet structure rather than adding new intake-only columns.
- The intake workflow uses the documented columns `Client Name`, `Email Address`, `Project Description`, `Invoice #`, `Airwallex Invoice ID`, `Amount`, `Currency`, `Due Date`, `Payment Status`, `Requested By`, and `Origin Thread TS`.
- Column E `Invoice #` stores the Airwallex invoice `number` from the invoice create response. Column F stores the Airwallex invoice `id`. Column P `Origin Thread TS` stores the Slack receipt thread timestamp from the Slack Invoice Handler as text so the decimal portion is not lost.
- Successful draft creation writes status `Draft - Pending John Review`.
- Billing Address, Payout, Invoice Date, Due Date, and fallback context are condensed into the existing `Project Description` text so the tracker still fits the current A:N layout.

---

## Credential Reference

| Credential Name | Type | ID | Used By | Account |
|----------------|------|----|---------|---------|
| Gmail account | Gmail OAuth2 | `vxHex5lFrkakcsPi` | Payment Detection | `noa@kravemedia.co` |
| Gmail account (john) | Gmail OAuth2 | `vsDW3WpKXqS9HUs3` | Invoice Reminder Cron | `john@kravemedia.co` |
| Google Sheets account | Google Sheets OAuth2 | `83MQOm78gYDvziTO` | Payment Detection, Invoice Reminder Cron, Invoice Request Intake | `noa@kravemedia.co` |
| Krave Slack Bot | Slack API (Bot Token) | `Bn2U6Cwe1wdiCXzD` | Slack-facing workflow posts, modal handling, and SOD local/manual runs | Krave Slack workspace |
| OpenAI account | OpenAI API | `UIREXIYn59JOH1zU` | EOD Triage Summary, Inbox Triage Daily, Start Of Day Report | OpenAI API |

### Airwallex

Hardcoded in the Payment Detection HTTP Request nodes:

| Field | Value |
|-------|-------|
| `x-client-id` | `JaQA4uJ1SDSBkTdFigT9sw` |
| `x-api-key` | `5611f8e1...` |
| Auth endpoint | `POST https://api.airwallex.com/api/v1/authentication/login` |
| Mark paid endpoint | `POST https://api.airwallex.com/api/v1/invoices/{id}/mark_as_paid` |

> Airwallex credentials are hardcoded in the workflow deploy logic, not stored in n8n credentials. If the API key rotates, update both the deploy script and the live workflow nodes.

---

## Workflow 8 - Invoice Approval Polling

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/uCS9lzHtVKWlqYlk`
**Deploy script:** `n8n-workflows/deploy-invoice-approval-polling.js`
**Current live state:** deployed and active as of 2026-04-30. Safe manual webhook test returned `Workflow was started` with no pending draft rows expected.

### Purpose

Automates the approval and finalization leg of the invoice ops flow. Polls the tracker for drafts pending John's approval, scans his private approval channel for "approve" replies, finalizes the Airwallex invoice, retrieves the payment link, writes the link to the tracker, and replies to the strategist in the original #payments-invoices-updates thread. Replaces the manual `invoice-approval-polling` skill run.

### Triggers

| Type | Details |
|------|---------|
| Schedule | `0 1,3,5,7,9 * * 1-5` - every 2 hrs, Mon-Fri, 9 AM-5 PM PHT |
| Webhook | `POST https://noatakhel.app.n8n.cloud/webhook/krave-invoice-approval-polling` |

### Node Flow

```
[Schedule / Webhook Trigger]
  ↓
[Read Invoice Tracker] - Google Sheets, all rows A:R
  ↓
[Filter Pending Drafts] - filter: Payment Status = "Draft - Pending John Review"
  ↓ (true per row)
[Get John Channel History] — conversations.history on C0AQZGJDR38
  ↓
[Find Draft Notification] — code: search for bot message containing invoice_id
  ↓
[Notification Found?] — skip if no message in channel yet
  ↓
[Get Thread Replies] — conversations.replies on notification_ts
  ↓
[Find Approve Reply] — code: scan replies for "approve", no ✅ reaction
  ↓
[Approve Reply Found?] — skip if no unprocessed approve reply
  ↓
[Airwallex Auth] — POST /authentication/login (creds from process.env)
  ↓
[Auth OK?] — token present → continue; absent → Alert Auth Failed
  ↓
[Finalize Invoice] — POST /api/v1/invoices/{id}/finalize
  ↓
[Get Invoice] — GET /api/v1/invoices/{id} for payment link
  ↓
[Extract Payment Link] — code: hosted_invoice_url → hosted_url → digital_invoice_link → payment_link → checkout_url
  ↓
[Update Tracker] - appendOrUpdate, match Airwallex Invoice ID, refresh Invoice #, set Payment Status = "Invoice Sent", set Invoice URL
  ↓
[Reply in John Thread] — chat.postMessage to C0AQZGJDR38 thread
  ↓
[Notify Strategist] - Slack bot post to C09HN2EBPR7, using Col P Origin Thread TS when present
```

### Approval Detection Logic

- Source of truth for pending drafts: tracker Col J Payment Status = `Draft - Pending John Review`
- For each pending draft, search C0AQZGJDR38 (John's DM with bot) for bot message containing the Airwallex Invoice ID (Col F, format `inv_xxx`)
- After finalization, refresh Col E `Invoice #` from Airwallex `number` because a draft number can change from `...-DRAFT` to the finalized `...-0001` value.
- Tracker updates match on stable Col F `Airwallex Invoice ID`, not Col E `Invoice #`.
- Final notifications reply in the original #payments-invoices-updates receipt thread from Col P. If Col P is blank, Slack posts a new channel message as fallback.
- Threaded Slack replies use Slack Web API `chat.postMessage` with explicit `thread_ts`; do not rely on Slack node `otherOptions.thread_ts` for audit-trail replies.
- Approval polling Slack replies use the `Krave Slack Bot` n8n credential. Manual operational corrections should not be posted through a user-profile Slack connector when the message is part of the invoice audit trail.
- Dedup: skip replies that already have a ✅ (`white_check_mark`) reaction
- "approve" match is case-insensitive — "Approve", "APPROVE", "approved" all count
- Processes all pending drafts in one execution (n8n fan-out per tracker row)

### Outputs

| Scenario | Action |
|----------|--------|
| Pending draft found, approve reply present | Finalize in Airwallex, get link, update Col J to `Invoice Sent`, write Col R Invoice URL, reply in John's thread, notify strategist in original thread |
| No pending drafts in tracker | Silent exit |
| Pending draft found but no approve reply yet | Skip that draft, check next |
| Notification message not found in C0AQZGJDR38 | Skip that draft |
| Payment link not in Airwallex response | Notify in thread: retrieve manually from Airwallex dashboard |

### Error Handling

| Failure | Behaviour |
|---------|-----------|
| Airwallex auth fails (no token) | `continueOnFail: true`; Auth OK? routes to Alert Auth Failed node; posts ⚠️ to C0AQZGJDR38 with invoice_id; manual finalization required |
| Finalize returns error (already finalized, etc.) | `continueOnFail: true`; Get Invoice still runs; payment link retrieved from current invoice state |
| Airwallex hosted link absent from all checked fields | `link_found: false`; thread reply and strategist post note ⚠️ to retrieve link from Airwallex dashboard |
| Slack reply or notify fails | `continueOnFail: true`; tracker update already wrote `Invoice Sent`; no re-processing on next run |
| Email Client fails | `continueOnFail: true`; logged in n8n execution history; tracker + Slack notifications already written |
| Google Sheets read fails | `continueOnFail: true`; no items flow downstream; silent exit |

---

## Runbook - Common Scenarios

### Trigger payment detection manually

```bash
curl -s -X POST "https://noatakhel.app.n8n.cloud/webhook/krave-payment-detection" \
  -H "Content-Type: application/json" -d '{}'
```

### Trigger invoice reminders manually

```bash
curl -s -X POST "https://noatakhel.app.n8n.cloud/webhook/krave-invoice-reminder" \
  -H "Content-Type: application/json" -d '{}'
```

### Trigger EOD triage manually

```bash
curl -s -X POST "https://noatakhel.app.n8n.cloud/webhook/krave-eod-triage-summary" \
  -H "Content-Type: application/json" -d '{}'
```

### Trigger SOD report manually

```bash
curl -s -X POST "https://noatakhel.app.n8n.cloud/webhook/krave-sod-report" \
  -H "Content-Type: application/json" -d '{}'
```

### Trigger invoice request intake manually

```bash
curl -s -X POST "https://noatakhel.app.n8n.cloud/webhook/krave-invoice-request-intake" \
  -H "Content-Type: application/json" -d '{}'
```

### Trigger invoice approval polling manually

```bash
curl -s -X POST "https://noatakhel.app.n8n.cloud/webhook/krave-invoice-approval-polling" \
  -H "Content-Type: application/json" -d '{}'
```

### Payment matched but Airwallex mark paid failed

The Sheets row still shows `Payment Complete` and Slack still shows the confirmation. Log into Airwallex and mark the invoice paid manually.

### Missing client email in tracker

The reminder workflow posts a warning to `#payments-invoices-updates`. Add the client email to Col C and it will be picked up on the next run.

### Strategist name in Col K does not match the lookup table

The email still sends, but strategist CC is skipped and Slack includes a warning. Valid names are `Amanda`, `Jeneena`, `Sybil`, `Noa`, and `John`.

### EOD DM to Noa fails

The workflow retries once. If the retry also fails, it posts the formatted summary to `#airwallexdrafts` for manual sending.

### Redeploy workflows from scratch

```bash
node n8n-workflows/deploy-payment-detection.js
node n8n-workflows/deploy-invoice-reminder-cron.js
node n8n-workflows/deploy-eod-triage-summary.js
node n8n-workflows/deploy-invoice-request-intake.js
node n8n-workflows/deploy-invoice-approval-polling.js
```

Most current deploy scripts update the matching live workflow in place and then reactivate it. Older archived copies may still exist in n8n, so confirm the non-archived workflow ID before assuming a stale link is current.

---

## Handover Checklist

- [ ] Access to `noatakhel.app.n8n.cloud`
- [ ] Access to the Client Invoice Tracker Google Sheet
- [ ] Understand the tracker status values in Col J and never write to Col N
- [ ] Keep Airwallex API credentials secure
- [ ] Keep all active workflows enabled in n8n
- [ ] Re-authorize Gmail OAuth2 credentials if email reads or sends stop working
- [ ] Ensure the Slack bot retains access to all required channels, Noa DM delivery, and John DM testing alerts
- [ ] Add or confirm an `OpenAI account` credential in n8n before deploying EOD or SOD workflows
- [ ] Treat repo deploy scripts as the source of truth
- [ ] Test by webhook after any workflow change
