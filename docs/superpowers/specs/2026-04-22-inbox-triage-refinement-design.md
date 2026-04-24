# Inbox Triage Daily Refinement Design

Date: 2026-04-22
Status: Proposed and approved for spec writing
Scope: Design only. No implementation in this document.

## Goal

Refine the existing `Inbox Triage Daily` skill and `n8n` workflow so the automation behaves like the intended triage policy instead of sending every message through the same downstream path.

The refined workflow should:

- search only recent inbox mail instead of the whole inbox
- include both unread and read inbox emails from the last 24 hours
- classify every in-scope email
- use rules first and only call AI for ambiguous emails
- create drafts only when a draft is actually needed
- detect when a thread is already in motion
- repair labels even when a thread was already handled
- keep already-actioned urgent work visible in the main Morning Triage output
- continue posting the Morning Triage summary to both `#airwallexdrafts` and Noa's Slack DM

## Source Of Truth

Primary source materials discovered in this repo:

- `.claude/skills/inbox-triage/SKILL.md`
- `n8n-workflows/deploy-inbox-triage-daily.js`
- `n8n-workflows/inbox-triage-daily.test.js`
- `n8n-workflows/README.md`
- `n8n-workflows/WORKFLOWS.md`

Known repo gap:

- `.claude/skills/inbox-triage/SKILL.md` still references `references/sops/inbox-triage.md`, but that SOP does not exist in this checkout

Known workflow defect to address:

- the current workflow shape sends all emails through AI classification and draft generation, even when rule-based classification already resolved the message and no draft should exist

Until a dedicated inbox-triage SOP exists, the skill file plus this design should be treated as the planning source of truth.

## Scope

### In scope for this refinement

- update the daily Gmail search window to last-24-hours inbox mail only
- keep both schedule and webhook triggers
- add explicit workflow gates for:
  - AI classification only when `ai_needed = true`
  - draft creation only when `draft_required = true` and the thread is not already actioned
- add explicit already-actioned detection using three signals:
  - Noa already replied in the thread
  - a draft already exists in the thread
  - the message or thread already has an `EA/*` label
- keep label repair enabled even for already-actioned threads
- annotate already-actioned items inline in the Morning Triage summary
- extend tests to cover behavior, not only workflow shape
- sync the skill and workflow docs to the refined behavior

### Explicitly out of scope

- implementing `Inbox Zero Setup`
- introducing persistent timestamps or checkpoint storage
- processing archived mail or the entire inbox history
- automatic email sending
- a brand-new workflow id or workflow split

## Recommended Approach

Use a hybrid classification design with explicit control-flow gates.

- deterministic rules handle obvious urgent, known-contact, and auto-sorted cases
- OpenAI only handles messages that remain ambiguous after rules
- draft creation is a separate gate from classification
- already-actioned detection prevents duplicate work without hiding important threads from the summary

This is preferable to an AI-first design because it keeps costs and runtime lower, preserves deterministic handling for obvious cases, and matches the original intent of the skill.

## Workflow Overview

### Trigger layer

The workflow keeps two entry points:

- `Schedule 9am ICT Weekdays`
- `Webhook Trigger`

No new workflow is introduced. The refinement updates the existing live workflow in place.

### Fetch layer

The workflow should stop querying broad inbox history.

Recommended Gmail query:

`in:inbox newer_than:1d`

Reasoning:

- covers the last 24 hours only
- includes both unread and read inbox emails
- avoids reprocessing archived mail
- matches the daily-triage operating rhythm without introducing checkpoint state

### Normalize layer

Each message should still be normalized into a compact per-email payload, but the payload should now also preserve enough state for action detection and label repair.

Recommended normalized fields:

- `message_id`
- `thread_id`
- `from_name`
- `from_email`
- `subject`
- `snippet`
- `body_preview`
- `received_at`
- existing Gmail label ids or label names
- any thread metadata needed for reply or draft detection

### Action-state detection layer

Add a dedicated stage before drafting that computes whether the thread is already in motion.

It should detect:

- `already_replied`
- `draft_exists`
- `already_labeled`
- `already_actioned`
- `already_actioned_reason`

Decision rule:

- if any one of the three signals is true, mark the thread as already actioned
- already-actioned threads still move through classification and label repair
- already-actioned threads do not create a fresh draft

### Classification layer

Classification should become explicitly two-stage instead of a single always-on path.

Stage 1: rules pass

- `EA/Urgent` for obvious legal, contract, overdue, payment-risk, or deadline-today signals
- `EA/Needs-Reply` minimum for known contacts and known high-priority senders
- `EA/Auto-Sorted` for clear newsletters, receipts, and automated notifications
- never auto-sort a known contact
- set `ai_needed = false` when rules are sufficient

Stage 2: AI assist only when needed

- if `ai_needed = true`, route the normalized payload to OpenAI
- if `ai_needed = false`, skip the AI node entirely

The classifier output must normalize back into one shared final contract regardless of whether the decision came from rules or AI.

### Drafting layer

Drafting becomes its own explicit gate.

Draft only when:

- `draft_required = true`
- `already_actioned = false`

Do not draft when:

- the item is `EA/FYI`
- the item is `EA/Auto-Sorted`
- the item is already replied to
- a draft already exists
- the email is only being reclassified or relabeled

This prevents duplicate drafts and avoids wasting AI time on non-actionable mail.

### Label repair layer

Label updates remain allowed even when the thread is already handled.

Refined rule:

- always apply the best current tier classification
- add or repair the context label when the new classification is more accurate
- treat labels as current workflow state, not immutable history

This lets the workflow improve inbox hygiene without creating duplicate human work.

### Archive layer

Archive behavior stays close to the current policy:

- `EA/Unsure` remains in inbox
- all other tiers may leave inbox after processing

Already-actioned status does not automatically block archival. The refinement keeps the inbox-focused operating model unless later operator feedback says certain handled threads should remain visible.

### Summary layer

Morning Triage keeps the normal sections:

- `URGENT`
- `Needs Your Reply`
- `FYI`
- `Review These`
- `Auto-Sorted`

Already-actioned emails still appear in their normal section, but with inline notes such as:

- `already replied`
- `draft exists`
- `already labeled`
- `action-state unknown`

Urgent items remain in `URGENT` even if they are already in motion.

If no emails match the last-24-hours inbox query, the workflow should still post a compact summary that makes it clear the inbox was effectively clear, rather than looking broken or silent.

## Components

Expected logical node groups after refinement:

1. `Schedule 9am ICT Weekdays`
2. `Webhook Trigger`
3. `Build Gmail Query`
4. `Search Inbox`
5. `Fetch Message Details`
6. `Normalize Email`
7. `Detect Existing Handling`
8. `Rules Classifier`
9. `Need AI?`
10. `AI Classifier`
11. `Merge Final Classification`
12. `Should Draft?`
13. `Draft Reply`
14. `Create Gmail Draft`
15. `Prepare Gmail Mutation`
16. `Apply Tier Label`
17. `Apply Context Label`
18. `Archive Decision`
19. `Archive Non-Unsure`
20. `Build Slack Summary`
21. `Post to Airwallex Drafts`
22. `DM Noa Summary`
23. `Slack Retry / Failure Alert`

The actual node names may vary, but the workflow must preserve these decisions as explicit branches instead of implicit prompt fields.

## Data Contract

Recommended merged downstream payload:

```json
{
  "message_id": "gmail-message-id",
  "thread_id": "gmail-thread-id",
  "from_name": "Sender Name",
  "from_email": "sender@example.com",
  "subject": "Subject line",
  "snippet": "Short Gmail snippet",
  "body_preview": "First meaningful body lines",
  "received_at": "2026-04-22T08:12:00+08:00",
  "tier": "EA/Needs-Reply",
  "context_label": "Krave",
  "reason": "Client asked for confirmation on revised scope.",
  "summary_line": "Acme | Scope approval needed today",
  "draft_required": true,
  "ai_needed": false,
  "already_replied": false,
  "draft_exists": true,
  "already_labeled": false,
  "already_actioned": true,
  "already_actioned_reason": "draft exists",
  "summary_status_note": "draft exists"
}
```

This contract keeps summary generation and label/archive logic simple and testable.

## Edge Cases And Decision Rules

- If no emails match the fetch query, still post a compact Morning Triage result instead of failing silently.
- If action-state detection fails, continue processing and mark the item as `action-state unknown`.
- If signals conflict, prefer the more conservative tier ordering:
  - `EA/Urgent`
  - `EA/Needs-Reply`
  - `EA/FYI`
  - `EA/Auto-Sorted`
- If classification is still ambiguous after review, keep `EA/Unsure` and leave it in inbox.
- If a thread is already actioned but the new classification is better, repair the labels anyway.
- If a thread is already actioned and still urgent, keep it in `URGENT` with an inline note.
- If label application fails for one message, continue processing the rest and include the failure in the final summary or failure alert.
- If Slack delivery fails, keep the existing retry pattern, but make the alert explicit that workflow processing completed and delivery alone needs manual follow-up.

## Testing Strategy

The current tests over-index on structure and under-test runtime behavior. The refinement should add behavior-level contract checks.

### Required test coverage

- Gmail query uses last-24-hours inbox scope instead of broad historical search
- rules-only items skip AI classification
- AI only runs when `ai_needed = true`
- draft creation only runs when `draft_required = true` and `already_actioned = false`
- already-actioned detection covers:
  - replied thread
  - existing draft
  - existing `EA/*` label
- urgent already-in-motion items remain in the `URGENT` summary section with an inline note
- `EA/Unsure` remains in inbox
- no-email runs still produce a compact Morning Triage summary
- Slack delivery still targets both `#airwallexdrafts` and Noa DM
- connection-integrity coverage remains in place for graph-level regressions

## Docs To Sync During Implementation

When implementation starts, the same round should update:

- `.claude/skills/inbox-triage/SKILL.md`
- `n8n-workflows/README.md`
- `n8n-workflows/WORKFLOWS.md`

The skill should stop implying that every fresh inbox item is processed identically and should reflect the last-24-hours query plus already-actioned behavior.

## Open Decisions Resolved In This Spec

- keep the hybrid rules-first design
- search last-24-hours inbox mail only
- include read and unread inbox emails
- classify every in-scope email
- use combined already-actioned detection:
  - replied
  - draft exists
  - existing `EA/*` label
- show already-actioned emails inline in normal Morning Triage sections
- allow label repair even when a thread is already handled
- keep already-actioned urgent items inside `URGENT`

## Implementation Readiness

This design is ready to turn into an implementation plan once the user reviews the written spec and confirms there are no scope changes.
