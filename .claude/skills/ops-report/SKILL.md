# Skill: Ops Report

**Trigger:** "hey report", "ops report", "daily report", "weekly report", "dashboard report", "what ran today", "how many invoices", "how many reminders", "payment sent", "payments received", "execution report", "current tracker state"

**Purpose:** Generate a live-read only operations briefing and optional dashboard snapshot from n8n executions, the Client Invoice Tracker, and Slack context.

**Manual invoke:** `/ops-report`

---

## Operating Boundary

This skill reports current state. It does not trigger workflows, send Slack messages, mutate Google Sheets, update Airwallex, or maintain a separate report database.

Default ranges:

- `hey report` / `ops report` -> week-to-date
- `daily report`, `today's report`, `report today` -> current local day
- `weekly report` -> week-to-date
- explicit dates/ranges -> requested range

State the concrete range before reporting.

---

## Data Sources

| Source | ID / access | Use |
|---|---|---|
| n8n API | `https://noatakhel.app.n8n.cloud`, `N8N_API_KEY` | execution counts, failures, workflow health |
| Client Invoice Tracker | Sheet `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`, tab `Invoices` | invoice state and finance movement |
| `#payments-invoices-updates` | `C09HN2EBPR7` | invoice requests, payment confirmations, overdue alerts |
| `#airwallexdrafts` | `C0AQZGJDR38` | EOD, SOD, inbox triage, John approvals, failure alerts |

Read `n8n-workflows/WORKFLOWS.md` before reporting so workflow IDs, schedules, and tracker columns match the repo's current documentation.

Only report workflow health for Krave/Claude EA workflows listed in `n8n-workflows/WORKFLOWS.md`. Ignore unrelated n8n workspace workflows unless the operator explicitly asks for a full n8n workspace audit.

---

## Step 1 - Pull n8n execution history

Use the n8n public API when `N8N_API_KEY` is available.

PowerShell pattern:

```powershell
$headers = @{ 'X-N8N-API-KEY' = $env:N8N_API_KEY }
Invoke-RestMethod -Method Get -Uri 'https://noatakhel.app.n8n.cloud/api/v1/executions?limit=100' -Headers $headers
```

Filter executions to the requested range, exclude workflows not listed in `n8n-workflows/WORKFLOWS.md`, and group by workflow ID/name. Report:

- total executions
- successful executions
- failed/error executions
- active workflows with no execution during the range when notable
- most recent failure per affected workflow

If the API is unavailable, continue and include a caveat: `n8n execution history unavailable: [reason]`.

---

## Step 2 - Pull Client Invoice Tracker

Use Google Sheets MCP:

```text
sheets_get_rows(
  spreadsheet_id: "1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50",
  range: "Invoices!A:Y"
)
```

Column map:

| Col | Field | Report use |
|---|---|---|
| A | Date Created | invoices created in range |
| B | Client Name | action labels |
| C | Email Address | missing email risks |
| E | Invoice # | invoice reference |
| F | Airwallex Invoice ID | stable invoice key |
| G | Amount | AR totals |
| H | Currency | group totals by currency |
| I | Due Date | overdue risk |
| J | Payment Status | operational state |
| L | Reminders Sent | reminder counts/log |
| M | Payment Confirmed Date | payments received in range |
| N | Status | formula/display status; read only |
| P | Origin Thread TS | Slack audit-trail presence |
| Q | Amount Paid | partial/full payment state |
| R | Invoice URL | finalized invoice link state |
| S | Last Follow-Up Sent | latest tracked reminder date |
| T | Last Follow-Up Type | latest reminder tier |
| U | Last Follow-Up Thread ID | John Gmail reminder thread key or invoice-number fallback |
| V | Last Client Reply Date | latest detected client reply date from `john@kravemedia.co` only |
| W | Client Reply Status | `No Reply`, `Replied`, `Promise to Pay`, `Question/Dispute`, or `Needs Human` |
| X | Client Reply Summary | short reply summary/snippet |
| Y | Follow-Up Attribution | reply/payment attribution note |

Never write to the sheet. Never mutate column N.

Compute current state:

- draft invoices pending John review
- sent / awaiting payment
- payments completed in range
- partial payments
- overdue rows by column N or due date
- collections rows
- missing email, invoice URL, origin thread, or Airwallex ID where those fields should exist
- reminders sent from column L where parseable
- payment reminder performance:
  - follow-ups sent/logged in the requested range from Column L
  - latest follow-up state from Columns S-U
  - client reply status from Columns V-Y; reply tracking is John-only via `john@kravemedia.co`
  - payments after follow-up by comparing Column L reminder dates to Column M payment confirmation dates
  - open invoices still unpaid after follow-up
  - next scheduled reminder based on the invoice reminder rules in `n8n-workflows/WORKFLOWS.md`
  - late-fee and collections eligibility dates
  - whether client reply tracking is available; if replies are not written to the tracker or otherwise readable, report `unavailable` instead of `0`

---

## Step 3 - Pull Slack context

Read date-range messages from:

- `C09HN2EBPR7` (`#payments-invoices-updates`)
- `C0AQZGJDR38` (`#airwallexdrafts`)

Use Slack as narrative context and audit support. Tracker and n8n data remain the source of truth for counts when available.

Look for:

- invoice request receipts
- draft created notices
- approval/finalization notices
- payment confirmations
- overdue or missing-email alerts
- SOD/EOD summaries
- inbox triage summaries
- workflow failure alerts

Pull threads when the action state depends on replies.

---

## Step 4 - Format briefing

Use this structure:

```markdown
### Ops Report - [date range]

**Source caveats**
- [Only include unavailable/incomplete sources]

**Workflow health**
- Executions: [total] total, [success] success, [failed] failed
- Failed: [workflow - failure summary]
- Quiet/stale: [active workflow with no execution if notable]

**Payment reminder performance**
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
```

Omit empty sections. Distinguish unavailable data from zero activity.

---

## Step 5 - Optional dashboard snapshot

When useful, create a local HTML snapshot under:

`reports/ops-report/`

Use a timestamped filename, for example:

`reports/ops-report/2026-05-01-week-to-date.html`

The dashboard should be self-contained with inline CSS and no external assets. Include:

- source caveats
- reminder impact scorecards and next-follow-up table when invoice reminder data is available
- workflow health scorecards and table lower on the page as technical support
- finance movement scorecards
- tracker status table
- action queue

Do not include secrets, API keys, raw private tokens, or unnecessary message dumps.

---

## Failure Handling

- If all sources fail, stop and report the blockers.
- If one source fails, continue with caveats.
- Do not infer missing counts from Slack alone if the tracker or n8n source failed.
- Do not claim a workflow completed from a webhook acceptance alone.
- Do not send or schedule Slack messages unless the operator explicitly asks for that after reviewing the report.
