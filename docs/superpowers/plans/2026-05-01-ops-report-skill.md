# Ops Report Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dual-agent ops reporting skill that live-reads n8n execution history, the Client Invoice Tracker, and Slack context to produce a briefing plus local dashboard snapshot.

**Architecture:** The skill is instruction-first and live-read only. Both Claude and Codex get matching `ops-report` skill files, while Codex's existing dispatcher gets a routing row so report phrases are discoverable. A small Node validation script checks static coverage and dashboard ignore rules without calling live APIs.

**Tech Stack:** Markdown skills, PowerShell/n8n public API, Slack MCP, Google Sheets MCP, Node.js assertion validation.

---

## File Structure

- Create `.claude/skills/ops-report/SKILL.md`: Claude-facing runbook for live ops reporting.
- Create `.agents/skills/ops-report/SKILL.md`: Codex-facing runbook using this repo's available MCP and PowerShell patterns.
- Modify `.agents/skills/claude-ea-workflows/SKILL.md`: Add dispatcher row and workflow map entry for ops reporting.
- Modify `.gitignore`: Ignore `.superpowers/` visual companion artifacts and generated `reports/ops-report/` dashboard files.
- Create `n8n-workflows/ops-report-skill.test.js`: Static validation for dual skill coverage, dispatcher coverage, source IDs, and ignore rules.

### Task 1: Add validation first

**Files:**
- Create: `n8n-workflows/ops-report-skill.test.js`

- [ ] **Step 1: Write the failing validation script**

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const codexSkillPath = '.agents/skills/ops-report/SKILL.md';
const claudeSkillPath = '.claude/skills/ops-report/SKILL.md';

assert.ok(fs.existsSync(path.join(root, codexSkillPath)), 'Expected Codex ops-report skill');
assert.ok(fs.existsSync(path.join(root, claudeSkillPath)), 'Expected Claude ops-report skill');

for (const skillPath of [codexSkillPath, claudeSkillPath]) {
  const skill = read(skillPath);
  assert.match(skill, /ops-report/, `${skillPath} should name ops-report`);
  assert.match(skill, /hey report|ops report|daily report|weekly report/i, `${skillPath} should define report triggers`);
  assert.match(skill, /N8N_API_KEY/, `${skillPath} should document n8n API access`);
  assert.match(skill, /1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50/, `${skillPath} should include tracker spreadsheet ID`);
  assert.match(skill, /C09HN2EBPR7/, `${skillPath} should include payments channel`);
  assert.match(skill, /C0AQZGJDR38/, `${skillPath} should include airwallexdrafts channel`);
  assert.match(skill, /reports\/ops-report/, `${skillPath} should define dashboard output path`);
  assert.match(skill, /live-read only/i, `${skillPath} should preserve live-read-only boundary`);
  assert.doesNotMatch(skill, /write to column N/i, `${skillPath} must not suggest writing formula column N`);
}

const dispatcher = read('.agents/skills/claude-ea-workflows/SKILL.md');
assert.match(dispatcher, /hey report|ops report|daily report|weekly report/i, 'Dispatcher should route report phrases');
assert.match(dispatcher, /\.agents\/skills\/ops-report\/SKILL\.md/, 'Dispatcher should reference Codex skill path');
assert.match(dispatcher, /\.claude\/skills\/ops-report\/SKILL\.md/, 'Dispatcher should reference Claude skill path');

const gitignore = read('.gitignore');
assert.match(gitignore, /^\.superpowers\/$/m, 'Expected .superpowers/ ignored');
assert.match(gitignore, /^reports\/ops-report\/$/m, 'Expected reports/ops-report/ ignored');

console.log('Ops report skill coverage check passed.');
```

- [ ] **Step 2: Run validation and confirm it fails before implementation**

Run: `node n8n-workflows/ops-report-skill.test.js`

Expected: FAIL with `Expected Codex ops-report skill`.

### Task 2: Create both ops-report skills

**Files:**
- Create: `.agents/skills/ops-report/SKILL.md`
- Create: `.claude/skills/ops-report/SKILL.md`

- [ ] **Step 1: Add the Codex skill**

Create a Codex runbook with YAML frontmatter, trigger language, source order, n8n API PowerShell examples, Google Sheets instructions, Slack instructions, dashboard output path, and failure caveats.

- [ ] **Step 2: Add the Claude skill**

Create a matching Claude runbook with the same operational contract, using Claude-style MCP tool names where useful and keeping all source IDs identical.

- [ ] **Step 3: Run validation**

Run: `node n8n-workflows/ops-report-skill.test.js`

Expected: FAIL only on dispatcher and `.gitignore` coverage.

### Task 3: Add dispatcher and ignore coverage

**Files:**
- Modify: `.agents/skills/claude-ea-workflows/SKILL.md`
- Modify: `.gitignore`

- [ ] **Step 1: Add dispatcher row**

Add a row mapping `/ops-report`, "hey report", "ops report", "daily report", "weekly report", and "dashboard report" to `.claude/skills/ops-report/SKILL.md`.

- [ ] **Step 2: Add automation map row**

Add a row explaining that ops report is a live-read reporting skill, not a workflow trigger, and that Codex uses `.agents/skills/ops-report/SKILL.md`.

- [ ] **Step 3: Ignore local artifacts**

Add these exact lines to `.gitignore`:

```gitignore
.superpowers/
reports/ops-report/
```

- [ ] **Step 4: Run validation**

Run: `node n8n-workflows/ops-report-skill.test.js`

Expected: PASS with `Ops report skill coverage check passed.`

### Task 4: Final review

**Files:**
- Test: `n8n-workflows/ops-report-skill.test.js`

- [ ] **Step 1: Scan for draft markers**

Run: `rg -n "TODO|TBD|placeholder|fill in" .agents/skills/ops-report .claude/skills/ops-report docs/superpowers/specs/2026-05-01-ops-report-skill-design.md`

Expected: no matches.

- [ ] **Step 2: Check git status**

Run: `git status --short`

Expected: only the new spec, plan, skills, validation script, dispatcher update, `.gitignore`, and ignored `.superpowers/` artifacts.

### Task 5: Add reminder attribution contract tests

**Files:**
- Modify: `n8n-workflows/invoice-reminder-cron.test.js`
- Create: `n8n-workflows/invoice-reminder-reply-detection.test.js`
- Modify: `n8n-workflows/connection-integrity.test.js`

- [ ] **Step 1: Extend reminder cron test**

Assert that `deploy-invoice-reminder-cron.js` writes latest follow-up metadata to tracker columns `Last Follow-Up Sent`, `Last Follow-Up Type`, and `Last Follow-Up Thread ID`, while continuing to write `Reminders Sent` and avoiding column N.

- [ ] **Step 2: Add reply-detection workflow test**

Assert that `deploy-invoice-reminder-reply-detection.js` exists, is scoped to `john@kravemedia.co`, reads `Invoices!A:Y`, searches Gmail reminder threads, classifies replies into the approved statuses, writes only reply attribution columns V:Y plus the invoice key, and does not send email or Slack messages.

- [ ] **Step 3: Add reply detection to connection integrity**

Include the new deploy script in the static connection validation list.

### Task 6: Implement tracker metadata in reminder cron

**Files:**
- Modify: `n8n-workflows/deploy-invoice-reminder-cron.js`

- [ ] **Step 1: Capture follow-up metadata**

Extend the invoice processing code to output `lastFollowUpSent`, `lastFollowUpType`, and `lastFollowUpThreadId` for each sent reminder. Use the invoice number as the stable fallback thread key when Gmail does not expose an actual thread id after send.

- [ ] **Step 2: Write S/T/U tracker columns**

Add the new columns to the Google Sheets append/update mapping, preserving existing updates to `Payment Status` and `Reminders Sent` and continuing to avoid formula column N.

### Task 7: Add reply detection workflow

**Files:**
- Create: `n8n-workflows/deploy-invoice-reminder-reply-detection.js`
- Modify: `n8n-workflows/WORKFLOWS.md`
- Modify: `n8n-workflows/README.md`

- [ ] **Step 1: Create the workflow deploy script**

Build a read/update workflow named `Krave - Invoice Reminder Reply Detection` with schedule plus webhook trigger. It reads the invoice tracker, filters rows with follow-up metadata, searches John's Gmail for replies in reminder threads, classifies replies conservatively, and writes `Last Client Reply Date`, `Client Reply Status`, `Client Reply Summary`, and `Follow-Up Attribution`.

- [ ] **Step 2: Document the workflow**

Add the workflow to the workflow index, shared tracker column map, and runbook docs. Note that it watches only `john@kravemedia.co`, does not monitor Noa or strategist inboxes, and does not auto-respond.

### Task 8: Update report skills and validate

**Files:**
- Modify: `.agents/skills/ops-report/SKILL.md`
- Modify: `.claude/skills/ops-report/SKILL.md`
- Modify: `n8n-workflows/ops-report-skill.test.js`

- [ ] **Step 1: Teach reports to read A:Y**

Update both report skills to use the new reminder attribution columns and to lead with reminder performance when available.

- [ ] **Step 2: Validate all static contracts**

Run the affected tests:

```powershell
node n8n-workflows\invoice-reminder-cron.test.js
node n8n-workflows\invoice-reminder-reply-detection.test.js
node n8n-workflows\connection-integrity.test.js
node n8n-workflows\ops-report-skill.test.js
```
