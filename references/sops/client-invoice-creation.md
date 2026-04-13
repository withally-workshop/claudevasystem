# KM-SOP-002 — Client Invoice Creation & Payment Tracking
**Frequency:** Ad Hoc (creation) · Daily automated (reminders + payment detection) | **Owner:** VA / Finance | **Updated:** April 2026

## Overview
When a strategist completes a project, they request an invoice via #payments-invoices-updates. Claude EA creates in Airwallex as a draft, logs to the Client Invoice Tracker (Google Sheets), and sends to client after Noa approves. The daily cron handles all reminders and payment detection — no manual follow-up required.

**Key Rules:**
- Strategists must **@tag @Claude EA** in #payments-invoices-updates to trigger invoice creation. Messages without this tag are informational — do not action them.
- **No invoice attachment required.** As long as the message includes client name, amount, currency, and payout terms, proceed to draft. Noa reviews all Airwallex drafts before submitting.
- If any required field (client name, amount, currency, payout terms) is missing, reply in thread asking for the missing info. Do not draft.

## Tools
| Tool | Detail |
|------|--------|
| Slack #payments-invoices-updates | C09HN2EBPR7 — where strategists @tag Claude EA to request invoice creation |
| Airwallex (Invoices) | Billing → Invoices — create and send invoices |
| Client Invoice Tracker | Google Sheet (see skill for Sheet ID) — master source of truth for all client invoice statuses |
| Gmail (john@kravemedia.co) | Reminder emails sent from here |
| Gmail (noa@kravemedia.co) | Scanned daily for Airwallex deposit notifications |
| ClickUp | Update project status on payment confirmed |

## Automated Skills
| Skill | When it runs |
|-------|-------------|
| `client-invoice-creation` | On-demand — when strategist @tags Claude EA |
| `invoice-reminder-cron` | Daily 9 AM ICT — runs payment detection + sends reminders |
| `payment-detection` | Called by cron — also runnable manually |

## Steps

### Step 1 — Receive Request
- Monitor #payments-invoices-updates for @Claude EA tagged invoice requests
- Request must include: client name, project name/description, amount, currency, payout terms
- If any of these are missing: reply in thread asking for the missing field. Do not create yet.
- No invoice attachment needed — Noa reviews drafts manually in Airwallex before submitting.

### Step 2 — Create Invoice in Airwallex
Navigate: Airwallex → Billing → Invoices → + New Invoice

Fields:
- Customer name (from Slack request)
- Invoice date (today)
- Due date (today + payout days from request — typically 14 or 30 days)
- Line items (from the Slack request description)
- Currency (from request)

Sample line items (IM8 HookFactory):
- IM8 HookFactory - Week 23 - 180 Exports — USD $2,550
- Add-On Concept Editing - 4 Concepts @ USD $150 each — USD $600
- Total: USD $3,150

### Step 3 — Log to Client Invoice Tracker
Immediately after drafting in Airwallex, append a row to the Client Invoice Tracker Google Sheet.
See `client-invoice-creation` skill for exact column mapping.
Status on creation: `Draft — Pending Noa Review`

### Step 4 — Send Invoice to Client (After Noa Approves)
- Noa reviews and approves draft in Airwallex
- Send from Airwallex using Send/Share on the finalized invoice
- Update tracker row: Status → `Invoice Sent`
- Note the date sent

### Step 5 — Automated Reminders (Daily Cron — no manual action needed)
The `invoice-reminder-cron` skill runs daily at 9 AM ICT and handles:

| Days to/from Due | Action |
|-----------------|--------|
| 7 days before | Reminder email from john@ |
| 5 days before | Reminder email from john@ |
| 3 days before | Reminder email from john@ |
| 1 day before | Reminder email from john@ |
| Due today | Reminder email from john@ |
| 1–6 days overdue | Overdue notice from john@ |
| 7 days overdue | Late fee notice + flag to add $200 in Airwallex |
| 60+ days overdue | Collections flag → tag Noa in Slack |

### Step 6 — Automated Payment Detection (Daily Cron — no manual action needed)
The `payment-detection` skill scans noa@kravemedia.co daily for Airwallex deposit notification emails.
On match:
- Updates Client Invoice Tracker: Status → `Payment Complete`
- Posts to #payments-invoices-updates with confirmation
- Flags Airwallex for manual status update (Airwallex does not auto-mark as paid)

Amanda and the team see payment status in #payments-invoices-updates and the Google Sheet — no need to check with Noa.

### Step 7 — Confirm Payment & Update ClickUp
- Payment detected → move project in ClickUp: Approved → **Payment Complete**
- 2+ months overdue → move to **Collections**, notify Noa in Slack

### Step 8 — Airwallex Manual Status Update
Airwallex does not auto-reflect incoming payments. After payment is confirmed:
- Manually open the invoice in Airwallex → mark as paid
- This is flagged by the payment detection skill each time it detects a payment

## Invoice Status Reference
| Status (Tracker) | Meaning |
|-----------------|---------|
| Draft — Pending Noa Review | Created in Airwallex, not yet sent |
| Invoice Sent | Sent to client, awaiting payment |
| 7d Reminder Sent | Reminder sent 7 days before due |
| Overdue — Reminder Sent | Past due, overdue notice sent |
| Late Fee Applied | $200 late fee added, notice sent |
| Payment Complete | Confirmed paid |
| Collections | 60+ days overdue, escalated |

## Email Templates
All reminder emails are auto-generated by the `invoice-reminder-cron` skill and sent from john@kravemedia.co. See the skill file for full templates.

## Late Fee
- **Amount:** USD $200 flat
- **When applied:** 7 days after due date
- **Line item format:** `Late Payment Fee — [Month Year] — USD $200`
- Applied monthly if still unpaid

## Known Recurring Invoices (auto-create monthly)
| Invoice | Amount | Send To |
|---------|--------|---------|
| Nancy Creative Engine — Krave | SGD $6,877 | Ronald (search "Nancy Creative Engine Krave" in Noa's sent mail for contact) |
| IM8 Creative Engine — Krave | USD $5,250 | josh.kong@prenetics.com |
