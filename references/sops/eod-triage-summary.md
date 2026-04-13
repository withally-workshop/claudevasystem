# SOP: EOD Triage Summary

**Owner:** John (operator)
**Recipient:** Noa Takhel (via Slack DM)
**Frequency:** Monday–Friday, automated at 6:00 PM GMT+8
**Skill:** `.claude/skills/eod-triage-summary/SKILL.md`
**Trigger:** `trig_015YZhdGzPQNotUAruRVtSTg`

---

## Purpose

Consolidate everything handled during the day into a single, structured Slack DM to Noa. Gives her a clear picture of what's done, what's blocked, and what needs her input — without requiring her to chase the team.

---

## How It Works

### Automated Flow (daily)

| Time (GMT+8) | Action |
|---|---|
| Throughout the day | John posts task updates to `#airwallexdrafts` as things happen |
| 6:00 PM | Remote agent fires, pulls today's messages from 3 channels |
| 6:00 PM | Filters to today only (midnight GMT+8 cutoff) |
| 6:00 PM | Categorizes into EOD template, sends to Noa's DM |
| 6:00 PM | Posts same message to `#airwallexdrafts` for SOD carry-over |

### Data Sources

| Channel | ID | Content |
|---|---|---|
| `#airwallexdrafts` | `C0AQZGJDR38` | John's task dump + invoice drafts + inbox triage |
| `#ad-production-internal` | `C0AGEM919QV` | IM8 production updates, Frame.io status |
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

Post updates to `#airwallexdrafts` throughout the day. No format required — just dump:
- Tasks completed
- Tasks blocked (and who/what is blocking)
- Decisions made
- Anything Noa should know

The richer the dump, the more useful the EOD report.

---

## Failure Handling

- If Slack send fails: agent retries once, then posts error to `#airwallexdrafts`
- If agent doesn't fire: manually invoke `/eod-triage-summary` in Claude Code

---

## Manual Override

Run `/eod-triage-summary` in Claude Code at any time for an off-schedule send.
