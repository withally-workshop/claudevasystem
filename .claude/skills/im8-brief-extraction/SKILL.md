# Skill: IM8 Brief Extraction

**Purpose:** Extract IM8 ad briefs from #ad-production-internal, look up codes from the Naming Convention sheet, populate the Master Tracker with a complete row per brief, and notify the assigned editor.

**Invoke when:** Running the Monday IM8 brief extraction workflow.

**SOP reference:** `references/sops/im8-brief-extraction.md`

**Fixed resources:**
- Master Tracker: `https://docs.google.com/spreadsheets/d/1UoOw8x5QMZwPxldWPTDWGiPzQjGWt7gyf7H93QIKEXQ/edit`
- Naming Convention Sheet: `https://docs.google.com/spreadsheets/d/1AIFmurmdH8SYtlQKl3HwtK-BuP5mlUZ9x-nCSbRmIhM/edit`

---

## Instructions

When this skill is invoked, execute all steps below in sequence.

---

### Step 1 — Get inputs from the user

`#ad-production-internal` is a Slack Connect channel — bots cannot be added. Ask the user to provide:

1. **Brief sheet URL** — paste the link from the Slack bot post
2. **Sprint number** — e.g., `SPRINT3` (or confirm current sprint)

Only process visible briefs. If the user mentions hidden briefs, skip those.

---

### Step 2 — List all visible tabs in the brief sheet

- Call `mcp__google-sheets__sheets_list_sheets` on the brief sheet spreadsheet ID
- The tool returns **only visible (unhidden) tabs** — hidden tabs are automatically excluded
- **Never process hidden tabs. Hidden = not approved by Noa. Adding unapproved scripts to the tracker is not permitted.**
- Filter the returned tabs for script tabs (starting with `S` or `R`) — skip any non-script tabs (e.g., `TikTok Organic`, index tabs)
- Process each visible script tab in order

### Step 3 — Read each script tab

- Call `mcp__google-sheets__sheets_get_rows` on each tab from Step 2
- Extract:
  - Campaign name
  - Problem / health concern being addressed
  - ICP (target persona — use only what is explicitly stated; never guess)
  - Number of hooks required (= # of videos)
  - Reference video URL
  - Script/concept tab name (for the Script/Concept Link field)
  - Creator type (HeyGen AI avatar → `AVA`)

---

### Step 3 — Look up codes in the Naming Convention Sheet

- Call `mcp__google-sheets__sheets_get_rows` on the Naming Convention Sheet
- Map the following:
  - Problem → code (e.g., `FATIGUE`, `CORTISOL`)
  - ICP → code
  - Landing Page → code matched to the ICP
- If any code is ambiguous, surface the options to the user and request confirmation before proceeding.

---

### Step 4 — Read editor availability

- Call `mcp__google-sheets__sheets_get_rows` on the Master Tracker, targeting the **Krave Capacity** section (top of sheet)
- Identify the available editor to assign to this brief

---

### Step 5 — Write row to Master Tracker

Use `mcp__google-sheets__sheets_update_row` to write to the next available row after the Sprint header, starting at column B.

**Do NOT use `sheets_append_row` — it places data at the wrong position.**

**Column mapping (columns B through AJ):**

| Col | Header | Value |
|-----|--------|-------|
| B | Name | Ad name string (see naming convention below) |
| C | Concept Reference | Reference video URL from brief |
| D | Execution | `Internal Editing Only` |
| E | Script/Concept Link | `=HYPERLINK("brief_sheet_url","Tab Name")` — clickable link using the exact tab name |
| F | Description | One-line summary from script + reference video |
| G | Problem | Code from Step 3 |
| H | Persona | ICP code from Step 3 |
| I | Raw Footage Link | `Use Master & B-Roll` |
| J | Comments | `Copy concept reference for editing style` |
| K | Type | `100% Net New` (or `IM8 Winner Iteration` / `Competitor Winner Copy` if applicable) |
| L | Winner Iteration Ref | *(blank unless iteration)* |
| M | Editing Style | Style that matches the concept reference video |
| N | PIC | `Noa` *(always)* |
| O | Editor | Assigned editor |
| P | DD Draft | *(blank)* |
| Q | DD Final | *(blank)* |
| R | Current Status | `Ready to Start` |
| S | Frame IO Link | *(blank)* |
| T | # Of Videos | Hook count from brief |
| U | Landing Page | LDP code from Step 3 |
| V | Uploaded? | `FALSE` |
| W–Z | Week Completed / Reported / Handover / YYMMDD | *(blank)* |
| AA | Format | `VID` |
| AB | Ad Type | Code based on execution style (see Ad Type guide below) |
| AC | ICP | ICP code (same as col H) |
| AD | Problem (Concept) | Problem code (same as col G) |
| AE | Creative Number | *(leave blank)* |
| AF | Agency | `INT` |
| AG | Batch Name | `SPRINT{N}` |
| AH | Creator Type | See Creator Type guide below |
| AI | Creator Name | `NA` |
| AJ | Hook Message | *(blank)* |

---

**Ad Type codes:**

| Code | When to use |
|------|-------------|
| `WOTXT` | B-Roll + VO with text overlays on screen |
| `TALKH` | Talking head — creator speaking to camera |
| `PODCT` | Podcast style |
| `ANIMT` | Animation / AI-generated visuals |
| `VSL` | Video Sales Letter (long-form educational) |
| `TREND` | TikTok trend format |
| `VLOG` | Vlog style |
| `CALLC` | Customer call / interview |

When ambiguous, cross-reference the concept reference video and existing tracker rows for precedent.

---

**Creator Type codes:**

| Code | When to use |
|------|-------------|
| `NA` | No creator featured (B-Roll, VO only, AI-generated without HeyGen avatar) |
| `AVA` | AI avatar generated via HeyGen or Creatify |
| `ATH` | Athlete |
| `DOC` | Doctor / medical professional |
| `KOL` | Key Opinion Leader |
| `AFF` | Affiliate |
| `SAB` | Science Advisory Board member |
| `FND` | Founder |
| `AMB` | Ambassador |

---

### Step 6 — Output editor comment for manual posting

Google Sheets comments cannot be posted via MCP. Output the following for manual posting:

> **Action required:** Right-click the new row in the Master Tracker → Comment → post:
>
> `@[Editor Name] — Hey [Editor Name], this is ready for you to start.`

---

### Step 7 — Output Slack reply for manual posting

`#ad-production-internal` is a Slack Connect channel — bots cannot post here. Output the following text for the user to paste manually as a thread reply:

> `[N] brief(s) added to Master Tracker. Assigned to [Editor Name].`

---

## N8n Automation Target

This skill currently operates in manual-invoke mode (Mondays). When ready to automate:

**Trigger:** Slack — message in `#ad-production-internal` matching bot brief post pattern

**Workflow:**
1. Parse message → extract brief sheet URL, sprint number
2. Read brief sheet → campaign, problem, ICP, hook count, reference video
3. Look up codes in Naming Convention Sheet
4. Read Krave Capacity → assign editor
5. Append row to Master Tracker
6. Reply in `#ad-production-internal` thread

**Status:** Not yet built. Skill operates in manual-invoke mode.
