---
name: ops-report
description: Use when Codex needs to generate a live Krave operations report or dashboard from n8n executions, the Client Invoice Tracker, and Slack context. Triggers include "hey report", "ops report", "daily report", "weekly report", "dashboard report", "what ran today", "how many invoices", "how many reminders", "payment sent", "payments received", "execution report", or requests for the current master tracker state.
metadata:
  short-description: Generate live ops reports
---

# Ops Report

Generate a live-read only operations briefing and optional dashboard snapshot for the Claude EA / Krave automation system. Do not trigger workflows, send Slack messages, mutate trackers, or create persistent metric storage.

## First Steps

1. Resolve the date range.
   - `hey report` / `ops report`: week-to-date.
   - `daily report`, `today's report`, `report today`: current local day.
   - `weekly report`: week-to-date.
   - Explicit dates or ranges override defaults.
2. State the concrete range before reporting.
3. Read `n8n-workflows/WORKFLOWS.md` for current workflow IDs, tracker columns, source channels, and schedules.
4. Pull all available live sources. Missing sources degrade the report; they do not make unavailable data equal zero.
5. Output a concise briefing first. Create a dashboard snapshot under `reports/ops-report/` only when there is enough data to render a useful state view.

Only report workflow health for Krave/Claude EA workflows listed in `n8n-workflows/WORKFLOWS.md`. Ignore unrelated n8n workspace workflows unless the user explicitly asks for a full n8n workspace audit.

## Source Map

| Source | Access | Use |
|---|---|---|
| n8n API | PowerShell `Invoke-RestMethod` with `N8N_API_KEY` | Execution counts, failed runs, active workflow health |
| Client Invoice Tracker | Google Sheets MCP | Current invoice state and finance movement |
| Slack | Slack MCP | Posted workflow outputs, finance events, SOD/EOD/inbox narrative, exception context |

## n8n Execution History

Use n8n execution history for process counts and workflow health when `N8N_API_KEY` is available. Do not expose the API key in the final answer.

PowerShell pattern:

```powershell
$headers = @{ 'X-N8N-API-KEY' = $env:N8N_API_KEY }
Invoke-RestMethod -Method Get -Uri 'https://noatakhel.app.n8n.cloud/api/v1/executions?limit=100' -Headers $headers
```

Recommended active workflow IDs are listed in `n8n-workflows/WORKFLOWS.md`. Count executions in the requested range by workflow name or workflow ID, but exclude workflows not listed there. Track:

- total executions
- successful executions
- failed/error executions
- workflows active in docs but not seen during the range
- most recent failure per affected workflow

If the n8n API key is unavailable or the API call fails, include: `n8n execution history unavailable: <reason>`.

## Invoice Tracker Dashboard

Read the Client Invoice Tracker with Google Sheets:

- Spreadsheet: `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`
- Tab: `Invoices`
- Range: `Invoices!A:Z`

Important columns:

| Col | Field | Report use |
|---|---|---|
| A | Date Created | invoices created in range |
| B | Client Name | action queue labels |
| E | Invoice # | invoice reference |
| F | Airwallex Invoice ID | stable invoice key |
| G | Amount | AR totals |
| H | Currency | group totals by currency |
| I | Due Date | overdue risk |
| J | Payment Status | operational state |
| L | Reminders Sent | reminder counts/log |
| M | Payment Confirmed Date | payments received in range |
| N | Status | formula/display status; read only |
| P | Origin Thread TS | Slack audit trail presence |
| Q | Amount Paid | partial/full payment state |
| R | Invoice URL | finalized invoice link state |
| S | Last Follow-Up Sent | latest tracked reminder date |
| T | Last Follow-Up Type | latest reminder tier |
| U | Last Follow-Up Thread ID | Real John Gmail reminder thread key when available; do not display as a dashboard field |
| V | Last Client Reply Date | latest detected client reply date from `john@kravemedia.co` only |
| W | Client Reply Status | `No Reply Found`, `Possible Reply`, `Replied`, `Promise to Pay`, `Question/Dispute`, or `Needs Human` |
| X | Client Reply Summary | short reply summary/snippet |
| Y | Follow-Up Attribution | reply/payment attribution note |
| Z | Reply Confidence | `Confirmed`, `Likely`, or `Unconfirmed` |

Never write to the tracker. Never mutate formula/display column N.

Compute:

- draft invoices pending John review
- invoices sent / awaiting payment
- payments completed in range
- partial payments
- overdue rows from column N or due date
- collections rows
- rows with missing email, invoice URL, origin thread, or Airwallex ID where relevant
- reminder counts from column L when parseable
- payment reminder performance:
  - follow-ups sent/logged in the requested range from Column L
  - latest follow-up state from Columns S-T; keep Column U hidden unless debugging raw Gmail metadata
  - client reply status from Columns V-Z; reply tracking is John-only via `john@kravemedia.co`
  - payments after follow-up by comparing Column L reminder dates to Column M payment confirmation dates
  - open invoices still unpaid after follow-up
  - next scheduled reminder based on the invoice reminder rules in `n8n-workflows/WORKFLOWS.md`
  - late-fee and collections eligibility dates
  - whether client reply tracking is available; if replies are not written to the tracker or otherwise readable, report `unavailable` instead of `0`

## Slack Context

Use Slack for narrative context and audit signals, not as the only metric source when tracker/n8n data is available.

Read:

- `#payments-invoices-updates` (`C09HN2EBPR7`): invoice requests, draft/finalization notices, payment confirmations, overdue alerts.
- `#airwallexdrafts` (`C0AQZGJDR38`): EOD, SOD, inbox triage, John approvals, workflow failure alerts.

Filter messages to the requested date range. Include relevant thread context when an action item depends on replies.

## Briefing Format

Use this structure:

```markdown
### Ops Report - [date range]

**Value Summary**
- Invoices created: [count]
- Invoices finalized/sent: [count]
- Follow-ups sent/logged: [count]
- Replies confirmed: [count]
- Payments after follow-up: [count and amount by currency]
- Open follow-up queue: [count]

**Workflow health**
- Executions: [total] total, [success] success, [failed] failed
- Failed: [workflow - failure summary]
- Quiet/stale: [active workflow with no execution if notable]

**Invoice Creation**
- Requests created: [count]
- Drafts created: [count]
- Finalized/sent: [count]
- Approval handoffs completed: [count]

**Payment Reminder Performance**
- Follow-ups sent/logged: [count]
- Client replies after follow-up: [count or unavailable]
- Paid after follow-up: [count and amount by currency]
- Still unpaid after follow-up: [count]

**Next follow-ups**
- [client/invoice] - [last follow-up] - [next follow-up] - [late-fee/collections date] - [owner/action]

**Finance movement**
- Invoice requests/drafts created: [count]
- Invoices finalized/sent: [count]
- Payments received: [count and amount by currency]
- Reminders/overdue escalations: [count]

**Current tracker state**
- Draft pending John: [count]
- Sent / awaiting payment: [count]
- Partial payment: [count]
- Payment complete: [count]
- Overdue / collections: [count]

**Action queue**
- [owner] - [specific item] - [why it matters]

**Source caveats**
- [Only include unavailable/incomplete sources]
```

Omit empty sections. Do not claim a workflow completed from a webhook acceptance alone; use n8n execution history or downstream outputs.

## Dashboard Snapshot

When useful, create a local HTML file under `reports/ops-report/` with a timestamped name such as:

`reports/ops-report/2026-05-01-week-to-date.html`

Keep it self-contained: inline CSS, no external assets, no secrets. Lead with visibility scorecards that show invoice creation, invoice approval/finalization, follow-up response tracking, and payments after follow-up. Keep workflow health lower on the page as technical support, and keep source caveats at the bottom. Include a next-follow-ups table with last follow-up, next follow-up, late-fee/collections dates, and owner/action. Tell the user the local path after creating it.

## Failure Rules

- If all sources fail, stop and report the blockers.
- If one source fails, continue with caveats.
- Distinguish `unavailable` from `0`.
- Do not send Slack messages unless the user explicitly asks to send or draft the report.
- Do not trigger n8n workflows from this skill; use `n8n-workflow-trigger` for that.
