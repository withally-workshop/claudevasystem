# n8n Workflows

Automated workflows running on n8n Cloud (`noatakhel.app.n8n.cloud`).

## Workflows

| Workflow | Status | Schedule | File |
|----------|--------|----------|------|
| Payment Detection | Active | Every hour | [deploy-payment-detection.js](deploy-payment-detection.js) |
| Invoice Reminder Cron | Active | 10am PHT Mon–Fri | [deploy-invoice-reminder-cron.js](deploy-invoice-reminder-cron.js) |
| Weekly Invoice Summary | Active | 9am PHT Mondays | [deploy-weekly-invoice-summary.js](deploy-weekly-invoice-summary.js) |
| Invoice Reminder Reply Detection | Active | 10:30am PHT weekdays + manual webhook | [deploy-invoice-reminder-reply-detection.js](deploy-invoice-reminder-reply-detection.js) |
| Inbox Triage Daily v2 | Active | 9am PHT weekdays + manual webhook | [deploy-inbox-triage-daily.js](deploy-inbox-triage-daily.js) |
| Slack Invoice Handler | Active | Slack slash command + modal submit | [deploy-slack-invoice-handler.js](deploy-slack-invoice-handler.js) |
| Invoice Request Intake | Active | Slack modal / manual trigger | [deploy-invoice-request-intake.js](deploy-invoice-request-intake.js) |
| Invoice Approval Polling | Active | Every 2 hrs Mon-Fri 9am-5pm PHT + manual webhook | [deploy-invoice-approval-polling.js](deploy-invoice-approval-polling.js) |
| Price Reply Auto-Resubmit | Active | Event-driven — `POST /webhook/krave-price-reply-resubmit` (no schedule; krave-bot forwards #payments-invoices-updates messages) | [deploy-price-reply-auto-resubmit.js](deploy-price-reply-auto-resubmit.js) |
| Client Invoice Creation | Inactive legacy | Do not use for approval finalization | [deploy-client-invoice-creation.js](deploy-client-invoice-creation.js) |
| LinkedIn Resource Post Alert | Active | Every 30min 8AM–1PM PHT Sun–Fri | [deploy-linkedin-resource-post-alert.js](deploy-linkedin-resource-post-alert.js) |
| Kit Subscriber Alert | Active | Kit webhook (subscriber.tag_add) | [deploy-kit-subscriber-alert.js](deploy-kit-subscriber-alert.js) |
| LinkedIn Post Consistency Check | Active | 10AM PHT Mon–Fri | [deploy-linkedin-post-consistency-check.js](deploy-linkedin-post-consistency-check.js) |
| Weekly Resource Conversion Report | Active | 9AM PHT Mondays | [deploy-weekly-resource-conversion-report.js](deploy-weekly-resource-conversion-report.js) |
| Halo Weekly Intelligence Report | Active | 7AM PHT Mondays | [deploy-halo-intelligence-report.js](deploy-halo-intelligence-report.js) |
| Crave - Daily Lead Push | Inactive (warm-up) | 9AM PHT daily | [deploy-crave-lead-push.js](deploy-crave-lead-push.js) |
| Crave - Status Sync | Inactive (warm-up) | 9AM PHT daily | [deploy-crave-status-sync.js](deploy-crave-status-sync.js) |
| LinkedIn Post Monitor | Inactive (needs actor verification) | Every 30min all day | [deploy-linkedin-post-monitor.js](deploy-linkedin-post-monitor.js) |
| Halo - VA Slack Bot | Active | Slack `app_mention` in #halo-home-shopify | [deploy-halo-home-slack-bot.js](deploy-halo-home-slack-bot.js) |
| Halo - Daily Digest | Active | 10 AM PHT daily (Asia/Manila) | [deploy-halo-home-daily-digest.js](deploy-halo-home-daily-digest.js) |
| Halo - Inventory Alert | Active | 9 AM PHT daily (Asia/Manila) | [deploy-halo-home-inventory-alert.js](deploy-halo-home-inventory-alert.js) |
| Halo - Weekly Report | Active | 9 AM PHT Mondays (Asia/Manila) | [deploy-halo-home-weekly-report.js](deploy-halo-home-weekly-report.js) |
| Krave — Creator Invoice Email Scan | `DbIJYYQ3FE4HKprB` | 09:00/12:00/15:00/18:00 PHT Mon–Fri + webhook | [deploy-creator-invoice-email-scan.js](deploy-creator-invoice-email-scan.js) |

---

## Halo Weekly Intelligence Report

Weekly social intelligence pipeline for Halo Home's US market entry. Scrapes TikTok and Instagram for top-performing content in Halo's niche hashtag clusters (sensitive skin, hair loss, hard water, clean beauty), scores and ranks posts by engagement × ICP relevance, analyzes with Claude, and delivers a structured report.

**Workflow ID:** `5ZqTSaUEtxnAndiY`
**Schedule:** Every Monday 7:00 AM PHT (Asia/Manila)

**Deploy:**
```bash
node n8n-workflows/deploy-halo-intelligence-report.js
```

**Credentials required:**
- `Google Sheets account` — `83MQOm78gYDvziTO` — writes to Halo Intelligence Report sheet
- `Krave Slack Bot` — `Bn2U6Cwe1wdiCXzD` — posts to `C0A22NPLV38`
- `Gmail account (john)` — `vsDW3WpKXqS9HUs3` — sends email report
- `APIFY_API_KEY` — set in n8n environment variables
- `ANTHROPIC_API_KEY` — set in n8n environment variables

**Google Sheet:** `1V_sjvMaCngWyB_5-ElMFdMetlsR2OdgD2QP42QQ5au4` — `Posts` tab columns: Week | Platform | Creator | Post URL | Likes | Views | Saves | Shares | Engagement Rate (%) | ICP Group | Content Pillar | Hook (0–3s) | Why It Works | ICP Match Detail | Halo Adaptation | Keyword | Format | Visual Style | Hook Type | CTA / Ending | Score (aligned to Alleah's manual inspo sheet format). Linked into the "Halo Post Inspiration Library" table of the Ideas & Moodboard Slack canvas (`F0A2ATP4D5L`).

**Email recipients:** shin@, noa@, john@kravemedia.co, alleahvargas@gmail.com, basteperez021198@gmail.com (Baste — ads inspo)

---

## Crave - Daily Lead Push

Reads the Crave Creator Outreach Sheet for rows where `status=approved` and `outreach_sent_at` is blank. Pushes them to Smartlead campaign 3375376. Marks pushed rows as `outreach_queued` + writes `outreach_sent_at`.

**Workflow ID:** `ke52OLrSUXk8mPVw`
**Schedule:** 9AM PHT daily
**Status:** Inactive — activate after warm-up completes (~2026-06-12)

**Deploy:**
```bash
node n8n-workflows/deploy-crave-lead-push.js
```

**Credentials required:**
- `Google Sheets account` — `83MQOm78gYDvziTO` — Crave Creator Outreach sheet
- `SMARTLEAD_API_KEY` — baked in at deploy time from local `.env`

**Sheet:** `1eLQrDP3IX9ec9dtFN0UyRdlTplzkLfRG9Asyqj1gLrI`

---

## Crave - Status Sync

Pulls all leads from Smartlead campaign 3375376. Matches to Sheet rows by email. Writes back status, timestamps for opens/replies/bounces. Skips rows already at terminal status (replied, bounced).

**Workflow ID:** `uUGxA3GW1W0vq6el`
**Schedule:** 9AM PHT daily
**Status:** Inactive — activate after warm-up completes (~2026-06-12)

**Deploy:**
```bash
node n8n-workflows/deploy-crave-status-sync.js
```

**Credentials required:**
- `Google Sheets account` — `83MQOm78gYDvziTO` — Crave Creator Outreach sheet
- `SMARTLEAD_API_KEY` — baked in at deploy time from local `.env`

---

## Payment Detection

Runs two parallel detection paths every hour: (1) scans `noa@kravemedia.co` for Airwallex deposit notifications + John's forwarded receipts, and (2) polls the Airwallex invoice API directly for SWIFT/bank-transfer payments. Uses **strict matching** — invoice number OR (amount + currency + client name fuzzy match). Anything with payment signal but no high-confidence match routes to a `needs review` Slack alert instead of writing the tracker. Cross-run idempotency via `processedEmailIds` (last 500) prevents re-processing.

**Does NOT mark invoices paid in Airwallex.** That step was removed in May 2026 after an incident where the matcher mistakenly auto-marked a wrong invoice paid in Airwallex (which has no unpay API). Tracker is now the single source of truth that the workflow writes to. Partial payments set Col J `Partial Payment` and update Col Q; full payments set Col J `Payment Complete`. Column N is formula-only.

**Workflow ID:** `NurOLZkg3J6rur5Q`

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

Scans the Client Invoice Tracker Mon–Fri at 9am PHT, sends reminder emails from `john@kravemedia.co`, tags the correct strategist plus Amanda in `#payments-invoices-updates` for overdue states, and updates the tracker. **Payout-term-aware (tightened May 2026):** 30d/15d invoices get 7d/3d/due-today reminders; 7d invoices get 3d/due-today only. Posts a daily digest at the end of every run.

Also writes latest reminder attribution metadata to the tracker: `Last Follow-Up Sent`, `Last Follow-Up Type`, and `Last Follow-Up Thread ID`. The thread ID is blank unless Gmail returns a real thread key. Column L remains the historical reminder log.

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

## Weekly Invoice Summary

Posts a full portfolio snapshot to #payments-invoices-updates every Monday at 9 AM PHT. Reads all open invoices from the tracker and categorises them into action buckets: Collections, Late Fee Applied, Overdue Needs Chase, Due This Week, and Pending Upcoming. Gives Noa a weekly "who to chase" list without digging through the tracker.

**Workflow ID:** `WX1hHek0cNTyZXkS`

**Webhook (manual trigger):**
```text
POST https://noatakhel.app.n8n.cloud/webhook/krave-weekly-invoice-summary
```

**Deploy from scratch:**
```bash
node n8n-workflows/deploy-weekly-invoice-summary.js
```

**Credentials required in n8n:**
- `Google Sheets account` - access to Client Invoice Tracker
- `Krave Slack Bot` - bot token for `#payments-invoices-updates`

---

## Invoice Reminder Reply Detection

**Workflow ID:** `omNFmRcDeiByLOzS`

Reads the Client Invoice Tracker attribution columns, scans only `john@kravemedia.co` Gmail for replies from client email addresses after the latest tracked follow-up, classifies replies conservatively, and writes reply attribution back to the tracker.

**John-only scope:** this workflow does not monitor Noa or strategist inboxes and does not infer client replies from Slack.

**No auto-response:** this workflow never sends emails, creates drafts, or posts Slack messages.

**Reply statuses:** `No Reply Found`, `Possible Reply`, `Replied`, `Promise to Pay`, `Question/Dispute`, and `Needs Human`.

**Reply confidence:** `Confirmed` when a real reminder thread match is available, `Likely` when the client emailed John after the follow-up, and `Unconfirmed` when no matching John Gmail reply is found.

**Webhook (manual trigger):**
```text
POST https://noatakhel.app.n8n.cloud/webhook/krave-invoice-reminder-reply-detection
```

**Deploy from scratch:**
```bash
node n8n-workflows/deploy-invoice-reminder-reply-detection.js
```

**Credentials required in n8n:**
- `Gmail account` - `john@kravemedia.co` OAuth2
- `Google Sheets account` - access to Client Invoice Tracker

---

## Inbox Triage Daily

Reads inbox email from the last 24 hours in `noa@kravemedia.co`, classifies each message into the `EA/*` tier model, creates Gmail drafts for `EA/Urgent` and `EA/Needs-Reply` only when the thread is not already in motion, repairs Gmail labels when needed, leaves `EA/Unsure` in the inbox, and posts the final summary to both `#ops-command` and Noa's Slack DM.

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
- `Krave Slack Bot` - summary posts to `#ops-command` plus Noa DM delivery
- `OpenAI account` - classification and reply drafting

---

## Invoice Request Intake

**Workflow ID:** `5XHxhQ7wB2rxE3qz`

Accepts invoice requests from a **Structured Slack modal**, normalizes the submission, attempts full Airwallex draft invoice creation, writes the result into the existing Invoices sheet structure in the Client Invoice Tracker, and falls back to a manual-ready row plus John DM alert if any Airwallex step fails.

**Draft-only behavior:** v1 stops after the Airwallex `draft invoice created` state. It does not auto-finalize or auto-send.

**Airwallex customer resolution:** intake uses email-first customer reuse. If `Email` is present, it looks up an existing Airwallex billing customer by exact email before considering the submitted company/client name. It only falls back to name matching when no email match is found, and only creates a new billing customer when neither lookup resolves.

**Tracker write behavior:** intake reuses the existing Invoices sheet structure and documented Invoices tab columns such as `Client Name`, `Email Address`, `Invoice #`, `Airwallex Invoice ID`, `Amount`, `Currency`, `Due Date`, `Payment Status`, `Requested By`, and `Origin Thread TS`. Column E `Invoice #` stores the Airwallex invoice number from the `number` field, while Column F stores the Airwallex invoice ID from the `id` field. Column P `Origin Thread TS` is written as text so Slack timestamps keep their decimal portion. Successful drafts land with Payment Status `Draft - Pending John Review`, and the draft confirmation replies in the original receipt thread when `Origin Thread TS` is present.

**Slack posting identity:** Slack invoice receipts, draft confirmations, John approval notifications, and approval-finalized notifications are sent by the `Krave Slack Bot` n8n credential. Do not use a user-profile Slack connector for operational corrections; route corrections through the bot/n8n path when a bot-authored audit trail is required.

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

## Invoice Approval Polling

**Workflow ID:** `uCS9lzHtVKWlqYlk`

**Current live state:** deployed and active as of 2026-04-30. This is the only active approval/finalization workflow.

Polls the tracker for rows where Col J `Payment Status` is `Draft - Pending John Review`, scans John's approval channel for approve replies, finalizes the Airwallex draft, refreshes Col E `Invoice #` from the finalized Airwallex `number`, matches tracker updates by stable Col F `Airwallex Invoice ID`, writes Col J `Payment Status = Invoice Sent`, writes Col R `Invoice URL`, and replies in the original `#payments-invoices-updates` receipt thread from Col P `Origin Thread TS` when present. Threaded Slack replies use Slack Web API `chat.postMessage` with explicit `thread_ts`.

**ClickUp sync:** John can include a ClickUp task URL in his approval reply (`approve https://app.clickup.com/t/XXXXXXXXX`). If present, the workflow updates the UGC task status to `collections`, writes Invoice Sent + Due dates to the task, and stores the task ID in tracker Col U. Optional — `approve` alone still works. All ClickUp steps are `continueOnFail: true`.

**Manual trigger:**
```text
POST https://noatakhel.app.n8n.cloud/webhook/krave-invoice-approval-polling
```

**Legacy deprecation:** `Krave — Client Invoice Creation` (`9eqWz6oJI5dqBesa`) is inactive live. Do not use `krave-client-invoice-creation` for finalization unless intentionally rolling back.

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

## Halo - VA Slack Bot

VA-facing Shopify ops bot for `#halo-home-shopify`. VA @mentions the bot to query orders, inventory, refunds, revenue, fulfillment, drafts, abandoned checkouts, discount codes, refill due list, order search by SKU/product, orders by discount code, week-vs-week comparison, subscription charges, and a subscription shipping-fee exception report (the $5 refund flag). Claude Haiku classifies intent → Shopify REST API → formatted thread reply.

**Workflow ID:** `XgHWMBeHoPWelE9r`
**Webhook:** `POST https://noatakhel.app.n8n.cloud/webhook/halo-home-bot`
**Channel:** `#halo-home-shopify` (`C0B6J5MUZCL`)

**Deploy:**
```bash
node n8n-workflows/deploy-halo-home-slack-bot.js
```

**Credentials required:** `HALO_HOME_BOT_TOKEN`, `SHOPIFY_ACCESS_TOKEN`, `ANTHROPIC_API_KEY`, `HALO_HOME_SLACK_CHANNEL_ID`

---

## Halo - Daily Digest

Posts yesterday's Halo Home revenue + unfulfilled orders to `#halo-home-shopify` every morning at 10 AM PHT.

**Workflow ID:** `047cSNvFvUGHaf3O`
**Schedule:** `0 10 * * *` Asia/Manila (10 AM PHT)

**Deploy:**
```bash
node n8n-workflows/deploy-halo-home-daily-digest.js
```

**Credentials required:** `HALO_HOME_BOT_TOKEN`, `SHOPIFY_ACCESS_TOKEN`, `ANTHROPIC_API_KEY`, `HALO_HOME_SLACK_CHANNEL_ID`

---

## Halo - Inventory Alert

Detects when Halo Home products go OOS, come back in stock, or newly drop below 10 units. Only posts to `#halo-home-shopify` when something changes.

**Workflow ID:** `NBvfYPmjdTXzrKfb`
**Schedule:** `0 9 * * *` Asia/Manila (9 AM PHT)

**Note:** First run establishes baseline state (no alert). Alerts fire from second run onward.

**Deploy:**
```bash
node n8n-workflows/deploy-halo-home-inventory-alert.js
```

**Credentials required:** `HALO_HOME_BOT_TOKEN`, `SHOPIFY_ACCESS_TOKEN`, `HALO_HOME_SLACK_CHANNEL_ID`

---

## Halo - Weekly Report

Posts refill due list + upsell gap to `#halo-home-shopify` every Monday at 9 AM PHT.

**Workflow ID:** `7N9gEZb7nDS0EDGu`
**Schedule:** `0 9 * * 1` Asia/Manila (9 AM PHT Mondays)

**Deploy:**
```bash
node n8n-workflows/deploy-halo-home-weekly-report.js
```

**Credentials required:** `HALO_HOME_BOT_TOKEN`, `SHOPIFY_ACCESS_TOKEN`, `ANTHROPIC_API_KEY`, `HALO_HOME_SLACK_CHANNEL_ID`

---

## Adding a new workflow

1. Build it in n8n
2. Export JSON: `curl -s https://noatakhel.app.n8n.cloud/api/v1/workflows/{id} -H "X-N8N-API-KEY: ..." > n8n-workflows/name.workflow.json`
3. Add a deploy script if needed
4. Add a row to the table above

## LinkedIn Resource Post Alert

Polls ClickUp every 30 minutes (8AM–1PM PHT, Sun–Fri) for resource-promo posts that Noa has just marked as `posted`. Sends a Slack alert to `#noa-linkedin-posts` with the trigger word, Kit sign-up link, and a pre-filled DM message for John to send manually.

**Workflow ID:** `Rw2VZ6sAzAhJteyJ`

**Deploy / activate:**
```bash
node n8n-workflows/deploy-linkedin-resource-post-alert.js
```

**Credentials required in n8n:**
- `Slack API` — bot token (`Bn2U6Cwe1wdiCXzD`)
- `ClickUp Header Auth` — Header Auth credential (Header Name: `Authorization`, Header Value: ClickUp API token). **Must be created manually before activating.**

---

## Kit Subscriber Alert

Receives a Kit `subscriber.tag_add` webhook, filters for the `resource-claimed` tag, and posts a Slack alert to `#noa-linkedin-posts` with the subscriber's name, email, and which Krave resource they signed up for.

**Workflow ID:** `dtrTee7qEgLdR9hQ`

**Webhook URL:**
```text
POST https://noatakhel.app.n8n.cloud/webhook/krave-kit-subscriber
```

**Deploy / activate:**
```bash
node n8n-workflows/deploy-kit-subscriber-alert.js
```

**Kit webhook setup (one-time manual step):**
Kit → Settings → Webhooks → New Webhook → Event: `subscriber.tag_add` → URL: `https://noatakhel.app.n8n.cloud/webhook/krave-kit-subscriber`

**Credentials required in n8n:**
- `Slack API` — bot token (`Bn2U6Cwe1wdiCXzD`)

---

## LinkedIn Post Consistency Check

Runs every weekday at 10AM PHT and checks ClickUp for any post marked `posted` that day. If none found, sends a Slack alert to `#noa-linkedin-posts` to flag the missed post.

**Workflow ID:** `220OeHs02nwJleCT`

**Deploy / activate:**
```bash
node n8n-workflows/deploy-linkedin-post-consistency-check.js
```

**Credentials required in n8n:**
- `ClickUp Header Auth` — Header Auth credential (same as LinkedIn Resource Post Alert)
- `Slack API` — bot token (`Bn2U6Cwe1wdiCXzD`)

---

## Weekly Resource Conversion Report

Runs every Monday at 9AM PHT. Fetches last 7 days of Kit subscribers tagged `resource-claimed`, groups by resource title, and posts a ranked breakdown to `#noa-linkedin-posts`.

**Workflow ID:** `G39y9GgsrhnvC91C`

**Deploy / activate:**
```bash
node n8n-workflows/deploy-weekly-resource-conversion-report.js
```

**Credentials required in n8n:**
- `Kit API` — Header Auth: `Authorization: Bearer {kit_api_secret}` (from app.kit.com → Settings → Developer)
- `Slack API` — bot token (`Bn2U6Cwe1wdiCXzD`)
