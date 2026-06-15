# Skill: Morning Coffee

**Purpose:** Generate Noa's personal daily morning briefing — a warm Slack DM from John covering today's calendar, emails needing attention, ClickUp project pulse, and open Slack threads. Personal in tone. Separate from the SOD report (which is ops-focused). Sent directly to Noa's DM.

**Automated:** Runs **Monday–Friday at 10:00 AM PHT (UTC+8)** via local Windows Task Scheduler task `KraveEA-MorningCoffee`. Invokes `claude -p "/morning-coffee" --dangerously-skip-permissions` from the repo root. Sends directly to Noa's DM (`U06TBGX9L93`). No confirmation step.

**Scope rule:** Scan Gmail for **last 24h** regardless of read status — rely on content classification (not read status) to filter what matters. Do not surface newsletters, automated tool digests, or already-actioned threads. See Step 2 for the exact filters. Sends directly to Noa's DM (`U06TBGX9L93`). No confirmation step.

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
| John–Noa DM channel | `D0AN35JHL80` (confirmed 2026-05-19 — accessible via John's OAuth) |
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
- Format: `[HH:MM PHT] — [Event Title] with [Person]` (omit "with" if no external attendees)
- **Flag** events between 13:30–19:00 PHT with `[deep work window]`

**Fallback:** If the Google Calendar MCP returns an error or empty result, fall back to email-based parsing:
```
mcp__gmail-noa__gmail_search_messages
  query: "(subject:\"Invitation:\" OR subject:\"Accepted:\" OR subject:\"Updated invitation:\" OR from:calendar-notification@google.com OR from:noreply@calendly.com OR from:scheduler@lark.com OR subject:\"Meeting confirmed\") newer_than:14d"
  max_results: 50
```
Filter to events matching `TODAY_PHT`. Prefer `Accepted:` over `Invitation:` when duplicate.

If no events today from either source: omit section silently.

### Step 2 — Read pre-classified inbox from EA/* labels

The n8n Inbox Triage workflow (ID: `EuT6REDs5PUaoycE`) runs at 9 AM PHT and labels every unread inbox email with `EA/Urgent`, `EA/Needs-Reply`, `EA/FYI`, or `EA/Auto-Sorted` before morning coffee fires at 10 AM. Read the pre-classified results directly — do NOT re-scan `in:inbox` or re-classify.

Morning Coffee is Noa's **single email surface**: she gets everything that needs action (`EA/Urgent` + `EA/Needs-Reply`) **and** everything that's just FYI (`EA/FYI`). The 9 AM triage `#ops-command` post is John's audit view, not hers.

> Note: as of 2026-06-15 the triage archives `EA/FYI` mail (removes it from the inbox). The `label:` searches below still find it — a Gmail label search matches archived messages, only `in:inbox` would miss them.

Run these three searches in parallel:

```
mcp__gmail-noa__gmail_search_messages
  query: "label:EA/Urgent newer_than:1d"
  max_results: 20

mcp__gmail-noa__gmail_search_messages
  query: "label:EA/Needs-Reply newer_than:1d"
  max_results: 20

mcp__gmail-noa__gmail_search_messages
  query: "label:EA/FYI newer_than:1d"
  max_results: 20
```

For each result, read sender, subject, and snippet via `mcp__gmail-noa__gmail_get_message`.

**Buckets:**
- `urgent_emails` — from `label:EA/Urgent` query → always surface, mark `[URGENT]`
- `reply_emails` — from `label:EA/Needs-Reply` query → surface top 5 by recency
- `fyi_emails` — from `label:EA/FYI` query → surface top 5 by recency in a separate compact FYI section (one-liners, no drafts, no "what's needed"). Client payment receipts (`_Payment_Received`) legitimately land here — keep them.

**Exclude from all buckets:**
- Emails from `@kravemedia.co` (internal — already handled in Slack)
- ClickUp notification emails (`notifications@tasks.clickup.com`) → handled in Step 3, never in the FYI section

**Fallback:** If all three label queries return zero results (triage didn't run, or ran before any email arrived), fall back to:
```
mcp__gmail-noa__gmail_search_messages
  query: "in:inbox newer_than:1d"
  max_results: 30
```
In fallback mode, apply the standard exclude filters (noreply@, newsletters, calendar notifications, SaaS marketing, ClickUp) and classify manually into **attention** (real human asks, deadlines, payments-failed) vs **FYI** (informational, receipts, confirmations). Note `_(triage labels not found — fallback mode)_` in the briefing.

**Urgency:** `EA/Urgent` emails are always `[URGENT]`. For `EA/Needs-Reply`, mark `[URGENT]` additionally if the subject or snippet contains a hard deadline today, legal/contract risk, or payment failure.

**Limits:** top 5–7 across the two attention buckets combined (urgent first, then needs-reply); FYI capped separately at 5.

### Step 3 — Aggregate ClickUp notifications (Project Pulse)

**Source: a direct Gmail query — NOT the Step 2 buckets.** ClickUp notifications are labeled `EA/Auto-Sorted` by triage and archived, so they never appear in the Urgent/Needs-Reply/FYI buckets. Query them directly (this finds them even though they're archived):

```
mcp__gmail-noa__gmail_search_messages
  query: "from:notifications@tasks.clickup.com newer_than:1d"
  max_results: 30
```

> Why not the ClickUp MCP? The `claude_ai_ClickUp` connector is unreliable in the local scheduled run (claude.ai connectors may not load headless, and it has thrown schema errors). The email notifications carry the same status-change data and are robust. If the MCP later proves stable in cron, this can be upgraded to read tasks directly.

Read each result's subject + snippet via `mcp__gmail-noa__gmail_get_message`, and parse for:
- `[Person] changed status [Project] Agency Execution / Projects / UGC [old status] → [new status]`
- `[Person] set the status to: [status] [Project]`
- `[Person] closed a task [Project]`

Aggregate:
- Count of tasks closed
- Notable status progressions (e.g. Scripting→Filming, Feedback→Approved) — one bullet each
- Stuck signals: same task/project appearing in 3+ notifications without forward movement
- Group by project when 3+ notifications span multiple projects

If the query returns 0 results: omit the Project Pulse section silently.

### Step 4 — Pull Slack channel highlights (NEW since last run)

Call `mcp__slack__slack_get_channel_history` for each channel, limit 30. Filter to messages within last 24 hours.

| Channel | ID | What to surface |
|---------|----|-----------------|
| `#ad-production-internal` | `C0AGEM919QV` | IM8 ad production updates, Frame.io status, blockers, direct asks to Noa |
| `#payments-invoices-updates` | `C09HN2EBPR7` | Payment confirmations relevant to Noa, overdue alerts she should know about |

**Include:** Messages naming Noa, naming a client she owns, containing a blocker, referencing a payment on a Krave/IM8 project.
**Exclude:** Bot digest messages (automated workflow posts), messages Noa has already reacted to (presence of `:white_check_mark:` or any reaction by `U06TBGX9L93` indicates she has seen and acknowledged it).

Limit to 3 bullets per channel. If 0 relevant in a channel: omit it. If both empty: omit entire sub-section.

### Step 5b — Extract tasks from Noa–John DM (last 24h)

Read the John–Noa DM channel directly using John's OAuth:

```
mcp__claude_ai_Slack__slack_read_channel
  channel_id: D0AN35JHL80
  oldest: [TODAY_PHT_00:00 as Unix timestamp]
  limit: 50
```

Filter to messages where `user == "U06TBGX9L93"` (Noa). Ignore all other senders (John, bots, morning coffee digests).

From Noa's messages, extract **tasks** — things she says she needs to complete, is working on, or mentions as action items. Apply these rules:

**Include:**
- Explicit task statements: "I need to X", "I have to X", "working on X", "need to finish X", "review X", "complete X"
- Implied work items she mentions as things on her plate (e.g. "mostly just worked on the ad world prime presentation" → extract as a task)
- Items she lists (comma-separated or multi-sentence) count as separate tasks

**Exclude:**
- Conversational filler ("how was your weekend", "I am glad")
- Status updates she's already reporting as done ("I finished X")
- Questions or requests directed at John (not her own tasks)

De-duplicate: if the same task appears across multiple messages (e.g. mentioned yesterday and today), keep one instance — the most recent phrasing.

**Format each task:** strip filler, normalize to action form. E.g. "mostly just worked on the ad world prime presentation over the weekend" → `Complete ad world prime presentation`

Cap at 7 tasks. If zero tasks found: omit section silently.

---

### Step 5 — Pull Noa's Slack channel mentions (last 24h)

Use the `slack-noa` MCP (Noa's personal user token). The MCP currently exposes: `slack_list_channels`, `slack_get_channel_history`, `slack_get_thread_replies`, `slack_get_user_profile`, `slack_get_users`. **Not available:** DM listing (`conversations.list types=im`), message search (`search.messages`). Personal DMs cannot be surfaced with the current tool surface.

**What to scan:**
1. `mcp__slack-noa__slack_list_channels` (limit 200) → filter to `is_member: true` AND `is_archived: false`. **Do NOT filter on `is_dormant`** — Slack flags most of Noa's active channels (`noaos`, `kravecore`, client channels) as dormant, and the old filter excluded them, which is why this scan was effectively dead and only the two bot channels in Step 4 surfaced.
2. Build the scan set (cap **20 channels** to bound cost), prioritized in this order:
   - **Tier A — active work channels:** names containing `krave-x-`, `int-`, starting with `noa`, containing `creator`, or ending `-reporting`; plus any channel with `num_members <= 4` (1:1s and small working groups).
   - **Tier B — fill remaining slots** from the rest of her member channels, ranked by `updated` (most recently active first).
3. For each channel in the set: `slack_get_channel_history` limit 15, filter to messages within the last 24h.
4. Surface a message where ANY of:
   - `@U06TBGX9L93` is mentioned in the text
   - It is from someone other than Noa AND directly addresses her ("Hi Noa", "Noa can you…")
   - It contains an untouched question or blocker (no Noa reply, no reaction)

**Format:** `[Person] in #[channel] — [1-line context]`

**Limit:** 7 bullets max for this sub-section. Prioritize urgency, then recency.

If `slack-noa` MCP is unavailable, returns errors, or yields zero relevant items: skip this sub-section silently. Do not note the absence in the output.

**Known limitation:** `slack-noa` exposes `slack_list_channels`, `slack_get_channel_history`, `slack_get_thread_replies`, `slack_get_user_profile`, `slack_get_users` — but **not** DM listing (`conversations.list types=im`) or message search (`search.messages`). Personal DMs from people cannot be surfaced (the John↔Noa DM is the exception, read via John's OAuth in Step 5b). When the MCP gains those scopes, add direct DM/mention queries here.

### Step 6 — Compose the briefing

Apply this template. Omit any section with zero data — no placeholder text, no "nothing to report." Run Steps 1–5b in parallel, then compose once all data is collected.

```
Good morning Noa ☀️

Here's your Morning Coffee for [Day, Date]:

*📅 Today's Calendar*
- [HH:MM] — [Event Title] with [Person]

*📬 Email — Needs Your Attention*
- [Sender] | [Subject] — [1-line context + what's needed] [URGENT if applicable]

*📥 Just So You Know (FYI)*
- [Sender] | [Subject] — [one-line, no action needed]

*📁 Project Pulse*
- [N] tasks advanced
- Notable: [Project] — [Old Status] → [New Status]
- Stuck: [Task/Project] — [observation]

*💬 Slack — Open Threads*
- [Person] DM'd you about [topic]
- @Noa mentioned in #[channel]: [1-line context]

*✅ Tasks*
- [Task extracted from DM]

_Deep work starts at 1:30 PM — have a good one._
```

**Formatting rules:**
- Omit any section with no data (including the FYI section — no "nothing to report")
- `[URGENT]` inline, never in a separate section
- **FYI is the compact section:** one line per item, no draft mention, no "what's needed", capped at 5. It always sits *below* "Needs Your Attention" — attention first, FYI second.
- Max ~18 bullets total (attention + pulse + slack + tasks), plus up to 5 FYI — cut attention items to the most urgent if over
- Slack markdown: `*bold*` for section headers, `_italic_` for sign-off
- Scannable in under 60 seconds
- Do not editorialize — state the fact and what's needed

### Step 7 — Send via John's personal Slack

```
mcp__claude_ai_Slack__slack_send_message
  channel_id: U06TBGX9L93   ← Noa's user ID, opens a DM
  message: [composed message — exact final text; do not append anything yourself]
```

**Critical formatting rules for this send:**
- The message body must end with `_Deep work starts at 1:30 PM — have a good one._` Do not add your own preamble, postscript, disclaimer, or note.
- **Known platform behavior — not a bug:** the claude.ai Slack connector auto-appends a `*Sent using* Claude` footer to messages sent via `mcp__claude_ai_Slack__slack_send_message`. It is injected by the platform *after* your text, so it cannot be prevented or removed from within this skill. This is expected — do not treat it as a failure or retry to strip it.
- The `message` parameter must contain ONLY the final composed briefing — no preamble, no postscript from you.

Confirm `ts` is returned. If delivery fails: output the composed message in full for manual copy-paste, note the failure.

Do NOT post to `#ops-command` or any other channel. This is a private personal DM only.

---

## MCP Tools Reference

| Action | Tool |
|--------|------|
| Noa's Gmail search | `mcp__gmail-noa__gmail_search_messages` |
| Read email body | `mcp__gmail-noa__gmail_get_message` |
| Slack channel history (bot) | `mcp__slack__slack_get_channel_history` |
| Noa's DMs + mentions | `mcp__slack_noa` tools (personal user token) |
| Today's calendar | `mcp__claude_ai_Google_Calendar__list_events` (primary); email fallback via `mcp__gmail-noa__gmail_search_messages` |
| Noa–John DM task read | `mcp__claude_ai_Slack__slack_read_channel` channel `D0AN35JHL80` (John's OAuth) |
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