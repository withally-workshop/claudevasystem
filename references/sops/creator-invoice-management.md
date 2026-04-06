# KM-SOP-001 — Creator Invoice Management
**Frequency:** Weekly | **Owner:** VA / Finance | **Updated:** March 2026

## Overview
Collect creator invoices from Slack (#payments-invoices-updates) and email, log them into Airwallex as bills, handle currency conversions, and flag exceptions — before any payment round is approved.

**Key Rule:** Never pay without owner approval. Prepare and flag only.

## Tools
| Tool | Detail |
|------|--------|
| Airwallex (Bills) | app.airwallex.com → Bills section |
| Auto-bill email | Forward to kravemedia@bills.airwallex.com |
| Slack channel | #payments-invoices-updates (C09HN2EBPR7) |
| Currency converter | xe.com or Google for live rates |

## Steps

### Step 1 — Collect Invoices
- Check #payments-invoices-updates for payment rounds (creator name, amount, currency, notes)
- Check email for forwarded invoices (subjects: 'Invoice', 'Payment', creator name + campaign)
- No invoice = no payment. Ask strategist first.

### Step 2 — Forward to Airwallex (Auto-Draft)
- Email invoices only: forward to kravemedia@bills.airwallex.com
- Slack-only invoices: manual entry required (Step 3)
- Verify auto-drafted bills in Airwallex → Bills → 'For Submission'

### Step 3 — Enter / Review Bills in Airwallex
Fields required:
- Vendor name (creator name)
- Description (e.g. 'UGC Video — Casetify Campaign')
- Invoice number, date, due date (if no due date stated, use submission date)
  - **If no invoice number provided**, generate using format: `DD-MM-YYYY-[First Initial][Last Name]`
  - Example: `01-04-2026-MTan` for Megan Tan on April 1 2026
- Amount and currency
- Attach original invoice PDF/image
- Save as draft — do not submit until currency confirmed

### Step 4 — Currency Verification & Conversion
| Scenario | Action |
|----------|--------|
| SG creator invoices in SGD | Enter as-is |
| US creator invoices in USD | Enter in USD if account receives USD |
| HK creator invoices in USD | Convert USD→HKD at live rate, subtract 3% |
| PayPal only | FLAG as exception. Request ACH/bank details |

Conversion formula: `local amount = invoice_amount * live_rate * 0.97`

### Step 5 — Submit for Approval
- Submit all bills in Airwallex for owner review
- Do not process payment yourself
- After approval: process transfers
- Confirm: 'Transfers created for all X bills' green banner

## Exception Types
| Exception | Action |
|-----------|--------|
| Missing bank details | Flag in Slack. Ask strategist to follow up |
| PayPal only | Flag in Slack. Request ACH/bank wire |
| No invoice provided | Ask strategist. No invoice = no bill |
| Currency mismatch | Convert per Step 4. Note in bill description |
| Duplicate invoice | Do not enter. Flag and confirm with strategist |
| Amount doesn't match agreement | Do not enter. Flag and loop in strategist |
