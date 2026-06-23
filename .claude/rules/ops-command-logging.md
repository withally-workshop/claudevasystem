# Rule: Log Work to #ops-command (EOD Capture)

## The Rule
After completing any substantive piece of work in a session — a build, edit, update, deploy, fix, or a finished ad-hoc task — post a short summary to **#ops-command (`C0AQZGJDR38`)** so the EOD Triage Summary (6 PM PHT) and the next day's SOD carry-overs capture it. The EOD reads this channel; work that isn't posted here is invisible to the daily wrap-up.

This is **async logging, not an escalation** — a channel post, not a DM or ping — so it does **not** violate the deep-work block (`.claude/rules/deep-work-protection.md`). Post freely regardless of the hour.

## When to Post
Post once, after the unit of work is **done** (not mid-stream):
- Shipping code/workflows/skills/docs — committed, pushed, deployed, or patched live.
- An edit / update / fix to any system (n8n, krave-bot, dashboard, skill, SOP, docs).
- A completed ad-hoc task — research delivered, invoice issued, calendar set up, outreach sent, report generated, contract prepped, etc.
- Anything you'd want the EOD wrap-up to know got done.

Do **not** post for:
- Pure question-answering / read-only turns that produced no change.
- Trivial single-step lookups.
- Mid-task progress — batch related edits into **one** summary when the unit of work is complete; don't spam per file.

## Channel & Identity
- Channel: `C0AQZGJDR38` (#ops-command).
- Post via the **Krave bot** — `mcp__slack-john__slack_post_message` ("John AI"). Never the personal `mcp__claude_ai_Slack` connector (it posts as the user's OAuth account). See `feedback_slack_posting`.
- If the bot MCP is unavailable in the session, output the formatted summary text so John can paste it, and say so — do not silently skip.

## Format (EOD-parseable)
Lead with what's done so the EOD buckets it cleanly (Completed / Next Steps / Blockers / FYIs):

```
🔧 Ops Log — <short task title> (<YYYY-MM-DD PHT>)
• Done: <what was built/edited/updated/shipped — concrete>
• Status: <live | committed+pushed | draft | verified | sent>
• Follow-up: <open items / next steps, or "none">
• Blocker: <who/what it's waiting on — omit this line if none>
```

A few bullets, concrete nouns (workflow names, files, IDs), no vague "improved things". Match the internal tone in `.claude/rules/communication-style.md`.

## Why
The EOD Triage Summary and the next morning's SOD run off #ops-command history. This rule closes the loop so Claude-driven work shows up in Noa's wrap-up without anyone re-logging it by hand.
