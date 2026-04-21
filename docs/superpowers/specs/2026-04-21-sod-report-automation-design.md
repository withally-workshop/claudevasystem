# Start Of Day Report Automation Design

Date: 2026-04-21
Status: Revised after operator review
Scope: Design only. No implementation in this document.

## Goal

Translate the existing `.claude/skills/sod-report/SKILL.md` process into a dedicated `n8n` automation that assembles Noa's Start of Day report from Slack inputs and posts the finished report to both `#airwallexdrafts` and Noa's Slack DM.

The workflow should:

- be deployed to n8n and remain active so the production webhook stays registered
- run when manually triggered from the editor or via the production webhook
- require all three source inputs before generating output
- read source messages from `#airwallexdrafts`
- build the report in the current SOD house format
- send the final report to both `#airwallexdrafts` and Noa's DM
- fail loudly instead of sending a partial report

## Source Of Truth

Primary source materials discovered in this repo:

- `.claude/skills/sod-report/SKILL.md`
- `references/sops/sod-report.md`
- `n8n-workflows/deploy-eod-triage-summary.js`

Known source drift that must be resolved during implementation:

- the current skill and SOP say the workflow may continue without `Morning Triage`
- product decision for this automation is now the opposite: missing `Morning Triage` is a hard stop

Until the skill and SOP are updated, this design document is the implementation source of truth for validation behavior.

## Scope

### In scope for v1

- active `n8n` workflow with registered production webhook
- manual `n8n` execution path
- production webhook trigger for morning execution and reruns
- one controlled real-data test run against the live `#airwallexdrafts` history
- Slack history fetch from `#airwallexdrafts`
- extraction of three required source blocks:
  - yesterday's EOD carry-over
  - John's same-day morning dump
  - today's `Morning Triage`
- hard-stop validation before report generation
- OpenAI-assisted report composition
- Slack delivery to both `#airwallexdrafts` and Noa's DM
- failure alerting when a required source block is missing or delivery fails
- repo docs/tests/deploy script for the workflow

### Explicitly out of scope for v1

- scheduled execution
- fallback generation with partial inputs
- reading from channels other than `#airwallexdrafts`
- automated retries that rerun the full workflow after a validation failure
- auto-editing or deleting prior Slack posts

## Recommended Approach

Use a manual-trigger hybrid workflow:

- deterministic parsing identifies the required source messages in Slack history
- deterministic validation blocks generation if any required source is missing
- OpenAI only handles the final synthesis of the SOD report from validated inputs

This keeps extraction and gating auditable while still using AI for concise formatting and judgment-heavy summarization.

## Workflow Overview

### Trigger layer

The workflow has two entry points:

- `Manual Trigger`
- `Webhook Trigger`

There is no schedule in v1. Operators run the workflow only after all expected morning inputs are present in Slack. After deployment, the workflow remains active so the production webhook stays registered, and operators trigger it each morning either by webhook or from the editor.

Recommended webhook path:

`POST /webhook/krave-sod-report`

### Fetch layer

The workflow reads recent message history from `#airwallexdrafts`.

The fetch window should be large enough to cover:

- the previous day's end-of-day post
- all same-day morning operator posts
- the same-day `Morning Triage` bot post

The workflow should normalize Slack message data into a compact structure containing:

- message timestamp
- local time in `Asia/Manila`
- sender user or bot identity
- raw text
- cleaned text
- thread timestamp when present

### Extraction layer

A code node should split Slack history into three required source groups.

#### Group A: Yesterday's EOD

Identify the most recent prior-day bot message in `#airwallexdrafts` containing:

`Today's Wrap-up`

Extract:

- `Not Completed / Needs More Work / Planned Next Steps`
- `Blocker / Input Needed`

This becomes the structured carry-over context.

#### Group B: John's morning dump

Identify same-day messages posted by John before the workflow run.

These messages provide:

- `Focus Goals`
- same-day blockers
- any extra priority context for Noa

Parsing rules for John's input:

- any same-day John message in `#airwallexdrafts` counts as the required John source
- if John's messages contain bullet-style lines, keep structured extraction into `focusGoals`, `blockers`, and `notes`
- if John's messages are paragraph-style or otherwise unstructured, preserve the raw same-day message text and pass it forward as fallback prompt context

#### Group C: Today's `Morning Triage`

Identify the same-day bot message in `#airwallexdrafts` containing:

`Morning Triage`

Extract:

- inbox follow-ups
- urgent reply work
- `Review These`
- any useful BAU items that should appear in the SOD report

### Validation layer

Validation is a hard gate.

The workflow must stop before report generation if any required source block is missing:

- no prior-day EOD found
- no same-day John morning dump found
- no same-day `Morning Triage` found

On validation failure, the workflow should post a minimal Slack alert to `#airwallexdrafts` naming only the missing source or sources and should not DM Noa.

### Composition layer

Once inputs are validated, OpenAI receives a structured prompt containing:

- extracted carry-over items
- unresolved blockers
- John's focus goals and notes
- John's raw same-day message text when structured extraction is sparse or absent
- inbox triage BAU/follow-up items

The model should return Slack-ready markdown only in the exact house format:

```md
### Today's Goals

**Focus Goals**
- [item]

**Carry-over from Yesterday**
- [item]

**Blocker / Input Needed**
- [item]

**BAU / Follow-ups (Business As Usual)**
- [item]
```

Rules:

- bullets only
- no paragraphs
- omit empty sections only if extraction truly produced no items for that section
- preserve urgency labels and deadlines inline when present
- do not invent work that is not grounded in the extracted Slack inputs

### Delivery layer

After generation succeeds, the workflow posts the same report to:

- `#airwallexdrafts`
- Noa's Slack DM

Delivery behavior:

- post to `#airwallexdrafts` first for auditability
- then DM Noa
- if archive post fails, stop and raise failure alert
- if archive post succeeds but DM fails, retry the Noa DM once
- if the retry also fails, raise a failure alert in `#airwallexdrafts`
- never rerun extraction or generation as part of DM retry handling

## Components

Expected node groups for the deploy script:

1. `Manual Trigger`
2. `Webhook Trigger`
3. `Fetch #airwallexdrafts History`
4. `Normalize Slack Messages`
5. `Extract SOD Inputs`
6. `Validate Required Inputs`
7. `Build SOD Prompt`
8. `Generate SOD Report`
9. `Post to #airwallexdrafts`
10. `DM Noa`
11. `Post Failure Alert`

The exact node names may vary, but these responsibilities should remain intact.

## Data Contract

The extraction node should emit a single structured payload shaped approximately like:

```json
{
  "date": "2026-04-21",
  "timezone": "Asia/Manila",
  "eod": {
    "messageTs": "1713630000.000100",
    "carryOverItems": ["..."],
    "blockers": ["..."]
  },
  "johnMorning": {
    "messageCount": 2,
    "focusGoals": ["..."],
    "blockers": ["..."],
    "notes": ["..."],
    "rawTexts": ["..."]
  },
  "morningTriage": {
    "messageTs": "1713715500.000200",
    "urgent": ["..."],
    "needsReply": ["..."],
    "reviewThese": ["..."],
    "bauFollowUps": ["..."]
  }
}
```

This contract keeps the prompt stable and makes failures easier to test.

## Failure Modes

### Missing source input

If any required source block is missing:

- mark the workflow run as failed
- post a minimal alert to `#airwallexdrafts` naming only the missing source or sources
- do not generate the SOD report
- do not DM Noa

### Slack delivery failure

If the archive post or DM post fails:

- retry the Noa DM once if the archive post succeeded but the first DM failed
- post a compact failure alert if the archive post fails or the DM retry also fails
- avoid rerunning extraction or generation automatically
- make manual resend easy from the failure payload

### Parsing ambiguity

If a message is found but section extraction is ambiguous:

- prefer explicit section labels from the source text
- fall back to a conservative line-based parse
- if parsing still cannot confidently produce a required input block, fail validation instead of guessing

## Public Interfaces

- deploy entrypoint:
  - `node n8n-workflows/deploy-sod-report.js`
- manual webhook:
  - `POST /webhook/krave-sod-report`
- Slack destinations:
  - `#airwallexdrafts`
  - Noa DM

## Testing Strategy

Implementation should include lightweight contract tests for:

- required node presence
- webhook path
- Slack credential wiring
- OpenAI node presence
- validation hard-stop path for each missing source type
- John raw-text fallback context when bullet parsing does not produce structured items
- DM retry path after successful archive post
- delivery path to both destinations

## Open Follow-On Work

After v1 implementation lands, sync these source docs to match the new hard-stop behavior:

- `.claude/skills/sod-report/SKILL.md`
- `references/sops/sod-report.md`

If future operations prove stable, a later version could add a scheduler that first checks for all required inputs and only then runs generation. That is intentionally deferred from v1.
