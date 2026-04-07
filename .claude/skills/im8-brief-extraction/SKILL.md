# Skill: IM8 Brief Extraction

**Purpose:** Extract IM8 ad briefs from #ad-production-internal, look up codes from the Naming Convention sheet, populate the Master Tracker with a complete row per script, and notify the assigned editor.

**Invoke when:** A new brief drops in #ad-production-internal, or running the Monday IM8 brief extraction workflow.

**SOP reference:** `references/sops/im8-brief-extraction.md`

**Fixed resources:**
- Master Tracker: `https://docs.google.com/spreadsheets/d/1UoOw8x5QMZwPxldWPTDWGiPzQjGWt7gyf7H93QIKEXQ/edit`
- Naming Convention Sheet: `https://docs.google.com/spreadsheets/d/1AIFmurmdH8SYtlQKl3HwtK-BuP5mlUZ9x-nCSbRmIhM/edit`
- Slack channel: `#ad-production-internal`

---

## Instructions

When this skill is invoked, execute all steps below in sequence.

---

### Step 1 — Detect the trigger in Slack

- Call `mcp__slack__slack_get_channel_history` on `#ad-production-internal`
- Scan recent messages for the **trigger signal**: a message from Noa that tags `@john` (or the bot) in the context of an "Ad Script Brief Complete" post
  - Noa will tag `@john` (or the bot) directly in the brief thread/message when it is approved and ready to process
  - **Do not process any brief that has NOT been tagged by Noa** — untagged briefs are not yet approved for extraction
- Once the trigger message is found, locate the associated brief post (same thread or linked) and extract:
  - **Brief sheet URL** (Google Sheets link)
  - **Thread timestamp (`ts`)** — save this for Step 9
  - **Campaign name** (e.g., "IM8 Health PCOS")
- If multiple tagged briefs exist, process them in chronological order
- If Slack MCP is unavailable, ask the user to paste the brief message as fallback

---

### Step 2 — Detect current sprint

- Call `mcp__google-sheets__sheets_get_rows` on the active tracker tab (e.g., `April Ad Pipeline 2026!A1:C10`)
- Find the most recent sprint header row (e.g., `SPRINT 5 - APRIL WEEK 1`)
- Extract the sprint number (e.g., `SPRINT5`) — use this for all rows in this run
- If ambiguous, ask the user to confirm

---

### Step 3 — List all visible tabs in the brief sheet

- Call `mcp__google-sheets__sheets_list_sheets` on the brief sheet spreadsheet ID
- The tool returns **only visible (unhidden) tabs** — hidden tabs are automatically excluded
- **Never process hidden tabs. Hidden = not approved by Noa. Adding unapproved scripts to the tracker is not permitted.**
- Filter for script tabs: include tabs starting with `S`, `R`, or `V` — skip `TikTok Organic` and any non-script tabs
- Process all visible script tabs in order

---

### Step 4 — Read all script tabs in parallel

- Call `mcp__google-sheets__sheets_get_rows` on each tab from Step 3 simultaneously
- For each tab extract:
  - Script/concept tab name
  - Execution type (Creator-Led / B-Roll + VO / Stock+B-Roll / etc.)
  - Creator type (check for HeyGen/Arcads/ArcAds mentions → `AVA`)
  - Number of hooks (= # of videos)
  - Ad reference URL (Concept Reference)
  - Script type (Research Original → `100% Net New`, Swipe Adaptation / V tab → `Competitor Winner Copy`)
  - Angle description (for Description field)

---

### Step 5 — Look up codes in the Naming Convention Sheet

- Call `mcp__google-sheets__sheets_get_rows` on the Naming Convention Sheet (ICP, Problem, Landing Pages tabs)
- Map for each script:
  - ICP → code (based on campaign — e.g., PCOS → `HCSS`, GLP-1 → `GLP`, Menopause → `MENO`)
  - Problem → code (based on the script angle)
  - Landing Page → code matched to product URL in brief (e.g., essentials-pro → `PDPPRO`)
- If any code is ambiguous, surface options and request confirmation before proceeding

---

### Step 6 — Determine editor assignment

- Call `mcp__google-sheets__sheets_get_rows` on the active tracker tab rows 1–4 (Krave Capacity section)
- The three eligible editors for IM8 briefs are: **Amanda A**, **Joshua**, **CEO**
- Read current assignments in the tracker to determine who has the lightest current load
- Distribute evenly across the batch — do not assign all scripts to one editor
- Default rotation: Amanda A → Joshua → CEO → Amanda A → Joshua → CEO...
- Example: 9 scripts = 3 each. 7 scripts = 3 / 2 / 2
- User can override at invocation time by specifying an editor

---

### Step 6b — Find next available row in the tracker

- Call `mcp__google-sheets__sheets_get_rows` on the active tracker tab, column B, from row 7 downward
- Find the first empty row after the sprint header
- All scripts from this brief write sequentially from that row

---

### Step 7 — Write all rows to the Master Tracker

Use `mcp__google-sheets__sheets_update_row` for each script row. **Do NOT use `sheets_append_row`.**

Write all rows in parallel where possible.

**Column mapping (B through AJ):**

| Col | Header | Value |
|-----|--------|-------|
| B | Name | `_VID_{ADTYPE}_{ICP}_{PROBLEM}__INT_{SPRINT}_{ CREATORTYPE}_NA__NA_{LDP}*` |
| C | Concept Reference | Ad reference URL from brief (blank if `gap_opportunity`) |
| D | Execution | `Internal Editing Only` |
| E | Script/Concept Link | `=HYPERLINK("brief_sheet_url","Tab Name")` |
| F | Description | One-line angle summary |
| G | Problem | Problem code |
| H | Persona | ICP code |
| I | Raw Footage Link | `Use Master & B-Roll` |
| J | Comments | `Copy concept reference for editing style` |
| K | Type | `100% Net New` / `Competitor Winner Copy` / `IM8 Winner Iteration` |
| L | Winner Iteration Ref | *(blank unless iteration)* |
| M | Editing Style | Style matching the concept reference video |
| N | PIC | `Noa` *(always)* |
| O | Editor | Assigned editor |
| P | DD Draft | *(blank)* |
| Q | DD Final | *(blank)* |
| R | Current Status | `Ready to Start` |
| S | Frame IO Link | *(blank)* |
| T | # Of Videos | Hook count from brief |
| U | Landing Page | LDP code |
| V | Uploaded? | `FALSE` |
| W–Z | Week / Reported / Handover / YYMMDD | *(blank)* |
| AA | Format | `VID` |
| AB | Ad Type | See Ad Type guide below |
| AC | ICP | Same as col H |
| AD | Problem (Concept) | Same as col G |
| AE | Creative Number | *(blank)* |
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
| `NA` | No creator featured (B-Roll/VO only, no specific person) |
| `AVA` | AI avatar — HeyGen, Creatify, or ArcAds explicitly mentioned in brief |
| `ATH` | Athlete |
| `DOC` | Doctor / medical professional |
| `KOL` | Key Opinion Leader |
| `AFF` | Affiliate |
| `SAB` | Science Advisory Board member |
| `FND` | Founder |
| `AMB` | Ambassador |

---

### Step 8 — Output editor comment for manual posting

Google Sheets comments cannot be posted via MCP — this is a permanent API limitation.

Output one comment block per editor with their assigned rows grouped:

> **Manual action — [Editor Name]:** Right-click each assigned row → Comment → post:
> `@[Editor Name] — Hey [Editor Name], this is ready for you to start.`

---

### Step 9 — Post Slack thread reply

- Call `mcp__slack__slack_reply_to_thread` using the `ts` from Step 1
- Channel: `#ad-production-internal`
- Message: `[N] briefs added to [Month] Ad Pipeline 2026 (SPRINT [N]). Assigned to: Amanda A ([X]), Joshua ([Y]), CEO ([Z]).`
