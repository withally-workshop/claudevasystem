---
name: n8n-workflow-trigger
description: Use when the user asks Codex to manually trigger, run, fire, or test a deployed Krave n8n workflow webhook, including payment detection, invoice reminders, invoice reminder reply detection, inbox triage, invoice approval polling, Slack invoice handler, or invoice request intake.
metadata:
  short-description: Trigger Krave n8n workflows
---

# n8n Workflow Trigger

Use this as Codex's manual n8n trigger hub for the Claude EA repo.

## First Steps

1. Identify the workflow alias from `.claude/skills/n8n-workflow-trigger/SKILL.md`.
2. Read `n8n-workflows/WORKFLOWS.md` if the user asks for current IDs, schedules, or output destinations.
3. For behavior-specific constraints, read the matching `.claude/skills/<workflow>/SKILL.md`.
4. Trigger only after an explicit user request to run the workflow.

## Trigger Rules

- Use PowerShell `Invoke-RestMethod` in this Windows repo.
- Do not expose the full webhook URL unless the user asks for the operational command.
- Empty `{}` is acceptable for `payment-detection`, `invoice-reminder`, `invoice-reminder-reply-detection`, `inbox-triage-daily`, and `invoice-approval-polling`. Do not trigger deprecated `client-invoice-creation` in normal operations.
- Require a real payload for `slack-invoice-handler` and `invoice-request-intake`, unless the user explicitly wants a failure-path test.
- Treat the workflow as asynchronous. A 200/accepted response means n8n started, not that the business process completed.
- Payment Detection scans Gmail from n8n `lastRunTs`; it must not scan Noa's full inbox or run the Gmail search once per tracker row. It may read Column N `Status` for eligibility (`Unpaid`, `Overdue`, or blank), but writes only Column J `Payment Status`, Column M, and Column Q.

## Required Coverage

Every active n8n workflow and every deployed webhook script must remain invocable from both agents:

| n8n workflow | Claude path | Codex path |
|---|---|---|
| Krave - Payment Detection | `.claude/skills/payment-detection-trigger/SKILL.md` or `.claude/skills/n8n-workflow-trigger/SKILL.md` | This skill with `payment-detection` |
| Krave - Invoice Reminder Cron | `.claude/skills/invoice-reminder-trigger/SKILL.md` or `.claude/skills/n8n-workflow-trigger/SKILL.md` | This skill with `invoice-reminder` |
| Krave - Invoice Reminder Reply Detection | `.claude/skills/n8n-workflow-trigger/SKILL.md` | This skill with `invoice-reminder-reply-detection` |
| Krave - Inbox Triage Daily | `.claude/skills/inbox-triage/SKILL.md` or `.claude/skills/n8n-workflow-trigger/SKILL.md` | This skill with `inbox-triage-daily` |
| Krave - Slack Invoice Handler | `.claude/skills/client-invoice-creation/SKILL.md` or `.claude/skills/n8n-workflow-trigger/SKILL.md` | This skill with `slack-invoice-handler` |
| Krave - Invoice Request Intake | `.claude/skills/client-invoice-creation/SKILL.md` or `.claude/skills/n8n-workflow-trigger/SKILL.md` | This skill with `invoice-request-intake` |
| Krave - Invoice Approval Polling | `.claude/skills/invoice-approval-polling/SKILL.md` or `.claude/skills/n8n-workflow-trigger/SKILL.md` | This skill with `invoice-approval-polling` |
| Krave - Client Invoice Creation | `.claude/skills/client-invoice-creation/SKILL.md` or `.claude/skills/n8n-workflow-trigger/SKILL.md` | Deprecated inactive legacy path; use `invoice-approval-polling` instead |

## Canonical Runbook

The canonical alias table and command templates live in:

`C:\Users\jopso\Desktop\claude-ea\.claude\skills\n8n-workflow-trigger\SKILL.md`

If there is a mismatch between docs and deploy scripts, prefer the deploy script and tell the user what differed.
