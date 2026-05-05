---
name: claude-ea-workflows
description: Use when the user asks Codex to run, explain, audit, list, or map the Claude EA / Noa Takhel executive assistant workflows, Claude skills, slash commands, n8n automations, invoice ops, inbox triage, SOD/EOD reports, IM8 brief extraction, weekly reviews, payment detection, or Osome reconciliation in this repository.
metadata:
  short-description: Run and map Claude EA workflows
---

# Claude EA Workflows

This repo is a Claude Code executive-assistant workspace. Treat `.claude/skills/*/SKILL.md` as the source of truth for workflow instructions, and `n8n-workflows/WORKFLOWS.md` as the source of truth for deployed n8n automations.

## First Steps

1. Identify the requested workflow from the trigger table below.
2. Read the matching `.claude/skills/<name>/SKILL.md` before acting.
3. If the task involves a deployed automation, read the relevant section of `n8n-workflows/WORKFLOWS.md`.
4. Preserve deep-work rules, channel routing, and tracker column rules exactly.
5. Do not print secrets from `.claude/settings.json` or webhook URLs unless the user explicitly asks for operational run commands.

## Project Skill Map

| User says / slash command | Claude skill file | What it does |
|---|---|---|
| `/invoice-triage`, "process invoices", "run invoice triage" | `.claude/skills/creator-invoice-processing/SKILL.md` | Prepare creator invoice bill report from Slack/Gmail inputs. |
| `/inbox-triage`, "triage inbox", "morning triage", "inbox zero setup" | `.claude/skills/inbox-triage/SKILL.md` | Run inbox setup or daily triage for `noa@kravemedia.co`. |
| `/payment-detection`, "check for payments", "scan for payments" | `.claude/skills/payment-detection/SKILL.md` | Scan Airwallex payment emails and update invoice tracker. |
| `/payment-detection-trigger`, "run payment detection" | `.claude/skills/payment-detection-trigger/SKILL.md` | Fire the n8n payment detection webhook. |
| `/n8n-trigger`, "trigger n8n", "run n8n workflow", "fire webhook", "run automation" | `.claude/skills/n8n-workflow-trigger/SKILL.md` | Manually trigger approved deployed n8n workflow webhooks. |
| `/invoice-reminder-cron`, "run invoice reminders" | `.claude/skills/invoice-reminder-cron/SKILL.md` | Full daily reminder workflow, including payment detection first. |
| `/invoice-reminder-trigger`, "trigger invoice reminder" | `.claude/skills/invoice-reminder-trigger/SKILL.md` | Fire the n8n invoice reminder webhook. |
| `/invoice-approval-polling`, "check approvals" | `.claude/skills/invoice-approval-polling/SKILL.md` | Poll John's approval threads, finalize invoices, notify strategist/client. |
| `/eod-triage-summary`, "EOD summary", "today's wrap-up" | `.claude/skills/eod-triage-summary/SKILL.md` | Generate and send Noa's end-of-day Slack summary. |
| `/sod-report`, "start of day report", "SOD report" | `.claude/skills/sod-report/SKILL.md` | Generate the daily goals report from validated Slack inputs. |
| `/weekly-review` | `.claude/skills/weekly-review/SKILL.md` | Synthesize weekly cross-business status and priorities. |
| `/ops-report`, "hey report", "ops report", "daily report", "weekly report", "dashboard report" | `.claude/skills/ops-report/SKILL.md` and `.agents/skills/ops-report/SKILL.md` | Generate a live-read operations briefing and dashboard from n8n executions, the invoice tracker, and Slack context. |
| `/weekly-invoice-summary`, "weekly invoice summary", "who to chase this week", "weekly payment status", "what invoices are overdue" | `.claude/skills/weekly-invoice-summary/SKILL.md` and `.agents/skills/weekly-invoice-summary/SKILL.md` | Fire the n8n weekly summary workflow — posts a full open-invoice portfolio snapshot to #payments-invoices-updates. |
| `/client-invoice-creation`, "client invoice creation", "process invoice requests" | `.claude/skills/client-invoice-creation/SKILL.md` | Process Slack invoice request receipts and approval replies. |
| "Osome reconciliation" | `.claude/skills/osome-reconciliation/SKILL.md` | Triage Osome documents-needed transactions and locate PDFs. |

## n8n Automation Map

Use `n8n-workflows/WORKFLOWS.md` for current IDs, status, webhook paths, deployment scripts, and runbook commands.

| Automation | Related skill | Trigger pattern |
|---|---|---|
| Krave - Payment Detection | `payment-detection`, `payment-detection-trigger`, `n8n-workflow-trigger` | Scheduled hourly, or manual webhook. |
| Krave - Invoice Reminder Cron | `invoice-reminder-cron`, `invoice-reminder-trigger`, `n8n-workflow-trigger` | Scheduled 9 AM ICT Mon–Fri, or manual webhook. |
| Krave - EOD Triage Summary | `eod-triage-summary`, `n8n-workflow-trigger` | Scheduled 6 PM ICT weekdays, or manual webhook. |
| Krave - Start Of Day Report | `sod-report`, `n8n-workflow-trigger` | Manual trigger or webhook after required Slack inputs exist. |
| Krave - Inbox Triage Daily | `inbox-triage`, `n8n-workflow-trigger` | Scheduled 9 AM ICT weekdays, or manual webhook. |
| Krave - Slack Invoice Handler | `client-invoice-creation`, `n8n-workflow-trigger` | Slack `/invoice-request` command and modal submissions. |
| Krave - Invoice Request Intake | `client-invoice-creation`, `n8n-workflow-trigger` | Structured Slack modal payload or manual webhook. |
| Krave - Invoice Approval Polling | `invoice-approval-polling`, `n8n-workflow-trigger` | Scheduled every 2 hrs on weekdays, or manual webhook. |
| Krave - Weekly Invoice Summary | `weekly-invoice-summary`, `n8n-workflow-trigger` | Scheduled Monday 9 AM ICT, or manual webhook. Posts open invoice portfolio snapshot to #payments-invoices-updates. |
| Krave - Client Invoice Creation | `client-invoice-creation` | Deprecated inactive legacy webhook from `deploy-client-invoice-creation.js`; use approval polling for finalization unless explicitly rolling back. |
| Krave - Ops Report | `ops-report` | Live-read reporting skill only; reads n8n execution history, the Client Invoice Tracker, and Slack context without triggering workflows. |

## Operating Rules

- Timezone: repo docs use ICT/GMT+7 in places, while workflow code often uses `Asia/Manila`/GMT+8. Confirm the runtime timezone before schedule-sensitive actions.
- Deep work: protect Noa's 1:30 PM-7:00 PM ICT block; batch non-urgent escalations into EOD.
- Recommendations: use the 3-and-1 framework when decisions are needed.
- Finance tracker: never write to formula/display columns called out in skill docs, especially Client Invoice Tracker column N.
- Deduplication: honor Slack `white_check_mark` reactions and tracker duplicate rules before processing.
- If MCP tools are unavailable, prepare the exact manual fallback output from the skill instead of inventing a new flow.
