# SOP: Insense Outreach

**Skill:** `insense-outreach` (one combined skill — replaces the prior `insense-triage` + `insense-send` split)
**Spec:** `docs/superpowers/specs/2026-05-07-insense-outreach-mcp.md`

---

## Daily Operating Ritual

1. **Open Insense in your everyday Chrome** — one tab logged in is enough. The Playwright Extension is installed there permanently.
2. **Run the skill** — `/insense-outreach --campaign "<Name>" --limit 25` for a dry-run preview, or add `--send` to actually message.
3. **Skill walks applicants** in sequence: opens each profile drawer, extracts signals, applies filter, sends template if passes.
4. **Slack `#airwallexdrafts`** gets a final summary: walked / passed / sent / skipped / failed / blocked counts plus per-creator detail.
5. **Cache** under `data/insense/cache.json` updates as creators are messaged so the next run skips them automatically.

---

## Setup

### One-time per machine
- Install the **Playwright Extension** in your everyday Chrome from the Chrome Web Store: `https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm`
- Pin the extension to the toolbar.
- Click the extension icon → copy the `PLAYWRIGHT_MCP_EXTENSION_TOKEN` value.
- Paste the token into `.mcp.json` under the `playwright-cdp` server's `env`. (Already wired on this machine; verify if you copy the repo elsewhere.)
- Confirm `playwright`, `playwright-cdp` are in `.claude/settings.local.json` `enabledMcpjsonServers`.

### Per session
- Just have your everyday Chrome open with Insense logged in. No launcher script, no port-9222 dance.
- Verify with `claude mcp list` that `playwright-cdp` is Connected.

### Adding a new tracked campaign
- Pass the exact campaign name (case-sensitive) via `--campaign "<Name>"`.
- Optionally schedule via `/schedule` after a manual `--dry-run` validates the filter.

---

## Pass/Fail Filter

A creator passes if **all three** are true:
- Portfolio uploads ≥ 1
- Finished deals on Insense ≥ 1
- Engagement rate ≥ 1%

Plus blocklist (any one → skip):
- Insense `Previous Collaborator` tag
- Cache shows `messaged` from any prior campaign
- Conversation already contains the Typeform URL (defense-in-depth)

---

## Background Use

Operator can keep working in other tabs and other Chrome windows. Playwright Extension drives the Insense tab via JavaScript — focus is irrelevant. **Just don't click in the Insense tab itself while a run is in progress.**

---

## DOM-Change Runbook

When a run starts failing:

1. **Check the most recent run JSON** in `data/insense/runs/` — look for `error-*.snapshot.md`.
2. **Open Insense in the same Chrome**, navigate to the broken view, inspect.
3. **Selectors and regexes are documented in:** `.claude/skills/insense-outreach/SKILL.md` → "DOM / URL Reference (validated YYYY-MM-DD)" section.
4. **Update the selector / regex in the SKILL.md**, append a note to `decisions/log.md` if the change is meaningful.
5. **Re-run with `--limit 5` and no `--send`** to validate before re-enabling real outreach.

The most fragile selectors (historical incidents):
- **Cookiebot dialog** blocking row clicks → solved by `document.getElementById('CybotCookiebotDialog')?.remove()` before any interaction.
- **Card finder** — must use anchor-walk (start from `a[target="_blank"]`, walk up until ancestor's `innerText` contains `View profile` AND `Chat`, depth ≈ 6). The "find ancestor with 3 keywords" approach does NOT work with current Insense DOM.
- **Recommended-creators noise** — those cards land at depth 7. Filter to depth 6 to drop them.
- **Drawer label format** — Insense uses lowercase `"finished deals"` and value-then-label format for ER (`8.6%\nEngagement rate`).
- **Chat button** — must use the row-level `getByRole('button', { name: /chat/i })`, NOT a profile-drawer detour (regressed twice in old runner).
- **Send button** — DOM walk: `composer.lastElementChild.lastElementChild`. If composer DOM restructures, this breaks.

---

## Cache Management

`data/insense/cache.json` is the source of truth for cross-campaign dedup.

### Reset cache (rare)
- Back up first: `cp data/insense/cache.json data/insense/cache.json.bak.<date>`
- Replace contents with `{ "creators": {} }`.
- Next run will re-mark everyone as `triaged`; if you also pass `--send`, everyone gets re-messaged. Consider blast radius.

### Re-onboarding a creator who was previously messaged
- Open `data/insense/cache.json`, find the creator's entry by URL or username.
- Either delete the entry, or change `status` from `messaged` to `triaged`.
- Next run with `--send` will message them again.

### Manual outreach drift
- Messages sent outside the skill are NOT recorded in cache. To make triage skip them, add an entry by hand:
  ```json
  "https://www.tiktok.com/@username": {
    "status": "messaged",
    "lastCampaign": "manual",
    "lastMessagedAt": "2026-05-07T...Z",
    "blockReason": ""
  }
  ```

---

## Failure Recovery

| Symptom | Likely cause | Fix |
|---|---|---|
| `browserBackend.callTool: Target page, context or browser has been closed` | Chrome was closed or you closed the Insense tab | Reopen the tab; the extension reconnects automatically |
| `initializeServer: connect ECONNREFUSED` (extension mode) | Extension popup not connected, token mismatch | Check extension popup, copy fresh token into `.mcp.json`, restart Claude Code |
| Campaign not found | Name mismatch (case-sensitive) | Match the exact campaign title shown on the Insense dashboard |
| `Total applicants:` never appears | Insense slow load, throttling | Re-run; if persistent, increase wait timeouts |
| Drawer empty for some creators | Insense throttling | Re-run; specific creators may need manual review |
| Same creator messaged twice | Cache lost or manual send happened | See "Manual outreach drift" above |
| Slack post fails | Bot token expired or channel renamed | Re-issue bot token, confirm channel ID `C0AQZGJDR38` |

---

## Out of Scope

- Logging into Insense from the skill (operator owns the session).
- Auto-discovery of new campaigns.
- Per-creator template variants (single template).
- Score weighting (deliberately removed — pass/fail filter only).
- Slack reaction-based approval (deliberately removed in v3 — combined flow without approval gate).
