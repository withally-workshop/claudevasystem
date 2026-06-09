---
name: weekly-review
description: Use when Codex needs to generate Noa's weekly review — synthesize the week's EOD summaries and Slack activity into a per-business recap (Krave Media, IM8/Prenetics, Halo Home, Skyvane) with AR snapshot, next-week priorities, and items needing Noa's attention. Triggers include "/weekly-review", "weekly review", "week recap". Recommended Fridays at/after 5:00 PM PHT.
metadata:
  short-description: Generate Noa's weekly business review
---

# Weekly Review

Synthesize Mon–Fri EOD summaries + Slack activity into a structured weekly recap by business, then deliver to John's DM (he reviews and forwards to Noa manually).

## How to Trigger

**Manual only:** "/weekly-review" — recommended Fridays at/after 5:00 PM PHT, before the EOD summary fires.

## Key References

- **Full skill (data sources, template, rules):** `.claude/skills/weekly-review/SKILL.md`
- **Sources:** #ops-command (C0AQZGJDR38, EOD wrap-ups), #ad-production-internal (C0AGEM919QV), #payments-invoices-updates (C09HN2EBPR7)
- **Week filter:** Monday 00:00 PHT through now

## What It Does

1. Pulls the week's messages (limit 200/channel); extracts "Today's Wrap-up" EOD posts
2. Asks operator for offline context (calls, WhatsApp supplier updates) before synthesizing
3. Groups into four businesses: Krave Media / IM8-Prenetics / Halo Home / Skyvane — done, rolled over, blockers each
4. AR/Finance snapshot: invoices sent, payments received, overdue flags
5. Ranked next-week priorities + max 3 "Needs Noa's Attention" items (3-and-1 framework)

## Delivery

- **John's DM only** (U0AM5EGRVTP) + archive copy to #ops-command. Do NOT send to Noa.
