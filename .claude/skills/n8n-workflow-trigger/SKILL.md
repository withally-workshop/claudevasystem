# Skill: Trigger n8n Workflow

**Trigger:** "trigger n8n", "run n8n workflow", "fire webhook", "run automation", "/n8n-trigger", "/trigger-workflow"
**What it does:** Manually fires approved Krave n8n workflow webhooks from Claude or Codex.
**Source of truth:** `n8n-workflows/WORKFLOWS.md` plus the matching `n8n-workflows/deploy-*.js` script.

---

## Safety Rules

- Only trigger a workflow when the user explicitly asks to run it.
- Prefer the workflow-specific skill when one exists, then use this skill as the shared webhook runbook.
- Do not print full webhook URLs unless the user asks for the operational command.
- Use the production `/webhook/` URL only for active workflows. Use `/webhook-test/` only when the workflow is inactive or the user asks for test mode.
- For workflows marked `Payload required`, do not send `{}` unless the user explicitly asks for a validation/failure test.
- After triggering, report that n8n accepted the request; do not claim the workflow completed unless you verify downstream output.
- Payment Detection scans Gmail from n8n `lastRunTs`; it must not scan Noa's full inbox or run the Gmail search once per tracker row. It may read Column N `Status` for eligibility (`Unpaid`, `Overdue`, or blank), but writes only Column J `Payment Status`, Column M, and Column Q.

---

## Workflow Aliases

| User intent | Alias | Empty body? | Webhook path | Expected output |
|---|---|---:|---|---|
| "run payment detection" | `payment-detection` | Yes | `krave-payment-detection` | Slack payment updates if anything changed |
| "run invoice reminders" | `invoice-reminder` | Yes | `krave-invoice-reminder` | Reminder emails and overdue Slack alerts if needed |
| "check reminder replies" / "run reply detection" | `invoice-reminder-reply-detection` | Yes | `krave-invoice-reminder-reply-detection` | Tracker reply attribution updates for John's Gmail reminder threads |
| "run EOD" / "today's wrap-up" | `eod-triage-summary` | Yes | `krave-eod-triage-summary` | Noa DM plus `#airwallexdrafts` archive |
| "run SOD" / "start of day report" | `sod-report` | Yes, after required inputs exist | `krave-sod-report` | `#airwallexdrafts` plus Noa DM, or hard-stop alert |
| "run inbox triage" / "morning triage" | `inbox-triage-daily` | Yes | `krave-inbox-triage-daily` | Gmail drafts/labels plus Slack summary |
| "check approvals" / "run approval polling" | `invoice-approval-polling` | Yes | `krave-invoice-approval-polling` | Finalized invoices and strategist/client notifications if approvals exist |
| "run client invoice creation" | `client-invoice-creation` | No | `krave-client-invoice-creation` | Deprecated/inactive legacy finalization path; use `invoice-approval-polling` instead |
| "open invoice request modal" | `slack-invoice-handler` | Payload required | `slack-invoice-handler` | Slack modal response |
| "submit invoice request intake" | `invoice-request-intake` | Payload required | `krave-invoice-request-intake` | Tracker row, Airwallex draft, or manual fallback |

---

## Coverage Matrix

Every active workflow in `n8n-workflows/WORKFLOWS.md`, plus any deployed webhook script in `n8n-workflows/deploy-*.js`, must have both a Claude invocation path and a Codex invocation path.

| n8n workflow | Claude invocation | Codex invocation |
|---|---|---|
| Krave - Payment Detection | `.claude/skills/payment-detection-trigger/SKILL.md` or this skill with `payment-detection` | `.agents/skills/n8n-workflow-trigger/SKILL.md` with `payment-detection` |
| Krave - Invoice Reminder Cron | `.claude/skills/invoice-reminder-trigger/SKILL.md` or this skill with `invoice-reminder` | `.agents/skills/n8n-workflow-trigger/SKILL.md` with `invoice-reminder` |
| Krave - Invoice Reminder Reply Detection | this skill with `invoice-reminder-reply-detection` | `.agents/skills/n8n-workflow-trigger/SKILL.md` with `invoice-reminder-reply-detection` |
| Krave - EOD Triage Summary | `.claude/skills/eod-triage-summary/SKILL.md` or this skill with `eod-triage-summary` | `.agents/skills/n8n-workflow-trigger/SKILL.md` with `eod-triage-summary` |
| Krave - Start Of Day Report | `.claude/skills/sod-report/SKILL.md` or this skill with `sod-report` | `.agents/skills/n8n-workflow-trigger/SKILL.md` with `sod-report` |
| Krave - Inbox Triage Daily | `.claude/skills/inbox-triage/SKILL.md` or this skill with `inbox-triage-daily` | `.agents/skills/n8n-workflow-trigger/SKILL.md` with `inbox-triage-daily` |
| Krave - Slack Invoice Handler | `.claude/skills/client-invoice-creation/SKILL.md` or this skill with `slack-invoice-handler` | `.agents/skills/n8n-workflow-trigger/SKILL.md` with `slack-invoice-handler` |
| Krave - Invoice Request Intake | `.claude/skills/client-invoice-creation/SKILL.md` or this skill with `invoice-request-intake` | `.agents/skills/n8n-workflow-trigger/SKILL.md` with `invoice-request-intake` |
| Krave - Invoice Approval Polling | `.claude/skills/invoice-approval-polling/SKILL.md` or this skill with `invoice-approval-polling` | `.agents/skills/n8n-workflow-trigger/SKILL.md` with `invoice-approval-polling` |
| Krave - Client Invoice Creation | `.claude/skills/client-invoice-creation/SKILL.md` or this skill with `client-invoice-creation` | `.agents/skills/n8n-workflow-trigger/SKILL.md` with `client-invoice-creation` |

---

## Execution

### PowerShell, preferred in this repo

```powershell
$body = '{}'
Invoke-RestMethod `
  -Method Post `
  -Uri 'https://noatakhel.app.n8n.cloud/webhook/WEBHOOK_PATH' `
  -ContentType 'application/json' `
  -Body $body
```

### Bash, when available

```bash
curl -sS -X POST "https://noatakhel.app.n8n.cloud/webhook/WEBHOOK_PATH" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Replace `WEBHOOK_PATH` with the path from the alias table.

---

## Pre-Run Checks

- For `sod-report`, confirm the required Slack inputs exist if the user expects a successful report: yesterday EOD, John's same-day morning dump, and today's Morning Triage.
- For `invoice-request-intake`, require a structured Slack modal-style JSON payload. Empty `{}` can write fallback/error artifacts.
- For `slack-invoice-handler`, require a Slack slash-command or interactivity payload. Empty `{}` is not a normal run.
- For `invoice-approval-polling`, use `krave-invoice-approval-polling`. If docs mention `krave-client-invoice-creation`, verify against `n8n-workflows/deploy-invoice-approval-polling.js`; the deploy script is authoritative.
- For `client-invoice-creation`, do not trigger the webhook in normal operations. It is a deprecated inactive legacy finalization path; use `invoice-approval-polling` unless the user explicitly asks for a rollback.

---

## Response Format

After a successful HTTP response:

```text
Triggered [workflow name]. n8n accepted the webhook request.
Expected result: [where output should appear].
```

If the request fails, report the HTTP status/error body and do not retry repeatedly unless the user asks.
