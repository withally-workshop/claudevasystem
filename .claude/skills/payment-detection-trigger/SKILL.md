# Skill: Trigger Payment Detection

**Trigger:** "run payment detection", "check for payments now", "trigger payment detection", "/payment-detection-trigger"
**What it does:** Fires the n8n Payment Detection workflow on demand via webhook. The workflow scans noa@kravemedia.co for Airwallex deposit emails, matches to open invoices, updates the tracker, and posts results to #payments-invoices-updates.

---

## Webhook Details

- **URL:** `https://noatakhel.app.n8n.cloud/webhook/krave-payment-detection`
- **Method:** POST
- **Auth:** none (webhook is public — URL is the secret)
- **Workflow:** Krave — Payment Detection (ID: `NurOLZkg3J6rur5Q`)
- **n8n instance:** `https://noatakhel.app.n8n.cloud`

---

## Execution Steps

### Step 1 — Fire the webhook
Use the Bash tool to call the webhook:

```bash
curl -s -X POST "https://noatakhel.app.n8n.cloud/webhook/krave-payment-detection" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Step 2 — Confirm trigger
- A 200 response means the workflow started successfully
- The workflow runs asynchronously — results appear in #payments-invoices-updates within ~30 seconds

### Step 3 — Report back
Tell the user:
```
Payment detection triggered — n8n is running the check now.
Results will appear in #payments-invoices-updates within ~30 seconds.
```

---

## Notes
- The workflow must be **active** in n8n for the production webhook URL to work
- If the workflow is inactive (not yet activated), use the test URL instead:
  `https://noatakhel.app.n8n.cloud/webhook-test/krave-payment-detection`
- This skill does not wait for the workflow to complete — it's fire-and-forget
- To check results, use `mcp__slack__slack_get_channel_history` on C09HN2EBPR7 after ~30 seconds
- The workflow scans Gmail from n8n `lastRunTs` only. It must not scan Noa's full inbox or run the Gmail search once per tracker row.
- Payment Detection may read Column N `Status` for eligibility (`Unpaid`, `Overdue`, or blank), but it writes only Column J `Payment Status`, Column M, and Column Q.
