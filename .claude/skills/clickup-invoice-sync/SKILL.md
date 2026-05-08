# Skill: ClickUp Invoice Sync

**Trigger:** "sync clickup", "update clickup status", "clickup invoice sync", "/clickup-invoice-sync"

---

## Purpose

Keeps UGC project tasks in ClickUp (Agency Execution → Projects → UGC) in sync with the invoice lifecycle — no manual status updates required from the team.

- When invoice is **finalized** (John approves): task moves to `collections`, Invoice Sent and Invoice Due dates are written
- When **payment is confirmed**: task moves to `payment complete`

Strategists and John change nothing. The sync fires automatically as part of the existing approval polling and payment detection workflows.

---

## How It Works

### Trigger: John's approval reply

John already replies "approve" in `#airwallex-drafts` to finalize invoices. To activate the ClickUp sync for a given invoice, John adds the ClickUp task URL on the same line:

```
approve https://app.clickup.com/t/86ex3jwhn
```

- URL is **optional** — `approve` alone still works (WhatsApp-only clients, new clients, deposits)
- Task ID is parsed from the URL (alphanumeric string after `/t/`)
- If no URL is present → ClickUp sync is skipped, everything else proceeds normally

**How John finds the URL:**
1. Open the task in ClickUp → copy URL from browser address bar, OR
2. Click `...` menu on the task → Copy link

### On invoice finalized (Approval Polling workflow)

1. Parse ClickUp task ID from approval reply text
2. If task ID found:
   - PUT ClickUp task status → `collections`
   - POST Invoice Sent date (today) to ClickUp field `79d9a123-4903-44ba-83cd-7d07b349617f`
   - POST Invoice Due date (from Sheets col I) to ClickUp field `8552675a-689e-43fa-a4d0-2f102e1d7fc5`
   - Write ClickUp Task ID to Sheets tracker col `Clickup Task ID` (col S)
3. All ClickUp HTTP nodes run with `continueOnFail: true` — invoice confirmation sends regardless of ClickUp API result

### On payment confirmed (Payment Detection workflow)

1. Look up ClickUp Task ID from Sheets tracker col `ClickUp Task ID` (matched via Invoice #)
2. If found → PUT ClickUp task status → `payment complete`
3. Runs with `continueOnFail: true` — payment detection continues regardless

---

## Key Data

| Item | Value |
|---|---|
| UGC List ID | `901800797397` |
| Space | Agency Execution (`90180438123`) |
| Invoice Sent field ID | `79d9a123-4903-44ba-83cd-7d07b349617f` |
| Invoice Due field ID | `8552675a-689e-43fa-a4d0-2f102e1d7fc5` |
| ClickUp Task ID Sheets col | `Clickup Task ID` (col S — already exists in sheet) |
| Sheets tracker ID | `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50` |
| Env var required | `CLICKUP_API_KEY` |

---

## ClickUp Status Values Written

| Lifecycle event | ClickUp status |
|---|---|
| Invoice finalized | `collections` |
| Payment confirmed (full) | `payment complete` |

Both statuses already exist in the UGC list — no new statuses needed.

---

## What Is NOT Automated

- `approved` status — set manually by strategist, never touched by automation
- Partial payments — ClickUp status is NOT updated on partial payment, only on full payment complete
- WhatsApp-only clients (e.g. Get Customer Pte) — John omits the URL, ClickUp sync skipped

---

## Deployment

- Approval polling changes: redeploy via `node n8n-workflows/deploy-invoice-approval-polling.js`
- Payment detection changes: run `node n8n-workflows/patch-payment-detection-clickup.js` (surgical patch — safe to re-run)

Col S `Clickup Task ID` already exists in the Invoices sheet — no manual setup required.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| ClickUp status not updating | Verify `CLICKUP_API_KEY` is set and valid; check n8n execution log for ClickUp HTTP node errors |
| Wrong task updated | John used wrong URL in approval reply — check approval reply text in Sheets tracker |
| ClickUp updated but Sheets col empty | Write ClickUp ID to Tracker node failed — check Sheets column header exists |
| Old invoices not syncing | Expected — rows without `ClickUp Task ID` col value are silently skipped |
