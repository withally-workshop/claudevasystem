# KM-SOP-002 — Client Invoice Creation & Payment Tracking
**Frequency:** Ad Hoc (as requested) | **Owner:** VA / Finance | **Updated:** March 2026

## Overview
When a strategist completes a project, they request an invoice via #payments-invoices-updates. Create in Airwallex as a draft, send to client, follow up on overdue invoices, and update ClickUp.

**Key Rules:**
- Strategists must **@tag @Claude EA** in #payments-invoices-updates to trigger invoice creation. Messages without this tag are informational — do not action them.
- **No invoice attachment required.** As long as the message includes client name, amount, currency, and payout terms, proceed to draft. Noa reviews all Airwallex drafts before submitting.
- If any required field (client name, amount, currency, payout terms) is missing, reply in thread asking for the missing info. Do not draft.

## Tools
| Tool | Detail |
|------|--------|
| Slack #payments-invoices-updates | C09HN2EBPR7 — where strategists @tag Claude EA to request invoice creation |
| Airwallex (Invoices) | Billing → Invoices — create and send invoices |
| ClickUp | Update project status on payment |
| Gmail | noa@kravemedia.co — Airwallex payment confirmations arrive here |

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

### Step 3 — Send Invoice to Client
- Find client email in Airwallex customer record or previous sent mail
- Send from Airwallex using Send/Share on the finalized invoice (Noa must approve draft first)
- Note the date sent

### Step 4 — Follow Up on Overdue Invoices (Weekly Check)
| Status | Action |
|--------|--------|
| Due date reached | Send 5-day warning reminder email |
| 1 week overdue | Add USD $200 late fee as new line item, send updated invoice |
| 2+ months overdue | Move to Collections in ClickUp, flag owner immediately |

Late fee line item format: `Late Payment Fee — [Month Year] — USD $200`

### Step 5 — Confirm Payment Received
Check noa@kravemedia.co for Airwallex deposit notifications:
- **Client payments:** rounded numbers (e.g. $3,400.00 USD, $4,590.00 USD)
- **Shopify payments:** irregular amounts (e.g. $588.93 SGD), reference says 'Shopify'
- Match to invoice by **amount + invoice number** (not customer reference — may pay via intermediary)
- Download deposit confirmation PDF for records

### Step 6 — Update ClickUp
- Payment confirmed → move project: Approved → **Payment Complete**
- 2+ months overdue → move to **Collections**, notify Noa in Slack

## Invoice Status Reference
| Status | Meaning / Action |
|--------|-----------------|
| Approved (ClickUp) | Project complete, invoice pending |
| Invoice sent | Awaiting payment |
| Due date reached | Send 5-day warning |
| 1 week overdue | Add $200 late fee, send updated invoice |
| 2+ months overdue | Collections in ClickUp, flag owner |
| Payment Complete | Confirmed — update ClickUp |

## Email Templates

**Payment Reminder (Due Date Reached)**
> Subject: Payment Reminder — [Invoice Number] — [Client Name]
> Hi [Client Name], this is a friendly reminder that invoice [Invoice Number] for [Amount] is now due. Please arrange payment within 5 days to avoid late fees. [Airwallex invoice link]
> Best regards, Krave Media

**Late Fee Notice (1 Week Overdue)**
> Subject: Updated Invoice with Late Fee — [Invoice Number] — [Client Name]
> Hi [Client Name], as payment for invoice [Invoice Number] has not been received, a late fee of USD $200 has been applied per our payment terms. Updated total: [New Total]. Please arrange payment at your earliest convenience.
> Best regards, Krave Media
