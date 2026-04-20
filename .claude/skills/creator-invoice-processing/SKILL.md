# Skill: Creator Invoice Processing
**Trigger:** "process invoices", "run invoice triage", "check payment channel", "/invoice-triage"
**Channel:** #payments-invoices-updates (C09HN2EBPR7)
**SOP:** references/sops/creator-invoice-management.md

---

## What This Skill Does
Reads #payments-invoices-updates, extracts all pending creator payment submissions, checks for exceptions, and outputs a structured bill prep report ready for Airwallex entry — plus flags any exceptions back to the channel.

---

## Trigger Rules
- Strategists must **@tag Claude EA** in #payments-invoices-updates to trigger invoice processing
- Messages without an @mention of Claude EA are informational — do NOT process them as invoice requests
- **Creator invoices: no invoice attached = no bill created.** If a strategist tags Claude EA but attaches no invoice (PDF, image, or confirmed email forward), reply asking for the invoice. Do not draft in Airwallex.
- Client invoices follow the separate `client-invoice-creation` skill — no invoice attachment required for those, just the billing info.

---

## Execution Steps

### 0. Load Last-Read Cursor
Call `slack_get_last_read(channel_id: C09HN2EBPR7)` — provided by `krave-tools` MCP.
- If it returns a timestamp → use it as `oldest` in Step 1 (only fetch messages since last run)
- If it returns `null` → first run; fetch last 50 messages with no `oldest` filter

### 0a. Scan Gmail Inbox (john@kravemedia.co)
Use the `gmail-john` MCP instance. Call `gmail_search_messages` with query:
```
subject:invoice OR subject:payment OR has:attachment newer_than:7d
```
For each result, call `gmail_get_message` to extract:
- Sender name / creator name
- Invoice amount + currency
- Attachment filename (PDF invoice) + `attachment_id`
- Date received

If an attachment is present, call `gmail_download_attachment` using the `message_id` and `attachment_id` to retrieve the PDF. This base64 content should be noted for manual upload into Airwallex → Bills → attach file. Flag in the bill prep report: "PDF downloaded — attach to Airwallex bill".

Tag these as **Source: "Email (Direct)"**

### 0b. Deduplicate Against Invoice Tracker
Before processing ANY submission (from Slack or Gmail):
1. Call `sheets_get_rows` on Invoice Tracker — range `Sheet1!A:F` (last 30 rows)
2. For each pending submission, check if **creator name + amount** already exists within the last 7 days
3. If match found → mark as **DUPLICATE — SKIP**. Do not draft in Airwallex. Do not log again.
4. If both Slack and Gmail have the same invoice → process the **Slack** version (already has thread context), tag source as "Email + Slack (deduped)"

### 1. Pull Channel History
Call `slack_get_channel_history(channel_id: C09HN2EBPR7, limit: 50, oldest: <cursor from Step 0 if set>)`.
- Filter for messages containing invoice submissions (look for: Creator, Amount, SGD/USD/HKD, invoice links, "please process", @Claude EA tag)
- Skip: ✅ already acknowledged messages (reactions with white_check_mark by the VA), casual replies, transfer notices

**File attachments:** For each qualifying message that includes a file attachment:
- Note the `file.id` from the message payload
- Call `slack_download_file(file_id: <id>, dest_path: C:/Users/jopso/Desktop/claude-ea/temp/<CreatorName>-<ts>.pdf)` — provided by `krave-tools` MCP
- Store the returned `local_path` against that submission for use in Step 5b

### 1b. Reply to Sender Immediately (Slack only)
For each valid new Slack request (@Claude EA tagged), reply in the message thread:
```
Got it! Processing the bill for [Creator Name] — [Amount]. Will be staged shortly.
```
Email replies are handled in Step 8 after processing is complete.

### 2. Parse Each Submission
For each invoice submission extract:
```
- Creator name
- Client / campaign
- Amount + currency
- Invoice source: [email sent | Slack only | Google Drive link]
- Invoice number (from PDF if available — if not provided, generate as: `DD-MM-YYYY-[First Initial][Last Name]`, e.g. `01-04-2026-MTan`)
- Date
- Payout terms (14 day / 30 day if stated — if not stated, due date = submission date)
- Any flags noted by the strategist
```

### 3. Currency Check
Apply these rules per SOP:
- SGD invoice → enter as SGD, no conversion
- USD invoice, US creator → enter as USD
- USD invoice, HK creator → convert: `HKD = USD_amount × live_rate × 0.97`
- Any PayPal mention → EXCEPTION

For conversions, use xe.com rate or note "verify live rate before entry."

### 4. Exception Detection
Auto-flag if any of these are true:
- **No invoice attached and no "sent via email" confirmation** — HARD STOP. Reply in thread: "No invoice attached — please share the PDF or confirm it's been emailed to john@kravemedia.co before I can process this." Do NOT draft the bill.
- Payment method is PayPal
- Currency appears mismatched for creator location
- Amount doesn't match a known rate card (flag for human review)
- Duplicate creator name in same payment round

### 5. Compile Bill Prep Report
Airwallex Bills API is in beta (list/get/sync only — no create endpoint). Do NOT attempt to create bills via API. Instead, compile a structured prep report for manual entry into Airwallex → Bills.

For each READY TO BILL item, assemble:
```
- Supplier name (creator)
- Invoice number (from PDF, or generated: DD-MM-YYYY-[Initial][LastName])
- Invoice date (from PDF or submission date)
- Due date (submission date + payout terms, else submission date)
- Currency (post-conversion if HKD)
- Amount
- Campaign/client
- PDF status: "Downloaded — attach manually" or "Google Drive link — forward to kravemedia@bills.airwallex.com"
```

### 5d. Output: Bill Run Report
Output the following:

---
**INVOICE TRIAGE — [DATE]**
**Channel:** #payments-invoices-updates

**READY TO ENTER IN AIRWALLEX → BILLS**
| # | Creator | Client | Amount | Currency | Invoice # | Invoice Date | Due Date | PDF |
|---|---------|--------|--------|----------|-----------|--------------|----------|-----|
| 1 | [name] | [client] | [amt] | [currency] | [inv#] | [date] | [due] | Downloaded / Google Drive |

**EXCEPTIONS — ACTION REQUIRED**
| Creator | Issue | Required Action |
|---------|-------|-----------------|
| [name] | [issue] | [what to do] |

**ALREADY PROCESSED** (✅ reacted — skip)
- [list]

**DUPLICATES SKIPPED**
- [Creator] — [Amount] — first seen [date] via [source]

**NEXT STEPS**
1. Enter each READY item manually in Airwallex → Bills → Create
2. Attach PDFs: downloaded ones saved to temp folder; Google Drive links → forward PDF to kravemedia@bills.airwallex.com
3. Verify HKD conversion rates where applied
4. Do NOT submit — Noa approves in Airwallex

**5PM ICT DIGEST** → post to John's private channel (C0AQZGJDR38):
```
📋 *Bill Digest — [DATE] 5pm ICT*
*Ready to enter in Airwallex → Bills:*
• [Creator] — [Amount] [Currency] — [Client/Campaign] — Invoice: [inv#]

*PDFs to attach:*
• [Creator] — Downloaded / Google Drive link

*Exceptions pending resolution:*
• [Creator] — [issue]

Action: Enter bills manually in Airwallex → Bills. Noa to approve once entered.
```
---

### 5e. Save Last-Read Cursor
After all bills are drafted (or exceptions posted), call:
```
slack_set_last_read(channel_id: C09HN2EBPR7, ts: <ts of the newest Slack message processed this run>)
```
This ensures the next run only fetches messages after this point.

### 6. Log to Invoice Tracker (Google Sheets)
After drafting each bill in Airwallex, append a row to the Invoice Tracker:
**Sheet ID:** `183bm4chIsw4Bf1w5_CoBVAuUODgPBfy6wk2-7I5zTFc`
**Sheet name:** Sheet1 (or first tab)

Use `sheets_append_row` with values in this exact column order:
| Column | Value |
|--------|-------|
| A — Date Received | Today's date (YYYY-MM-DD) |
| B — Vendor / Creator Name | Creator name from submission |
| C — Invoice Number | Invoice number if provided, else "N/A" |
| D — Source | "Email" / "Slack" / "Google Drive" |
| E — Invoice Currency | Original invoice currency (SGD/USD/HKD) |
| F — Invoice Amount | Original invoice amount |
| G — -3% FX Adjustment Applied? | "Yes" if HKD conversion applied, else "No" |
| H — Airwallex Status | "Pending manual entry" (Bills API not available — enter in Airwallex UI) |
| I — Exceptions / Flags | Exception description if any, else blank |
| J — Notes / Approver | Client/campaign name |
| K — Status Update | "Ready to enter in Airwallex — pending manual entry + Noa approval" |
| L — Follow up date | Due date (submission date if not stated) |

Log exceptions-only rows too with Status Update = "On hold — [reason]".

### 7. Post Exceptions to Slack
For each exception, post to #payments-invoices-updates:

**Template:**
```
⚠️ *Exception — [Creator Name]*
Issue: [describe the issue]
Required: [what the strategist needs to provide]
Holding bill until resolved.
```

### 8. Reply to Strategists via Email
For every email-sourced submission, reply in the original thread using `gmail_send` (gmail-john MCP) with `in_reply_to_message_id` set to the original message ID. This auto-threads the reply correctly.

**For READY TO BILL items:**
```
Hi [First Name],

The invoice has been staged for payment. Noa will review and approve in Airwallex.

Thanks!
```

**For EXCEPTION items** (replace the body with the specific issue):
```
Hi [First Name],

Just a quick flag on [Creator Name]'s invoice — [describe issue clearly, one sentence].
Could you [what is needed]? Happy to process as soon as that's confirmed.

Thanks!
```

Rules:
- Use `in_reply_to_message_id` = the Gmail message ID of the submission email (from Step 0a)
- One reply per email thread — if a strategist sent 2 invoices in one email, one reply covers both
- Do NOT reply to non-Krave emails (e.g. creator invoices sent directly from gmail.com addresses) — only reply to `@kravemedia.co` senders
- Skip reply if already replied in this thread (check if outgoing message exists in thread)

---

## Notes
- The VA handle is @U0AM5EGRVTP
- Noa's handle is @U06TBGX9L93
- Messages with ✅ white_check_mark from the VA = already actioned
- Slack-only invoices (no email sent) require manual Airwallex entry
- Google Drive invoice links = strategist will forward via email OR you can flag to forward to kravemedia@bills.airwallex.com
- Auto-forward only works for email-sourced invoices
