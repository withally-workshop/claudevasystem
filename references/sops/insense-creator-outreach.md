# SOP: Insense Creator Outreach — Database Invite

**Owner:** John (operator)
**Executor:** Automated (Playwright via Claude Code)
**Trigger:** Manual — run per campaign when applications are ready to review
**Skill:** `.claude/skills/insense-creator-outreach/SKILL.md`
**Objective:** Onboard high-quality creators to the internal Krave Creator Database by sending personalised database invites to strong applicants who aren't the right fit for a specific Insense campaign brief.

---

## Purpose

When creators apply to Krave's Insense campaigns, many will be high quality but not the exact fit for that brief. Rather than losing them, this workflow sends a personalised invite to join Krave's owned creator database — removing the 10% Insense platform markup and building a direct long-term relationship.

---

## Quality Screening Criteria

A creator **passes** if they meet all three:

| Signal | Threshold | Where visible |
|--------|-----------|---------------|
| Has portfolio content | ≥ 1 upload | Profile panel → Portfolio tab |
| Has completed Insense deals | ≥ 1 finished deal | Profile panel → "X finished deals" |
| Engagement rate | ≥ 1% | Profile panel → Engagement rate stat |

A creator **fails** (skip, no message) if:
- Zero portfolio uploads — no sample work to evaluate
- Zero finished deals — unproven on platform
- Engagement rate < 1% — audience is not engaged

---

## Database Invite Message Template

```
Hey {Creator Name},

Thanks for applying to our project on Insense. We loved your work and wanted to reach out personally. You weren't quite the right fit for that specific brief, but we absolutely want to keep working with you!

We're Krave Media and we work with some of the fastest-growing DTC brands in the US.
We'd love for you to join our own creator network so our strategists can match you directly to briefs. If you join, you get:

• First look at paid briefs matched to your niche
• Set your own UGC rates — keep 100% of what you earn
• Work directly with the brand team
• Early access to our private creator Discord (launching soon) — jobs board, work-sharing, and direct line to our brand partners
• Long-term relationships — most of our creators work 6+ campaigns a year with us

It just takes 5 min to fill out:
https://form.typeform.com/to/lAPIxgqv

Once you're in, our strategist team will reach out directly with briefs that match you!
Excited to have you on the team! :)

Cheers,
Krave Media Creator Team
```

---

## Step-by-Step (Automated)

### Step 1 — Log in to Insense
- Navigate to `https://app.insense.pro/signin`
- Credentials: `noa@kravemedia.co` / retrieve password from secure store
- Dismiss any cookie or guide tooltips on load

### Step 2 — Select the target campaign
- Navigate to the Campaigns section via the sidebar
- Select the specific campaign with pending applications
- Open the **Applications** tab within that campaign

### Step 3 — Process each application
For each application in the list:

1. Open the creator's profile panel (click "View profile" or the application row)
2. Read quality signals: portfolio upload count, finished deals count, engagement rate
3. **If fails quality criteria** → skip. Do not message. Log as "Skipped — below threshold"
4. **If passes quality criteria:**
   - Click **"Go to chat"** to open the direct message thread
   - Send the database invite message with `{Creator Name}` replaced by their actual first name (or username if first name unavailable)
   - Log as "Messaged — [username]"
5. Close the profile panel and move to the next application

### Step 4 — Deduplication
- Before sending any message, check if a previous message in the chat thread already contains `form.typeform.com/to/lAPIxgqv`
- If the link is already present in the thread → skip. Log as "Already messaged"

### Step 5 — Report
After processing all applications, output a summary in the current conversation and post to `#airwallexdrafts` (channel ID: `C0AQZGJDR38`) for EOD/SOD reporting pick-up:

```
*Insense Outreach — [Campaign Name] — [DATE]*

✅ *Messaged:* [N] creators
[username], [username], ...

⏭ *Skipped (below threshold):* [N] creators
[username] — [reason]

↩ *Already messaged (dedup):* [N] creators
[username], [username], ...

*Total applications reviewed:* [N]
```

---

## Credentials

| Field | Value |
|-------|-------|
| Login | noa@kravemedia.co |
| Password | NoaNed393! |
| Database invite link | https://form.typeform.com/to/lAPIxgqv |

---

## Notes

- Only message creators you are **not** accepting for the specific campaign. Do not send the database invite to creators you are approving — it creates confusion.
- If a creator has no first name visible, use their Insense username as the greeting name.
- This workflow runs per campaign. Run it each time a campaign's review period closes.
