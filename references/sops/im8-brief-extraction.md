# SOP: IM8 Video Editing Process (Ad Production)

**Task ID:** KM-SOP-004
**Frequency:** Weekly (Mondays)
**Owner:** VA / Automations EP
**Updated:** March 2026

---

## Overview

Extract AI-generated ad briefs for IM8 (Prenetics) from the `#ad-production-internal` Slack channel and input them into the **IM8 Video Editing Process 2026** master tracker for video editors to execute.

**Key Rule:** Always use "Paste without formatting" (Ctrl+Shift+V) when moving data into the master tracker to preserve spreadsheet styling.

---

## Tools & Access

| Tool | Resource |
|------|----------|
| Slack | `#ad-production-internal` channel |
| Google Sheets | Source: Brief Sheet (e.g., IM8 Health GLP-1 - Competitor-Informed...) |
| Google Sheets | Master Tracker: IM8 Video Editing Process 2026 |
| Google Sheets | Naming Key: ADS_Naming Convention sheet |

---

## Step 1 — Locate and Review the AI Briefs

- Navigate to `#ad-production-internal` in Slack.
- Find the automated weekly post from Noa's bot. Click the link to open the new brief sheet.
- **Only process visible (unhidden) tabs. Never process hidden tabs.**
- Hidden tabs = not approved by Noa. Adding them to the tracker without approval is not permitted.

---

## Step 2 — Transfer the Brief to the Master Tracker

Open the **IM8 Video Editing Process 2026** sheet. Locate the correct Sprint section for the current week and topic.

| Field | Action |
|-------|--------|
| Script/Concept Link | Copy the URL of the specific brief sheet tab |
| Concept Reference | Copy the URL of the reference video in the brief sheet |
| Description | Write a brief description based on script + reference video |

**Reminder:** Paste without formatting (Ctrl+Shift+V) for all text entries.

---

## Step 3 — Populate the Code Columns

| Column | Source / Rule |
|--------|---------------|
| Problem | From the brief → look up code in ADS_Naming Convention sheet (e.g., "FATIGUE") |
| ICP (Persona) | From the brief (explicitly stated — do not guess) → look up code in convention sheet |
| Creative Number | Leave blank |
| Agency | Always enter `INT` (Internal) |
| Batch Name | Current sprint number (e.g., `SPRINT2`) |
| Creator Type | If AI avatar via HeyGen → `AVA` |
| Creator Name | If AVA → `NA` |
| WTAD (Ad Type) | If standard social ad → `NA` |
| Landing Page | From convention sheet — match to ICP, enter corresponding code |

---

## Step 4 — Finalize the Tracker Details

| Column | Action |
|--------|--------|
| Ad Type | Determine from reference video style (e.g., `TALKH`, `PODCT`, `RVIEW`, `ANIMT`) |
| Format | Always `VID` |
| Raw Footage Link | Enter `Use Master & B-Roll` |
| Editing Style | Select based on concept reference video |
| Editor | Assign from available editors — check "Krave Capacity" section at top of sheet |
| Current Status | Set to `Ready to Start` |
| # Of Videos | From brief — count the number of hooks required |

---

## Step 5 — Notify the Editor

- Right-click the newly completed row → select **Comment**.
- Tag the assigned editor (e.g., `@Joshua`).
- Write: `Hey [Editor Name], this is ready for you to start.`

---

## Checklist

- [ ] Brief located in `#ad-production-internal`
- [ ] Visible briefs only — hidden briefs skipped
- [ ] Script/Concept Link copied
- [ ] Concept Reference copied
- [ ] All code columns populated (Problem, ICP, Agency, Batch, Creator, Landing Page)
- [ ] Ad Type, Format, Raw Footage, Editing Style, Editor, Status, # of Videos filled
- [ ] Editor tagged via Google Sheets comment
