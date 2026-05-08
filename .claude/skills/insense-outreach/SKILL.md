# Skill: Insense Outreach

**Trigger:** "run insense outreach", "insense outreach", "/insense-outreach"
**Mode:** Manual or scheduled. Attaches to operator's everyday Chrome via `playwright-cdp` MCP server (Playwright Extension, no port-9222 launcher needed).
**Spec:** `docs/superpowers/specs/2026-05-07-insense-outreach-mcp.md`
**Replaces:** the prior `insense-triage` + `insense-send` split — one combined pass per the operator's actual ritual.

---

## What This Skill Does

For one campaign, walks each visible applicant, opens the profile drawer, extracts quality signals, applies pass/fail filter + blocklist + cross-campaign cache check, and **for passing creators sends the templated invite immediately** through the row-level Chat composer. No Slack approval gate. Cache is updated as messages send. A Slack summary log is posted at the end of the run.

**Default mode is dry-run.** Pass `--send` to actually message creators.

---

## Inputs

| Input | Required | Default |
|---|---|---|
| `--campaign "<Name>"` | yes | — |
| `--limit N` | no | 25 (visible pool cap) |
| `--send` | no | off (dry-run) |

---

## Prerequisites

1. **Playwright Extension installed in your everyday Chrome** (Chrome Web Store: `Playwright Extension`). One-time install. Token wired into `.mcp.json` for `playwright-cdp` server.
2. The Insense session in that Chrome must be logged in.
3. Cache, template, and run dir under `data/insense/`.

No CDP launcher script needed. No port-9222 dance. Operator can keep browsing in other tabs/windows; do not click in the Insense tab while the skill is running.

---

## Pass/Fail Filter

A creator passes if **all three** are true:

| Check | Minimum |
|---|---|
| Portfolio uploads | ≥ 1 |
| Finished deals on Insense | ≥ 1 |
| Engagement rate | ≥ 1% |

Plus blocklist (any one → skip):
- `Previous Collaborator` tag on the card
- `data/insense/cache.json` shows `status: 'messaged'` from any prior campaign
- Conversation already contains the Typeform URL (`https://form.typeform.com/to/lAPIxgqv`) — defense-in-depth dedup before send

---

## Key Data

- **Template:** `data/insense/templates.md` — single source of truth, substitution `{firstName}`
- **Cache:** `data/insense/cache.json` — keyed by social URL or username; `status` ∈ `triaged | messaged | blocked`
- **Run audit:** `data/insense/runs/<campaign-slug>-<iso>.json` — full record of every applicant in this run
- **Slack channel:** `C0AQZGJDR38` (`#airwallexdrafts`) — post final summary only
- **Slack tool:** use `mcp__slack__slack_post_message` (bot token). NEVER use `mcp__claude_ai_Slack__slack_send_message` — that sends as the user's personal OAuth account (per memory `feedback_slack_posting.md`)

---

## DOM / URL Reference (validated 2026-05-08)

- Dashboard: `https://app.insense.pro/dashboard`
- Campaign applicants list: `a[href*="/received-applicants"]` filtered by campaign name (case-sensitive)
- URL pattern: `/campaigns/<id>/received-applicants`
- Cookiebot DOM removal (always run before any interaction):
  ```js
  for (const id of ['CybotCookiebotDialog', 'CybotCookiebotDialogBodyUnderlay']) {
    const node = document.getElementById(id);
    if (node) node.remove();
  }
  ```
- **Top-card extraction (anchor-walk strategy):**
  - Iterate over `document.querySelectorAll('a[target="_blank"]')` filtering hrefs to `instagram|tiktok|youtube`.
  - For each, walk up the DOM (max 12 levels) until the ancestor's `innerText` contains `View profile` AND (`View application` OR `Chat`). Accept any depth — do NOT hard-filter to depth 6, as virtual rendering changes depths.
  - `View application` is the current (2026-05-08) card label. `Chat` was the prior label — include as fallback.
  - Do NOT extract `firstName` from `cardNode.innerText` — the ancestor is too high and contains multiple cards' text. Extract from drawer instead (see below).
- **View profile click:** find the `button` with `textContent === 'View profile'` inside the resolved card; `.click()` it.
- **Drawer close — CRITICAL — `closeDrawerAndWait()`:**
  ```js
  async function closeDrawerAndWait() {
    pressEscape();
    // Poll until "finished deals" leaves body.innerText — confirms drawer is fully gone.
    // Without this, the next card's drawer opens into stale DOM and extractDrawerSignals
    // returns the previous creator's data (stale-drawer contamination bug, 2026-05-08).
    await waitFor(() => !/\d+\s+finished deals/i.test(document.body.innerText), 5000, 150);
    await sleep(300);
  }
  ```
  Call `closeDrawerAndWait()` everywhere you previously called `pressEscape()` alone. Also call it at the start of each loop iteration if `finished deals` is already in DOM.
- **Drawer wait:** `waitFor(() => /\d+\s+finished deals/i.test(body) && /@?username\b/i.test(body), 12000)` — both conditions required to confirm correct creator loaded.
- **Drawer regex (validated):**
  ```js
  const fd = text.match(/(\d+)\s+finished deals/i);
  const er = text.match(/([\d.]+)\s*%\s*\n?\s*Engagement rate/i);
  const port = text.match(/(\d+)\s+uploads?\s+in\s+\d+\s+(?:different\s+)?categor/i);
  ```
- **firstName extraction — use username directly (validated 2026-05-08):**
  Insense does NOT render a display name adjacent to the @username anywhere in `body.innerText`. The lines before the username are always platform labels ("Instagram profile") or section headers. DOM diagnostic on batch 6 (2026-05-08) confirmed: username at line 2186, preceded by "Instagram profile", with "finished deals" at line 2191 (after, not before). No forward or backward search reliably produces a real display name.
  **Fix: `firstName = targetUsername` unconditionally.** Template gives "Hey wilhelminahomedecor," which is acceptable.
- **Send flow (2026-05-08 — no row-level Chat button):**
  The row-level `Chat` button no longer exists. Send flow is entirely through the drawer:
  1. `View profile` → drawer opens → extract signals → filter
  2. If passed: find `button` with `textContent === 'Send a message'` in the open drawer → click
  3. Composer `textarea[data-test="msgField:textarea:text"]` appears
  4. Fill + send (same React trick as before):
  ```js
  const ta = document.querySelector('textarea[data-test="msgField:textarea:text"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, message);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(300);
  const composer = ta.parentElement?.parentElement?.parentElement;
  const sendBtn = composer?.lastElementChild?.lastElementChild; // SVG icon, no text
  sendBtn.click();
  ```
- **Send confirmation:** `ta.value.length === 0 AND body includes TYPEFORM_URL` within 8s. `send-unconfirmed` (textarea cleared but Typeform URL not visible) is a **false negative** for brand-new conversations — the message sends successfully but the conversation context doesn't show the URL immediately. Treat `send-unconfirmed` as messaged and update cache accordingly.
- **Niche zone:** bound between `text.lastIndexOf('Portfolio')` and `text.lastIndexOf('Audience')` to avoid false matches elsewhere on the page. Vocabulary: Beauty, Skincare, Fashion, Lifestyle, Food, Fitness, Tech, Wellness, Health, Parenting, Travel, Pets, Home, Gaming, Education, Finance, Sports, Music, Art, Business.

---

## Steps Claude Executes

The performance-critical pattern is to **collapse the entire walk-and-send loop into a single `browser_evaluate` call** that runs in-page with async/await + `setTimeout` promises. This replaces ~10 MCP roundtrips per candidate with one. Validated 2026-05-07: 3 candidates (drawer + filter + chat + send + verify) in 17 seconds total. ~25× faster than per-step MCP calls.

### Driver-side (Claude / harness)

1. **Verify CDP attach.** Call `mcp__playwright-cdp__browser_tabs action=list`. If `ECONNREFUSED` or "browser closed", fail loud.
2. **Navigate** to `https://app.insense.pro/dashboard`. Run Cookiebot removal.
3. **Resolve campaign link** — `a[href*="/received-applicants"]` filtered by `--campaign` text.
4. **Navigate to the applicants list.** Wait for `Total applicants:` text.
5. **Scroll-load** until you have at least `--limit` cards: `document.documentElement.scrollTop = 99999` then sleep 1.5s, repeat 2–3×.
6. **Extract candidate list** with the anchor-walk + depth=6 filter (see DOM Reference).
7. **Pre-filter on driver side:**
   - Drop any card whose `socialHref` is in `data/insense/cache.json` with `status: 'messaged'`.
   - Drop cards with `previousCollaborator: true` (record as `blocked`).
   - Drop cards with card-level ER < 1% or `— ER` (record as `failed-filter`, save the drawer-walk).
8. **Build the `targets` array** (`{ username, firstName }`) for everyone left, capped at `--limit`.
9. **Run the in-page walker** (single `browser_evaluate`, see canonical script below). Returns `{ results, totalElapsedMs }`.
10. **Update cache + write run JSON** from the returned results.
11. **Post Slack summary** to `#airwallexdrafts` with the bot token.

### In-page walker (canonical script — validated 2026-05-08)

This is the function passed to `mcp__playwright-cdp__browser_evaluate`. The `targets` array and constants are embedded inline per run (no `__PLACEHOLDER__` substitution needed — just inline the values directly).

Key changes from the 2026-05-07 version:
- `closeDrawerAndWait()` replaces bare `pressEscape()` — polls until "finished deals" leaves DOM before proceeding
- `firstName` extracted from drawer display name (line before `@username`), not from card ancestor
- Send flow: `Send a message` button inside open drawer replaces row-level `Chat` button
- `send-unconfirmed` treated as success — Typeform URL doesn't appear in new conversation context within 8s but message delivers

```js
async () => {
  const targets = [/* { username, socialHref } — firstName extracted from drawer */];
  const TYPEFORM_URL = 'https://form.typeform.com/to/lAPIxgqv';
  const TEMPLATE = `Hey {firstName},\n\n...`; // full template
  const SEND = true; // false for dry-run

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function escapeRe(s) { return s.replace(/[.+*?^${}()|[\]\\]/g, '\\$&'); }

  async function waitFor(predicate, timeoutMs = 10000, intervalMs = 200) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { if (predicate()) return true; } catch {}
      await sleep(intervalMs);
    }
    return false;
  }

  function pressEscape() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
  }

  async function closeDrawerAndWait() {
    pressEscape();
    // Wait for "finished deals" to leave DOM — confirms drawer fully closed.
    // Skipping this causes stale-drawer contamination: next card reads previous creator's data.
    await waitFor(() => !/\d+\s+finished deals/i.test(document.body.innerText), 5000, 150);
    await sleep(300);
  }

  function findCardButton(username, buttonText) {
    const links = Array.from(document.querySelectorAll('a[target="_blank"]'));
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      const re = new RegExp('/' + escapeRe(username) + '(/|$)', 'i');
      if (!re.test(href)) continue;
      let n = link;
      for (let i = 0; i < 12 && n && n !== document.body; i++) {
        const buttons = Array.from(n.querySelectorAll('button'))
          .filter(b => (b.textContent || '').trim() === buttonText);
        if (buttons.length >= 1) return buttons[0];
        n = n.parentElement;
      }
    }
    return null;
  }

  function extractDrawerData(targetUsername) {
    const t = document.body.innerText;
    // Staleness guard
    if (!new RegExp('@?' + escapeRe(targetUsername) + '\\b', 'i').test(t)) {
      return { stale: true };
    }
    // firstName: Insense does not render display name adjacent to @username in body.innerText.
    // The preceding line is always "Instagram profile" or similar — not a real name.
    // Use username directly. Gives "Hey wilhelminahomedecor," which is acceptable.
    const firstName = targetUsername;
    const fd = t.match(/(\d+)\s+finished deals/i);
    const er = t.match(/([\d.]+)\s*%\s*\n?\s*Engagement rate/i);
    const port = t.match(/(\d+)\s+uploads?\s+in\s+\d+\s+(?:different\s+)?categor/i);
    return {
      firstName,
      finishedDeals: fd ? +fd[1] : null,
      engagementRate: er ? +er[1] : null,
      portfolioUploads: port ? +port[1] : null,
    };
  }

  const results = [];
  const startedAt = Date.now();

  for (const t of targets) {
    const r = { username: t.username, firstName: t.username, status: null };
    const itemStart = Date.now();
    try {
      // Guard: close any leftover drawer before starting this iteration
      if (/\d+\s+finished deals/i.test(document.body.innerText)) {
        await closeDrawerAndWait();
      }

      // 1. Open profile drawer
      const vp = findCardButton(t.username, 'View profile');
      if (!vp) { r.status = 'card-not-found'; results.push(r); continue; }
      vp.click();

      // 2. Wait for correct drawer
      let drawerOk = await waitFor(() => {
        const txt = document.body.innerText;
        return /\d+\s+finished deals/i.test(txt)
          && new RegExp('@?' + escapeRe(t.username) + '\\b', 'i').test(txt);
      }, 12000);

      // Retry once on timeout
      if (!drawerOk) {
        await closeDrawerAndWait();
        const link = Array.from(document.querySelectorAll('a[target="_blank"]'))
          .find(a => new RegExp('/' + escapeRe(t.username) + '(/|$)', 'i').test(a.getAttribute('href') || ''));
        if (link) { link.scrollIntoView({ block: 'center' }); await sleep(600); }
        const vpR = findCardButton(t.username, 'View profile');
        if (vpR) {
          vpR.click();
          drawerOk = await waitFor(() => {
            const txt = document.body.innerText;
            return /\d+\s+finished deals/i.test(txt)
              && new RegExp('@?' + escapeRe(t.username) + '\\b', 'i').test(txt);
          }, 12000);
        }
      }

      if (!drawerOk) { r.status = 'drawer-timeout'; await closeDrawerAndWait(); results.push(r); continue; }

      // 3. Extract signals + firstName from drawer
      const drawer = extractDrawerData(t.username);
      if (drawer.stale) { r.status = 'drawer-stale'; await closeDrawerAndWait(); results.push(r); continue; }
      r.firstName = drawer.firstName;
      r.finishedDeals = drawer.finishedDeals;
      r.engagementRate = drawer.engagementRate;
      r.portfolioUploads = drawer.portfolioUploads;

      // 4. Filter
      const passed = (r.finishedDeals != null && r.finishedDeals >= 1)
                  && (r.engagementRate != null && r.engagementRate >= 1)
                  && (r.portfolioUploads != null && r.portfolioUploads >= 1);
      if (!passed) { r.status = 'failed-filter'; await closeDrawerAndWait(); results.push(r); continue; }

      if (!SEND) { r.status = 'would-send'; await closeDrawerAndWait(); results.push(r); continue; }

      // 5. Click "Send a message" inside the open drawer (no row-level Chat button since 2026-05-08)
      const sendMsgBtn = Array.from(document.querySelectorAll('button'))
        .find(b => (b.textContent || '').trim() === 'Send a message');
      if (!sendMsgBtn) { r.status = 'send-msg-btn-not-found'; await closeDrawerAndWait(); results.push(r); continue; }
      sendMsgBtn.click();

      // 6. Wait for composer
      const composerOk = await waitFor(() => !!document.querySelector('textarea[data-test="msgField:textarea:text"]'), 8000);
      if (!composerOk) { r.status = 'composer-timeout'; pressEscape(); await sleep(500); results.push(r); continue; }

      // 7. Typeform dedup — defense-in-depth
      if (document.body.innerText.includes(TYPEFORM_URL)) {
        r.status = 'already-sent'; pressEscape(); await sleep(300); results.push(r); continue;
      }

      // 8. Fill + send
      const ta = document.querySelector('textarea[data-test="msgField:textarea:text"]');
      const message = TEMPLATE.replace(/\{firstName\}/g, r.firstName);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, message);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(300);

      const composer = ta.parentElement?.parentElement?.parentElement;
      const sendBtn = composer?.lastElementChild?.lastElementChild; // SVG icon, no text
      if (!sendBtn) { r.status = 'send-button-not-found'; pressEscape(); results.push(r); continue; }
      sendBtn.click();

      // 9. Confirm — send-unconfirmed is a false negative for new conversations; treat as success
      const sent = await waitFor(() => {
        const ta2 = document.querySelector('textarea[data-test="msgField:textarea:text"]');
        return ta2 && ta2.value.length === 0 && document.body.innerText.includes(TYPEFORM_URL);
      }, 8000);

      r.status = sent ? 'sent' : 'send-unconfirmed';
      pressEscape();
      await sleep(500);

    } catch(e) {
      r.status = 'error'; r.error = String(e?.message || e);
      try { pressEscape(); } catch {}
    }
    r.elapsedMs = Date.now() - itemStart;
    results.push(r);
  }

  return { results, totalElapsedMs: Date.now() - startedAt };
}
```

**Performance benchmarks (validated 2026-05-07):**
- Per-candidate average: ~5.5s at low scroll depth, ~16s past 250 cards (Insense throttles drawer loads).
- 3 candidates total: 17s (in-page walker) vs ~10 min (per-step MCP pattern).
- Speedup: ~25× from collapsing MCP roundtrips into a single in-page evaluate.

**Depth caveat:** Past ~250 cards in the visible pool, Insense rate-limits drawer loads. Drawer-timeout rate jumped from 0% to ~40% in a 25-candidate batch at that depth (run 9, 2026-05-07). Mitigations baked into the canonical script:
- **Stale-drawer guard:** verify the drawer text contains the target's username before reading values.
- **One-shot retry on timeout:** if the drawer doesn't load in 12s, escape, scroll the card back into view, click View profile again, wait another 12s.

If you're sweeping a campaign past ~150 sends, prefer batches of 10 over 25 to keep the success rate high.

**Hard limit observed (Little Saints, 2026-05-07 run 10):** even with scroll-into-view + retry, drawers stop loading entirely past ~280 cards / 150 sends in a single session. The staleness guard correctly refuses to send when this happens (returns `drawer-timeout`). To keep going past the hard limit, **end the session and resume in a fresh browser tab another time** — Insense's rate counter appears to reset between sessions. Cache will skip everyone already messaged, so the next session starts fresh from the first available unmessaged creator.

---

## Cache Format

```json
{
  "creators": {
    "https://www.tiktok.com/@elevatewithdai": {
      "status": "messaged",
      "lastCampaign": "Little Saints - US Based Creators",
      "lastMessagedAt": "2026-05-07T...Z",
      "blockReason": ""
    }
  }
}
```

`status` ∈ `triaged | messaged | blocked`. Only `messaged` blocks future sends.

---

## Output Format

Slack summary in `#airwallexdrafts`:

```
Insense outreach — <Campaign> — DRY RUN  (or — SEND)
Walked: N | Passed: X | Sent: S | Skipped: K | Failed filter: F | Blocked: B

Sent (or "Would send" in dry-run):
• @elevatewithdai — 16 deals — 8.6% ER — wellness, health
• @ricthelisouza — 54 deals — 2.41% ER — beauty, food, health

Skipped (already messaged):
• @somecreator (last messaged 2026-04-29 from <prior campaign>)

Failed filter:
• @ninja_natalie — 0.74% ER (below 1%)

Blocked:
• @heyanhmian — Previous Collaborator
```

---

## After the Run

**Always do this after any `--send` run to keep the ops dashboard current.**

The ops dashboard ([krave-ops-dashboard.onrender.com](https://krave-ops-dashboard.onrender.com)) reads `data/insense/cache.json` from the deployed repo. It only updates when the file is committed and pushed.

```bash
git add data/insense/cache.json
git commit -m "chore(insense): update outreach cache post-run"
git push
```

Render auto-deploys on push. Dashboard reflects new data within ~1 minute.

**Do not push raw batch files** (`data/insense/batch*-raw.json`) — these are gitignored and local-only.

---

## Failure Modes

| Failure | Behaviour |
|---|---|
| Playwright Extension not connected | Fail loud, instruct operator to check extension popup |
| Campaign not found on dashboard | Fail loud in Slack |
| `Total applicants:` never appears | Fail loud, snapshot DOM into `data/insense/runs/error-<iso>.snapshot.md` |
| Drawer extraction returns null fields for some signal | Mark `passed: false`, `blockReason: 'Could not extract signals'`. Continue. |
| Composer textarea not found in send flow | Mark this creator `failed`, continue with next. Do NOT mark cache as `messaged`. |
| Send confirmation never arrives | Same — `failed`, continue, no cache write. |
| Slack post fails at end | Save cache + run JSON anyway, surface error to operator |

---

## Background Use

Operator can keep working in other tabs / windows. Playwright Extension drives the Insense tab via JS — focus is irrelevant. **Do not interact with the Insense tab itself while the run is in progress.**

---

## Scheduling

Optional: schedule via `/schedule` per campaign, daily at 09:00 PHT. Recommended to schedule with `--send` only after a manual `--dry-run` validates the campaign's filter behavior.

```
claude -p "/insense-outreach --campaign \"Little Saints - US Based Creators\" --limit 25 --send" --dangerously-skip-permissions
```

---

## Out of Scope

- Logging into Insense (operator owns the session).
- Auto-discovery of new campaigns (operator passes `--campaign`).
- Per-creator template variants (single template).
- Score weighting (deliberately removed — pass/fail filter only).
- Slack reaction-based approval (deliberately removed in v3 — combined flow).
