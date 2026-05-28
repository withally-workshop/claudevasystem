# SOP: EOD Triage Summary

**Owner:** John (operator)
**Frequency:** Monday–Friday, automated at 6:00 PM GMT+8
**Delivery:** `#ops-command` (bot post)
**Skill:** `.claude/skills/eod-triage-summary/SKILL.md`
**Trigger:** `trig_015YZhdGzPQNotUAruRVtSTg`

---

## Purpose

Consolidate everything handled during the day into a single, structured `#ops-command` post. Provides a clear record of what's done, what's blocked, and what rolls to tomorrow — feeds the SOD carry-over.

---

## How It Works

### Automated Flow (daily)

| Time (GMT+8) | Action |
|---|---|
| Throughout the day | John posts task updates to `#ops-command` as things happen |
| 6:00 PM | Remote agent fires, pulls today's messages from source channels |
| 6:00 PM | Filters to today only (midnight GMT+8 cutoff) |
| 6:00 PM | Categorizes into EOD template, posts to `#ops-command` |

### Data Sources

| Channel | ID | Content |
|---|---|---|
| `#ops-command` | `C0AQZGJDR38` | John's task dump + invoice drafts + inbox triage |
| `#payments-invoices-updates` | `C09HN2EBPR7` | Invoice requests, payment confirmations |

---

## EOD Report Template

```
### 🏁 Today's Wrap-up

**✅ Completed from Focus Goals**
- [item]

**🚧 Not Completed / Needs More Work / Planned Next Steps**
- [item]

**🔎 Blocker / Input Needed**
- [item] — waiting on [who/what]

**↔️ FYIs**
- [item]
```

---

## John's Daily Responsibility

Post updates to `#ops-command` throughout the day. No format required — just dump:
- Tasks completed
- Tasks blocked (and who/what is blocking)
- Decisions made
- Anything Noa should know

The richer the dump, the more useful the EOD report.

---

## Failure Handling

- If Slack send fails: agent retries once, then posts error to `#ops-command`
- If agent doesn't fire: manually invoke `/eod-triage-summary` in Claude Code

---

## Manual Override

Run `/eod-triage-summary` in Claude Code at any time for an off-schedule send.
