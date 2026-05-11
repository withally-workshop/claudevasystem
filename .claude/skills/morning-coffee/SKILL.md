# Skill: Morning Coffee

**Purpose:** Generate Noa's personal daily morning briefing — a warm Slack DM from John covering today's calendar, emails needing attention, ClickUp project pulse, and open Slack threads. Personal in tone. Separate from the SOD report (which is ops-focused). Sent directly to Noa's DM.

**Automated:** Runs **Monday–Friday at 10:00 AM PHT (UTC+8)** via local Windows Task Scheduler task `KraveEA-MorningCoffee`. Invokes `claude -p "/morning-coffee" --dangerously-skip-permissions` from the repo root. Sends directly to Noa's DM (`U06TBGX9L93`). No confirmation step.

**Scope rule:** Only process **unread** Gmail and **new since last run** Slack activity. Do not re-summarize already-read mail or already-seen messages. See Step 2 and Step 5 for the exact filters. Sends directly to Noa's DM (`U06TBGX9L93`). No confirmation step.

**Manual invoke:** "morning coffee", "run morning coffee", "/morning-coffee", or off-schedule testing.

**Delivery account:** John's personal Slack OAuth — use `mcp__claude_ai_Slack__slack_send_message`, NOT `mcp__slack__slack_post_message` (bot token). This is intentional — the DM must appear to come from John personally, not the bot.

---

## Key Data

| Item | Value |
|------|-------|
| Noa's Slack user ID | `U06TBGX9L93` |
| Gmail account | `noa@kravemedia.co` (via `mcp__gmail-noa__gmail_search_messages`) |
| Key Slack channels | `#ad-production-internal` (`C0AGEM919QV`), `#payments-invoices-updates` (`C09HN2EBPR7`) |
| ClickUp notification sender | `notifications@tasks.clickup.com` |
| Noa's Slack DMs + mentions | `slack-noa` MCP (Noa's personal user token — configured in `.mcp.json`) |
| Calendar source | Google Calendar MCP (`mcp__claude_ai_Google_Calendar__list_events`) — confirmed working as of 2026-05-11. Falls back to email-based parsing if MCP fails. |
| Cron (UTC) | `0 2 * * 1-5` = 10:00 AM PHT (UTC+8), weekdays |

---

## Instructions

### Step 0 — Date resolution

Resolve today's date in PHT (UTC+8). All "last 24h" queries anchor to `TODAY_PHT 00:00:00`. Format date headers as `[Day, Month D, YYYY]` (e.g. `Wednesday, May 6, 2026`).

### Step 1 — Pull today's calendar (Google Calendar MCP)

Use `mcp__claude_ai_Google_Calendar__list_events` with Noa's primary calendar:

```
mcp__claude_ai_Google_Calendar__list_events
  startTime: TODAY_PHT 00:00:00+08:00
  endTime:   TODAY_PHT 23:59:59+08:00
  timeZone:  Asia/Singapore
  orderBy:   startTime
```

For each event returned:
- Extract `summary` (title), `start.dateTime`, `end.dateTime`, attendees
- Skip events where `status == "cancelled"`
- Format: `[HH:MM TZ] — [Event Title] with [Person]` (omit "with" if no external attendees)
- **Flag** events between 14:30–20:00 PHT (2:30–8:00 PM SGT / 1:30–7:00 PM ICT) with `[deep work window]`

**Fallback:** If the Google Calendar MCP returns an error or empty result, fall back to email-based parsing:
```
mcp__gmail-noa__gmail_search_messages
  query: "(subject:\"Invitation:\" OR subject:\"Accepted:\" OR subject:\"Updated invitation:\" OR from:calendar-notification@google.com OR from:noreply@calendly.com OR from:scheduler@lark.com OR subject:\"Meeting confirmed\") newer_than:14d"
  max_results: 50
```
Filter to events matching `TODAY_PHT`. Prefer `Accepted:` over `Invitation:` when duplicate.

If no events today from either source: omit section silently.

### Step 2 — Scan Noa's Gmail (UNREAD only, last 24h)

```
mcp__gmail-noa__gmail_search_messages
  query: "in:inbox is:unread newer_than:1d"
  max_results: 50
```

The `is:unread` filter ensures we only surface emails Noa hasn't opened yet. Already-read mail (handled, archived, or skimmed) is excluded automatically.

For each result, read sender, subject, and snippet via `mcp__gmail-noa__gmail_get_message`.

Split into two buckets immediately:
- `clickup_emails` — from `notifications@tasks.clickup.com` → route to Step 3
- `candidate_emails` — everything else → apply filters below

**Exclude from candidates:**
- Automated ticket status threads (e.g. PandaDoc support auto-replies, noreply@ tool messages)
- Marketing and promotional emails from SaaS tools
- John's outbound invoice reminders (`from:john@kravemedia.co` + subject contains "reminder")
- Calendar accept/decline notifications (noreply from Google Calendar)
- Newsletters and automated digests

**Include (surface in briefing):**
- Clients or brand partners requiring a reply (Care & Bloom, StashAway, House of Wellness, IM8 agencies, Insense, etc.)
- Contracts or agreements incoming or requiring signature
- Billing alerts: payment failures, overdue notices, subscription problems
- Speaking or partnership opportunities

**Urgency:** Mark `[URGENT]` inline if: hard deadline today, legal/contract risk, payment failure, client loss risk.

Limit to top 5–7 most relevant (urgent first, then needs-reply).

### Step 3 — Aggregate ClickUp notifications (Project Pulse)

From `clickup_emails`, parse each notification for:
- `[Person] changed status [Project] Agency Execution / Projects / UGC [old status] → [new status]`
- `[Person] closed a task [Project]`

Aggregate:
- Count of tasks closed
- Notable status progressions (e.g. Scripting→Filming, Feedback→Approved) — one bullet each
- Stuck signals: same task/project appearing in 3+ notifications without forward movement
- Group by project when 3+ notifications span multiple projects

If 0 ClickUp emails: omit section.

### Step 4 — Pull Slack channel highlights (NEW since last run)

Call `mcp__slack__slack_get_channel_history` for each channel, limit 30. Filter to messages within last 24 hours.

| Channel | ID | What to surface |
|---------|----|-----------------|
| `#ad-production-internal` | `C0AGEM919QV` | IM8 ad production updates, Frame.io status, blockers, direct asks to Noa |
| `#payments-invoices-updates` | `C09HN2EBPR7` | Payment confirmations relevant to Noa, overdue alerts she should know about |

**Include:** Messages naming Noa, naming a client she owns, containing a blocker, referencing a payment on a Krave/IM8 project.
**Exclude:** Bot digest messages (automated workflow posts), messages Noa has already reacted to (presence of `:white_check_mark:` or any reaction by `U06TBGX9L93` indicates she has seen and acknowledged it).

Limit to 3 bullets per channel. If 0 relevant in a channel: omit it. If both empty: omit entire sub-section.

### Step 5 — Pull Noa's Slack channel mentions (last 24h)

Use the `slack-noa` MCP (Noa's personal user token). The MCP currently exposes: `slack_list_channels`, `slack_get_channel_history`, `slack_get_thread_replies`, `slack_get_user_profile`, `slack_get_users`. **Not available:** DM listing (`conversations.list types=im`), message search (`search.messages`). Personal DMs cannot be surfaced with the current tool surface.

**What to scan:**
1. `mcp__slack-noa__slack_list_channels` (limit 200) → filter to `is_member: true` AND not `is_dormant`
2. **Priority channels** (scan first, even if dormant):
   - `genesis-x-noa-work-log`, `noaos`, `noa-personal-brand-editing`, `kravecore`, `automation-wishlist`, `int-halo`, `creators-discovery`, `inboundleads`
   - Any channel with `noa-x-` or `x-noa` in the name
   - Any channel where `num_members <= 4` (likely 1:1 or small group)
3. For each priority channel: `slack_get_channel_history` limit 10, filter to last 24h
4. Surface messages where:
   - `@U06TBGX9L93` is mentioned in the text
   - Message is from someone other than Noa AND directly addresses her (e.g. "Hi Noa", "Noa can you...")
   - Message contains a question or blocker that's untouched (no Noa reply, no reaction)

**Format:** `[Person] in #[channel] — [1-line context]`

**Limit:** 5 bullets max for this sub-section. Prioritize urgency.

If `slack-noa` MCP is unavailable, returns errors, or yields zero relevant items: skip this sub-section silently. Do not note the absence in the output.

**Future improvement:** When `slack-noa` MCP gains `conversations.list types=im` and `search.messages`, replace this approach with direct DM/mention queries.

### Step 6 — Compose the briefing

Apply this template. Omit any section with zero data — no placeholder text, no "nothing to report."

```
Good morning Noa ☀️

Here's your Morning Coffee for [Day, Date]:

*📅 Today's Calendar*
- [HH:MM] — [Event Title] with [Person]

*📬 Email — Needs Your Attention*
- [Sender] | [Subject] — [1-line context + what's needed] [URGENT if applicable]

*📁 Project Pulse*
- [N] tasks advanced
- Notable: [Project] — [Old Status] → [New Status]
- Stuck: [Task/Project] — [observation]

*💬 Slack — Open Threads*
- [Person] DM'd you about [topic]
- @Noa mentioned in #[channel]: [1-line context]

_Deep work starts at 1:30 PM — have a good one._
```

**Formatting rules:**
- Omit any section with no data
- `[URGENT]` inline, never in a separate section
- Max ~15 bullets total — cut to most urgent if over
- Slack markdown: `*bold*` for section headers, `_italic_` for sign-off
- Scannable in under 60 seconds
- Do not editorialize — state the fact and what's needed

### Step 7 — Send via John's personal Slack

```
mcp__claude_ai_Slack__slack_send_message
  channel_id: U06TBGX9L93   ← Noa's user ID, opens a DM
  message: [composed message — exact final text, nothing appended]
```

**Critical formatting rules for this send:**
- Do NOT append `*Sent using* Claude`, `Sent via Claude Code`, or any attribution footer. The message must end with `_Deep work starts at 1:30 PM — have a good one._` and nothing after.
- Do NOT include any disclaimer, note, or explanation outside the briefing template.
- The `text` parameter must contain ONLY the final composed briefing — no preamble, no postscript.

Confirm `ts` is returned. If delivery fails: output the composed message in full for manual copy-paste, note the failure.

Do NOT post to `#airwallexdrafts` or any other channel. This is a private personal DM only.

---

## MCP Tools Reference

| Action | Tool |
|--------|------|
| Noa's Gmail search | `mcp__gmail-noa__gmail_search_messages` |
| Read email body | `mcp__gmail-noa__gmail_get_message` |
| Slack channel history (bot) | `mcp__slack__slack_get_channel_history` |
| Noa's DMs + mentions | `mcp__slack_noa` tools (personal user token) |
| Today's calendar | `mcp__claude_ai_Google_Calendar__list_events` (primary); email fallback via `mcp__gmail-noa__gmail_search_messages` |
| Send DM as John | `mcp__claude_ai_Slack__slack_send_message` |

---

## Failure Rules

- Gmail unavailable: skip email + ClickUp sections; still send with calendar + Slack if available; append `_(email data unavailable today)_`
- All sources fail: do not send an empty briefing; report failure for manual diagnosis
- Calendar MCP error: fall back to email-based calendar parsing (see Step 1 fallback). If both fail, omit section silently — do NOT note absence
- `slack-noa` unavailable: omit DMs sub-section silently; channel highlights can still appear
- Never send on behalf of Noa; never draft replies from this skill

---

## Scheduling — Local Windows Task Scheduler

This skill runs **locally** via Windows Task Scheduler, NOT as a remote CCR routine. Local execution is required because the skill depends on local-only MCP servers: `gmail-noa` (service account impersonation), `slack-noa` (Noa's user token), `slack` (bot token).

**Task name:** `KraveEA-MorningCoffee`
**Schedule:** Weekly, Mon–Fri at 10:00 AM (Asia/Manila system local time)
**Action:** `claude -p "/morning-coffee" --dangerously-skip-permissions`
**Working directory:** `c:\Users\jopso\Desktop\claude-ea`

**To create or update the task** (PowerShell):

```powershell
$action = New-ScheduledTaskAction -Execute "claude" -Argument '-p "/morning-coffee" --dangerously-skip-permissions' -WorkingDirectory "c:\Users\jopso\Desktop\claude-ea"
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 10:00am
Register-ScheduledTask -TaskName "KraveEA-MorningCoffee" -Action $action -Trigger $trigger -Description "Noa Morning Coffee — personal daily briefing DM, 10 AM PHT weekdays"
```

To run on demand: `Start-ScheduledTask -TaskName "KraveEA-MorningCoffee"`