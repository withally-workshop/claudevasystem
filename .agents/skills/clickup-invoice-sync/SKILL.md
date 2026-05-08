---
name: clickup-invoice-sync
description: Use when asked about ClickUp invoice status sync, why a UGC task didn't move to collections or payment complete, how to set up or troubleshoot the ClickUp sync, or when John needs to know how to include the ClickUp URL in his approval reply.
metadata:
  short-description: ClickUp ↔ invoice lifecycle sync
---

# ClickUp Invoice Sync

Keeps UGC project tasks in ClickUp (Agency Execution → Projects → UGC) in sync with the invoice lifecycle. No manual status updates needed from the team.

## Trigger

John's approval reply in `#airwallex-drafts`:

```
approve https://app.clickup.com/t/86ex3jwhn
```

URL is optional. `approve` alone skips ClickUp sync (works for WhatsApp clients, new clients, deposits). Task ID is extracted from the URL.

## What Happens Automatically

- **Invoice finalized** → ClickUp status: `collections` + Invoice Sent date + Invoice Due date written to task
- **Payment confirmed (full)** → ClickUp status: `payment complete`

## How John Gets the URL

Open the UGC task in ClickUp → copy URL from browser address bar (`https://app.clickup.com/t/XXXXXXXXX`).

## Implementation

- Approval Polling workflow: `n8n-workflows/deploy-invoice-approval-polling.js` — nodes n18–n23 (parallel branch from Update Tracker)
- Payment Detection workflow: `n8n-workflows/patch-payment-detection-clickup.js` — surgical patch, nodes cu1–cu3
- Claude Code skill: `.claude/skills/clickup-invoice-sync/SKILL.md`

## Key IDs

| Item | Value |
|---|---|
| UGC List | `901800797397` |
| Invoice Sent field | `79d9a123-4903-44ba-83cd-7d07b349617f` |
| Invoice Due field | `8552675a-689e-43fa-a4d0-2f102e1d7fc5` |
| Sheets col | `ClickUp Task ID` |
| Env var | `CLICKUP_API_KEY` |
