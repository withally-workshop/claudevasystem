# Ops Report Skill Design

## Goal

Build a dual-agent `ops-report` skill that can be invoked with phrases like "hey report", "ops report", "daily report", or "weekly report" to generate a live operations briefing and dashboard snapshot for Krave's automation system.

## Scope

Version 1 is live-read only. It must not create a database, scheduled job, persistent metric store, or tracker-write path. Each run reads current source systems, computes the report for the requested date range, emits the briefing, and optionally writes a local HTML dashboard artifact.

The skill must exist for both agents:

- `.claude/skills/ops-report/SKILL.md`
- `.agents/skills/ops-report/SKILL.md`

The Codex workflow dispatcher must know when to route reporting requests to the new skill.

## Default Behavior

Generic invocations such as "hey report" or "ops report" default to week-to-date in the operator's current timezone. Explicit invocations override that default:

- "daily report", "today's report", or "report today" use the current day.
- "weekly report" uses the current week-to-date.
- Explicit dates or ranges use the requested start and end dates.

If a relative date is ambiguous, the agent must state the concrete date range it is using before reporting.

## Live Data Sources

The report combines three source families.

First, n8n execution history provides workflow health. The report should use the n8n public API with `N8N_API_KEY` when available and query executions for the active workflow IDs in `n8n-workflows/WORKFLOWS.md`. It should count total executions, successful executions, failed/error executions, active workflows with no execution during the range, and recent failure details. If the n8n API key is unavailable, the report must continue with a clear "n8n execution history unavailable" caveat instead of inventing counts.

Second, the Client Invoice Tracker Google Sheet is the finance source of truth. The report reads spreadsheet `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`, tab `Invoices`, range `A:R`. It computes current tracker state by status, including draft invoices pending John review, invoices sent and awaiting payment, payment complete, partial payment, collections, overdue/display status from column N, reminder-log presence from column L, payment confirmed dates from column M, amount paid from column Q, and invoice URLs from column R. It must never write to the sheet and must never write to formula/display column N.

Third, Slack gives narrative and audit context. The report reads `#payments-invoices-updates` (`C09HN2EBPR7`) for invoice requests, payment confirmations, overdue alerts, and approval/finalization notifications. It reads `#airwallexdrafts` (`C0AQZGJDR38`) for EOD, SOD, inbox triage, John task dumps, and workflow failure alerts. Slack context should explain what changed and what needs action; tracker and n8n data remain the metric source of truth when available.

## Output

The primary output is a concise briefing suitable for terminal or Slack review. It should include:

- Date range and source caveats.
- Payment reminder performance: follow-ups sent, replies received, payments after follow-up, money recovered after follow-up, invoices still waiting after follow-up, and no-response invoices.
- Next follow-ups: invoice-level next reminder dates, late-fee dates, collections dates, owner, and action.
- Finance movement: invoice requests/drafts created, invoices finalized/sent, payments completed, partial payments, reminders/overdue escalations, and open AR state.
- Current tracker state: counts by operational status and a short list of items needing action.
- Workflow health: execution totals, failures, stale workflows, and failed workflow names. This is supporting context, not the lead story when reminder data exists.
- Action queue: items that need John, Noa, strategist, or manual systems attention.

The secondary output is a local HTML dashboard snapshot when the agent has enough data to generate it. The dashboard should be saved under `reports/ops-report/` with a timestamped filename. It should include scorecards, workflow-health table, tracker-status table, and action queue. Generated report artifacts are local outputs and should be ignored by git.

## Reminder Attribution Upgrade

The current tracker can show that reminders were sent and that payments later arrived, but it cannot prove client replies because reminder email replies are not written back to the sheet. The upgrade adds a reminder attribution layer focused only on `john@kravemedia.co`.

Reply detection must watch only John's Gmail inbox and sent reminder threads. If a client replies to Noa, Amanda, or another strategist outside John's thread, the system does not count that as a tracked reply unless the team forwards it into John's thread or manually records it later. This keeps the attribution model narrow, auditable, and aligned with the inbox the agent can actually inspect.

The tracker should gain these columns after Column R:

- S `Last Follow-Up Sent`
- T `Last Follow-Up Type`
- U `Last Follow-Up Thread ID`
- V `Last Client Reply Date`
- W `Client Reply Status`
- X `Client Reply Summary`
- Y `Follow-Up Attribution`

`Invoice Reminder Cron` should continue writing Column L as the historical reminder log, and additionally write S/T/U for the latest reminder sent from `john@kravemedia.co`. It should never overwrite client reply columns V/W/X unless the reminder event explicitly resets or supersedes the prior response state by design.

A new `Invoice Reminder Reply Detection` workflow should run on a schedule, read John Gmail reminder threads, detect client replies newer than the last recorded follow-up, classify them conservatively, and update V/W/X. The first version should use these statuses only:

- `No Reply`
- `Replied`
- `Promise to Pay`
- `Question/Dispute`
- `Needs Human`

The reply detector must not auto-respond to clients. It reports and updates tracker state only.

The ops report should attribute a payment to a follow-up when the invoice had a follow-up sent before the payment confirmation date, the payment confirmation is within a configurable attribution window, and the invoice/client matches the tracker row. The initial attribution window is 14 days. If the data is missing or ambiguous, the report should say attribution is unavailable or uncertain rather than counting it as a win.

## Reminder Data Flow

1. `Invoice Reminder Cron` sends a reminder from `john@kravemedia.co`.
2. It writes the reminder history to Column L and the latest follow-up metadata to S/T/U.
3. `Invoice Reminder Reply Detection` scans John's Gmail reminder threads and writes reply status to V/W/X.
4. `Payment Detection` continues writing payment status and payment confirmation dates to J/M/Q.
5. `Ops Report` reads L/M/S:Y and produces reminder performance, response status, paid-after-follow-up, and next-follow-up tables.

## Scheduling and Escalation Rules

The next-follow-up table should derive reminder timing from `n8n-workflows/WORKFLOWS.md` and the deployed reminder workflow rules:

- +7, +5, +3, +1 days before due: pre-due payment reminders.
- 0 days: due-today reminder.
- -1 to -6 days: overdue reminder.
- -7 days: late-fee event.
- -8 to -59 days: late-fee follow-up, deduped weekly.
- <= -60 days: collections.

The report should surface the next eligible reminder date, late-fee date, and collections date per open invoice. It should also identify rows where the next reminder is blocked because required data is missing, such as client email or invoice URL.

## Failure Handling

Missing source access should degrade the report, not stop it, unless all live sources fail. Each source caveat must be named in the final briefing. The report must distinguish unavailable data from zero activity.

If n8n execution history is unavailable, still report tracker and Slack state. If Google Sheets is unavailable, still report n8n workflow health and Slack narrative, but label finance counts as incomplete. If Slack is unavailable, still report n8n and tracker counts, but omit narrative context.

## Non-Goals

The report skill itself does not send messages automatically, trigger n8n workflows, mutate invoice tracker rows, reconcile Airwallex directly, or store historical metrics. It also does not replace the existing `/weekly-review` skill; it complements it with automation health and tracker-state reporting.

The reminder attribution upgrade does not monitor Noa or strategist inboxes, does not infer client replies from Slack, does not auto-reply to clients, and does not treat missing reply data as zero replies.

## Validation

The implementation must validate that the new skills are present in both agent locations, that the Codex dispatcher routes report phrases to the skill, that generated dashboard artifacts are ignored by git, and that any helper scripts run without live credentials using fixture data.

The reminder attribution upgrade must validate that tracker column additions do not disturb existing A:R behavior, that Column N remains formula-only, that reply detection is scoped to `john@kravemedia.co`, and that attribution reports distinguish confirmed, uncertain, and unavailable data.
