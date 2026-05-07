# Claude EA — Noa Takhel Executive Assistant System

A Claude Code-powered executive assistant workspace for Noa Takhel — multi-business founder, creative strategist, and operator across Krave Media, Halo Home, Skyvane, and IM8/Prenetics.

---

## What This Is

A persistent, skill-based AI assistant system built on top of Claude Code. It handles recurring operational workflows, protects Noa's deep work time, and acts as an intelligent layer across her business stack.

**Operator:** John (Systems Partner & EA)
**Timezone:** Bangkok Time (ICT / GMT+7)

---

## Businesses

| Business | Description |
|----------|-------------|
| Krave Media | End-to-end video production and custom creative ad packages |
| Halo Home | DTC physical e-commerce — currently scaling into the US |
| Skyvane | Creative strategy consulting and Meta ad funnel optimization |
| IM8 (Prenetics) | Contracted Head Creative Strategist — manages 9 external agencies |

---

## Core Rules

- **Deep Work Block:** 1:30 PM–7:00 PM ICT is protected. No non-emergency interruptions.
- **EOD Triage:** All escalations batch to a daily 7:00 PM summary.
- **3-and-1 Framework:** All recommendations present 3 options, 1 explicit recommendation.

---

## Skills

Automated workflows built from recurring tasks. Located in [`.claude/skills/`](.claude/skills/).

| Skill | Purpose |
|-------|---------|
| `im8-brief-extraction` | Extract IM8 ad briefs from Slack → populate Master Tracker |
| `eod-triage-summary` | Generate daily End-of-Day Triage Summary for Slack |
| `osome-reconciliation` | Guide Osome PDF upload reconciliation workflow |
| `client-invoice-creation` | Client invoice creation and payment tracking |
| `creator-invoice-processing` | Creator invoice processing |
| `inbox-triage` | Tier 1 inbox triage for routine replies |

---

## Repository Structure

```
claude-ea/
├── context/              # Who Noa is, her businesses, team, priorities, goals
├── projects/             # Active workstreams (Halo Home US, Automation)
├── references/sops/      # Standard operating procedures
├── templates/            # Reusable templates (session summary, etc.)
├── decisions/log.md      # Append-only decision log
├── mcp-servers/          # Local MCP server integrations (Google Sheets, etc.)
├── .claude/
│   ├── skills/           # Skill definitions
│   └── rules/            # Communication style + deep work protection rules
└── CLAUDE.md             # Master system prompt and configuration
```

---

## Integrations

| Tool | Use |
|------|-----|
| Slack | Primary hub — Krave ops, IM8 agency comms |
| Google Sheets | IM8 ad briefs, master trackers |
| Gmail | noa@kravemedia.co · takhelnoa@gmail.com |
| Airwallex | Invoicing, payouts |
| Osome | Accounting, reconciliation |
| ClickUp | Krave project tracking, video QA |
| Notion | Skyvane ops, EA dashboard |
| PandaDoc | Contracts |

---

## Setup on a New Machine

```bash
git clone https://github.com/jopsonaljohnkarl-stack/claudevasystem.git
cd claudevasystem
cd mcp-servers/google-sheets && npm install
```

Then open in Claude Code and log in with your Anthropic account.

---

## Current Priorities (Q2 2026)

1. Defend the 1:30–7:00 PM deep work block
2. Automate Osome reconciliation, IM8 brief extraction, and Krave video QA
3. Scale Halo Home into the US market
4. Maintain IM8 creative velocity across 9 agencies
