# KM-SOP-002 - Client Invoice Creation & Payment Tracking
**Frequency:** Ad hoc creation and automated reminders/payment detection | **Owner:** VA / Finance | **Updated:** April 2026

## Overview
When a strategist completes a project, they request an invoice via `#payments-invoices-updates`. Claude EA creates an Airwallex draft, logs it to the Client Invoice Tracker, and sends it to the client after Noa approves. The automated reminder and payment-detection workflows handle follow-up and payment updates.

**Key Rules:**
- Strategists must tag Claude EA in `#payments-invoices-updates` to trigger invoice creation. Messages without that tag are informational.
- No invoice attachment is required. As long as the message includes client name, amount, currency, and payout terms, proceed to draft.
- If any required field is missing, reply in thread asking for the missing info. Do not draft.
- Column J `Payment Status` is the operational state. Column N `Status` is formula/display-only and must never be written by automations.

## Tools
| Tool | Detail |
|------|--------|
| Slack `#payments-invoices-updates` | C09HN2EBPR7 - where strategists request invoice creation and payment updates land |
| Airwallex Invoices | Create, send, and mark invoices paid |
| Client Invoice Tracker | Google Sheet master source of truth for client invoice status |
| Gmail `john@kravemedia.co` | Reminder emails sent from here |
| Gmail `noa@kravemedia.co` | Scanned for Airwallex deposit notifications since the last n8n scan |
| ClickUp | Update project status after payment confirmation |

## Automated Skills
| Skill | When it runs |
|-------|-------------|
| `client-invoice-creation` | On demand when a strategist tags Claude EA |
| `invoice-reminder-cron` | Daily reminder processing |
| `payment-detection` | Hourly n8n automation and manual trigger when needed |

## Steps

### Step 1 - Receive Request
- Monitor `#payments-invoices-updates` for Claude EA tagged invoice requests.
- Request must include client name, project description, amount, currency, and payout terms.
- If any of these are missing, reply in thread asking for the missing field. Do not create yet.

### Step 2 - Create Invoice in Airwallex
Navigate: Airwallex -> Billing -> Invoices -> New Invoice.

Fields:
- Customer name from Slack request
- Invoice date
- Due date based on payout terms
- Line items from the Slack request
- Currency from request

### Step 3 - Log to Client Invoice Tracker
Immediately after drafting in Airwallex, append a row to the Client Invoice Tracker. See the `client-invoice-creation` skill for the exact column mapping. Drafts use Column J `Payment Status = Draft - Pending John Review`.

### Step 4 - Send Invoice to Client After Approval
- Noa/John approves the Airwallex draft.
- Send/share the finalized invoice from Airwallex.
- Update tracker Column J `Payment Status` to `Invoice Sent`.
- Store the payment link in the tracker when available.

### Step 5 - Automated Reminders
The `invoice-reminder-cron` workflow handles reminder emails and overdue Slack alerts. It reads Column J `Payment Status` for lifecycle state and Column N `Status` as formula/display context only.

### Step 6 - Automated Payment Detection
The `payment-detection` workflow scans `noa@kravemedia.co` for Airwallex deposit notification emails since the last n8n scan. It does not scan the full inbox on each run.

On match:
- Update Client Invoice Tracker Column J `Payment Status` to `Payment Complete` for full payments or `Partial Payment` for partial payments.
- Update Column M `Payment Confirmed Date`.
- Update Column Q `Amount Paid`.
- Post one deduped confirmation to `#payments-invoices-updates`.
- Mark the Airwallex invoice paid when applicable.

Payment detection only acts on tracker rows whose formula/display Column N `Status` is `Unpaid`, `Overdue`, or blank and whose Column J `Payment Status` is not complete, collections, or draft. Column N is formula-only and must never be written by automations.

### Step 7 - Confirm Payment & Update ClickUp
- Payment detected -> move project in ClickUp to `Payment Complete`.
- 60+ days overdue -> move to `Collections` and notify Noa in Slack.

## Invoice Status Reference
| Column J Payment Status | Meaning |
|-------------------------|---------|
| Draft - Pending John Review | Created in Airwallex, not sent yet |
| Invoice Sent | Sent to client, awaiting payment |
| Partial Payment | Payment received, invoice not fully paid yet |
| Payment Complete | Confirmed paid |
| Collections | 60+ days overdue, escalated |

## Late Fee
- Amount: USD $200 flat.
- Applied 7 days after due date.
- Line item format: `Late Payment Fee - [Month Year] - USD $200`.
- Applied monthly if still unpaid.
