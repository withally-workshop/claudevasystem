# Inbox Triage Daily Triage Design

Date: 2026-04-21
Status: Proposed and approved for spec writing
Scope: Design only. No implementation in this document.

## Goal

Translate the existing `.claude/skills/inbox-triage/SKILL.md` process into an `n8n` automation, starting with `Daily Triage` as the first production slice and reserving `Inbox Zero Setup` for a supervised follow-on workflow.

The workflow should:

- Read new inbox email from `noa@kravemedia.co`
- Classify each email into the existing tier model
- Create Gmail drafts for emails that need replies
- Apply Gmail labels and archive non-ambiguous emails
- Post a Slack summary to both `#airwallexdrafts` and Noa's Slack DM
- Avoid sending email automatically
- Keep ambiguous emails in the inbox for human review

## Source Of Truth

Primary source materials discovered in this repo:

- `.claude/skills/inbox-triage/SKILL.md`
- `README.md`
- `CLAUDE.md`
- `references/sops/eod-triage-summary.md`
- `n8n-workflows/deploy-eod-triage-summary.js`

Known gap:

- `.claude/skills/inbox-triage/SKILL.md` references `references/sops/inbox-triage.md`, but that SOP file does not exist in the current checkout. For implementation, the skill file will be treated as the operational source of truth until a dedicated SOP is added.

## Scope

### In scope for v1

- Scheduled `Daily Triage` workflow in `n8n`
- Manual webhook trigger for testing and reruns
- Gmail search for new inbox items since the previous day
- Message normalization for classification and summary generation
- Hybrid classification pipeline using deterministic rules plus OpenAI
- Gmail draft creation for `EA/Urgent` and `EA/Needs-Reply`
- Gmail tier/context label application
- Auto-archive for all tiers except `EA/Unsure`
- Slack summary posting to both `#airwallexdrafts` and Noa's DM
- Failure reporting for message-level processing and Slack delivery
- Repo docs/tests/deploy script for the workflow

### Explicitly out of scope for v1

- Automated email sending
- Full `Inbox Zero Setup` bulk archival/categorization flow
- Dynamic label-taxonomy discovery from historical inbox analysis
- Human approval queue inside `n8n` before every archive action
- Gmail thread sentiment scoring or advanced priority scoring

## Recommended Approach

Use a hybrid automation design:

- Deterministic rules handle obvious high-risk or low-risk cases
- OpenAI handles nuanced classification and reply drafting
- Gmail mutation remains guarded by explicit fail-safe logic

This balances safety and flexibility better than a rules-only or LLM-only design.

## Workflow Overview

### Trigger layer

The workflow has two entry points:

- `Schedule 9am ICT Weekdays`
- `Webhook Trigger`

The schedule is the intended production path. The webhook is for manual reruns, testing, and validation without waiting for the morning schedule.

### Fetch layer

The Gmail search node queries for a date string computed at runtime in `Asia/Manila`, for example:

`in:inbox after:2026/04/20`

This keeps the run focused on fresh inbox items while preserving the skill's daily-triage intent.

Each matching message is then expanded into a normalized record containing:

- Gmail message ID
- Thread ID
- Sender name
- Sender email
- Subject
- Snippet
- First meaningful body chunk
- Received timestamp

### Classification layer

Classification runs in two stages.

Stage 1: deterministic rule pass

- `EA/Urgent` if legal, contract, payment-risk, or deadline-today indicators appear
- `EA/Needs-Reply` minimum for known internal/high-priority contacts
- `EA/Auto-Sorted` for clear newsletters, receipts, and automated notifications
- never auto-sort known contacts
- route only unresolved messages to the AI classifier

Stage 2: OpenAI assist

OpenAI receives normalized message context and must return:

- `tier`
- optional `context_label`
- `reason`
- `draft_required`
- `summary_line`

The model must choose from the allowed tier set only:

- `EA/Urgent`
- `EA/Needs-Reply`
- `EA/FYI`
- `EA/Auto-Sorted`
- `EA/Unsure`

### Drafting layer

Only messages classified as `EA/Urgent` or `EA/Needs-Reply` move into reply drafting.

The drafting node will:

- generate a reply in Noa's voice
- use the 3-and-1 framework when decision-making is involved
- create a Gmail draft only
- never send

Draft metadata should flow back into the summary payload so Slack can say `Draft ready in Gmail`.

### Label and archive layer

For each processed email:

- apply one tier label
- apply one context label if available and mapped
- remove `INBOX` for every tier except `EA/Unsure`

`EA/Unsure` is the only class that remains in the inbox after a successful run.

### Summary layer

After message processing, the workflow builds a Slack-ready morning summary with sections for:

- `URGENT`
- `Needs Your Reply`
- `FYI`
- `Review These`
- `Auto-Sorted`
- final inbox count

The summary should preserve the current skill intent but route to both destinations:

- `#airwallexdrafts`
- Noa Slack DM

## Initial Label Model

Because the historical taxonomy-discovery setup flow is not yet automated, v1 will use a fixed starter label set.

### Tier labels

- `EA/Urgent`
- `EA/Needs-Reply`
- `EA/FYI`
- `EA/Auto-Sorted`
- `EA/Unsure`

### Starter context labels

- `Krave`
- `IM8`
- `Halo-Home`
- `Skyvane`
- `Invoices`
- `Contracts`
- `Receipts`
- `Suppliers`

If no context label is a confident fit, the workflow should skip context labeling rather than force a bad match.

## Components

Expected node groups for the deploy script:

1. `Schedule 9am ICT Weekdays`
2. `Webhook Trigger`
3. `Search Inbox`
4. `Fetch Message Details`
5. `Normalize Email`
6. `Rules Classifier`
7. `AI Classifier`
8. `Merge Classification`
9. `Draft Reply`
10. `Create Gmail Draft`
11. `Apply Tier Label`
12. `Apply Context Label`
13. `Archive Non-Unsure`
14. `Build Slack Summary`
15. `Post to #airwallexdrafts`
16. `DM Noa`
17. `Slack Retry / Failure Alert`

The actual node names may differ, but these responsibilities should remain intact.

## Data Contracts

Each normalized email should carry a compact contract like:

```json
{
  "message_id": "gmail-message-id",
  "thread_id": "gmail-thread-id",
  "from_name": "Sender Name",
  "from_email": "sender@example.com",
  "subject": "Subject line",
  "snippet": "Short Gmail snippet",
  "body_preview": "First meaningful body lines",
  "received_at": "2026-04-21T08:12:00+08:00",
  "tier": "EA/Needs-Reply",
  "context_label": "Krave",
  "reason": "Client asked for approval on revised scope.",
  "draft_required": true,
  "draft_subject": "Re: Subject line",
  "summary_line": "Acme Client | Q2 scope approval - waiting on Noa to confirm revised deliverables"
}
```

This contract keeps downstream nodes testable and reduces accidental shape drift.

## Error Handling

### Message-level failures

If one email fails during processing:

- do not stop the entire run unless the failure is upstream/global
- leave the email in inbox if label/archive mutation did not complete
- append a clear failure note into the final Slack report

### Slack delivery failures

Slack delivery should retry once per destination.

If one destination fails after retry:

- still attempt the other destination
- post a manual-action alert to `#airwallexdrafts`

### Gmail draft failures

If drafting fails:

- keep the classification result
- do not archive until labeling logic finishes successfully
- mark the email as `draft_failed` in the Slack summary

### Global upstream failures

Examples:

- Gmail auth broken
- OpenAI auth broken
- malformed workflow output shape

In those cases:

- abort safely
- post a failure alert to `#airwallexdrafts`
- avoid inbox mutation on unprocessed emails

## Testing Strategy

The workflow should follow the repo's existing contract-test pattern.

### Required tests

- deploy-script structural contract test
- connection integrity test
- classification rules coverage for:
  - urgent legal/payment/deadline signals
  - auto-sorted newsletter/receipt signals
  - known-contact protection from auto-sort
  - unsure retention behavior
- summary contract test
- documentation assertions for README and `WORKFLOWS.md`

### Verification targets

- workflow contains both schedule and webhook triggers
- allowed tiers are hardcoded in classifier prompt/logic
- `EA/Unsure` path does not remove `INBOX`
- Slack posts go to both `#airwallexdrafts` and Noa DM
- draft creation exists only for `Urgent` and `Needs-Reply`

## Dependencies

Expected `n8n` credentials:

- `Gmail account` for `noa@kravemedia.co`
- `Krave Slack Bot`
- `OpenAI account`

The design assumes these credentials already exist or can be provisioned before live deployment.

## Future Slice: Inbox Zero Setup

`Inbox Zero Setup` should be implemented as a separate supervised workflow after `Daily Triage` is stable.

Design direction for that follow-on:

- manual trigger only
- read existing Gmail labels first
- sample 2026 messages to propose taxonomy
- require explicit human approval before label creation
- batch archive pre-2026 emails in chunks
- categorize 2026 inbox items with progress reporting
- post setup summary to `#airwallexdrafts`

This should not share the same production trigger as `Daily Triage`.

## Open Decisions Resolved In This Spec

- `Daily Triage` is the first implementation slice
- `Inbox Zero Setup` is supervised and deferred
- v1 posts to both `#airwallexdrafts` and Noa DM
- v1 uses a fixed starter context-label set
- ambiguous emails remain in inbox as `EA/Unsure`
- no automatic sending of email

## Implementation Readiness

This design is ready to turn into an implementation plan once the user reviews the written spec and confirms there are no scope changes.
