# Skill: Morning Coffee

**Purpose:** Generate Noa's personal daily morning briefing — a warm Slack DM from John covering today's calendar, emails needing attention, ClickUp project pulse, and open Slack threads. Personal in tone. Separate from the SOD report (which is ops-focused). Sent directly to Noa's DM.

**Automated:** Runs **Monday–Friday at 10:00 AM PHT (UTC+8)** via local Windows Task Scheduler task `KraveEA-MorningCoffee`. Invokes `claude -p "/morning-coffee" --dangerously-skip-permissions` from the repo root. Sends directly to Noa's DM (`U06TBGX9L93`). No confirmation step.

**Scope rule:** Scan Gmail for **last 24h** regardless of read status — rely on content classification (not read status) to filter what matters. Do not surface newsletters, automated tool digests, or already-actioned threads. See Step 2 for the exact filters. Sends directly to Noa's DM (`U06TBGX9L93`). No confirmation step.

**Personal-scope boundary (purely personal):** Morning Coffee covers Noa's *personal* day — calendar, human correspondence needing her reply, project/creative pulse, her own tasks, and personal Slack mentions. It does **not** carry ops/finance: invoice approvals, payment receipts/confirmations, overdue-payment alerts, AR/AP. Those are owned by the **SOD report** (runs at the same 10 AM PHT, posts to `#ops-command`). This split prevents Noa seeing the same invoice/blocker twice across both briefings. When an item is ambiguous, ask: "would this appear in SOD?" — if yes, leave it out here.

**Manual invoke:** "morning coffee", "run morning coffee", "/morning-coffee", or off-schedule testing.

**Delivery account:** John's personal Slack OAuth — use `mcp__claude_ai_Slack__slack_send_message`, NOT `mcp__slack__slack_post_message` (bot token). This is intentional — the DM must appear to come from John personally, not the bot.

---

## Key Data

| Item | Value |
|------|-------|
| Noa's Slack user ID | `U06TBGX9L93` |
| Gmail account | `noa@kravemedia.co` (via `mcp__gmail-noa__gmail_search_messages`) |
| Bot-token channels | None scanned as of 2026-06-18 — `#ad-production-internal` (`C0AGEM919QV`) and `#payments-invoices-updates` (`C09HN2EBPR7`) both dropped (IM8-ended / ops→SOD). Step 4 removed; skill no longer uses the `slack` bot MCP |
| Carry-over state file | `.claude/skills/morning-coffee/state.json` (local, gitignored) — open tasks + unreplied emails persisted across runs |
| Slack scan stats | `.claude/skills/morning-coffee/scan-stats.jsonl` (local, gitignored) — per-run channel scan/yield log; used to cut the Step 5 candidate list to a proven allowlist |
| ClickUp notification sender | `notifications@tasks.clickup.com` |
| Noa's Slack DMs + mentions | `slack-noa` MCP (Noa's personal user token — configured in `.mcp.json`) |
| John–Noa DM channel | `D0AN35JHL80` (confirmed 2026-05-19 — accessible via John's OAuth) |
| Calendar source | Google Calendar MCP (`mcp__claude_ai_Google_Calendar__list_events`) — confirmed working as of 2026-05-11. Falls back to email-based parsing if MCP fails. |
| Cron (UTC) | `0 2 * * 1-5` = 10:00 AM PHT (UTC+8), weekdays |

---

## Instructions

### Step 0 — Date resolution

Resolve today's date in PHT (UTC+8). All "last 24h" queries anchor to `TODAY_PHT 00:00:00`. Format date headers as `[Day, Month D, YYYY]` (e.g. `Wednesday, May 6, 2026`).

### Step 0b — Load yesterday's carry-over state

Read `.claude/skills/morning-coffee/state.json` (local, gitignored). It holds what was still open at the end of the last run:

```json
{
  "last_run_date": "YYYY-MM-DD",
  "open_tasks":    [ { "task": "Complete ad world prime presentation", "first_seen": "YYYY-MM-DD" } ],
  "open_replies":  [ { "key": "[sender] | [subject]", "first_seen": "YYYY-MM-DD" } ]
}
```

- If the file is **missing or unreadable** (first run, fresh machine): treat both lists as empty and continue — never fail or delay the briefing over missing state.
- Hold `open_tasks` and `open_replies` in memory. Step 2 reconciles `open_replies`, Step 5b reconciles `open_tasks`, and Step 8 writes the updated state back.
- `first_seen` is **preserved across days** so age ("since Tue", "open 3 days") can be shown. Only set `first_seen` to today for genuinely new items.

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
- `fyi_emails` — from `label:EA/FYI` query → surface top 5 by recency in a separate compact FYI section (one-liners, no drafts, no "what's needed").

**Exclude from all buckets:**
- Emails from `@kravemedia.co` (internal — already handled in Slack)
- ClickUp notification emails (`notifications@tasks.clickup.com`) → handled in Step 3, never in the FYI section
- **Ops/finance mail (defer to SOD — see Personal-scope boundary):** invoice approvals/requests, payment receipts & confirmations (incl. `_Payment_Received` / Airwallex deposit notices), overdue-payment alerts, AR/AP. These belong to the SOD report, not Morning Coffee — drop them from every bucket. (A genuine human email that only mentions money in passing but whose real ask is personal/creative still belongs here; judge by the primary ask.)

**Fallback:** If all three label queries return zero results (triage didn't run, or ran before any email arrived), fall back to:
```
mcp__gmail-noa__gmail_search_messages
  query: "in:inbox newer_than:1d"
  max_results: 30
```
In fallback mode, apply the standard exclude filters (noreply@, newsletters, calendar notifications, SaaS marketing, ClickUp) and classify manually into **attention** (real human asks, deadlines, payments-failed) vs **FYI** (informational, receipts, confirmations). Note `_(triage labels not found — fallback mode)_` in the briefing.

**Urgency:** `EA/Urgent` emails are always `[URGENT]`. For `EA/Needs-Reply`, mark `[URGENT]` additionally if the subject or snippet contains a hard deadline today, legal/contract risk, or payment failure.

**Limits:** top 5–7 across the two attention buckets combined (urgent first, then needs-reply); FYI capped separately at 5.

**Carry-over (reconcile `open_replies` from Step 0b):** For each needs-reply email surfaced today, compare its `[sender] | [subject]` key against the carried `open_replies` list. If it matches a carried entry, append an age tag `⏳ since [Day]` (derived from `first_seen`) so Noa sees it has been waiting. A carried reply that **no longer appears** today (she replied, or it aged past 24h) is simply dropped in Step 8 — do not resurrect it. New needs-reply emails get `first_seen = today` in Step 8.

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

### Step 4 — (removed 2026-06-18) Bot-token channel highlights

This step previously pulled two channels via the `slack` **bot token** (channels Noa's personal token can't see). Both are now dropped:
- `#payments-invoices-updates` (`C09HN2EBPR7`) → ops/finance, owned by the SOD report (Personal-scope boundary).
- `#ad-production-internal` (`C0AGEM919QV`) → IM8-flavored (IM8 engagement ended) and near-zero personal yield (1 Noa mention in 30 messages in the 2026-06-18 dry run) at the highest per-pull token cost of any channel.

There are currently **no bot-only channels worth scanning**, so this skill no longer uses the `slack` bot-token MCP. Noa's own channels are covered by the `slack-noa` scan in Step 5. If a future bot-only channel genuinely carries personal asks for Noa, re-add it here with `mcp__slack__slack_get_channel_history` (limit 10, last 24h, bot/already-reacted messages excluded). The `slack` bot MCP is still required by other skills (SOD, ops-report, krave-bot) — do not remove it from `.mcp.json`.

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

**Carry-over reconciliation (reconcile `open_tasks` from Step 0b):**
1. For each carried task, scan today's DM for a completion statement matching it ("finished / done with / sent / wrapped [task]"). If found → the task is **complete**: drop it from state and do not surface it (one brief `✅ Closed: [task]` line is allowed, max 2, only when she explicitly reported it done today).
2. A carried task with **no completion statement and not re-mentioned** today → still open: surface it under Tasks tagged `↳ from [Day] — still open?` (Day from `first_seen`).
3. Today's newly extracted tasks → surface normally; they get `first_seen = today` in Step 8.
4. De-duplicate carried vs new by normalized task text — a task mentioned again today keeps its **original** `first_seen` (so its age keeps counting up).

Cap at 7 tasks (carried + new combined). If zero tasks found and zero carried: omit section silently.

---

### Step 5 — Pull Noa's Slack channel mentions (last 24h)

Use the `slack-noa` MCP (Noa's personal user token). The MCP currently exposes: `slack_list_channels`, `slack_get_channel_history`, `slack_get_thread_replies`, `slack_get_user_profile`, `slack_get_users`. **Not available:** DM listing (`conversations.list types=im`), message search (`search.messages`). Personal DMs cannot be surfaced with the current tool surface.

**What to scan (cost-bounded — see the Cost-trim note at the end of this step):**
1. `mcp__slack-noa__slack_list_channels` (limit 200) → keep only `is_member: true` AND `is_archived: false`. **Do NOT filter on `is_dormant`** — Slack flags most of Noa's active channels (`noaos`, `kravecore`, client channels) as dormant.
2. **Exclude bot-fed / broadcast channels** — the main source of wasted scan cost. They structurally never carry a personal ask for Noa, and their digest payloads are large enough to blow the tool's token limit. Drop any channel whose name:
   - ends in `-reporting`, `-adreporting`, or `-updates` (bot-fed client reporting digests)
   - is `halo-home-shopify` (Halo AI posts daily digests here — Halo ops lives in the Halo skills, not Morning Coffee)
   - is `general`, `random`, `emojis`, `inboundleads`, `automation-wishlist`, or `freelanceleadspro-updates` (announce / noise / bot channels)
   - has `num_members >= 25` (org-wide broadcast — Noa is rarely personally addressed there, and these are expensive to pull)
3. Rank the survivors and take the **top 10** (down from 20):
   - **Tier A — genuine human working channels:** names containing `krave-x-`, `int-`, `creator`, or starting with `noa`; plus small working groups (`num_members <= 4`) that survived Step 2. (`-reporting` is no longer Tier A — it is excluded above.)
   - **Tier B — fill remaining slots** from the rest, ranked by `updated` desc (most recently active first).
4. For each of the ≤10 channels: `slack_get_channel_history` limit **10**, filter to the last 24h. If every in-window message carries a `bot_id` (bot/app post), the channel yields nothing — record it as zero-yield (see Cost-trim instrumentation below) and skip it.
5. Surface a message where ANY of:
   - `@U06TBGX9L93` is mentioned in the text
   - It is from someone other than Noa AND directly addresses her ("Hi Noa", "Noa can you…")
   - It contains an untouched question or blocker (no Noa reply, no reaction)

**Format:** `[Person] in #[channel] — [1-line context]`

**Limit:** 7 bullets max for this sub-section. Prioritize urgency, then recency.

**Cost-trim instrumentation (so the candidate list can be cut with real data, not guesswork):** after the scan, append ONE line to `.claude/skills/morning-coffee/scan-stats.jsonl` (local, gitignored):
```
{"date":"YYYY-MM-DD","scanned":["name",...],"yielded":{"name":bulletCount,...}}
```
Append with a shell redirect (`echo '<json>' >> .claude/skills/morning-coffee/scan-stats.jsonl`) so prior lines survive; if the write fails, skip it silently — never block the briefing. **Refinement rule:** after ~10 weekday runs, read this file. Any channel that has appeared in `scanned` repeatedly but **never** in `yielded` is a confirmed zero — move it into the Step 2 exclusions (or tighten Tier A). This converts the scan from a broad 10-channel sweep into a small proven allowlist, cutting cost further. Record the cut in `decisions/log.md`.

> **Why the 2026-06-18 cost-trim:** a dry run found the old 20-channel sweep returned **zero** personal items in 24h — every candidate was a bot digest, a `-reporting` channel, or a stale thread — while two channels' histories were large enough to exceed the tool's token limit. Excluding bot-fed/broadcast channels + capping at 10 removes ~all of that waste with no loss of real signal; the instrumentation closes the loop.

If `slack-noa` MCP is unavailable, returns errors, or yields zero relevant items: skip this sub-section silently. Do not note the absence in the output.

**Known limitation:** `slack-noa` exposes `slack_list_channels`, `slack_get_channel_history`, `slack_get_thread_replies`, `slack_get_user_profile`, `slack_get_users` — but **not** DM listing (`conversations.list types=im`) or message search (`search.messages`). Personal DMs from people cannot be surfaced (the John↔Noa DM is the exception, read via John's OAuth in Step 5b). When the MCP gains those scopes, add direct DM/mention queries here.

### Step 6 — Compose the briefing

Apply this template. Omit any section with zero data — no placeholder text, no "nothing to report." Run Steps 1–5b in parallel, then compose once all data is collected.

**Top-line (`☕ Top of mind`) — compose this LAST, after every section is built.** One sentence naming the single most important thing today, placed directly under the greeting. Pick by this priority:
1. A human email with a hard deadline today or legal/contract risk → name it
2. A meeting that lands in the 13:30–19:00 deep-work window → name the conflict
3. A carried-over task or unreplied email open **≥2 days** → name it with its age
4. Otherwise the day's dominant signal (back-to-back calendar, the single biggest task)
5. Genuinely light day → one short warm line (e.g. "Light one today — your deep-work block is clear.")

Keep it to one sentence. This is the **only** line where you prioritize/synthesize — everything below it stays factual. The top-line is always present (even on a light day); every other section is omitted when empty.

```
Good morning Noa ☀️

☕ *Top of mind:* [one-sentence synthesis — the single most important thing today]

Here's your Morning Coffee for [Day, Date]:

*📅 Today's Calendar*
- [HH:MM] — [Event Title] with [Person]

*📬 Email — Needs Your Attention*
- [Sender] | [Subject] — [1-line context + what's needed] [URGENT if applicable] [⏳ since [Day] if carried]

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
- [New task extracted from DM]
- [Carried task] ↳ from [Day] — still open?
- ✅ Closed: [task she reported done today]   ← optional, max 2

_Deep work starts at 1:30 PM — have a good one._
```

**Formatting rules:**
- `☕ Top of mind:` is always present (one sentence, directly under the greeting); every other section is omitted when empty
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

### Step 8 — Persist today's carry-over state

After sending (regardless of send success — what was surfaced is what we record), overwrite `.claude/skills/morning-coffee/state.json`:

```json
{
  "last_run_date": "TODAY_PHT",
  "open_tasks":    [ { "task": "...", "first_seen": "..." } ],
  "open_replies":  [ { "key": "[sender] | [subject]", "first_seen": "..." } ]
}
```

- `open_tasks` = carried tasks still open (Step 5b rule 2) + today's new tasks (rule 3). Drop completed ones. Preserve original `first_seen` for carried tasks.
- `open_replies` = today's needs-reply emails that still need a reply, each keyed `[sender] | [subject]`. Preserve `first_seen` if carried; set to today if new. Drop replies that no longer appear.
- Write the file even when a section was empty (write empty arrays) so tomorrow starts clean.
- If the write fails, note it in the run log and continue — never retry the send because of a state-write failure. **This file is local-only and gitignored — never commit it.**

---

## MCP Tools Reference

| Action | Tool |
|--------|------|
| Noa's Gmail search | `mcp__gmail-noa__gmail_search_messages` |
| Read email body | `mcp__gmail-noa__gmail_get_message` |
| Slack channel history (bot) | _no longer used by this skill (Step 4 removed 2026-06-18); `slack` bot MCP retained for other skills_ |
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
- `state.json` missing/unreadable: treat carry-over as empty, send normally, then write a fresh state file in Step 8 — never block the briefing on state
- `state.json` write fails (Step 8): log it, do not retry the send; the briefing already went out
- Never send on behalf of Noa; never draft replies from this skill

---

## Scheduling — Local Windows Task Scheduler

This skill runs **locally** via Windows Task Scheduler, NOT as a remote CCR routine. Local execution is required because the skill depends on local-only MCP servers: `gmail-noa` (service account impersonation) and `slack-noa` (Noa's user token). _(As of 2026-06-18 it no longer uses the `slack` bot token — Step 4 was removed. The DM read and send use `claude_ai_Slack` (John's OAuth). The `slack` bot MCP is still required by other skills.)_

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