# Krave Media - n8n Automation Workflows

**Instance:** `noatakhel.app.n8n.cloud`  
**Last updated:** `2026-04-20`  
**Maintained by:** John (Systems Partner) - `john@kravemedia.co`

---

## Table of Contents

1. [Workflow Index](#workflow-index)
2. [Shared Infrastructure](#shared-infrastructure)
3. [Workflow 1 - Payment Detection](#workflow-1---payment-detection)
4. [Workflow 2 - Invoice Reminder Cron](#workflow-2---invoice-reminder-cron)
5. [Workflow 3 - EOD Triage Summary](#workflow-3---eod-triage-summary)
6. [Workflow 4 - Invoice Request Intake](#workflow-4---invoice-request-intake)
7. [Credential Reference](#credential-reference)
8. [Runbook - Common Scenarios](#runbook---common-scenarios)
9. [Handover Checklist](#handover-checklist)

---

## Workflow Index

| # | Name | ID | Status | Schedule | Purpose |
|---|------|----|--------|----------|---------|
| 1 | Krave - Payment Detection | `grsXd1VCVIL2F8Cv` | Active | 10am + 5pm ICT | Detect Airwallex deposits, match invoices, update tracker |
| 2 | Krave - Invoice Reminder Cron | `QvHzslWExLjrH0mo` | Active | 10am ICT daily | Send invoice reminders, alert overdue, update tracker |
| 3 | Krave - EOD Triage Summary | `TBD after deploy` | Planned | 6pm ICT weekdays | Summarize daily Slack activity, DM Noa, archive to `#airwallexdrafts` |
| 4 | Krave - Invoice Request Intake | `TBD after deploy` | Planned | Structured Slack modal / manual webhook | Capture invoice requests, create Airwallex drafts, and fall back to manual-ready tracker rows |

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
| Slack DM destination | John | `TBD in n8n` | Bot sends invoice intake testing alerts |
| Gmail inbox (scan) | `noa@kravemedia.co` | OAuth2 | Read only (payment detection) |
| Gmail inbox (send) | `john@kravemedia.co` | OAuth2 | Send + CC |

### Invoice Tracker Column Map

| Col | Header | Used By |
|-----|--------|---------|
| A | Date Created | - |
| B | Client Name | Payment Detection, Invoice Reminder Cron |
| C | Email Address | Invoice Reminder Cron |
| D | Project Description | - |
| E | Invoice # | Payment Detection, Invoice Reminder Cron |
| F | Airwallex Invoice ID | Payment Detection |
| G | Amount | Payment Detection, Invoice Reminder Cron |
| H | Currency | Payment Detection, Invoice Reminder Cron |
| I | Due Date | Invoice Reminder Cron |
| J | Status | Payment Detection, Invoice Reminder Cron |
| K | Requested By | Invoice Reminder Cron |
| L | Reminders Sent | Invoice Reminder Cron |
| M | Payment Confirmed Date | Payment Detection |
| N | Status Display | Formula-driven, never write |

### Status Value Reference

| Value | Set By | Meaning |
|-------|--------|---------|
| `Invoice Sent` | Manual / invoice creation flow | Invoice delivered to client |
| `Draft - Pending John Review` | Invoice creation flow | Not sent yet, skip reminders |
| `Payment Complete` | Payment Detection | Deposit matched and confirmed |
| `Late Fee Applied - YYYY-MM-DD` | Invoice Reminder Cron | 7+ days overdue, fee logged |
| `Collections` | Invoice Reminder Cron | 60+ days overdue, escalated |

---

## Workflow 1 - Payment Detection

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/grsXd1VCVIL2F8Cv`  
**Deploy script:** `n8n-workflows/deploy-payment-detection.js`

### Purpose

Replaces the manual daily task of checking whether clients have paid. It scans `noa@kravemedia.co` for Airwallex deposit emails, matches each deposit to an open invoice in the tracker, marks the invoice paid in both Google Sheets and Airwallex, and posts a confirmation to Slack.

### Triggers

| Type | Details |
|------|---------|
| Schedule | `0 3,10 * * *` - 10:00 AM + 5:00 PM ICT |
| Webhook | `POST https://noatakhel.app.n8n.cloud/webhook/krave-payment-detection` |

### Node Flow

```text
[Schedule / Webhook]
        |
[Search Airwallex Emails]
        |
[Parse All Emails]
        |
[Get Invoice Tracker]
        |
[Match Deposits To Invoices]
        |
[Match Found?]
   | true               | false
   v                    v
[Airwallex Auth]      [silent exit]
        |
[Airwallex Mark Paid]
        |
[Update Invoice Status]
        |
[Slack Payment Confirmed]
```

### Matching Logic

1. Invoice number match against Col E.
2. Exact amount + currency match against a single open invoice.
3. Ambiguous matches are skipped silently.
4. Unmatched deposits are skipped silently.

### Outputs

| Outcome | Action |
|---------|--------|
| Match found | Sheets updated, Airwallex marked paid, Slack confirmation |
| No emails found | Silent |
| Unmatched deposit | Silent |
| Shopify / payout noise | Skipped silently |

### Error Handling

| Failure | Behaviour |
|---------|-----------|
| Airwallex auth fails | `continueOnFail: true` - Sheets and Slack still continue |
| Airwallex mark paid fails | `continueOnFail: true` - Sheets still update |
| Gmail auth error | Workflow errors and n8n emails the instance owner |

---

## Workflow 2 - Invoice Reminder Cron

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/QvHzslWExLjrH0mo`  
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

**n8n URL:** `TBD after deploy`  
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
| `#ad-production-internal` | `C0AGEM919QV` | IM8 production updates, blockers, Frame.io status |
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

## Workflow 4 - Invoice Request Intake

**n8n URL:** `TBD after deploy`  
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
[Airwallex Auth]
        |
[Find Billing Customer]
        |
[Resolve Billing Customer]
   | existing            | missing / create
   v                     v
[Create Products]   [Create Billing Customer]
        |                     |
        +----------+----------+
                   |
             [Create Prices]
                   |
         [Create Draft Invoice]
                   |
      [Attach Invoice Line Items]
             | success            | failure
             v                    v
[Write Tracker Success]   [Write Tracker Fallback]
             |                    |
             v                    v
[Requester Success Confirmation] [DM John Failure Alert]
```

### Intake Rules

- Uses a Structured Slack modal so required fields arrive in a predictable payload.
- Supports multiple line items per request.
- Resolves customers by company name or client name rather than email.
- Ambiguous customer matches do not auto-resolve and instead move to fallback.

### Outputs

| Scenario | Action |
|----------|--------|
| Draft invoice created | Existing Invoices sheet structure row is updated with Airwallex IDs and the requester gets a success confirmation |
| Validation failure | Tracker fallback row is written for manual follow-up |
| Ambiguous customer match | Status becomes `fallback_manual_required`, tracker captures the issue, and John DM fires |
| Any Airwallex failure | Status becomes `fallback_manual_required`, tracker captures `failure_stage` and `failure_reason`, and John DM fires |

### Error Handling

| Failure | Behaviour |
|---------|-----------|
| Missing required modal fields | Mark `failed_validation` and write a manual-ready fallback row |
| Airwallex auth / customer / product / price / invoice failure | Mark `fallback_manual_required`, preserve the line items payload, and send a John DM testing alert |
| Draft creation succeeds | Stop at draft only; no auto-finalize and no auto-send in v1 |

### Run Notes

- V1 is draft-only and stops once the Airwallex draft invoice exists.
- John DM is the temporary testing alert path while the workflow is being stabilized.
- Intake writes into the existing Invoices sheet structure rather than adding new intake-only columns.
- The intake workflow uses the documented columns `Client Name`, `Email Address`, `Project Description`, `Airwallex Invoice ID`, `Amount`, `Currency`, `Due Date`, `Status`, and `Requested By`.
- Successful draft creation writes status `Draft - Pending John Review`.
- Fallback context is condensed into the existing `Project Description` text so the tracker still fits the current A:N layout.

---

## Credential Reference

| Credential Name | Type | ID | Used By | Account |
|----------------|------|----|---------|---------|
| Gmail account | Gmail OAuth2 | `vxHex5lFrkakcsPi` | Payment Detection | `noa@kravemedia.co` |
| Gmail account (john) | Gmail OAuth2 | `vsDW3WpKXqS9HUs3` | Invoice Reminder Cron | `john@kravemedia.co` |
| Google Sheets account | Google Sheets OAuth2 | `83MQOm78gYDvziTO` | Payment Detection, Invoice Reminder Cron, Invoice Request Intake | `noa@kravemedia.co` |
| Krave Slack Bot | Slack API (Bot Token) | `Bn2U6Cwe1wdiCXzD` | All four workflows | Krave Slack workspace |
| OpenAI account | OpenAI API | `TBD in n8n` | EOD Triage Summary | OpenAI API |

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

### Trigger invoice request intake manually

```bash
curl -s -X POST "https://noatakhel.app.n8n.cloud/webhook/krave-invoice-request-intake" \
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
```

Each deploy script creates a new workflow. Activate the new workflow in n8n and deactivate the old one if replacing an existing live version.

---

## Handover Checklist

- [ ] Access to `noatakhel.app.n8n.cloud`
- [ ] Access to the Client Invoice Tracker Google Sheet
- [ ] Understand the tracker status values in Col J and never write to Col N
- [ ] Keep Airwallex API credentials secure
- [ ] Keep all active workflows enabled in n8n
- [ ] Re-authorize Gmail OAuth2 credentials if email reads or sends stop working
- [ ] Ensure the Slack bot retains access to all required channels, Noa DM delivery, and John DM testing alerts
- [ ] Add or confirm an `OpenAI account` credential in n8n before deploying EOD Triage Summary
- [ ] Treat repo deploy scripts as the source of truth
- [ ] Test by webhook after any workflow change
