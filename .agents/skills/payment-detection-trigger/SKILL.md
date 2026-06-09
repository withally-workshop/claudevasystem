---
name: payment-detection-trigger
description: Use when Codex needs to fire the n8n Payment Detection workflow on demand. Triggers include "run payment detection", "check for payments now", "trigger payment detection", "/payment-detection-trigger". Fire-and-forget webhook — the workflow scans noa@kravemedia.co for Airwallex deposit emails, matches to open invoices, updates the tracker, and posts results to #payments-invoices-updates.
metadata:
  short-description: Fire payment detection via webhook
---

# Trigger Payment Detection

Fire the n8n Payment Detection workflow on demand. Fire-and-forget — results appear in `#payments-invoices-updates` (C09HN2EBPR7) within ~30 seconds.

## How to Trigger

**Manual:** "run payment detection", "check for payments now", "/payment-detection-trigger"

**Webhook:**
```bash
curl -s -X POST "https://noatakhel.app.n8n.cloud/webhook/krave-payment-detection" \
  -H "Content-Type: application/json" -d '{}'
```

## Key References

- **Full skill:** `.claude/skills/payment-detection-trigger/SKILL.md` (and `payment-detection` for the matching logic)
- **Workflow:** Krave — Payment Detection (`NurOLZkg3J6rur5Q`) on `noatakhel.app.n8n.cloud`
- **Deploy script:** `n8n-workflows/deploy-payment-detection.js` (stale — live workflow patched in place)

## Notes

- 200 response = workflow started; check C09HN2EBPR7 after ~30 seconds for results
- Workflow must be active for the production URL; test URL: `/webhook-test/krave-payment-detection`
- The workflow scans Gmail incrementally from `lastRunTs` — it never rescans the full inbox
- It writes only Payment Status (J), Payment Confirmed Date (M), and Amount Paid (Q) — never Status (N)
