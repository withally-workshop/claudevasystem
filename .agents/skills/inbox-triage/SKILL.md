---
name: inbox-triage
description: Use when the user says "run triage", "triage inbox", "trigger inbox triage", "run email triage", or "morning triage". Fires the Krave inbox triage n8n workflow immediately via webhook. The workflow classifies unread emails, applies EA/* labels, creates drafts, archives noise, and posts a summary to #ops-command.
metadata:
  short-description: Trigger inbox triage webhook
---

# Inbox Triage

Fires the inbox triage n8n workflow immediately (on-demand). The workflow runs asynchronously — a 200 response means n8n accepted the trigger, not that triage is complete. Allow ~2 minutes.

## Trigger

POST to the webhook:

```
POST https://noatakhel.app.n8n.cloud/webhook/krave-inbox-triage-v2
Content-Type: application/json
Body: {}
```

PowerShell:
```powershell
Invoke-RestMethod -Method POST -Uri "https://noatakhel.app.n8n.cloud/webhook/krave-inbox-triage-v2" -ContentType "application/json" -Body "{}"
```

## After Triggering

Report: "Inbox triage triggered. The workflow will classify unread emails, apply EA/* labels, create drafts, archive, and post the summary to #ops-command within ~2 minutes."

If non-2xx: report the status code and suggest checking the workflow at `https://noatakhel.app.n8n.cloud/workflow/EuT6REDs5PUaoycE`.

## What the Workflow Does

- Searches `in:inbox is:unread` for new emails
- AI classifier applies two-layer labels: EA/Urgent, EA/Needs-Reply, EA/FYI, EA/Auto-Sorted, EA/Unsure + context labels (Compliance, Creators-Inbound, etc.)
- Creates Gmail drafts for emails needing replies
- Archives non-`EA/Unsure` emails (removes from inbox), EXCEPT client payments labeled `_Payment_Received` — those are classified `EA/FYI` but kept in the inbox per Noa's rule (pairs with the Gmail filter routing client deposits to inbox + `_Payment_Received`)
- Posts a triage summary to #ops-command (Slack channel C0AQZGJDR38)

## Key References

- Claude Code skill: `.claude/skills/inbox-triage/SKILL.md`
- Deploy script: `n8n-workflows/deploy-inbox-triage-daily.js`
- Workflow ID: `EuT6REDs5PUaoycE`
- n8n workflow docs: `n8n-workflows/WORKFLOWS.md` (Workflow 5)
