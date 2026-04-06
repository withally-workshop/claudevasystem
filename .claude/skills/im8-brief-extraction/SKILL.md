# Skill: IM8 Brief Extraction

**Purpose:** Process incoming IM8 ad briefs from #ad-production-internal and populate the Master Tracker with structured rows + editor assignment comments.

**Invoke when:** A new brief drops in #ad-production-internal and needs to be processed.

**Master Tracker:** https://docs.google.com/spreadsheets/d/1UoOw8x5QMZwPxldWPTDWGiPzQjGWt7gyf7H93QIKEXQ/edit
**Naming Convention Sheet:** https://docs.google.com/spreadsheets/d/1AIFmurmdH8SYtlQKl3HwtK-BuP5mlUZ9x-nCSbRmIhM/edit

---

## Instructions

When this skill is invoked:

### Step 1 — Get the brief
Fetch the latest brief from Slack via MCP:
- Use `mcp__slack__slack_get_channel_history` on `#ad-production-internal`
- Filter for messages matching "Ad Script Brief Complete"
- If multiple unprocessed briefs exist, ask the user which sprint/campaign to process first
- If no recent brief is found, or if Slack MCP is not connected, ask the user to paste the message manually as fallback

### Step 2 — Parse the brief
Extract:
- Campaign name (e.g., "IM8 Health High Cortisol")
- Problem / health concern
- ICP (target persona, if identifiable)
- Script count and types (S = Swipe, R = Research)
- Script Google Sheet link (if in message)
- Product page URL (if in message)
- Sprint number (if stated; default to current sprint)

### Step 3 — Map to Naming Convention
Using the Naming Convention Sheet, generate the Name field for each script.

Format: `_VID_{ADTYPE}_{ICP}_{PROBLEM}__{AGENCY}_SPRINT{N}_{CREATORTYPE}_{CREATORNAME}__{HOOK}_{LDP}`

- Agency for internal briefs: `INT`
- Creator fields: `NA` if not applicable
- If ICP or Problem codes are ambiguous, ask the user to confirm before proceeding.

### Step 4 — Generate tracker rows
Output a table with one row per script, ready to add to the Master Tracker:

| Column | Value |
|--------|-------|
| Name | Generated from naming convention |
| Description | "Swipe Script" or "Research Script" |
| Problem | From brief |
| ICP / Persona | From brief |
| Type | VID |
| Ad Type | Match from brief |
| Agency | INT |
| Script/Concept Link | From brief outputs |
| Current Status | Script Ready |
| Creative Number | S1–S10 or R1–R10 |
| Format | VID |

### Step 5 — Editor assignment
Ask the user to assign editors from the current list. Once assigned, output a Google Sheets comment for each row:

> @[EditorName] — [S1 / R1 / etc.] is ready for editing. Please review the script link and begin production.

### Step 6 — Deliver output
- Table of tracker rows (copy-paste ready for Google Sheets)
- List of comments to post in Google Sheets (one per assigned editor)
- Reply in the `#ad-production-internal` thread via `mcp__slack__slack_reply_to_thread` (use the brief message's `ts` as `thread_ts`): "[N] scripts added to Master Tracker. Editor assignments: [list]."
  - If Slack MCP is not connected, output the reply text for manual posting as fallback

---

## N8n Automation Target

This entire process should be automated via n8n. Use this spec when building:

**Trigger:** Slack — message in #ad-production-internal matching "Ad Script Brief Complete"

**Workflow:**
1. Parse message → extract campaign, problem, ICP, script count, script sheet URL
2. Look up Problem + ICP codes in Naming Convention Sheet (Google Sheets node, read rows)
3. Generate one row per script using naming convention formula
4. Append rows to Master Tracker (Google Sheets node, append)
5. Post Google Sheets comment per row tagging assigned editor (manual assignment step until auto-assignment logic is defined)
6. Reply in #ad-production-internal thread: "[N] scripts added to Master Tracker."

**Status:** Not yet built. Skill currently operates in manual-assist mode (Steps 1–6 above).
