# SOP: Start of Day Report

**Owner:** John (operator)
**Recipient:** Noa Takhel (via Slack DM) and `#ops-command`
**Frequency:** Local/manual only for now
**Skill:** `.claude/skills/sod-report/SKILL.md`
**Trigger:** Manual `n8n` run or `POST /webhook/krave-sod-report`

---

## Purpose

Give Noa a clear picture of what's happening today before her deep work block starts at 1:30 PM ICT. The workflow surfaces John's focus goals, carry-overs from yesterday's EOD, blockers needing her input, and, when available, the morning inbox-triage follow-ups, then posts the same final report to both Noa's DM and `#ops-command`.

---

## How It Works

### Manual / Webhook Flow

| Time (GMT+8) | Action |
|---|---|
| Before run | John posts focus goals + context to `#ops-command` |
| Run time | Operator triggers the local/manual workflow or `POST /webhook/krave-sod-report` |
| Run time | Workflow reads yesterday's EOD from `#ops-command` for carry-overs |
| Run time | Workflow reads John's morning posts for focus goals |
| Run time | Workflow reads same-day `Morning Triage` for BAU / inbox follow-ups when available |
| Run time | Workflow validates the required sources before generation |
| Run time | Workflow generates the SOD report and sends to `#ops-command` + Noa's DM |

### Data Sources

| Source | Content | How identified |
|---|---|---|
| `#ops-command` - yesterday | Carry-overs, unresolved blockers | Bot message from yesterday containing "Today's Wrap-up" |
| `#ops-command` - today | Focus goals, new blockers | Messages from U0AM5EGRVTP posted after midnight GMT+8 |
| `#ops-command` - today | BAU / inbox follow-ups | Bot message from today containing `Morning Triage` |

---

## SOD Report Template

```
### Today's Goals

**Focus Goals**
- [from John's morning dump]

**Carry-over from Yesterday**
- [from yesterday's EOD Not Completed section - omit if none]

**Blocker / Input Needed**
- [from John's dump + unresolved yesterday blockers]

**BAU / Follow-ups (Business As Usual)**
- [recurring ops: pending invoices, IM8 check-ins, inbox triage follow-ups, etc.]
```

---

## John's Daily Responsibility

Post to `#ops-command` before the workflow run. Include:
- What you're focusing on today
- Any blockers you're already aware of
- Anything Noa needs to know before her day starts

No format required - free text is fine.

---

## Validation Rules

The workflow must hard-stop if either required source is missing:

- yesterday's EOD message containing `Today's Wrap-up`
- John's same-day morning dump

If `Morning Triage` is missing, the workflow should still send the report and omit inbox-triage follow-ups for that run.

---

## Failure Handling

- If John hasn't posted: workflow stops and alerts `#ops-command`
- If inbox triage has not posted `Morning Triage`: workflow still sends without inbox-triage follow-ups
- If no yesterday EOD is found: workflow stops and alerts `#ops-command`
- If archive post succeeds but Noa DM fails: workflow raises a failure alert for manual resend
- If the local/manual workflow is unavailable: use `/sod-report` in Claude Code as manual fallback

---

## Manual Override

Run `/sod-report` in Claude Code at any time for an off-schedule send or manual resend, keeping delivery to both `#ops-command` and Noa's DM.
