# SOP: Start of Day Report

**Owner:** John (operator)
**Recipient:** Noa Takhel (via Slack DM)
**Frequency:** Monday–Friday, automated at 9:00 AM GMT+8
**Skill:** `.claude/skills/sod-report/SKILL.md`
**Trigger:** `trig_0175RPhNgA1HaPH5w34W3QdN` (UTC hour 01 routing, shared with Hourly Invoice Triage)

---

## Purpose

Give Noa a clear picture of what's happening today before her deep work block starts at 1:30 PM ICT. Surfaces John's focus goals, carry-overs from yesterday's EOD, and any blockers needing her input — delivered automatically, no manual assembly required.

---

## How It Works

### Automated Flow (daily)

| Time (GMT+8) | Action |
|---|---|
| By 9:00 AM | John posts focus goals + context to `#airwallexdrafts` |
| 9:00 AM | Remote agent fires (UTC hour 01 slot in hourly trigger) |
| 9:00 AM | Reads yesterday's EOD from `#airwallexdrafts` for carry-overs |
| 9:00 AM | Reads John's morning posts for focus goals |
| 9:00 AM | Generates SOD report using template, sends to Noa's DM + John's DM |

### Data Sources

| Source | Content | How identified |
|---|---|---|
| `#airwallexdrafts` — yesterday | Carry-overs, unresolved blockers | Bot message from yesterday containing "Today's Wrap-up" |
| `#airwallexdrafts` — today | Focus goals, new blockers | Messages from U0AM5EGRVTP posted after midnight GMT+8 |

---

## SOD Report Template

```
### ✍️ Today's Goals

**Focus Goals**
- [from John's morning dump]

**Carry-over from Yesterday**
- [from yesterday's EOD Not Completed section — omit if none]

**Blocker / Input Needed**
- [from John's dump + unresolved yesterday blockers]

**BAU / Follow-ups (Business As Usual)**
- [recurring ops: pending invoices, IM8 check-ins, etc.]
```

---

## John's Daily Responsibility

Post to `#airwallexdrafts` before 9:00 AM GMT+8. Include:
- What you're focusing on today
- Any blockers you're already aware of
- Anything Noa needs to know before her day starts

No format required — free text is fine.

---

## Failure Handling

- If John hasn't posted by 9 AM: agent sends carry-overs only, notes missing goals
- If no yesterday EOD found: agent notes it and sends whatever context is available
- If Slack send fails: agent retries once, then posts error to `#airwallexdrafts`
- If agent doesn't fire: manually invoke `/sod-report` in Claude Code

---

## Manual Override

Run `/sod-report` in Claude Code at any time for an off-schedule send.
