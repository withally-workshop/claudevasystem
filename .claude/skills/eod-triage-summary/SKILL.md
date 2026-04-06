# Skill: EOD Triage Summary

**Purpose:** Generate Noa's daily End-of-Day Triage Summary — a clean Slack message consolidating everything handled during the day.

**Invoke at:** ~6:30–7:00 PM ICT daily, before sending to Noa on Slack.

---

## Instructions

When this skill is invoked:

### Step 1 — Collect today's items
Ask the user to dump everything handled today. Accept anything: unstructured notes, Slack message snippets, ClickUp task names, email threads, voice-note transcriptions. Don't require a specific format — just get the raw material.

### Step 2 — Categorize
Sort every item into one of four buckets:
- **Completed** — done, resolved, sent, closed
- **Blocked** — waiting on a person or resource (always state who/what)
- **Next Steps** — requires Noa's decision or direct action
- **FYI** — Noa should know, no action needed

### Step 3 — Apply communication rules
- Bullet points only. No paragraphs.
- No filler language.
- For any Next Steps item requiring a decision: apply the **3-and-1 Framework** — list 3 options, give 1 explicit recommendation.
- Flag time-sensitive items with `[URGENT]` or include the deadline inline.
- Group by business (Krave / IM8 / Halo Home / Skyvane) only if items span multiple businesses and grouping aids clarity. Otherwise keep flat.

### Step 4 — Output the Slack message

Use this format exactly:

---

*EOD Triage — [DAY, DATE] (ICT)*

*Completed*
- [item]

*Blocked*
- [item] — waiting on [who/what]

*Next Steps*
- [item]
  → Rec: [recommendation] *(only include if a decision is needed)*

*FYI*
- [item]

---

### Step 5 — Confirm before sending
Ask: "Anything to add or adjust before this goes to Noa?"
