# Krave Media — n8n Automation Workflows
**Instance:** `noatakhel.app.n8n.cloud`
**Last updated:** 2026-04-20
**Maintained by:** John (Systems Partner) — john@kravemedia.co

---

## Table of Contents
1. [Workflow Index](#workflow-index)
2. [Shared Infrastructure](#shared-infrastructure)
3. [Workflow 1 — Payment Detection](#workflow-1--payment-detection)
4. [Workflow 2 — Invoice Reminder Cron](#workflow-2--invoice-reminder-cron)
5. [Credential Reference](#credential-reference)
6. [Runbook — Common Scenarios](#runbook--common-scenarios)
7. [Handover Checklist](#handover-checklist)

---

## Workflow Index

| # | Name | ID | Status | Schedule | Purpose |
|---|------|----|--------|----------|---------|
| 1 | Krave — Payment Detection | `grsXd1VCVIL2F8Cv` | ✅ Active | 10am + 5pm ICT | Detect Airwallex deposits → match invoices → update tracker |
| 2 | Krave — Invoice Reminder Cron | `QvHzslWExLjrH0mo` | ✅ Active | 10am ICT | Send invoice reminders → alert overdue → update tracker |

---

## Shared Infrastructure

### Data Sources
| Resource | Type | ID / Location | Access |
|----------|------|---------------|--------|
| Client Invoice Tracker | Google Sheets | `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50` | Tab: `Invoices` |
| Slack channel | #payments-invoices-updates | `C09HN2EBPR7` | Bot posts only |
| Gmail inbox (scan) | noa@kravemedia.co | OAuth2 | Read only (payment detection) |
| Gmail inbox (send) | john@kravemedia.co | OAuth2 | Send + CC |

### Invoice Tracker Column Map
| Col | Header | Used By |
|-----|--------|---------|
| A | Date Created | — |
| B | Client Name | Both workflows |
| C | Email Address | Reminder Cron (send to) |
| D | Project Description | — |
| E | Invoice # | Both workflows (match key) |
| F | Airwallex Invoice ID | Payment Detection (mark paid) |
| G | Amount | Both workflows |
| H | Currency | Both workflows |
| I | Due Date | Reminder Cron (days_diff calc) |
| J | Status | Both workflows (read + write) |
| K | Requested By | Reminder Cron (strategist CC + tag) |
| L | Reminders Sent | Reminder Cron (dedup log) |
| M | Payment Confirmed Date | Payment Detection (write) |
| N | Status Display | Formula-driven — **never write** |

### Status Value Reference
| Value | Set By | Meaning |
|-------|--------|---------|
| `Invoice Sent` | Manual / invoice creation skill | Invoice delivered to client |
| `Draft — Pending John Review` | Invoice creation skill | Not sent yet — skip reminders |
| `Payment Complete` | Payment Detection | Deposit matched and confirmed |
| `Late Fee Applied — YYYY-MM-DD` | Reminder Cron | 7+ days overdue, fee logged |
| `Collections` | Reminder Cron | 60+ days overdue, escalated |

---

## Workflow 1 — Payment Detection

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/grsXd1VCVIL2F8Cv`
**Deploy script:** `n8n-workflows/deploy-payment-detection.js`

### Purpose
Replaces the manual daily task of checking whether clients have paid. Scans noa@kravemedia.co for Airwallex deposit notification emails, matches each deposit to an open invoice in the tracker, marks the invoice as paid in both Google Sheets and Airwallex, and posts a confirmation to Slack.

### Triggers
| Type | Details |
|------|---------|
| Schedule | `0 3,10 * * *` — 10:00 AM + 5:00 PM ICT (03:00 + 10:00 UTC) |
| Webhook | `POST https://noatakhel.app.n8n.cloud/webhook/krave-payment-detection` |

### Node Flow
```
[Schedule / Webhook]
        ↓
[Search Airwallex Emails]     Gmail — scans noa@ for Airwallex deposit emails (last 2 days)
        ↓
[Parse All Emails]            Code — extracts amount, currency, invoice # from each email body
        ↓                     Shopify filter: skip if contains "shopify", "shop_", "payout", or non-round amount
[Get Invoice Tracker]         Google Sheets — reads all rows from Invoices tab
        ↓
[Match Deposits To Invoices]  Code — matches by Invoice # first, then by exact amount + currency
        ↓
[Match Found?]                IF — routes matched vs unmatched
        ↓ TRUE                ↓ FALSE
[Airwallex Auth]              [Slack Alert]   Posts to #payments-invoices-updates (silent if no emails found)
        ↓
[Airwallex Mark Paid]         HTTP POST /api/v1/invoices/{id}/mark_as_paid
        ↓
[Update Invoice Status]       Sheets — Col J → "Payment Complete", Col M → today's date
        ↓
[Slack Payment Confirmed]     Posts confirmed payment summary to #payments-invoices-updates
```

### Matching Logic (Priority Order)
1. **High confidence** — Invoice # found in email body matches Col E exactly
2. **Medium confidence** — Amount + currency matches exactly one open invoice
3. **Ambiguous** — Amount matches multiple invoices → skipped, no Slack alert
4. **No match** — Silently skipped (no Slack noise)

### Shopify Filter (3-layer)
Emails are skipped if they contain: `shopify`, `shop_`, or `payout` in subject/body, OR if the deposit amount has non-zero cents (Shopify payouts are irregular amounts).

### Outputs
| Outcome | Action |
|---------|--------|
| Match found | Sheets updated + Airwallex marked paid + Slack confirmed |
| No emails found | Silent (no Slack post) |
| Unmatched deposit | Silent (no Slack post) |
| Shopify email | Skipped silently |

### Error Handling
| Failure | Behaviour |
|---------|-----------|
| Airwallex Auth fails | `continueOnFail: true` — still updates Sheets + posts Slack |
| Airwallex Mark Paid fails | `continueOnFail: true` — Sheets still updated |
| Gmail auth error | Workflow errors — n8n sends failure email to instance owner |

---

## Workflow 2 — Invoice Reminder Cron

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/QvHzslWExLjrH0mo`
**Deploy script:** `n8n-workflows/deploy-invoice-reminder-cron.js`

### Purpose
Replaces all manual invoice follow-up. Once daily, scans every open invoice in the tracker, calculates days until/since due date, sends tiered reminder emails from john@kravemedia.co with the assigned strategist and Noa on CC, updates the tracker, and posts Slack alerts for overdue and escalated invoices — completely silent when nothing needs action.

### Triggers
| Type | Details |
|------|---------|
| Schedule | `0 3 * * *` — 10:00 AM ICT (03:00 UTC) daily |
| Webhook | `POST https://noatakhel.app.n8n.cloud/webhook/krave-invoice-reminder` |

### Node Flow
```
[Schedule / Webhook]
        ↓
[Get Invoice Tracker]         Google Sheets — reads all rows from Invoices tab
        ↓
[Process Invoices]            Code — filters, classifies, deduplicates all actionable invoices
        ↓                     Returns 0 items → workflow exits silently
        ↓                     Returns N items → one item per action needed
[Has Client Email?]           IF — routes by whether Col C (Email Address) is populated
        ↓ TRUE                ↓ FALSE
[Send Reminder Email]         [Slack Missing Email Warning]   Posts ⚠️ to channel
        ↓
[Update Tracker Row]          Sheets — Col J (Status) + Col L (Reminders Sent) appended
        ↓
[Needs Slack Alert?]          IF — only overdue / late-fee / collections trigger Slack
        ↓ TRUE
[Slack Overdue Alert]         Posts to #payments-invoices-updates, tags strategist + Amanda
```

### Reminder Schedule
| Days Until/Since Due | Trigger | Email Type | Slack Alert |
|---------------------|---------|-----------|-------------|
| +7 | Pre-due | Payment Reminder | No |
| +5 | Pre-due | Payment Reminder | No |
| +3 | Pre-due | Payment Reminder | No |
| +1 | Pre-due | Payment Reminder | No |
| 0 | Due today | Invoice Due Today | Yes — tags strategist + Amanda |
| -1 to -6 | Overdue | Overdue Invoice | Yes — tags strategist + Amanda |
| -7 | Late fee | Late Fee Applied | Yes — tags strategist + Amanda |
| -8 to -59 | Late fee follow-up | Late Fee Applied | Yes — tags strategist + Amanda |
| ≤ -60 | Collections | FINAL NOTICE | Yes — tags strategist + Amanda + Noa |

### Deduplication
Before sending any reminder, the workflow checks Col L (Reminders Sent). Format: `7d 2026-04-10 | overdue 2026-04-15`.
- Same reminder type sent within **2 days** → skip
- `late-fee-followup` sent within **7 days** → skip

### Email Format
- **From:** john@kravemedia.co
- **To:** Col C (Email Address)
- **CC:** Col K strategist email + noa@kravemedia.co
- **Subject:** varies by reminder type (see templates in `SKILL.md`)

### Strategist Slack ID Map
| Name | Email | Slack ID |
|------|-------|----------|
| Amanda | amanda@kravemedia.co | `U07J8SRCPGU` |
| Jeneena | jeneena@kravemedia.co | `U07R7FU4WBV` |
| Sybil | sybil@kravemedia.co | `U0A2HLNV8NM` |
| Noa | noa@kravemedia.co | `U06TBGX9L93` |
| John | john@kravemedia.co | `U0AM5EGRVTP` |

### Rows Skipped (Never Processed)
- Status = `Payment Complete`
- Status = `Collections`
- Status = `Draft — Pending John Review`
- Missing Invoice # or Due Date
- Unparseable Due Date

### Outputs
| Scenario | Email | Slack |
|----------|-------|-------|
| Pre-due (7d/5d/3d/1d) | Sent | Silent |
| Due today / Overdue | Sent | Alert with strategist + Amanda tag |
| Late fee (-7d+) | Sent | Alert with strategist + Amanda tag |
| Collections (-60d+) | Sent | Alert with strategist + Amanda + Noa tag |
| Missing client email | Skipped | Warning posted to channel |
| Unknown strategist (Col K) | Sent (CC skipped) | Warning appended to alert |
| Nothing to action | — | Silent — workflow exits |

---

## Credential Reference

| Credential Name | Type | ID | Used By | Account |
|----------------|------|----|---------|---------|
| Gmail account | Gmail OAuth2 | `vxHex5lFrkakcsPi` | Payment Detection | noa@kravemedia.co |
| Gmail account (john) | Gmail OAuth2 | `vsDW3WpKXqS9HUs3` | Invoice Reminder Cron | john@kravemedia.co |
| Google Sheets account | Sheets OAuth2 | `83MQOm78gYDvziTO` | Both | noa@kravemedia.co |
| Krave Slack Bot | Slack API (Bot Token) | `Bn2U6Cwe1wdiCXzD` | Both | Krave Slack workspace |

### Airwallex (hardcoded in HTTP Request nodes)
| Field | Value |
|-------|-------|
| x-client-id | `JaQA4uJ1SDSBkTdFigT9sw` |
| x-api-key | `5611f8e1...` (see deploy script) |
| Auth endpoint | `POST https://api.airwallex.com/api/v1/authentication/login` |
| Mark paid endpoint | `POST https://api.airwallex.com/api/v1/invoices/{id}/mark_as_paid` |

> **Note:** Airwallex credentials are hardcoded as HTTP Request headers — not stored as n8n credentials. If the API key rotates, update both the deploy script and the live workflow node directly.

---

## Runbook — Common Scenarios

### Trigger a payment check manually
```bash
curl -s -X POST "https://noatakhel.app.n8n.cloud/webhook/krave-payment-detection" \
  -H "Content-Type: application/json" -d '{}'
```
Or via Claude Code: say **"run payment detection"** or **"/payment-detection-trigger"**

### Trigger invoice reminders manually
```bash
curl -s -X POST "https://noatakhel.app.n8n.cloud/webhook/krave-invoice-reminder" \
  -H "Content-Type: application/json" -d '{}'
```
Or via Claude Code: say **"run invoice reminders"** or **"/invoice-reminder-trigger"**

### A payment was matched but Airwallex mark_paid failed
The Sheets row will still show `Payment Complete` and Slack will have posted confirmation. Log into Airwallex and manually mark the invoice as paid. The `continueOnFail` flag on the Airwallex node prevents this from blocking Sheets/Slack.

### A client's email is missing from the tracker
The reminder cron will post a ⚠️ warning to #payments-invoices-updates: `No client email on file for [Client] ([Invoice #])`. Add the email to Col C in the tracker — it will be picked up on the next run.

### A strategist name in Col K doesn't match the lookup table
The email will still send but the CC will be skipped and a warning will appear in Slack: `⚠️ Unknown strategist "[name]"`. Check the Col K value — it must be one of: `Amanda`, `Jeneena`, `Sybil`, `Noa`, `John` (exact match, case-sensitive).

### Reminder was sent twice / deduplication not working
Check Col L (Reminders Sent) for the row. If the entry is malformed or missing, the dedup check will fail. Correct format: `7d 2026-04-10 | overdue 2026-04-15`. Add/fix the entry manually.

### Redeploy a workflow from scratch
```bash
node n8n-workflows/deploy-payment-detection.js
node n8n-workflows/deploy-invoice-reminder-cron.js
```
This creates a **new** workflow — you'll get a new ID and need to activate it and deactivate the old one.

### Update an existing workflow
Use the n8n API directly (PUT `/api/v1/workflows/{id}`) as done in the deploy scripts, or edit in the n8n canvas and save.

---

## Handover Checklist

For anyone inheriting or maintaining these workflows:

- [ ] Access to `noatakhel.app.n8n.cloud` (ask Noa for login or create a new member account)
- [ ] Access to Client Invoice Tracker Google Sheet (`1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`)
- [ ] Understand the Status values in Col J — never manually write to Col N
- [ ] Know that Airwallex credentials are hardcoded (not in n8n credential store) — keep the deploy scripts safe
- [ ] Both workflows should remain **Active** in n8n at all times
- [ ] Gmail OAuth2 tokens expire — if emails stop sending, re-authorize the credential in n8n (Credentials → open → reconnect OAuth)
- [ ] Slack bot token (`Krave Slack Bot`) does not expire unless revoked
- [ ] All code changes should be committed to `github.com/withally-workshop/claudevasystem` — the deploy scripts are the source of truth
- [ ] Test after any change by triggering the webhook and checking #payments-invoices-updates
