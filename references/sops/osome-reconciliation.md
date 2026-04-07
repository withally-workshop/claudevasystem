# FIN-001 — Osome Transaction Reconciliation
**Frequency:** One-time (tax submission) | **Owner:** VA / Finance | **Updated:** March 2026
**Company:** Eclipse Ventures Pte. Ltd. | **Platform:** Osome + Airwallex | **Status:** Active

## Overview
Resolve all transactions flagged as "Documents needed" in Osome for Eclipse Ventures Pte. Ltd.
Originally 1,489 flagged transactions. Est. ~2 weeks to complete.

**PRIORITY RULE:** Always work LARGEST transaction amount → SMALLEST. Highest financial value reconciled first.

## Tools

| Tool | URL / Detail | Purpose |
|------|-------------|---------|
| Osome | app.osome.com | View flagged transactions, upload documents |
| Osome ingestion email | 977e06fe7c21-628067@my.osome.com | Email documents directly — Osome auto-attaches to matching transaction |
| Airwallex | app.airwallex.com | Download paid contractor/creator invoices |
| Gmail — Work | noa@kravemedia.co | Find SaaS invoices (HeyGen, Magicbrief, etc.) |
| Gmail — Personal | takhelnoa@gmail.com | Backup inbox for SaaS invoices |

## Steps

### Step 1 — Access Transactions in Osome
1. Log in at app.osome.com using Eclipse Ventures credentials
2. Click the Transactions icon in the left sidebar (two-arrow icon)
3. Confirm org = Eclipse Ventures Pte. Ltd. (top-right corner)
4. Click **Documents needed** filter
5. Sort by **Amount — largest first**. Always work largest to smallest. Never process in date order.

### Step 2 — Identify Transaction Type

| Transaction Type | Where to Find | Action |
|-----------------|--------------|--------|
| Creator / Contractor | Airwallex > Bills > Paid | Download PDF → Upload to Osome |
| SaaS Tools (HeyGen, Magicbrief, Canva, etc.) | noa@kravemedia.co or takhelnoa@gmail.com | Find invoice email → Download PDF → Upload |
| Insense | N/A — no auto invoice | Email Insense support using template (Step 3C) |
| Unknown / Cannot locate | — | Message Noa — only after exhausting all sources |

### Step 3A — Creators & Contractors (Airwallex)
1. Go to app.airwallex.com → Bills > Paid
2. Search by vendor name or invoice number from Osome transaction
3. Click matching bill → open Bill Details panel
4. Confirm amount + vendor match before downloading
5. Download invoice PDF from left panel
6. Return to Osome → upload PDF to flagged transaction
7. Confirm transaction no longer shows as Documents needed

> TIP: Bill Details shows invoice left, payment details right. Match amount + vendor before downloading.

### Step 3B — SaaS & Subscriptions (Gmail)
1. Open noa@kravemedia.co
2. Search: vendor name (e.g. `heygen`, `magicbrief`) + filter Has attachment
3. Find email matching transaction date and amount (subject: "Your receipt from..." or "Invoice #...")
4. Download attached PDF
5. If not found → repeat search in takhelnoa@gmail.com
6. Upload PDF to flagged transaction in Osome

> TIP: HeyGen receipts from "HeyGen Technology Inc." include both Invoice PDF + Receipt PDF. Upload the **Invoice PDF**.

### Step 3C — Insense (No Invoice Available)
Insense does not auto-issue invoices. Email their support for each transaction.

**Email template:**
```
Subject: Invoice Request — Eclipse Ventures Pte. Ltd.

Hi Insense Support,

Could you please provide an invoice or payment receipt for the
following transaction for our accounting records?

  Account: Eclipse Ventures Pte. Ltd.
  Transaction Date: [DATE]
  Amount: [AMOUNT] USD
  Reference: [TRANSACTION REF]

Thank you,
Noa Nederpelt / Eclipse Ventures Pte. Ltd.
```

### Step 4 — Cannot Find Document (Escalation to Noa)
Exhaust ALL options before escalating:
- Check both Gmail inboxes
- Search Airwallex with partial vendor name, amount, date
- Try searching by card number shown in Osome (e.g., **5435)
- If still not found → message Noa with: **amount + date + description + sources already checked**

⚠ Only escalate AFTER checking Airwallex + noa@kravemedia.co + takhelnoa@gmail.com.

### Step 5 — Send Document to Osome

**Option A (Automated — preferred):** Email the PDF to `977e06fe7c21-628067@my.osome.com`. Osome auto-attaches it to the matching transaction. No manual upload required.

**Option B (Manual fallback):** 
1. Click flagged transaction in Osome
2. Click upload icon (upward arrow) or drag and drop PDF
3. Confirm file name visible and upload complete

"Processing data from X files..." = normal. Can take up to 24 hours.

## Exception Rules

| Situation | Action |
|-----------|--------|
| Amount doesn't match exactly | Do NOT upload. Note discrepancy, message Noa |
| Multiple bills for same vendor + date | Match by amount first, then date. If ambiguous, ask Noa |
| Card number shown (**5435) | Use last 4 digits to identify Airwallex card/account |
| Osome shows "Processing..." | Normal. Continue working on other transactions |

## Progress Tracking

| Date | Resolved | Remaining | Source Used | Notes / Escalations |
|------|----------|-----------|-------------|---------------------|
| | | | | |

## Decision Tree (Quick Reference)
```
Creator / contractor?         → Airwallex > Bills > Paid
SaaS tool?                    → Gmail (noa@kravemedia.co then takhelnoa@gmail.com)
Insense transaction?          → Email Insense support (Step 3C template)
Cannot find anywhere?         → Message Noa: amount + date + description + sources checked
```
