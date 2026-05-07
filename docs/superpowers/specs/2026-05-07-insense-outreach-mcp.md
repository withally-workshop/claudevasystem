# Spec: Insense Outreach v2 — Playwright MCP

**Date:** 2026-05-07
**Replaces:** Standalone Playwright runner under `projects/insense-creator-database/` (deleted 2026-05-07)

---

## Problem

The previous standalone Node runner was heavy: separate project, login each run, separate decision/cache files, Slack approval thread step. The actual operational pattern is closer to: get a ranked list, glance at it, message the good ones from a real browser. Build for that.

## Goal

Two skills sharing one cache:

- `insense-triage` — scheduled, headless, posts a ranked Slack list per campaign
- `insense-send` — manual, attaches to operator's logged-in Chrome, sends template messages to chosen creators

Both skills are driven by Claude through `@playwright/mcp`. No bespoke runner code.

## Non-Goals

- No Slack reaction-based approval thread (operator picks from the Slack list directly)
- No score weighting model (replaced by pass/fail filter)
- No cross-campaign auto-blocklist beyond the cache (Insense's own "Previous Collaborator" tag still respected)

---

## User Flow

1. Cron fires `insense-triage --campaign "<Name>"` daily (per tracked campaign)
2. Triage logs in headless, walks visible applicants, applies pass/fail filter, posts to Slack `#airwallexdrafts`:
   - Parent: `Insense triage — <Campaign> — N candidates`
   - One reply per pass-listed creator: niches, profile link, Insense conversation link
3. Operator skims Slack, decides who to message
4. Operator runs `/insense-send --campaign "<Name>" <usernames...>` with their Chrome already open
5. Send skill attaches to that Chrome via CDP, opens each conversation, pastes template, hits send
6. Cache updates so future triage runs skip messaged creators

---

## Pass/Fail Filter (Simplified)

Creator passes if **all three** are true:

| Check | Minimum |
|---|---|
| Portfolio uploads | ≥ 1 |
| Finished deals on Insense | ≥ 1 |
| Engagement rate | ≥ 1% |

Plus blocklist:
- Insense `Previous Collaborator` tag → skip
- Cache shows `messaged: true` from any prior campaign → skip
- Conversation already contains the Typeform URL → skip (defense-in-depth)

Niches are still extracted and shown in Slack for context. No score field.

---

## Architecture

### MCP

Add to `.mcp.json`:

```json
"playwright": {
  "command": "C:\\Program Files\\nodejs\\npx.cmd",
  "args": ["-y", "@playwright/mcp@latest"],
  "env": {}
}
```

Triage runs use the default headless launch.
Send runs use `browser_connect` against `http://localhost:9222` (operator's Chrome with `--remote-debugging-port=9222`).

### Chrome attach helper

`scripts/launch-chrome-cdp.cmd` (or `.ps1`) — single-file shortcut that launches Chrome with the debug port:

```bat
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data"
```

Operator double-clicks once at the start of the day; the send skill assumes port 9222 is reachable.

### Shared state

```
data/insense/
  cache.json         # creator url -> { status, lastCampaign, lastMessagedAt, blockReason }
  templates.md       # the single message template (preserved verbatim from old runner)
  campaigns.json     # optional: list of tracked campaigns the cron walks
  runs/<campaign-slug>-<ISO>.json   # one file per triage run (audit trail)
```

### Skills

**`insense-triage`** (`.claude/skills/insense-triage/SKILL.md`)
- Trigger: `/insense-triage`, "run insense triage", scheduled via /schedule
- Inputs: `--campaign "<Name>"` (required)
- Env: `INSENSE_PASSWORD`, `SLACK_BOT_TOKEN`, `INSENSE_SLACK_CHANNEL_ID` (default `C0AQZGJDR38`)
- Steps Claude executes via Playwright MCP:
  1. `browser_navigate` to Insense login
  2. Fill email/password (email defaults to `noa@kravemedia.co`)
  3. Navigate to campaign applicants list
  4. Scroll/paginate visible pool (bounded by `--limit`, default 25)
  5. For each applicant card: open profile drawer, extract portfolio/deals/ER/followers/niches/previous-collab flag
  6. Apply pass/fail + blocklist + cache lookup
  7. Write run JSON to `data/insense/runs/<slug>-<iso>.json`
  8. Post Slack parent + one reply per passing candidate (sorted by ER desc)
  9. Update cache rows for triaged creators with `status: 'triaged'`

**`insense-send`** (`.claude/skills/insense-send/SKILL.md`)
- Trigger: `/insense-send`, "send insense to <usernames>"
- Inputs: `--campaign "<Name>"` and one or more usernames or profile URLs
- Env: only `INSENSE_PASSWORD` (only used as fallback if CDP attach fails)
- Steps Claude executes via Playwright MCP:
  1. `browser_connect` to `http://localhost:9222`
  2. For each target:
     - Resolve to Insense conversation URL (lookup in latest run JSON, or search applicants)
     - `browser_navigate`, scan body for Typeform URL → skip if present
     - Render template from `templates.md` (substitute first name)
     - Fill composer textarea, click Send
     - Confirm send (toast / textarea cleared)
     - Update cache: `status: 'messaged'`, `lastMessagedAt`
  3. Post Slack confirmation to the same `#airwallexdrafts` thread (or channel) with results

### Skill parity

Each skill mirrored under `.agents/skills/` and registered in `.agents/skills/claude-ea-workflows/SKILL.md`.

---

## Message Template

Preserved verbatim in `data/insense/templates.md` (recovered from prior `lib/messaging.mjs`):

```
Hey {firstName},

Thanks for applying to our project on Insense. We loved your work and wanted to reach out personally. You weren't quite the right fit for that specific brief, but we absolutely want to keep working with you!

We're Krave Media and we work with some of the fastest-growing DTC brands in the US.
We'd love for you to join our own creator network so our strategists can match you directly to briefs. If you join, you get:

- First look at paid briefs matched to your niche
- Set your own UGC rates - keep 100% of what you earn
- Work directly with the brand team
- Early access to our private creator Discord - jobs board, work-sharing, and direct line to our brand partners
- Long-term relationships - most of our creators work 6+ campaigns a year with us

It just takes 5 min to fill out:
https://form.typeform.com/to/lAPIxgqv

Once you're in, our strategist team will reach out directly with briefs that match you!
Excited to have you on the team! :)

Cheers,
Krave Media Creator Team
```

Substitution: `{firstName}` ← creator's first name; falls back to username (without `@`), then to `there`.

---

## Risks

- **Insense DOM changes** break selectors. Mitigation: keep selectors in one place per skill (`textarea[data-test="msgField:textarea:text"]` etc.) and document in SOP. No standalone runner means failures surface in the chat — fast feedback.
- **CDP attach drift**: if operator closes Chrome or starts it without the debug flag, send fails fast. Helper script + clear error message.
- **Headless login flakiness**: same risk as before. Triage retries login once; if blocked (captcha), fail loud in Slack rather than silently.
- **Cache drift**: only updated by these two skills. Manual messages outside the skill aren't recorded. Acceptable — operator owns the cache.

## Out of Scope

- Web UI for the cache
- Auto-discovery of new campaigns (operator passes campaign name)
- Multi-account support (single Insense login)
