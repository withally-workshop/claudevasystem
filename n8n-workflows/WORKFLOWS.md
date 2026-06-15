# Krave Media - n8n Automation Workflows

**Instance:** `noatakhel.app.n8n.cloud`  
**Last updated:** `2026-05-08`  
**Maintained by:** John (Systems Partner) - `john@kravemedia.co`

---

## Table of Contents

1. [Workflow Index](#workflow-index)
2. [Shared Infrastructure](#shared-infrastructure)
3. [Workflow 1 - Payment Detection](#workflow-1---payment-detection)
4. [Workflow 2 - Invoice Reminder Cron](#workflow-2---invoice-reminder-cron)
5. ~~Workflow 3 - EOD Triage Summary~~ (removed — see `.claude/skills/eod-triage-summary/SKILL.md`)
6. ~~Workflow 4 - Start Of Day Report~~ (removed — see `.claude/skills/sod-report/SKILL.md`)
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
| 2 | Krave - Invoice Reminder Cron | `Q3IqqLvmX9H49NdE` | Active | 10am PHT Mon–Fri | Send invoice reminders, alert overdue, update tracker, post daily digest |
| 2b | Krave - Invoice Reminder Reply Detection | `omNFmRcDeiByLOzS` | Active | 10:30am PHT weekdays + `POST /webhook/krave-invoice-reminder-reply-detection` | Scan only `john@kravemedia.co` reminder threads, classify client replies, update reminder attribution columns |
| 5 | Krave — Inbox Triage Daily v2 | `EuT6REDs5PUaoycE` | Active | 9am PHT weekdays + manual webhook | Classify all unread inbox emails into EA/* tiers using hardcoded rules + GPT-4o-mini fallback, create drafts, archive noise tiers only (FYI + Auto-Sorted), post audit summary to #ops-command |
| 6 | Krave - Slack Invoice Handler | `t7MMhlUo5H4HQmgL` | Active | Slash command + modal submit | Open the Slack modal and forward normalized submissions to invoice intake |
| 7 | Krave - Invoice Request Intake | `5XHxhQ7wB2rxE3qz` | Active | Structured Slack modal / manual webhook | Capture invoice requests, create Airwallex drafts, and fall back to manual-ready tracker rows |
| 8 | Krave - Invoice Approval Polling | `uCS9lzHtVKWlqYlk` | Active | Every 2 hrs Mon-Fri 9am-5pm PHT + `POST /webhook/krave-invoice-approval-polling` | Poll tracker for pending drafts, detect John's "approve" replies, finalize in Airwallex, write tracker link, and reply in the original strategist thread |
| 9 | Krave - Client Invoice Creation | `9eqWz6oJI5dqBesa` | Inactive legacy | Do not trigger | Deprecated finalization path; approval polling is canonical |
| 10 | Krave - Weekly Invoice Summary | WX1hHek0cNTyZXkS | Active | 9am PHT Mondays | Post full portfolio snapshot to Slack — overdue, late fee, needs chase, due this week, upcoming |
| 11 | LinkedIn Resource Post Alert | `Rw2VZ6sAzAhJteyJ` | Active | Every 30min 8AM–1PM PHT Sun–Fri | Poll ClickUp for resource-promo posts just marked posted, alert John in #noa-linkedin-posts with trigger word + pre-filled DM |
| 12 | Kit Subscriber Alert | `dtrTee7qEgLdR9hQ` | Active | Kit webhook (subscriber.tag_add) | Receive Kit webhook on new resource-claimed subscribers, post Slack alert to #noa-linkedin-posts with name, email, and resource |
| 13 | LinkedIn Post Consistency Check | `220OeHs02nwJleCT` | Active | 10AM PHT Mon–Fri | Check if any post was marked posted in ClickUp today; alert #noa-linkedin-posts if none found |
| 14 | Weekly Resource Conversion Report | `G39y9GgsrhnvC91C` | Active | 9AM PHT Mondays | Fetch last 7 days of resource-claimed Kit subscribers, group by resource, post breakdown to #noa-linkedin-posts |
| 15 | Halo - Weekly Intelligence Report | 5ZqTSaUEtxnAndiY | Active | 7AM PHT Mondays | Scrape TikTok + Instagram by hashtag cluster, score by engagement × ICP relevance, Claude analysis of top 10 per platform, deliver to Slack + Google Sheet + email |
| 16 | Crave - Daily Lead Push | `ke52OLrSUXk8mPVw` | Inactive (warm-up) | 9AM PHT daily | Read approved Sheet rows, push to Smartlead campaign 3375376, mark outreach_queued |
| 17 | Crave - Status Sync | `uUGxA3GW1W0vq6el` | Inactive (warm-up) | 9AM PHT daily | Pull Smartlead lead statuses, sync opens/replies/bounces back to Sheet |
| 18 | Krave — Price Reply Auto-Resubmit | `nzFTk4e9NRi6Jk9r` | Active | **Event-driven** — `POST /webhook/krave-price-reply-resubmit` (no schedule) | Detect bot "price missing" threads with unprocessed amount replies in #payments-invoices-updates, parse receipt + amount, resubmit to intake webhook automatically. **Fully event-driven as of 2026-06-10:** the krave-bot (Render) forwards human messages in this private channel (`message.groups`) to the webhook; ~0 idle execs. History: 24/7 `*/10` (~4,300/mo, blew the 2,500 cap) → throttled `*/30 8-19 * * 1-5` → schedule removed. |
| 19 | LinkedIn Post Monitor | `wNXs7wqHz5d5naJN` | Inactive (needs actor verification) | Every 30min all day | Scrape Noa's LinkedIn profile via Apify every 30min, detect new posts using workflow static data, alert John in #noa-linkedin-posts with preview + link |
| 20 | Halo - VA Slack Bot | `XgHWMBeHoPWelE9r` | Active | `app_mention` in #halo-home-shopify | VA @mentions bot → Claude classifies intent → Shopify API → formatted reply in thread |
| 21 | Halo - Daily Digest | `047cSNvFvUGHaf3O` | Active | 10 AM PHT daily (Asia/Manila) | Pull yesterday's Shopify orders + unfulfilled count → Claude formats → post to #halo-home-shopify |
| 22 | Krave — Creator Invoice Email Scan | `DbIJYYQ3FE4HKprB` | Active (reworked + reactivated 2026-06-12 after client-facing misfire; guards: PDF-only intake, is-invoice classification, per-message replies, known-sender gate + #ops-command flag path — see Workflow 22 section) | 09:00/12:00/15:00/18:00 PHT Mon–Fri + `POST /webhook/krave-creator-invoice-email-scan` | Scan john@kravemedia.co for unread invoice PDFs, parse with Claude, block Airwallex/automated senders, dedup vs tracker, validate bank details, forward to kravemedia@bills.airwallex.com, reply to sender, log to Creator & AP Bills Tracker |
| 23 | Halo - Inventory Alert | `NBvfYPmjdTXzrKfb` | Active | 9 AM PHT daily (Asia/Manila) | Compare product stock vs previous run; alert #halo-home-shopify on OOS changes + newly low-stock (<10 units) |
| 24 | Halo - Weekly Report | `7N9gEZb7nDS0EDGu` | Active | 9 AM PHT Mondays (Asia/Manila) | Refill due list (filter buyers 75–105 days ago) + upsell gap (showerhead buyers without filters) → post to #halo-home-shopify |

---

## Shared Infrastructure

### Data Sources

| Resource | Type | ID / Location | Access |
|----------|------|---------------|--------|
| Client Invoice Tracker | Google Sheets | `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50` | Tab: `Invoices` |
| Slack channel | `#payments-invoices-updates` | `C09HN2EBPR7` | Bot posts and reads |
| Slack channel | `#ops-command` | `C0AQZGJDR38` | Bot reads and archives EOD |
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
| S | Last Follow-Up Sent | Invoice Reminder Cron; latest reminder date for attribution |
| T | Last Follow-Up Type | Invoice Reminder Cron; latest reminder tier such as `7d`, `overdue`, or `late-fee-followup` |
| S | Clickup Task ID | Invoice Approval Polling (write when John includes ClickUp URL in approval reply); Payment Detection (read to update ClickUp status) |
| U | Last Follow-Up Thread ID | Invoice Reminder Cron; real Gmail reminder thread key when available, otherwise blank |
| V | Last Client Reply Date | Invoice Reminder Reply Detection; latest client reply date from John's Gmail only |
| W | Client Reply Status | Invoice Reminder Reply Detection; `No Reply Found`, `Possible Reply`, `Replied`, `Promise to Pay`, `Question/Dispute`, or `Needs Human` |
| X | Client Reply Summary | Invoice Reminder Reply Detection; short summary/snippet of the latest detected client reply |
| Y | Follow-Up Attribution | Invoice Reminder Reply Detection and Ops Report; attribution note for reply/payment reporting |
| Z | Reply Confidence | Invoice Reminder Reply Detection and Ops Report; `Confirmed`, `Likely`, or `Unconfirmed` |

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

Detects client payments and updates the tracker. Runs three detection paths in parallel: (1) scans `noa@kravemedia.co` for Airwallex deposit notifications + John's forwarded receipts, (2) polls the Airwallex invoice API directly — catching SWIFT bank-transfer payments that may not generate an email, and (3) scans for client-reply payment confirmations on non-Airwallex bank flows (added 2026-05-07). Path (3) routes only to `Slack Needs Review` and never auto-marks paid. Matches deposits to open invoices using **strict client-name + amount/currency matching**, handles partial payments, and posts Slack alerts. **Marks invoices paid in Airwallex only behind a confidence gate + live verification guard** (v7, 2026-06-11): high-confidence full payments are auto-marked after re-verifying amount/currency/status against the live Airwallex record; everything else gets an explicit "NEEDS MANUAL mark-as-paid" line in the Slack alert. Unconditional auto-mark was removed in May 2026 after an incident — see Hardening Notes below.

### Triggers

| Type | Details |
|------|---------|
| Schedule | `0 * * * *` - hourly |
| Webhook | `POST https://noatakhel.app.n8n.cloud/webhook/krave-payment-detection` |

### Node Flow (post-May-2026 hardening)

```text
[Schedule / Webhook]
        |
[Claim Window]              ← lastRunTs; emits gmailQuery + clientReplyQuery
        |
   ┌────┴───────────────────┬──────────────────────────┐
   │                        │                          │
[Search Airwallex Emails] [Get Invoice Tracker]  [Search Client Replies]
   │                        │                          │  (has:attachment,
[Parse All Emails]       [Poll Airwallex Invoices]     │   non-internal sender,
   │  (extracts amount,     │  (uses this.helpers.       │   reminder phrases excluded)
   │   currency, INV#,         httpRequest;             │
   │   depositor name,         parallel to Gmail)    [Parse Client Replies]
   │   source)              │                          │  (phrase + tracker
   └─────────┬──────────────┘                          │   fuzzy match by domain;
             │                                         │   processedClientReplyIds
   [Combine Payment Signals]                           │   idempotency, cap 10/run)
             │                                         │
             ▼                                         │
   [Match Deposits To Invoices]      ← STRICT: invoice# OR (amount+currency+clientName)
                │                       cross-run idempotency via processedEmailIds
                │                                       │
                ▼                                       ▼
                │
          [Needs Review?]                              │
            /         \                                 │
     TRUE              FALSE                            │
      |                  |                              │
[Slack Needs ◄──────────────────────────────────────────┘ (client-reply path)
  Review]   [Is Partial?]
            /         \
                  TRUE         FALSE
                   |              |
            [Update Partial   [Is Osome?]
              Tracker]         /        \
                   |        TRUE         FALSE
            [Slack Partial    |             |
              Alert]    [Update Osome]  [Update Invoice Status]
                              |             |
                        [Slack Osome]  [Airwallex Auth]            ← httpCustomAuth credential
                        [Confirmed]         |                         (no secrets in code)
                                       [Airwallex Guarded Mark Paid] ← v7: confidence gate +
                                            |                         live verify, else manual flag
                                       [Slack Payment Confirmed]    ← always carries
                                                                      "• Airwallex: <status>" line
```

### Matching Logic (strict — May 2026)

1. **Open candidates** — Col N `Status` of `Unpaid`, `Overdue`, or blank AND Col J `Payment Status` not in `Payment Complete`, `Collections`, and not a draft state. Col E `Invoice #` must be set.
2. **Tier 1 — Exact invoice number match** against Col E (`high` confidence). For forwarded emails, additionally require client name fuzzy match if both depositor and tracker client name present.
3. **Tier 2 — Airwallex deposit emails only:** require all three: amount + currency + client-name fuzzy match (`medium-client` confidence). Token-based match drops corporate suffixes (LLC, LTD, INC, PTE, PTY, etc.).
4. **No amount-only fallback** — was removed after the WELLE incident (see below).
5. **Forwarded receipts without amount** — when the email contains the invoice number but no parseable amount, the matcher uses the tracker's invoice amount (`high-tracker-amount` confidence).
6. **Anything else with payment signal but no high-confidence match** routes to `Slack Needs Review` instead of writing the tracker.
7. **Cross-run idempotency** — every processed `emailId` is added to `staticData.processedEmailIds` (last 500). Re-runs skip already-seen emails even if `lastRunTs` has been reset.
8. **Time-windowing** — Gmail query uses `after:{lastRunTs}` since last run. First run falls back to `newer_than:1d`.

### Hardening Notes (May 2026 incident → v4 → v5.1)

In May 2026 the matcher's amount-only fallback wrongly assigned a Little Saints deposit to WELLE PTY LTD (both happened to have $4,600 USD invoices open at the same time) and the workflow then auto-mark-paid WELLE in Airwallex via API. Airwallex has **no unpay endpoint** — the only fix was a credit-note-and-replace process. The hardening rolled out in three patches:

**v4 (initial response):**
1. **Removed** the `Airwallex Auth` and `Airwallex Mark Paid` HTTP nodes. The workflow no longer mutates Airwallex state; tracker is the only source of truth that the automation writes to. Airwallex side is reconciled manually when needed.
2. **Strict matching** — amount-only fallback is gone. Required signals listed in Tier 1–3 above. Corner cases route to `Slack Needs Review`.
3. **Idempotency via emailId dedup** — `processedEmailIds` (last 500) in workflow staticData; prevents re-processing if `lastRunTs` is reset.
4. **Forwarded-email filter** in Claim Window now includes a payment-keyword whitelist AND requires `to:noa@kravemedia.co` (skips reminder CCs) AND explicitly excludes `subject:reminder`, `subject:"following up"`, `subject:"due today"`, `subject:overdue`.

**v5 (system awareness):**
5. **Already-reconciled check** — before routing to Needs Review, the matcher checks if the deposit matches any tracker row already marked `Payment Complete` (by client + amount + currency, or by invoice number). If yes, silently dedup. This prevents Needs Review noise for late-arriving deposit notifications of payments we've already manually reconciled.
6. **Depositor denylist** — silent skip at parse stage for known non-client payment processors: `STRIPE PAYMENTS`, `SHOPIFY`, `PAYPAL HOLDINGS`, `GUSTO` (Krave's own Shopify/Stripe payouts).
7. **INV regex tightened** — requires `INV-` dash prefix; no longer matches the bare word "INVOICE" from email body text.

**v5.1 (parser fix):**
8. **Subject/From fallbacks** — Parse All Emails now reads `msg.Subject` and `msg.From` as fallbacks for Gmail simple-mode responses (not just `msg.payload.headers`). Previously, Subject extraction silently fell back to `msg.snippet` which sometimes misses the real subject (e.g., short forwards where subject IS the invoice number but body has different text).

**v6 (client-reply branch — 2026-05-07):**
9. **Client Payment Reply branch added.** Trigger: 2026-05-07 Nutrition Kitchen 2/2 silent-miss — payment landed in Eclipse Ventures Pte. Ltd. (non-Airwallex SG bank), client confirmation came as a reply on the invoice thread, both prior detection paths blind. New nodes `Search Client Replies` (Gmail) + `Parse Client Replies` (Code) emit Needs Review payloads only — they never auto-mark paid. Match rule: phrase signal (e.g. "payment is done", "transfer details", "remittance advice") AND tracker fuzzy match by sender domain ↔ Client Email, status not Payment Complete, sender not in internal denylist. Idempotency via `processedClientReplyIds` (last 200, separate from the Airwallex branch's `processedEmailIds`). Slack volume capped at 10 posts per run. Operator workflow: Needs Review post → forward email from john@→noa@ with invoice# + amount in subject → existing forwarded-receipt path marks paid.

**v6.1 (full-message fetch + broadened API poll — 2026-05-08):**
10. **Full-message fetch in Parse All Emails (`n3`).** When Gmail search returns a stripped payload (no `parts`), the node calls `GET /gmail/v1/users/me/messages/{id}?format=full` via `requestWithAuthentication` (gmailOAuth2 credential `vxHex5lFrkakcsPi` added to the node). This ensures the complete MIME tree is available for body extraction.
11. **PDF attachment extraction (v6.1 attempt — superseded by v6.2).** Attempted to extract invoice references from PDF attachments via `zlib.inflateSync`. Abandoned: NotoSans Identity-H CID encoding makes text extraction from the PDF impractical without a full ToUnicode CMap parser.
12. **Broadened `paid_amount` field detection in Poll Airwallex Invoices (`n17`).** Added `amount_settled`, `amount_received`, `collected_amount` as field candidates. Added status-based fallback: if `status` is `PAID`, `COMPLETED`, or `SETTLED` and all amount-field candidates are null, uses the invoice total as paid amount.

**v6.3 (PDF attachment extraction + dedup hardening — 2026-05-08):**
14. **PDF text extraction in Parse All Emails (`n3`).** Root cause: Airwallex Global Account "Confirmation of Receipt of Funds" emails have a completely empty body — all data (remitter name, reference) is in a `ga_deposit_confirmation_letter-*.pdf` attachment (Typst 0.13.1, NotoSans Identity-H CID encoding). v6.2's recursive MIME walker correctly found no text parts. Fix: when body is still empty AND source is `airwallex-email` AND an `application/pdf` attachment exists, download via Gmail Attachments API (`requestWithAuthentication`, gmailOAuth2 `vxHex5lFrkakcsPi`), inflate all FlateDecode streams to find ToUnicode CMaps, build CID→Unicode maps (handles `beginbfchar`/`beginbfrange`), then decode the page content stream (BT/ET/Tf/Tj/TJ operators) to plain text. Extracted text then flows through existing `clientName` and `INV-` regex parsers as normal.
15. **Amount+currency fallback dedup in Match Deposits To Invoices (`n5`).** Belt-and-suspenders for the case where PDF extraction fails (clientName still null). When `source === 'airwallex-email'` and `clientName` is null, checks `completedRows` for amount+currency match within a 90-day payment window. If found, silently deduplicates (adds to `processedEmailIds`). Prevents repeat `needsReview` alerts for already-manually-reconciled deposit confirmation emails.

**v6.2 (recursive MIME traversal — 2026-05-08):**
13. **Recursive MIME walker in Parse All Emails (`n3`).** Replaced the 2-level nested for-loop with a `findBodyParts()` recursive function that walks the MIME tree to any depth. Handles Airwallex invoice-paid notification emails that nest `text/html` at level 3+. Does not handle the deposit confirmation email type (empty body) — that is v6.3's scope. Extraction order: `text/plain` → `text/html` (deepest match at any nesting level) → PDF attachment (v6.3) → `msg.snippet`.

**v7 (confidence-gated mark-as-paid — 2026-06-11):**
16. **Guarded Airwallex mark-as-paid re-introduced.** Trigger: 2026-06-10 AMPLIFIED MARKETING `INV-AG2H2WFA-0001` — exact-amount match updated the tracker but left Airwallex unpaid with no notification that a manual step was needed (the v4 over-correction). Patch script: `n8n-workflows/patch-payment-detection-aw-markpaid.js`. Design (decision: John, 2026-06-11):
    - **Confidence gate** (in `Match Deposits To Invoices`, `awMarkEligible`): eligible only for full (non-partial), non-Osome payments where the match is `high`/`high-tracker-amount` (invoice-number match) OR `medium-client` with a single payment settling the exact full invoice amount (`existingAmountPaid === 0` and `|amount − invoiceAmount| < 0.01`).
    - **Runtime verification guard** (`Airwallex Guarded Mark Paid` node): before any write, re-fetches the live Airwallex invoice and requires currency match, `total_amount` match vs tracker (±0.01), and `payment_status` not already `PAID`/void. Any mismatch or API error → no write, manual flag. This directly addresses the WELLE failure mode: a wrongly-matched deposit cannot mark a different-amount invoice.
    - **Auth via credential store** (`Airwallex Auth` HTTP Request node, `httpCustomAuth` credential `Ry37bj6SFVD1zcd0`) — no API keys in workflow code. NOTE: Code nodes on this instance do NOT have `this.helpers.requestWithAuthentication` (verified 2026-06-11; the v6.1/v6.3 usages in `n3` are inside silent try/catch) — only `this.helpers.httpRequest` works, so auth must live in a regular node.
    - **Visibility:** `Slack Payment Confirmed` always ends with `• Airwallex: <status>` — "marked paid automatically (…)", "already PAID in Airwallex", or "⚠️ NEEDS MANUAL mark-as-paid — <reason>". No silent Airwallex gaps.

### Partial Payment Detection

After a match, the workflow checks if the received amount covers the full invoice:

- `existingAmountPaid` = Col Q — 0 if empty
- `newAmountPaid` = existingAmountPaid + received amount
- `remaining` = Col G (Amount) − newAmountPaid
- **Partial** if remaining > $1.00 → Col J `Partial Payment`, Col Q updated, Slack 🔄
- **Full** if remaining ≤ $1.00 → Col J `Payment Complete`, Col M date, Col Q = invoice amount, Slack ✅

### ClickUp Sync (full payment only)

Applied via surgical patch: `n8n-workflows/patch-payment-detection-clickup.js` (nodes cu1–cu3).

On full payment confirmed (not partial), after `Update Invoice Status` / `Update Osome Invoice Status`:
1. Look up Col S `Clickup Task ID` from tracker rows (matched via Invoice #)
2. If present → PUT ClickUp task status → `payment complete`
3. `continueOnFail: true` — payment detection flow is never blocked by ClickUp API errors
4. If Col U is blank (invoices created before this feature) → silently skipped

### Airwallex API Poll

`Poll Airwallex Invoices` (Code node, `continueOnFail: true`) runs in parallel with the Gmail scan:
- Uses `this.helpers.httpRequest` to authenticate and call `GET /api/v1/invoices/{id}` per open non-Osome tracker row
- Checks `paid_amount` / `amount_paid` / `total_paid` / `amount_settled` / `amount_received` / `collected_amount` for each invoice (v6.1: broadened candidates)
- Status-based fallback: if Airwallex status is `PAID`/`COMPLETED`/`SETTLED` and no paid-amount field is populated, uses invoice total as paid amount (v6.1)
- If API shows more paid than Col Q records, injects a payment signal for the difference (with `clientName` from the tracker row)
- Gmail and API signals merged + deduped before matching

### Outputs

| Outcome | Action |
|---------|--------|
| Full payment matched, Airwallex invoice, auto-mark eligible + verified | Sheets Col J → Payment Complete, Col M date, Col Q = full amount, Airwallex `mark_as_paid`, Slack ✅ with "Airwallex: marked paid automatically" |
| Full payment matched, Airwallex invoice, NOT eligible or guard mismatch | Sheets updates as above, NO Airwallex write, Slack ✅ with "⚠️ Airwallex: NEEDS MANUAL mark-as-paid — [reason]" |
| Full payment matched, Osome invoice | Same Sheets updates (no Airwallex record exists) |
| Partial payment matched | Sheets Col J → Partial Payment, Col M date, Col Q = cumulative paid, Slack 🔄 |
| Email has signal but matcher can't disambiguate | Slack ⚠️ "needs review" — no tracker write |
| No emails / no API signals | Silent |
| Shopify / payout noise / already-processed emailId | Skipped silently |

### Error Handling

| Failure | Behaviour |
|---------|-----------|
| First run (no static data yet) | `lastRunTs` defaults to 0 — falls back to `newer_than:1d`, continues normally |
| Airwallex API poll auth fails | `continueOnFail: true` — returns empty emails array; Gmail scan still runs |
| Per-invoice API fetch fails | Silent — that invoice skipped in poll; Gmail scan is fallback |
| Airwallex `paid_amount` field missing | Poll returns nothing for that invoice — no false positives |
| Airwallex Auth (login) fails | `continueOnFail: true` — guard node sees no token, flags "NEEDS MANUAL mark-as-paid — auth failed"; Sheets already updated |
| Guard verification mismatch (currency/amount/status) | No Airwallex write — Slack flags "NEEDS MANUAL" with the specific mismatch reason |
| Airwallex `mark_as_paid` call fails | Caught inside guard node — Slack flags "NEEDS MANUAL mark-as-paid — Airwallex API error"; Sheets already updated |
| Gmail auth error | Workflow errors and n8n emails the instance owner |

---

## Workflow 2 - Invoice Reminder Cron

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/Q3IqqLvmX9H49NdE`  
**Deploy script:** `n8n-workflows/deploy-invoice-reminder-cron.js`

### Purpose

Replaces manual invoice follow-up. Once daily, it scans every open invoice in the tracker, calculates days until or since due date, sends tiered reminder emails from `john@kravemedia.co`, updates the tracker, and posts Slack alerts for overdue and escalated invoices.

The workflow also writes latest follow-up metadata to Columns S-U: `Last Follow-Up Sent`, `Last Follow-Up Type`, and `Last Follow-Up Thread ID`. The thread ID is blank unless Gmail returns a real thread key, so reports should treat it as an implementation detail rather than a user-facing invoice reference. Column L remains the historical reminder log. Column N stays formula-only and must never be written.

### Triggers

| Type | Details |
|------|---------|
| Schedule | `0 10 * * 1-5` (Asia/Manila) - 10:00 AM PHT Monday–Friday |
| Webhook | `POST https://noatakhel.app.n8n.cloud/webhook/krave-invoice-reminder` |

### Node Flow

```text
[Schedule / Webhook]
        |
[Get Invoice Tracker]
        |
[Process Invoices]
        |
[Is Digest Item?]
   | true                     | false
   v                          v
[Post Digest]          [Has Client Email?]
                          | true                     | false
                          v                          v
                   [Send Email]        [Slack Missing Email Warning]
                          |
                   [Update Tracker Row]
                          |
                   [Needs Slack Alert?]
                      | true
                      v
                   [Slack Overdue Alert]
```

### Reminder Schedule

Pre-due tiers are filtered by payout term, inferred from `Col I (Due Date) - Col A (Date Created)` gap. Overdue tiers fire for all invoices regardless of term.

**Payout term → allowed pre-due tiers** (tightened May 2026):

| Inferred Term | Gap | 7d | 3d | Due Today |
|--------------|-----|----|----|-----------|
| 30d terms | > 20 days | ✅ | ✅ | ✅ |
| 15d terms | 11–20 days | ✅ | ✅ | ✅ |
| 7d terms | ≤ 10 days | — | ✅ | ✅ |

If Col A is missing, defaults to 30d terms. The 5d and 1d pre-due tiers are no longer used for any payout term.

**Full schedule:**

| Days Until/Since Due | Trigger | Email Type | Slack Alert |
|----------------------|---------|-----------|-------------|
| +7 | Pre-due (30d/15d only) | Payment Reminder | No |
| +3 | Pre-due (all terms) | Payment Reminder | No |
| 0 | Due today (all terms) | Invoice Due Today | Yes |
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

## Workflow 2b - Invoice Reminder Reply Detection

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/omNFmRcDeiByLOzS`  
**Deploy script:** `n8n-workflows/deploy-invoice-reminder-reply-detection.js`

### Purpose

Adds reply attribution for the invoice reminder system. It reads the Client Invoice Tracker through Column Z, finds rows with latest follow-up metadata, scans only `john@kravemedia.co` Gmail for client replies after the latest follow-up, classifies the reply status conservatively, and writes reply attribution back to the tracker with a confidence label.

This workflow does not monitor Noa or strategist inboxes, does not infer client replies from Slack, and does not send client responses.

### Triggers

| Type | Details |
|------|---------|
| Schedule | `30 10 * * 1-5` (Asia/Manila) - 10:30 AM PHT weekdays |
| Webhook | `POST https://noatakhel.app.n8n.cloud/webhook/krave-invoice-reminder-reply-detection` |

### Node Flow

```text
[Schedule / Webhook]
        |
[Get Invoice Tracker]        reads Invoices!A:Z
        |
[Prepare Reply Queries]      builds John-only Gmail queries per invoice
        |
[Search John Gmail Replies]  scans replies from client emails to john@kravemedia.co
        |
[Classify Reply]             No Reply Found / Possible Reply / Replied / Promise to Pay / Question/Dispute / Needs Human
        |
[Update Reply Attribution]   writes V:Z using Invoice # match
```

### Tracker Writes

| Col | Field | Write rule |
|-----|-------|------------|
| E | Invoice # | match key only |
| V | Last Client Reply Date | latest detected client reply date, blank when no reply |
| W | Client Reply Status | one of the approved reply statuses |
| X | Client Reply Summary | short snippet/summary of latest reply |
| Y | Follow-Up Attribution | note explaining reply detection state |
| Z | Reply Confidence | `Confirmed`, `Likely`, or `Unconfirmed` |

Column N remains formula-only and must never be written.

### Reply Scope

Only `john@kravemedia.co` Gmail is scanned. A client reply sent only to Noa, Amanda, or another strategist is not counted unless it is forwarded into John's reminder thread or manually recorded later.

### Non-Goals

- No auto-reply.
- No Gmail drafts.
- No Slack posts.
- No monitoring outside John's mailbox.

---

## Workflow 3 - EOD Triage Summary — REMOVED

Migrated out of n8n. EOD now runs as a scheduled remote Claude Code agent at 6:00 PM Asia/Manila Mon–Fri.
Canonical source of truth: [`.claude/skills/eod-triage-summary/SKILL.md`](../.claude/skills/eod-triage-summary/SKILL.md).

---

## Workflow 4 - Start Of Day Report — REMOVED

Migrated out of n8n. SOD now runs as a scheduled Claude cron at 10:00 AM PHT Mon–Fri.
Canonical source of truth: [`.claude/skills/sod-report/SKILL.md`](../.claude/skills/sod-report/SKILL.md).

---

## Workflow 5 - Inbox Triage Daily v2

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/EuT6REDs5PUaoycE`  
**Deploy script:** `n8n-workflows/deploy-inbox-triage-daily.js`  
**Previous workflow:** `3YyEjk1e6oZV786T` (deleted — classification stopped working April 2026)

### Purpose

Classifies all unread inbox emails for `noa@kravemedia.co` into the `EA/*` tier model. Uses a hardcoded rules classifier first (Osome, creator inbound, known contacts, client payments) and falls back to GPT-4o-mini only for unknown senders. Applies labels, creates drafts for Urgent/Needs-Reply tiers, archives only the noise tiers (`EA/FYI` + `EA/Auto-Sorted`), and posts an audit summary to `#ops-command`.

**Inbox = actionable queue (2026-06-15):** `EA/Urgent`, `EA/Needs-Reply`, and `EA/Unsure` (plus client payments) stay in the inbox — only `EA/FYI` and `EA/Auto-Sorted` are archived. The `#ops-command` post is John's QA/audit view; Noa reads the day's mail (Urgent + Needs-Reply + FYI) via the Morning Coffee DM, which is her single surface. The workflow does **not** DM Noa directly.

### Triggers

| Type | Details |
|------|---------|
| Schedule | `0 9 * * 1-5` (Asia/Manila) — 9:00 AM PHT weekdays |
| Webhook | `POST https://noatakhel.app.n8n.cloud/webhook/krave-inbox-triage-v2` |

### Tier Model

| Tier | Label ID | Meaning |
|------|----------|---------|
| `EA/Urgent` | `Label_3` | Compliance deadlines, legal, disputes — act today |
| `EA/Needs-Reply` | `Label_4` | Real human email needing a response — draft created |
| `EA/FYI` | `Label_5` | Useful info, no reply needed |
| `EA/Auto-Sorted` | `Label_6` | Automated notifications that slipped past Gmail filters |
| `EA/Unsure` | `Label_7` | Genuinely ambiguous — stays in inbox for manual review |

### Hardcoded Rules (bypass AI)

| Condition | Outcome |
|-----------|---------|
| Sender includes `osome.com` OR has `Compliance` label (`Label_14`) | EA/Urgent + draft |
| Has `Creators-Inbound` label (`Label_16`) | EA/Needs-Reply + typeform draft |
| Has `_Payment_Received` label (`Label_5194298534623747326`) | EA/FYI, no draft, **kept in inbox** (client payments are not archived) |
| Sender matches known contacts list (amanda, shin, joshua, lucas, welleco, etc.) | EA/Needs-Reply + AI draft |
| PandaDoc completed contract notification | EA/Needs-Reply, no draft |
| Sender matches `noreply@`, `no-reply@`, `notifications@` | EA/Auto-Sorted |
| Everything else | AI classify (GPT-4o-mini) |

### Search Scope

- Gmail query: `in:inbox is:unread -label:EA/Urgent -label:EA/Needs-Reply -label:EA/FYI -label:EA/Auto-Sorted -label:EA/Unsure`
- Scans all unread inbox emails not yet triaged (catches weekend backlog)
- Cap: 50 emails per run

### Outputs

| Scenario | Action |
|----------|--------|
| EA/Urgent / EA/Needs-Reply | Apply label, create draft (typeform for creator inbound, AI for all others), **keep in inbox** |
| EA/FYI / EA/Auto-Sorted | Apply label, **archive** (remove from inbox) |
| EA/FYI with `_Payment_Received` (client payment) | Apply label, **keep in inbox** (`archive_ok` forced false for `_Payment_Received`) |
| EA/Unsure | Apply label, keep in inbox |
| All tiers | Post audit summary to `#ops-command` channel (no Noa DM — Noa reads Morning Coffee) |

### Error Handling

| Failure | Behaviour |
|---------|-----------|
| AI classify returns invalid JSON | Falls back to `EA/Unsure` |
| Gmail label/draft error | `continueOnFail` — other emails continue processing |
| Slack post failure | Workflow ends; no retry configured |
| Email send | Never sends automatically — draft only, Noa reviews and sends |

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

## Workflow 15 — Halo Weekly Intelligence Report

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/5ZqTSaUEtxnAndiY`
**Deploy script:** `n8n-workflows/deploy-halo-intelligence-report.js`

### Purpose

Weekly social intelligence pipeline for Halo Home's US market entry. Replaces manual monitoring of competitor/niche content. Scrapes TikTok and Instagram for top-performing posts in Halo's four hashtag clusters, scores by weighted engagement formula × ICP relevance multiplier, selects Top 10 per platform with diversity rules, runs Claude analysis on each post, and delivers a structured report to Slack, Google Sheets, and email every Monday.

### Triggers

| Type | Details |
|------|---------|
| Schedule | `0 7 * * 1` (Asia/Manila) — 7:00 AM PHT every Monday |

### Node Flow

```text
[Schedule Trigger — Mon 7AM ICT]
        |
[Fetch TikTok] + [Fetch Instagram]  (parallel Apify HTTP Request nodes)
  Instagram runs in reels mode (resultsType: 'reels'); TikTok scrapes video posts
  Hashtag clusters: skin, hair, shower/water, wellness/clean beauty
        |
[Merge] → [Score and Rank Posts]
  Filter: video/reels only; last 14 days; TikTok >=5,000 likes; Instagram >=10,000 views
  Score: Engagement Rate (40%) + Saves/Shares (35%) + Views Normalized (25%) × ICP multiplier
  Select Top 10 per platform: max 2 per creator; >=3 distinct niche categories (best effort)
        |
[Claude Analysis]
  Per post: hook, hook type, format, visual style, keyword, CTA/ending,
            why it works, ICP match, content pillar, Halo adaptation
  Plus: 2-paragraph trend synthesis
  Hook Type + Format constrained to fixed option lists (aligned to Alleah's manual inspo sheet)
        |
[Format Report]
  Slack text, email HTML, sheet rows
        |
[Post to Slack] → C0A22NPLV38
        |
[Send Email] → shin@kravemedia.co, noa@kravemedia.co, john@kravemedia.co, alleahvargas@gmail.com, basteperez021198@gmail.com (Baste — ads inspo)
        |
[Prepare Sheet Rows] — splits into 20 items (one per post)
        |
[Append Sheet Row] — fires 20× → Google Sheet Posts tab
```

### ICP Relevance Multiplier

| Group | Sub-ICPs | Emotional Driver |
|-------|----------|-----------------|
| Skin Conditions | Eczema · Rosacea · Psoriasis · Acne-Prone · Sensitive Skin | Pain, exhaustion, desperation — has tried everything |
| Hair & Scalp Conditions | Hair Loss · Dandruff · Dry/Frizzy Hair · Color-Treated Hair | Frustration, embarrassment, wasted money, identity threat |
| Context & Mindset | Hard Water Refugee · Wellness-Burned · Prevention-Focused | Attribution, skepticism, proactive protection |

Each matched group adds +0.1 to the multiplier (1.0 base → max 1.3).

### Hashtag Clusters Scraped

| Cluster | Hashtags |
|---------|---------|
| Skin | sensitiveskin, skintok, skinbarrier, eczema, rosacea, acneskin |
| Hair | hairloss, scalptok, dryhair, dandruff, colortreatedhair |
| Shower/Water | showertok, hardwater, showerskincare |
| Wellness | cleanbeauty, wellnesstok, skinconsciousliving, nontoxicbeauty, rituals |

### Outputs

| Scenario | Action |
|----------|--------|
| Top posts scored + analyzed | Slack digest to `C0A22NPLV38`, HTML email to 5 recipients (incl. Baste for ads inspo), 20 rows appended to Posts sheet |
| Team access | Posts sheet is linked in the "Halo Post Inspiration Library" table of the **Ideas & Moodboard** Slack canvas (`F0A2ATP4D5L`) as the auto-updated TikTok feed; Alleah's manual sheet there is the IG-focused complement |
| Apify actor fails | Returns empty array; scoring continues with whatever is available; no hard failure |
| Claude parse error | Fallback to empty analysis fields; report still delivers |
| Slack/email send fails | `continueOnFail: true`; Sheet append still runs |

### Error Handling

| Failure | Behaviour |
|---------|-----------|
| APIFY_API_KEY / ANTHROPIC_API_KEY missing at deploy | Deploy script throws (keys are read from local `.env` and baked into nodes); workflow is not updated |
| Invalid Apify/Anthropic key at runtime | HTTP Request returns 401; `continueOnFail: true` → node returns empty; report delivers with fewer/no posts |
| Actor timeout (>300s) | HTTP Request errors; `continueOnFail` → actor returns []; report delivers with fewer posts |
| Google Sheets append fails per row | `continueOnFail: true`; remaining rows still process |

### Runbook — Resolved Issues

| Symptom | Cause | Resolution |
|---------|-------|------------|
| Report ships TikTok-only; Instagram section empty | Instagram Apify body omitted `resultsType`, so the actor defaulted to `posts` (static photos, near-zero engagement) and all results failed the quality gate | Set `resultsType: 'reels'` in `INSTAGRAM_APIFY_BODY`; gate Instagram on views (>=10,000), not likes; redeploy |
| `Posts` sheet stays empty despite a successful run | `Prepare Sheet Rows` read `$json.sheetRows`, but its upstream node is `Send Email` (Gmail) whose output has no `sheetRows` | Read `$('Format Report').first().json.sheetRows` explicitly; redeploy |
| A platform returns fewer than 10 posts | Recency (14-day) + quality gates legitimately filtered the pool; best-effort diversity floor cannot fabricate posts | Expected — widen `MAX_AGE_DAYS` or lower the gate only if the team prefers volume over freshness/quality |

### Google Sheet Setup (manual, one-time)

Sheet ID: `1V_sjvMaCngWyB_5-ElMFdMetlsR2OdgD2QP42QQ5au4`
Tab name: `Posts`
Columns: Week | Platform | Creator | Post URL | Likes | Views | Saves | Shares | Engagement Rate (%) | ICP Group | Content Pillar | Hook (0–3s) | Why It Works | ICP Match Detail | Halo Adaptation | Keyword | Format | Visual Style | Hook Type | CTA / Ending | Score
Columns are aligned to Alleah's manual inspo sheet format (Format, Hook Type, Visual Style, CTA/Ending, Keyword added; Hook→Hook (0–3s), Why It Performed→Why It Works, Halo Angle→Halo Adaptation, URL→Post URL). The n8n append maps by header name, so physical column order need not match this list. `Transcript` is intentionally omitted (scraper does not return reliable transcripts).

### Apify Actor Verification (before first deploy)

Verify actor IDs at https://apify.com/store:
- TikTok: search "tiktok hashtag scraper" — confirm `clockworks~tiktok-hashtag-scraper` is the active actor
- Instagram: search "instagram hashtag scraper" — confirm `apify~instagram-hashtag-scraper` is correct
Update `TIKTOK_ACTOR_ID` and `INSTAGRAM_ACTOR_ID` in the deploy script if different.

---

## Credential Reference

| Credential Name | Type | ID | Used By | Account |
|----------------|------|----|---------|---------|
| Gmail account | Gmail OAuth2 | `vxHex5lFrkakcsPi` | Payment Detection | `noa@kravemedia.co` |
| Gmail account (john) | Gmail OAuth2 | `vsDW3WpKXqS9HUs3` | Invoice Reminder Cron | `john@kravemedia.co` |
| Google Sheets account | Google Sheets OAuth2 | `83MQOm78gYDvziTO` | Payment Detection, Invoice Reminder Cron, Invoice Request Intake | `noa@kravemedia.co` |
| Krave Slack Bot | Slack API (Bot Token) | `Bn2U6Cwe1wdiCXzD` | Slack-facing workflow posts, modal handling, and SOD local/manual runs | Krave Slack workspace |
| OpenAI account | OpenAI API | `UIREXIYn59JOH1zU` | Inbox Triage Daily | OpenAI API |
| APIFY_API_KEY | Baked into workflow nodes at deploy time (n8n Starter has no env vars) — sourced from local `.env`; rotate by redeploying | — | Halo Intelligence Report | Apify account (apify.com) |
| ANTHROPIC_API_KEY | Baked into workflow nodes at deploy time (n8n Starter has no env vars) — sourced from local `.env`; rotate by redeploying | — | Halo Intelligence Report | Anthropic API |

### Airwallex

| Field | Value |
|-------|-------|
| n8n credential | `Airwallex API (login headers)` — type `httpCustomAuth`, ID `Ry37bj6SFVD1zcd0` (created 2026-06-11) |
| Used by | Payment Detection `Airwallex Auth` node (v7 guarded mark-as-paid path) |
| Auth endpoint | `POST https://api.airwallex.com/api/v1/authentication/login` |
| Mark paid endpoint | `POST https://api.airwallex.com/api/v1/invoices/{id}/mark_as_paid` |

> The actual client-id/api-key live in `.env` (gitignored) and in the n8n credential store — never in committed files. **Legacy exception:** the `Poll Airwallex Invoices` code node (n17) still has creds inlined from deploy-time interpolation; on the next key rotation, migrate it to the `httpCustomAuth` credential pattern used by `Airwallex Auth` instead of re-inlining. (Previous key was publicly exposed Apr–Jun 2026 and rotated 2026-06-10.)

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
| Schedule | `0 9,11,13,15,17 * * 1-5` (Asia/Manila) - every 2 hrs, Mon-Fri, 9 AM-5 PM PHT |
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
  ↓ (two parallel branches)
  ├─ [Build John Thread Reply] → [Reply in John Thread] → [Build Strategist Message] → [Notify Strategist]
  └─ [Parse ClickUp Task ID] → [Has ClickUp Task?]
       └─ true → [ClickUp Set Collections] → [ClickUp Set Invoice Sent Date] → [ClickUp Set Invoice Due Date] → [Write ClickUp ID to Tracker]
       └─ false → (end — no ClickUp URL in reply)
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

### ClickUp Sync (post-finalization)

John can optionally include the UGC ClickUp task URL in his approval reply:
```
approve https://app.clickup.com/t/86ex3jwhn
```
- Task ID is parsed from the URL via regex `/app\.clickup\.com\/t\/([a-z0-9]+)/i`
- If URL present: ClickUp task status → `collections`; Invoice Sent date written; Invoice Due date written (from Col I); ClickUp Task ID stored in tracker Col S (`Clickup Task ID` — already exists in sheet)
- If no URL (WhatsApp clients, deposits, new clients): ClickUp sync skipped silently; all other outputs still fire
- All ClickUp HTTP nodes run with `continueOnFail: true` — invoice finalization is never blocked by ClickUp API errors

### Outputs

| Scenario | Action |
|----------|--------|
| Pending draft found, approve reply present | Finalize in Airwallex, get link, update Col J to `Invoice Sent`, write Col R Invoice URL, reply in John's thread, notify strategist in original thread |
| Approve reply includes ClickUp URL | Additionally: ClickUp status → `collections`, Invoice Sent + Due dates written to task, Col S `Clickup Task ID` written in tracker |
| Approve reply has no ClickUp URL | ClickUp sync skipped; all other outputs unchanged |
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
| ClickUp API fails (status update or date write) | `continueOnFail: true`; ClickUp branch is parallel and isolated; invoice finalization and Slack notifications are unaffected; manually update ClickUp task if needed |

---

## Workflow 10 — Weekly Invoice Summary

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/WX1hHek0cNTyZXkS`
**Deploy script:** `n8n-workflows/deploy-weekly-invoice-summary.js`

### Purpose

Proactive Monday portfolio snapshot for Noa. Reads every open invoice in the tracker, categorises by urgency bucket, and posts a single action-oriented summary to #payments-invoices-updates. Distinct from the daily digest (which reports what the reminder cron did that run) — this reports the full open portfolio regardless of what reminders fired.

### Triggers

| Type | Details |
|------|---------|
| Schedule | `0 9 * * 1` (Asia/Manila) — 9:00 AM PHT every Monday |
| Webhook | `POST https://noatakhel.app.n8n.cloud/webhook/krave-weekly-invoice-summary` |

### Node Flow

```text
[Schedule Monday 9am ICT / Webhook]
        |
[Get Invoice Tracker]
        |
[Build Weekly Summary]
        |
[Post Weekly Summary] → #payments-invoices-updates
```

### Portfolio Buckets

| Bucket | Condition |
|--------|-----------|
| 🔴 Collections | `days_diff ≤ -60` OR Col J = `Collections` |
| 🟠 Late Fee Applied | `days_diff` between -8 and -59 |
| 🟡 Overdue — Needs Chase | `days_diff` between -1 and -7 |
| 🔵 Due This Week | `days_diff` between 0 and 7 |
| ⚪ Pending — Upcoming | `days_diff > 7` |

Rows where Col N / Col J = `Payment Complete`, `Paid`, or starts with `Draft` are skipped. Partial payment rows show remaining balance.

### Outputs

| Scenario | Action |
|----------|--------|
| Open invoices exist | Sectioned Slack message with per-bucket counts and line items |
| All invoices paid / none open | `✅ No outstanding invoices — all paid or no open items.` |

### Error Handling

| Failure | Behaviour |
|---------|-----------|
| Sheets read fails | No items flow; Post Weekly Summary node receives no input; silent exit |
| Bad due date on a row | Row skipped silently |
| Unknown strategist in Col K | Raw name shown instead of mention; no error |

---

## Runbook - Common Scenarios

### Trigger payment detection manually

```bash
curl -s -X POST "https://noatakhel.app.n8n.cloud/webhook/krave-payment-detection" \
  -H "Content-Type: application/json" -d '{}'
```

### Client confirms payment via email reply (non-Airwallex bank flow)

**Symptom:** Client sends a reply on the invoice thread saying "payment is done / transfer details attached" but no Airwallex deposit notification arrives (e.g. payment landed in Eclipse Ventures Pte. Ltd. or another non-Airwallex SG/HK account).

**Expected behaviour (post-2026-05-07):** The Client Payment Reply branch fires automatically and posts a `Slack Needs Review` message in `#payments-invoices-updates` with: subject, source = `client-reply`, parsed amount/currency from tracker fuzzy match, parsed invoice number, parsed client name, reason, email ID. **No tracker write happens.**

**Operator action:** Verify the reply is genuine (open the email, check the attached transfer notice). Then forward the email from `john@kravemedia.co` → `noa@kravemedia.co` with the invoice number and amount in the subject. The existing forwarded-receipt path will detect it on the next run and mark the tracker `Payment Complete`.

**If branch did NOT fire when it should have:**
- Check `staticData.processedClientReplyIds` — sender's email ID may have been seen before (strip from list to reprocess).
- Check sender domain is not in the internal denylist (`kravemedia.co`, `airwallex.com`, etc.) — replies from kravemedia.co domains are intentionally excluded.
- Check the body/subject contains one of the trigger phrases (`payment is done`, `transfer details`, `remittance advice`, etc.). If a new phrasing surfaces, append it to the `PHRASES` array in the `Parse Client Replies` node.
- Check tracker has an open row whose `Client Email` domain matches the sender domain. Without a tracker hit and no inline `INV-...` regex, the email is silently skipped.

### Trigger invoice reminders manually

```bash
curl -s -X POST "https://noatakhel.app.n8n.cloud/webhook/krave-invoice-reminder" \
  -H "Content-Type: application/json" -d '{}'
```

### Trigger invoice reminder reply detection manually

```bash
curl -s -X POST "https://noatakhel.app.n8n.cloud/webhook/krave-invoice-reminder-reply-detection" \
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

### Trigger weekly invoice summary manually

```bash
curl -s -X POST "https://noatakhel.app.n8n.cloud/webhook/krave-weekly-invoice-summary" \
  -H "Content-Type: application/json" -d '{}'
```

### Payment matched but Airwallex not auto-marked (v7)

The Slack ✅ confirmation's `• Airwallex:` line says why: below the confidence gate, a verification mismatch (currency/amount/status), auth failure, or an API error. The Sheets row still shows `Payment Complete`. Resolution: verify the deposit against the invoice, then mark paid manually in Airwallex (or via `airwallex_mark_paid` MCP after human verification). If the line says "marked paid automatically", no action is needed.

### Missing client email in tracker

The reminder workflow posts a warning to `#payments-invoices-updates`. Add the client email to Col C and it will be picked up on the next run.

### Strategist name in Col K does not match the lookup table

The email still sends, but strategist CC is skipped and Slack includes a warning. Valid names are `Amanda`, `Jeneena`, `Sybil`, `Noa`, and `John`.

### EOD DM to Noa fails

The workflow retries once. If the retry also fails, it posts the formatted summary to `#ops-command` for manual sending.

### Run Halo intelligence report manually

Execute the workflow in n8n UI, or redeploy:
```bash
node n8n-workflows/deploy-halo-intelligence-report.js
```

### Redeploy workflows from scratch

```bash
node n8n-workflows/deploy-payment-detection.js
node n8n-workflows/deploy-invoice-reminder-cron.js
node n8n-workflows/deploy-weekly-invoice-summary.js
node n8n-workflows/deploy-invoice-request-intake.js
node n8n-workflows/deploy-invoice-approval-polling.js
node n8n-workflows/deploy-linkedin-resource-post-alert.js
node n8n-workflows/deploy-halo-intelligence-report.js
node n8n-workflows/deploy-halo-home-slack-bot.js
node n8n-workflows/deploy-halo-home-daily-digest.js
node n8n-workflows/deploy-halo-home-inventory-alert.js
node n8n-workflows/deploy-halo-home-weekly-report.js
```

Most current deploy scripts update the matching live workflow in place and then reactivate it. Older archived copies may still exist in n8n, so confirm the non-archived workflow ID before assuming a stale link is current.

---

## Workflow 11 — LinkedIn Resource Post Alert

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/Rw2VZ6sAzAhJteyJ`
**Deploy script:** `n8n-workflows/deploy-linkedin-resource-post-alert.js`

### Purpose
Polls ClickUp every 30 minutes during posting hours for resource-promo posts that Noa has just marked as `posted`. When one is detected, it sends a Slack alert to `#noa-linkedin-posts` with the trigger word to watch for in comments, the correct Kit sign-up link, and a pre-filled DM message ready to copy-paste. Replaces the need for John to manually check the LinkedIn post schedule.

### Triggers
| Type | Details |
|------|---------|
| Schedule | `0 0,30 8-13 * * 0-5` — every 30 min, 8AM–1PM PHT, Sun–Fri (no Saturday; mirrors Noa's posting schedule) |

### Node Flow
```
Every 30min 8AM-1PM PHT
  → Fetch Resource-Promo Tasks (ClickUp API GET /list/901818102123/task)
    → Filter Posted Resource Posts (Code: Stage=posted + map resource→trigger word)
      → Alert in #noa-linkedin-posts (Slack message)
```

### Detection Logic
- Queries ClickUp list `901818102123` (LinkedIn Post > Posts) for tasks with Post Type = `resource-promo` updated in the last 32 minutes
- Filters client-side for Stage custom field value = `3` (posted)
- Maps the Resource custom field orderindex to trigger word + Kit link:

| Resource orderindex | Trigger word | Kit link |
|---------------------|-------------|---------|
| 1 (hooks) | HOOKS | https://newsletter.kravemedia.co/r/hooks |
| 2 (persona) | PERSONA | https://newsletter.kravemedia.co/r/persona |
| 3 (automation) | AUTO | https://newsletter.kravemedia.co/r/automation |
| 4 (forensics) | AUDIT | https://newsletter.kravemedia.co/r/forensics |
| 5 (copy) | COPY | https://newsletter.kravemedia.co/r/copy |
| 6 (frameworks) | FRAMEWORKS | https://newsletter.kravemedia.co/r/frameworks |
| 7 (editing) | EDIT | https://newsletter.kravemedia.co/r/editing |

### Outputs
| Scenario | Action |
|----------|--------|
| Resource-promo post just marked `posted` | Slack alert to `#noa-linkedin-posts` with trigger word, Kit link, and pre-filled DM message |
| No new resource posts in the 32-min window | Workflow exits silently — no message sent |
| Post Type = `resource-promo` but Resource = `none` | Skipped — no alert |

### Error Handling
| Failure | Behaviour |
|---------|-----------|
| ClickUp API 401 | HTTP Request node fails — check ClickUp Header Auth credential is configured |
| ClickUp API returns empty tasks array | Code node returns 0 items — workflow exits silently |
| Slack send fails | n8n marks execution as error — check Slack bot token credential |

---

## Workflow 12 — Kit Subscriber Alert

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/dtrTee7qEgLdR9hQ`
**Deploy script:** `n8n-workflows/deploy-kit-subscriber-alert.js`

### Purpose
Receives a Kit (ConvertKit) webhook each time the `resource-claimed` tag is added to a new subscriber. Extracts the subscriber's name, email, and resource title, and posts a Slack alert to `#noa-linkedin-posts` so John knows who converted from a LinkedIn resource post.

### Triggers
| Type | Details |
|------|---------|
| Webhook | `POST https://noatakhel.app.n8n.cloud/webhook/krave-kit-subscriber` |

### Node Flow
```
Kit Subscriber Webhook → Resource Claimed? → Build Slack Message → Post to Slack
                                         ↓ (false)
                                        [end]
```

### Detection Logic
| Check | Value |
|-------|-------|
| Filter field | `body.event.tag.name` |
| Filter value | `resource-claimed` |
| Resource name source | `body.subscriber.fields.resource_title` |
| Name source | `body.subscriber.first_name` |
| Email source | `body.subscriber.email_address` |

### Outputs
| Scenario | Action |
|----------|--------|
| New subscriber with `resource-claimed` tag | Slack alert: `*New Kit subscriber* — [name] ([email]) just signed up for *[resource]*` |
| Tag add event for any other tag | If node short-circuits — no Slack message |

### Error Handling
| Failure | Behaviour |
|---------|-----------|
| Slack credential invalid | Execution fails at Post to Slack node |
| Kit sends malformed payload | Code node falls back to `Someone`, `(no email)`, `Unknown resource` defaults |

### Kit Webhook Setup (manual, one-time)
1. Go to `https://app.kit.com` → Settings → Webhooks → New Webhook
2. Event: `subscriber.tag_add`
3. Target URL: `https://noatakhel.app.n8n.cloud/webhook/krave-kit-subscriber`
4. Save — no tag-specific filtering needed, workflow handles it internally

---

## Workflow 13 — LinkedIn Post Consistency Check

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/220OeHs02nwJleCT`
**Deploy script:** `n8n-workflows/deploy-linkedin-post-consistency-check.js`

### Purpose
Runs every weekday at 10AM PHT and checks if any LinkedIn post was marked `posted` in ClickUp that day. If no post is found, sends a Slack alert to `#noa-linkedin-posts` so Noa knows she hasn't posted yet. Enforces daily posting consistency without manual tracking.

### Triggers
| Type | Details |
|------|---------|
| Schedule | `0 10 * * 1-5` — 10:00 AM PHT Mon–Fri |

### Node Flow
```
Schedule → Fetch ClickUp Tasks (posted today) → Any posted today? → [end]
                                                              ↓ (none found)
                                              Post Slack Alert → #noa-linkedin-posts
```

### Detection Logic
| Check | Value |
|-------|-------|
| ClickUp list | LinkedIn Post list (same as Workflow 11) |
| Filter | Stage field = `posted` AND date updated = today PHT |
| Credential | ClickUp Header Auth (same as Workflow 11) |

### Outputs
| Scenario | Action |
|----------|--------|
| At least one post marked posted today | No alert — all clear |
| No post marked posted today by 10AM | Slack alert to `#noa-linkedin-posts`: no post detected today |

### Error Handling
| Failure | Behaviour |
|---------|-----------|
| ClickUp credential missing/invalid | Execution fails at fetch node |
| Slack credential invalid | Execution fails at alert node |

---

## Workflow 14 — Weekly Resource Conversion Report

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/G39y9GgsrhnvC91C`
**Deploy script:** `n8n-workflows/deploy-weekly-resource-conversion-report.js`

### Purpose
Runs every Monday at 9AM PHT and fetches the last 7 days of Kit subscribers who were tagged `resource-claimed`. Groups them by resource title and posts a breakdown to `#noa-linkedin-posts` so John and Noa can see which LinkedIn resource posts drove the most conversions that week.

### Triggers
| Type | Details |
|------|---------|
| Schedule | `0 9 * * 1` — 9:00 AM PHT Mondays |

### Node Flow
```
Schedule → Fetch Kit Subscribers (last 7d, resource-claimed) → Group by Resource → Build Report → Post to #noa-linkedin-posts
```

### Key Logic
- Fetches subscribers via Kit API filtered by `resource-claimed` tag and `created_after` = 7 days ago
- Groups by `resource_title` custom field
- Posts ranked list: resource name → subscriber count

### Outputs
| Scenario | Action |
|----------|--------|
| Subscribers found | Slack post: ranked resource breakdown with counts |
| No subscribers in last 7d | Slack post noting zero conversions this week |

### Error Handling
| Failure | Behaviour |
|---------|-----------|
| Kit API credential missing | Execution fails at fetch node |
| Slack credential invalid | Execution fails at post node |

### Kit API Credential Setup (one-time)
1. Go to `https://app.kit.com` → Settings → Developer → API Secret
2. In n8n → Credentials → New → Header Auth
3. Name: `Kit API`, Header Name: `Authorization`, Header Value: `Bearer {api_secret}`

---

## Workflow 16 — Crave - Daily Lead Push

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/ke52OLrSUXk8mPVw`
**Deploy script:** `n8n-workflows/deploy-crave-lead-push.js`

### Purpose
Reads the Crave Creator Outreach Sheet every morning for rows where `status=approved` and `outreach_sent_at` is blank. Pushes them to Smartlead campaign 3375376 as leads. Marks each pushed row `outreach_queued` and writes `outreach_sent_at`. Replaces the need to run `python src/smartlead.py --push-leads` manually each day.

### Triggers
| Type | Details |
|------|---------|
| Schedule | `0 9 * * *` — 9:00 AM PHT daily |

### Node Flow
```
Schedule Trigger
  → Get Sheet Rows (Google Sheets — all rows)
  → Filter and Build (Code — filter approved+blank outreach_sent_at, build leads array + rowNumbers)
  → Push to Smartlead (HTTP POST /campaigns/3375376/leads)
  → Expand Row Updates (Code — explode rowNumbers back into per-row items)
  → Mark Outreach Queued (Google Sheets update — col O=outreach_queued, col Q=timestamp)
```

### Key Logic
- Code node filters `status=approved` AND `outreach_sent_at` blank AND `email` present
- If 0 approved leads: `Filter and Build` returns empty — downstream nodes do not execute
- Smartlead payload: `{lead_list, settings: {ignore_global_block_list: false, ignore_unsubscribe_list: true}}`
- Row updates match by `row_number` (n8n Google Sheets auto-field)
- `continueOnFail: true` on Smartlead HTTP node — Sheet update runs even if Smartlead returns partial error

### Outputs
| Scenario | Action |
|----------|--------|
| Approved leads found | Pushed to Smartlead; Sheet rows set to outreach_queued + outreach_sent_at timestamp |
| No approved leads | Workflow exits silently after Filter and Build (no items) |

### Error Handling
| Failure | Behaviour |
|---------|-----------|
| Smartlead API error | `continueOnFail` — Sheet still updated with outreach_queued status |
| Google Sheets credential expired | Execution fails at Get Sheet Rows |
| SMARTLEAD_API_KEY rotated | Redeploy script with updated key in local `.env` |

### Activation Note
Workflow is deployed **inactive**. Activate in the n8n UI on ~2026-06-12 when warm-up completes.

---

## Workflow 17 — Crave - Status Sync

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/uUGxA3GW1W0vq6el`
**Deploy script:** `n8n-workflows/deploy-crave-status-sync.js`

### Purpose
Pulls all leads from Smartlead campaign 3375376 every morning. Matches them to Sheet rows by email. Updates status, replied_at, bounced, and opened_at for leads whose status has changed in Smartlead. Skips rows already at terminal status (replied, bounced). Replaces the need to run `python src/smartlead.py --sync-status` manually.

### Triggers
| Type | Details |
|------|---------|
| Schedule | `0 9 * * *` — 9:00 AM PHT daily |

### Node Flow
```
Schedule Trigger
  → Get Smartlead Leads (HTTP GET /campaigns/3375376/leads?limit=500)
  → Aggregate Statuses (Code — collapse N lead items into 1 item: {statusMap: {email: lead_status}})
  → Get Sheet Rows (Google Sheets — all rows)
  → Build Updates (Code — join statusMap + sheet rows, emit one item per row needing update)
  → Update Sheet Row (Google Sheets update — status, replied_at, bounced, opened_at)
```

### Key Logic
- Smartlead returns array → n8n splits into N items (one per lead) → Aggregate collapses to 1 item
- `Build Updates` references `Aggregate Statuses` node via `$('Aggregate Statuses').first().json.statusMap`
- Status mapping: `REPLIED` → replied + replied_at; `BOUNCED/HARD_BOUNCED` → bounced + bounced=TRUE; `OPENED/CLICKED` → opened + opened_at (only if opened_at blank)
- Terminal check: rows already at `replied` or `bounced` are skipped
- If 0 rows need updating: `Build Updates` returns empty — Update Sheet Row does not execute

### Outputs
| Scenario | Action |
|----------|--------|
| Status changes found | Sheet rows updated with new status + timestamps |
| No changes | Workflow exits silently after Build Updates (no items) |

### Error Handling
| Failure | Behaviour |
|---------|-----------|
| Smartlead API unreachable | `continueOnFail` — Aggregate receives empty; Build Updates exits with no items |
| Google Sheets credential expired | Execution fails at Get Sheet Rows |
| SMARTLEAD_API_KEY rotated | Redeploy script with updated key in local `.env` |

### Activation Note
Workflow is deployed **inactive**. Activate in the n8n UI on ~2026-06-12 when warm-up completes.

---

## Workflow 20 — Halo - VA Slack Bot

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/XgHWMBeHoPWelE9r`
**Deploy script:** `n8n-workflows/deploy-halo-home-slack-bot.js`

### Purpose

Gives the Halo Home VA Shopify store access via Slack without needing admin credentials. VA @mentions the bot in #halo-home; the bot classifies intent, calls Shopify Admin REST API, and replies in thread within 3 seconds.

### Triggers

| Type | Details |
|------|---------|
| Webhook (Slack Event) | Slack `app_mention` event → `POST https://noatakhel.app.n8n.cloud/webhook/halo-home-bot` |

### Node Flow

```text
[Webhook — halo-home-bot (onReceived)]
  ↓
[Parse Event] — extract text, userId, channel, threadTs
  ↓
[Is App Mention?] — filter: event.type = app_mention
  ↓
[Classify Intent (Claude Haiku)] — returns JSON intent + params
  ↓
[Build Shopify URL] — maps intent → Shopify REST endpoint
  ↓
[Fetch Shopify Data] — GET /admin/api/2024-10/...
  ↓
[Format Response (Claude Haiku)] — formats data into clean Slack reply
  ↓
[Parse Response] — extract text from Claude response
  ↓
[Post Slack Reply] — reply in thread
```

### Intent Types Handled

`orders_today`, `orders_week`, `orders_month`, `order_lookup_email`, `order_lookup_number`, `order_status`, `unfulfilled_orders`, `draft_orders`, `abandoned_checkouts`, `discount_lookup`, `orders_by_discount`, `refill_due`, `compare_periods`, `inventory`, `product_availability`, `refunds`, `customer_history`, `subscriptions`, `subscription_charges_today`, `subscription_shipping_exceptions`, `order_by_sku`, `comped_orders`, `revenue_report`, `product_catalog`, `run_digest`, `run_inventory`, `general`

### Node Flow (current)

```text
[Webhook — halo-home-bot]
  ↓
[Parse Slack Event] — text, userId, channel, threadTs, challenge
  ↓
[Is URL Verification?] — handles Slack handshake
  ├─ true  → [Respond Challenge]
  └─ false → [Acknowledge Event] (200 immediately, <3s)
               ↓
             [Is App Mention?]
               ↓
             [Fetch Thread Context] — conversations.replies (continueOnFail)
               ↓
             [Build Thread Context] — aggregator Code node, $('Parse Slack Event') ref
               ↓
             [Classify Intent] — Anthropic Haiku HTTP Request
               ↓
             [Build Shopify URL] — aggregator Code node, maps intent → REST endpoint
               ↓
             [Fetch Shopify Data] — HTTP Request (continueOnFail)
               ↓
             [Build Claude Prompt] — aggregator Code node; pre-processes run_inventory, compare_periods, order_by_sku, orders_by_discount, subscription_charges_today & subscription_shipping_exceptions data
               ↓
             [Format Response] — Anthropic Haiku HTTP Request
               ↓
             [Extract Reply] — aggregator Code node, restores channel/threadTs
               ↓
             [Post Slack Reply] — chat.postMessage in thread
```

### Outputs

| Scenario | Action |
|----------|--------|
| Valid store query | Shopify data fetched, Claude-formatted reply posted in thread |
| `run_digest` | Fetches yesterday's orders, formats as daily digest |
| `run_inventory` | Fetches all products, pre-processes stock status, posts full inventory |
| `refill_due` | Fetches orders 75–105 days ago, filters by filter SKUs |
| `abandoned_checkouts` | Lists open checkout sessions |
| `discount_lookup` | Looks up code validity + usage count (does NOT list orders) |
| `orders_by_discount` | Lists orders that exact-matched a discount code + revenue (default 90-day window, override with date_from/date_to) |
| `order_by_sku` | Lists orders whose line items match a SKU or product name (default 30-day window) |
| `subscription_charges_today` | Lists subscription/Smart Refill orders charged in range (default today). Sub ID + next charge date come from Seal, not Shopify |
| `subscription_shipping_exceptions` | Flags subscription orders wrongly charged shipping — the $5 refund report (default 7-day window) |
| `compare_periods` | This-week vs last-week revenue/orders/AOV with % change |
| General question | Claude answers from catalog knowledge, no Shopify call |

### Error Handling

| Failure | Behaviour |
|---------|-----------|
| Shopify API fails | `onError: continueRegularOutput`; Claude formats with available data |
| Not an app_mention | If node filters it out, workflow exits silently |
| Slack url_verification | Responds with challenge immediately, does not continue pipeline |

### Pre-deploy Setup

1. Invite Halo AI bot to `#halo-home-shopify`
2. In Slack App settings: Enable Event Subscriptions → Request URL: `https://noatakhel.app.n8n.cloud/webhook/halo-home-bot`
3. Subscribe to bot event: `app_mention`
4. Set `HALO_HOME_SLACK_CHANNEL_ID=C0B6J5MUZCL` in `.env`

---

## Workflow 21 — Halo - Daily Digest

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/047cSNvFvUGHaf3O`
**Deploy script:** `n8n-workflows/deploy-halo-home-daily-digest.js`

### Purpose

Posts yesterday's Halo Home sales summary + current unfulfilled orders to `#halo-home-shopify` every morning at 10 AM PHT. Gives the VA and Noa/John a daily pulse without logging into Shopify.

### Triggers

| Type | Details |
|------|---------|
| Schedule | `0 10 * * *` (Asia/Manila) — 10:00 AM PHT daily |

### Node Flow

```text
[Schedule Trigger — 2 AM UTC / 10 AM PHT]
  ↓
[Build Date Range] — calculates yesterday + today in UTC+8
  ↓
[Fetch Yesterday Orders] — GET /orders.json?created_at range
  ↓
[Fetch Unfulfilled Orders] — GET /orders.json?fulfillment_status=unfulfilled&status=open
  ↓
[Combine Digest Data] — aggregator Code node, merges both responses + date
  ↓
[Format Digest (Claude Haiku)] — POST Anthropic API
  ↓
[Post to Slack] — #halo-home-shopify (C0B6J5MUZCL)
```

### Outputs

| Scenario | Action |
|----------|--------|
| Orders exist | Slack digest: revenue, count, AOV, top products, refunds, comped + unfulfilled count |
| Zero orders | "No orders yesterday." + unfulfilled section still shown |

### Error Handling

| Failure | Behaviour |
|---------|-----------|
| Shopify API fails | `onError: continueRegularOutput`; Claude formats with whatever data arrived |

---

## Workflow 22 — Krave — Creator Invoice Email Scan

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/DbIJYYQ3FE4HKprB`
**Deploy script:** `n8n-workflows/deploy-creator-invoice-email-scan.js`

### Purpose

Replaces the manual email-check step for creator/AP invoice intake. Scans john@kravemedia.co four times a day for unread emails with **PDF attachments only**, classifies + parses each with Claude Sonnet, guards against non-invoices and Airwallex/automated senders, validates bank details (hardstop if missing), **forwards the invoice PDF to the Airwallex bills inbox** (`kravemedia@bills.airwallex.com`), replies to the original sender (known senders only on the failure path), posts a prep report to `#ops-command`, and logs to the Creator & AP Bills Tracker (`14kiX9MnWyel_4_OxvL2TlnOAqBqFwwECf7Dm24znuJc`). This workflow does **not** call the Airwallex Spend API directly — bill creation happens on the Airwallex side from the forwarded email; John reviews/finalizes drafts there. **Migration note (2026-06-12):** the manual `/invoice-triage` path now creates bills via the Spend API directly (see `references/sops/creator-invoice-management.md`); Phase 2 will promote that logic into this workflow via an `httpCustomAuth` Spend credential. Until then this workflow stays forward-by-email.

> **2026-06-12 incident + guards:** the original version ingested inline images, treated any priced document as an invoice, and replied per attachment — it sent the "missing bank details" reply twice to a client lead whose proposal pricing screenshots matched the query (execution 8041; see `decisions/log.md`). The workflow was killed, reworked with four guards (PDF-only intake, explicit is-invoice classification with email context, per-message reply dedup, known-sender gate on the auto-reply with an #ops-command flag path for unknown senders), and reactivated the same day with John's approval.

### Triggers

| Type | Details |
|------|---------|
| Schedule | `0 9,12,15,18 * * 1-5` — 09:00, 12:00, 15:00, 18:00 PHT, Mon–Fri (Asia/Manila) |
| Webhook | `POST https://noatakhel.app.n8n.cloud/webhook/krave-creator-invoice-email-scan` |

### Node Flow

```text
[Schedule / Webhook Trigger]
  ↓
[Fetch Existing Bills] — HTTP GET Sheets values, range B:I — vendor names (allowlist) + column I messageIds (dedup)
  ↓
[Search Inbox] — Gmail getAll, is:unread has:attachment in:inbox (invoice|bill|creator|payment) filename:pdf, -from:airwallex.com
  ↓
[Get Message Details] — full payload per email
  ↓
[Extract PDF Attachments] — Code, splits into one item per PDF (PDF-ONLY — images excluded); SENDER BLOCKLIST drops Airwallex/no-reply/notifications/mailer-daemon (left untouched)
  ↓
[Dedup Filter] — Code, drops candidates whose messageId already has a row in the tracker (fail-open)
  ↓
[Download Attachment] — Gmail OAuth HTTP Request, returns base64url
  ↓
[Merge Attachment Data] — combines base64 + email context
  ↓
[Prepare Claude Request] — builds document API payload + email context (sender, subject)
  ↓
[Call Claude API] — claude-sonnet-4-6, CLASSIFIES (is_invoice + reason) then extracts invoice fields as JSON
  ↓
[Parse & Validate] — derives invoice number (MMDDYYYY-FLast), Friday due date, bank details check; isInvoice requires Claude's is_invoice === true
  ↓
[Is Invoice?]
  ├─ false → [Dedup Notice Per Message] → [Post Not-Invoice Notice] (→ #ops-command) → [Mark Read (not invoice)]
  └─ true  → [Has Bank Details?]
               ├─ false → [Dedup Reply Gate] (one item per message + senderKnown flag)
               │            → [Known Sender?]
               │                ├─ true  → [Reply Missing Bank Details] → [Mark Read (missing bank details)]
               │                └─ false → [Flag Unknown Sender to Ops] (→ #ops-command, NO email)
               │                           → [Log On Hold to Bills Tab] (status: On hold — missing bank details)
               │                           → [Mark Read (held)]
               └─ true  → [Build Forward Context] (builds Slack text + RFC822 MIME w/ PDF)
                          → [Forward PDF to Airwallex Email] (→ kravemedia@bills.airwallex.com)
                          → [Post Slack Prep Report] (→ #ops-command C0AQZGJDR38)
                          → [Reply Fallback] (→ sender: "Received. Staged for payment.")
                          → [Log to Bills Tab (pending)] (status: Forwarded via Email)
                          → [Mark Read (fallback)]
```

### Key Logic

- **Sender blocklist (NEVER reply to Airwallex):** Two layers. (1) `-from:airwallex.com` in the Search Inbox query keeps platform mail out of the pipeline (saves Claude calls). (2) `isBlockedSender()` in Extract PDF Attachments hard-drops any email from `airwallex.com` (+ subdomains), `no-reply`/`noreply`, `notifications@`, or `mailer-daemon`/`postmaster` — never parsed, replied to, forwarded, logged, or marked read; left untouched in the inbox. `kravemedia.co` is **not** blocked — strategists send/forward invoices and may use that domain.
- **PDF-only intake (2026-06-12 guard):** the Gmail query (`filename:pdf`) and the extractor both exclude images. Inline pricing screenshots on a client sales thread were the trigger for the 2026-06-12 misfire.
- **Is Invoice? guard (2026-06-12 guard):** Claude is asked to CLASSIFY first — `is_invoice` is true only for an actual invoice/bill issued TO Krave Media, judged with email context (sender, subject). Proposals, quotes, pricing pages, receipts, contracts, and Krave's own outbound invoices are explicitly not invoices. `isInvoice` requires Claude's `is_invoice === true` plus the name/amount sanity floor. A Claude parse failure fails safe to the not-invoice path. Nothing is skipped silently anymore: every not-invoice skip posts a one-line notice (with Claude's reason) to `#ops-command` before marking read.
- **Known-sender gate on the failure path (2026-06-12 guard):** the "missing bank details" auto-reply only goes to senders who are `@kravemedia.co` or whose name matches an existing vendor in the Bills tracker (column B, matched against parsed creator name or From name). Unknown senders get **no email** — the case is flagged to `#ops-command`, logged to the tracker as `On hold — missing bank details`, and marked read. Fail-safe: if the tracker read failed, every sender is treated as unknown.
- **Per-message replies (2026-06-12 guard):** `Dedup Reply Gate` and `Dedup Notice Per Message` collapse N failing attachments from one email into ONE reply/flag/notice. The incident's duplicate emails came from per-attachment replies.
- **Dedup (3 layers):** (1) `is:unread` search + mark-as-read at the end of every path. (2) **Tracker dedup** — `Fetch Existing Bills` reads range B:I of the tracker once at the top; `Dedup Filter` drops any candidate whose Gmail messageId already has a row (column I = index 7 in the range). The On-hold log row also feeds this, so held emails are never reprocessed. Fail-open: if the read errors, everything is processed. (3) Multiple PDFs in one email each get their own item but share the messageId (see limitation below).
- **Multiple PDFs per email:** Extract Attachments splits one email into N items (one per PDF). Each PDF is processed independently on the forward path. *Limitation:* tracker dedup keys on messageId only, so if a run forwards PDF A but fails before PDF B, a later run skips both (messageId already present). Mark-as-read mitigates in practice.
- **Invoice number:** Auto-generated as `MMDDYYYY-[FirstInitialLastName]` if missing.
- **Due date:** Defaults to Friday of current week (PHT) if not on invoice.
- **Bank details hardstop:** Known sender → reply asking to reissue; unknown sender → #ops-command flag + On-hold log. Either way: marked read, never forwarded.
- **Forward-by-email (not Spend API):** On a valid invoice, the PDF is rebuilt into an RFC822 MIME message and sent to `kravemedia@bills.airwallex.com`; a prep report goes to `#ops-command`; the sender gets a confirmation reply; a row is logged as "Forwarded via Email."

### Outputs

| Scenario | Action |
|----------|--------|
| Valid invoice with bank details | PDF forwarded to kravemedia@bills.airwallex.com, Slack prep report to #ops-command, confirmation reply to sender, logged to tracker as "Forwarded via Email", email marked read |
| Not an invoice (Claude classification) | One notice per email to #ops-command (with Claude's reason), email marked read — no reply, no forward, no tracker row |
| Missing bank details, KNOWN sender (@kravemedia.co or tracker vendor) | One reissue reply per email, marked read, not forwarded |
| Missing bank details, UNKNOWN sender | NO email sent — flagged to #ops-command, logged as "On hold — missing bank details", marked read |
| Blocked sender (Airwallex / no-reply / notifications / mailer-daemon) | Dropped at Extract — left untouched in inbox |
| Already in tracker (duplicate messageId) | Dropped at Dedup Filter — not reprocessed |
| No unread PDF emails | Workflow exits with 0 items, nothing happens |

### Error Handling

| Failure | Behaviour |
|---------|-----------|
| Tracker read (`Fetch Existing Bills`) fails | `continueOnFail` — Dedup Filter fails open (processes everything); Dedup Reply Gate fails SAFE (all senders treated unknown → flag path, no auto-reply) |
| Claude API fails | Parse & Validate gets empty response → `isInvoice` false → #ops-command notice + marked read, no reply |
| Forward to Airwallex email fails | `continueOnFail` — downstream Slack/reply/log/mark-read still run |
| Gmail reply fails | `continueOnFail` — mark read still runs |
| Sheets append fails | `continueOnFail` — email still marked read |

---

## Workflow 23 — Halo - Inventory Alert

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/NBvfYPmjdTXzrKfb`
**Deploy script:** `n8n-workflows/deploy-halo-home-inventory-alert.js`

### Purpose

Alerts `#halo-home-shopify` when Halo Home products go out of stock, come back in stock, or newly drop below 10 units. Runs daily at 9 AM PHT and only posts when something changes — no repeat noise for already-known states.

### Triggers

| Type | Details |
|------|---------|
| Schedule | `0 9 * * *` (Asia/Manila) — 9:00 AM PHT daily |

### Node Flow

```text
[Schedule Trigger — 1 AM UTC / 9 AM PHT]
  ↓
[Load OOS State] — reads workflow static data (persisted between runs)
  ↓
[Fetch Products] — HTTP Request: GET /products.json?limit=250 (not a Code node — sandbox fix)
  ↓
[Check Inventory] — Code node: compare DENY/qty vs saved state; detect OOS + low-stock changes
  ↓
[Has Changes?] — IF node: has_changes = true
  ↓ true                       ↓ false
[Build Message]           [Save OOS State]
  ↓
[Post to Slack] — #halo-home-shopify (C0B6J5MUZCL)
  ↓
[Save OOS State] — persist current state to workflow static data
```

### Key Logic

- OOS: `inventory_management = shopify` + `inventory_policy = deny` + `inventory_quantity <= 0`
- Low stock: `inventory_management = shopify` + not OOS + `inventory_quantity < 10`
- State keys: `oos_{variantId}` and `low_{variantId}` stored in workflow static data
- First run saves baseline; alerts only fire when state changes from the previous run

### Outputs

| Scenario | Action |
|----------|--------|
| New OOS detected | Posts `✗ [Product]` to #halo-home-shopify |
| Product back in stock | Posts `✓ [Product]` to #halo-home-shopify |
| Newly low stock (<10 units) | Posts `⚠ [Product] — X units left` to #halo-home-shopify |
| Back above threshold | Posts `✓ [Product] (restocked)` to #halo-home-shopify |
| No change | Silent — no Slack post |

### Error Handling

| Failure | Behaviour |
|---------|-----------|
| Shopify API fails | `onError: continueRegularOutput`; Save OOS State still runs if it receives input |
| Static data unavailable | `prevState` defaults to `{}` — first run is treated as baseline |

---

## Workflow 24 — Halo - Weekly Report

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/7N9gEZb7nDS0EDGu`
**Deploy script:** `n8n-workflows/deploy-halo-home-weekly-report.js`

### Purpose

Every Monday at 9 AM PHT, posts two proactive lists to `#halo-home-shopify`: (1) customers in the 75–105 day refill window (due to reorder filters), and (2) showerhead buyers in the last 14–120 days who never bought a filter in the same order (upsell gap). Replaces manual Shopify export and customer segmentation.

### Triggers

| Type | Details |
|------|---------|
| Schedule | `0 9 * * 1` (Asia/Manila) — 9:00 AM PHT every Monday |

### Node Flow

```text
[Schedule Trigger — 1 AM UTC Monday / 9 AM PHT]
  ↓
[Build Date Ranges] — Code node: calculates 75/105-day and 14/120-day windows in UTC+8
  ↓
[Fetch Refill Due Orders] — GET /orders.json?created_at 75–105 days ago
  ↓
[Fetch Showerhead Orders] — GET /orders.json?created_at 14–120 days ago
  ↓
[Build Report Data] — Code node: filters refill orders by filter SKUs; filters showerhead orders by showerhead SKU + no-filter-in-same-order
  ↓
[Format Report (Claude Haiku)] — POST Anthropic API
  ↓
[Post to Slack] — #halo-home-shopify (C0B6J5MUZCL)
```

### Key Logic

- **Refill due:** orders containing SKUs `SH-HR-HEADCALCIUM-NA-0013`, `SH-HR-HANDLEPP-NA-0011`, `SH-HR-HEADVITA-LAVENDER-0014`, `SH-HR-FILTERPLAN-0015` created 75–105 days ago
- **Upsell gap:** orders containing showerhead SKUs (`SH-HH-BrushedChrome-0009`, `SH-HH-MATTEBLACK-0010`) created 14–120 days ago where the same order had no filter SKU

### Outputs

| Scenario | Action |
|----------|--------|
| Refill-due customers found | Lists email, items, days since order, order # |
| Upsell gap found | Lists email, showerhead product, days ago, order # |
| Either section empty | Shows "none this week ✓" for that section |

### Error Handling

| Failure | Behaviour |
|---------|-----------|
| Shopify API fails | `onError: continueRegularOutput`; corresponding section shows empty data |
| No orders in window | Build Report Data returns empty arrays; Claude formats gracefully |

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
- [ ] Create a `Header Auth` credential in n8n named `ClickUp Header Auth` (Header Name: `Authorization`, Header Value: ClickUp API token from app.clickup.com/settings/account) before the LinkedIn Resource Post Alert workflow will run correctly
- [ ] Configure the Kit webhook (Kit → Settings → Webhooks → `subscriber.tag_add` → URL: `https://noatakhel.app.n8n.cloud/webhook/krave-kit-subscriber`) before the Kit Subscriber Alert workflow will receive events
- [ ] Ensure `APIFY_API_KEY` and `ANTHROPIC_API_KEY` are in local `.env` — the deploy script bakes them into the workflow nodes at deploy time (n8n Starter has no env-var support); rotate by redeploying
- [ ] Create the `Posts` tab in the Halo Intelligence Report Google Sheet (`1V_sjvMaCngWyB_5-ElMFdMetlsR2OdgD2QP42QQ5au4`) with the required columns before the first run
- [ ] Verify Apify actor IDs (`clockworks~tiktok-hashtag-scraper`, `apify~instagram-hashtag-scraper`) at apify.com/store
- [ ] Activate Crave - Daily Lead Push (workflow 16) and Crave - Status Sync (workflow 17) in n8n UI after warm-up completes (~2026-06-12) — both are deployed inactive
- [ ] After deploying crave workflows, set the returned WORKFLOW_ID in `deploy-crave-lead-push.js` and `deploy-crave-status-sync.js` for future redeploys
- [ ] Test by webhook after any workflow change
- [ ] **Halo Home:** Set `SHOPIFY_ACCESS_TOKEN` and `HALO_HOME_SLACK_CHANNEL_ID` in n8n environment variables before deploying any Halo workflows
- [ ] **Halo VA Bot:** Invite Krave Slack Bot to #halo-home; enable Slack app Event Subscriptions → `app_mention` → URL: `https://noatakhel.app.n8n.cloud/webhook/halo-home-bot`
- [ ] **Halo VA Bot:** After deploy, set `HALO_HOME_SLACK_BOT_WORKFLOW_ID` in deploy script env for future redeploys
- [ ] **Halo Digest:** After deploy, set `HALO_HOME_DAILY_DIGEST_WORKFLOW_ID` in deploy script env for future redeploys
- [ ] **Halo Inventory Alert:** After deploy, set `HALO_HOME_INVENTORY_ALERT_WORKFLOW_ID` in deploy script env for future redeploys; first run establishes baseline OOS state (no alert), second run onward alerts on changes
- [ ] **Halo Weekly Report:** After deploy, set `HALO_HOME_WEEKLY_REPORT_WORKFLOW_ID=7N9gEZb7nDS0EDGu` in `.env`; requires `HALO_HOME_BOT_TOKEN`, `SHOPIFY_ACCESS_TOKEN`, `ANTHROPIC_API_KEY`, `HALO_HOME_SLACK_CHANNEL_ID`
- [ ] **Halo Chatbot (Render):** Deploy `projects/halo-home-chat/` to Render → set env vars `SHOPIFY_ACCESS_TOKEN`, `MYSHOPIFY_DOMAIN`, `ANTHROPIC_API_KEY`; update `BACKEND_URL` in `widget.js` with the live Render URL
- [ ] **Halo Chatbot (Widget):** Inject `widget.js` into Shopify theme → Online Store → Themes → Edit code → `layout/theme.liquid` → add `<script src="...">` before `</body>`
