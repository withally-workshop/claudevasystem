# Skill: Insense Creator Outreach
**Trigger:** "run insense outreach", "process insense applications", "send database invites", "/insense-creator-outreach"
**SOP:** references/sops/insense-creator-outreach.md
**Mode:** Fully automated via Playwright

---

## What This Skill Does

Reviews creator applications on a specific Insense campaign. For each applicant who passes a quality threshold but is not being accepted for the campaign brief, sends a personalised Krave Creator Database invite via the Insense chat. Skips creators already messaged (dedup). Outputs a completion report.

---

## Prerequisites

- Playwright MCP server must be connected (`mcp__plugin_playwright_playwright__*`)
- Target campaign name or URL must be provided (ask if not given)
- Credentials: `noa@kravemedia.co` / `NoaNed393!`

---

## Quality Pass Criteria

A creator **must meet all three** to receive a message:

| Check | Minimum |
|-------|---------|
| Portfolio uploads | ≥ 1 |
| Finished deals on Insense | ≥ 1 |
| Engagement rate | ≥ 1% |

Skip silently if any check fails. Log the reason.

---

## Message Template

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

Replace `{Creator Name}` with the creator's first name. If only a username is available, use the username.

---

## Batch Size

**Run 10 creators per session.** The Playwright MCP browser connection drops when idle (e.g. during explicit delays), causing reconnects. Processing 10 creators per invocation keeps sessions short and stable. After each batch, post an interim report to Slack and ask the user if they want to continue the next batch.

Do NOT use `setTimeout`-based delays between sends. The natural latency of sequential tool calls (~5-10s per creator) is sufficient pacing.

---

## Execution Steps

### Step 1 — Confirm campaign
If no campaign is specified, ask: "Which Insense campaign should I process applications for?"
If provided, confirm before proceeding.

### Step 2 — Log in
```
browser_navigate → https://app.insense.pro/signin
browser_fill_form → email: noa@kravemedia.co, password: NoaNed393!
browser_click → Sign In
```
Dismiss any cookie consent dialogs or guide tooltips that appear on load.

### Step 3 — Navigate to campaign applications
```
browser_navigate → https://app.insense.pro/campaigns (or use sidebar)
```
- Locate the target campaign by name
- Click into it
- Select the **Applications** tab
- Take a snapshot to confirm the applications list is loaded

### Step 4 — Process each application (loop)

For each application row visible:

**4a — Open profile**
- Click the application row or "View profile" button to open the profile panel
- Take a snapshot to read profile data

**4b — Extract quality signals**
Read from the profile panel:
- Portfolio upload count (shown as "X uploads in Y categories")
- Finished deals count (shown as "X finished deals")
- Engagement rate (shown as "X.XX%" under Engagement rate stat)
- Creator first name or username

**4c — Quality check**
- If any signal is below threshold → log "Skipped: [username] — [reason]" → close panel → next application

**4d — Dedup check**
- Click "Go to chat" to open the message thread
- Scroll the thread and check for existing text containing `form.typeform.com/to/lAPIxgqv`
- If found → log "Already messaged: [username]" → go back → next application

**4e — Send message**
- In the chat input, type the full message template with `{Creator Name}` substituted
- Send the message
- Log "Messaged: [username]"
- Navigate back to the applications list

### Step 5 — Paginate
If the applications list has multiple pages or a "load more" button, load all pages and continue the loop until all applications are processed. Stop after 10 creators per batch.

### Step 6 — Output report + post to Slack

Compile the report in this format:

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

Then:
1. Post the report to `#airwallexdrafts` (channel ID: `C0AQZGJDR38`) using `mcp__slack__slack_post_message`
2. Also output the report in the current conversation as a reply

---

## Error Handling

| Situation | Action |
|-----------|--------|
| Login fails | Stop. Report credentials may have changed. |
| Campaign not found | Stop. Ask user to confirm campaign name. |
| Profile panel doesn't load | Skip that application. Log "Error: profile panel failed to load — [username]". |
| Chat thread fails to open | Skip that application. Log "Error: could not open chat — [username]". |
| Playwright loses session mid-run | Re-navigate to campaign URL. Session usually persists (no re-login needed). Resume from next unprocessed creator — dedup prevents double-messaging. |
| Browser closes during setTimeout delay | Do NOT use setTimeout-based delays between tool calls. Process creators sequentially with no explicit pauses. |

---

## Dedup Rule
The presence of `form.typeform.com/to/lAPIxgqv` anywhere in the existing chat thread is the dedup signal. This is robust to message edits or formatting changes.
