# Skill: IM8 Creative Velocity Report

**Purpose:** Compile the weekly IM8 Creative Velocity Report — internal video production vs. sprint goal, plus external agency output across all 9 agencies — and post it to the Prenetics #ad-production-internal channel.

**Cadence:** Weekly. Run **Mondays** after agencies have posted their standardized reports (typically by EOD Monday ICT). Can also be triggered manually.

**Manual invoke:** `/creative-velocity-report`

**Slack workspace:** Prenetics (via `mcp__claude_ai_Slack__` — Noa's OAuth)

---

## Prerequisites

- `mcp__claude_ai_Slack__` connected (Prenetics workspace, Noa's account)
- Internal numbers provided by operator (no ClickUp MCP available)
- Agencies have posted their weekly reports in their respective Prenetics channels

---

## Step 0 — Collect Internal Numbers from Operator

No ClickUp MCP is available, so internal data must be provided manually. Ask:

> "What are this week's internal numbers?
> - Sprint goal (total videos targeted this sprint)
> - Videos Produced (approved/finalized this week — mark these as 'Week X completed' + Reported=Yes in the tracker)
> - Briefs Written (number of video concepts briefed in the current sprint)"

Wait for operator input before proceeding.

---

## Step 1 — Identify the 9 Agency Channels in Prenetics Slack

Use `mcp__claude_ai_Slack__slack_search_channels` to find each agency channel. Known agencies include:
- adex
- street talk
- LJV

Search for additional agency channels under "external connections" using terms like:
- `mcp__claude_ai_Slack__slack_search_channels` with query: `"agency"`, `"external"`, `"production"`
- Also search for known brand/agency names from the Prenetics context

Compile a list of all 9 agency channel IDs. If fewer than 9 are found, flag which agencies are missing and proceed with those found.

---

## Step 2 — Read Each Agency Channel

For each agency channel found:

1. Use `mcp__claude_ai_Slack__slack_read_channel` to pull the last 50 messages
2. Find the most recent standardized weekly report (agencies post in a consistent format with sections for **Approved**, **For Review**, **In Production**)
3. Extract:
   - Agency name
   - Number of **Approved** videos this week
   - Sample frame link (copy one link from the approved section if available)
   - Any blockers or flags mentioned

If an agency has not posted a report this week, flag it as `[NO REPORT]`.

---

## Step 3 — Determine Current Sprint Week

Ask operator if not already known:

> "What sprint week are we reporting on? (e.g., Week 4)"

Or infer from operator's Step 0 input.

---

## Step 4 — Compile the Report

Use the template below. If Noa has posted an updated template in #ad-production-internal this week, use that instead.

```
📊 IM8 Weekly Creative Velocity — [Sprint Week X] | [Date Range]

━━━━━━━━━━━━━━━━━━━━━━━━━
🏠 INTERNAL PRODUCTION
━━━━━━━━━━━━━━━━━━━━━━━━━
Sprint Goal: [X] videos
Videos Produced: [X]
Briefs Written: [X]
Velocity: [X/sprint goal]%

━━━━━━━━━━━━━━━━━━━━━━━━━
🏢 EXTERNAL AGENCIES
━━━━━━━━━━━━━━━━━━━━━━━━━
[Agency Name]
✅ Approved: [X] | 🔄 For Review: [X] | 🎬 In Production: [X]
Sample: [frame link or N/A]

[Agency Name]
✅ Approved: [X] | 🔄 For Review: [X] | 🎬 In Production: [X]
Sample: [frame link or N/A]

[...repeat for all agencies...]

━━━━━━━━━━━━━━━━━━━━━━━━━
📈 TOTAL EXTERNAL APPROVED: [sum]
━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ No Report: [agency names, if any]
🚧 Blockers: [any agency blockers — omit if none]
```

Rules:
- Bullets only. No filler sentences.
- Flag `[NO REPORT]` agencies at the bottom.
- If total approved (internal + external) is below sprint goal, add a `⚠️ Below Target` line.

---

## Step 5 — Post the Report

Find the `#ad-production-internal` channel in Prenetics Slack:
- Search using `mcp__claude_ai_Slack__slack_search_channels` with query: `"ad-production-internal"`

Post using `mcp__claude_ai_Slack__slack_send_message` to that channel.

Confirm the `ts` returned. If the send fails, output the compiled message for manual post.

---

## Known Gaps (to fill over time)

| Gap | Status | How to resolve |
|-----|--------|----------------|
| Exact 9 agency channel names/IDs | Unknown — discover at runtime | Skill will search and compile on first run |
| Internal tracker integration | No ClickUp MCP | Operator provides numbers manually |
| Sprint week reference | Not automated | Operator confirms each run |
| Report template versioning | Noa posts updates in Slack | Skill checks #ad-production-internal before compiling |
