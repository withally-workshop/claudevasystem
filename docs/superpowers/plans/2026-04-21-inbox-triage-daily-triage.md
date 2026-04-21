# Inbox Triage Daily Triage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an n8n workflow that performs morning inbox triage for `noa@kravemedia.co`, creates Gmail drafts for reply-needed emails, applies Gmail labels, archives non-ambiguous items, and posts the summary to both `#airwallexdrafts` and Noa's Slack DM.

**Architecture:** Add one new deploy script that defines the full Daily Triage workflow with a weekday schedule trigger and a manual webhook trigger. Keep classification hybrid: deterministic code-node rules for obvious cases, an OpenAI node for nuanced tier/context decisions and drafting, then Gmail mutation and Slack fan-out with failure alerts. Cover the workflow with focused contract tests, extend shared connection-integrity coverage, and document the workflow in the repo handover docs.

**Tech Stack:** Node.js, n8n Cloud workflow JSON via deploy scripts, Gmail nodes, Slack nodes, OpenAI node, built-in n8n Code nodes, `node:assert/strict`

---

## File Structure

### Files to create

- `n8n-workflows/deploy-inbox-triage-daily.js`
  Purpose: Source-of-truth deploy script for the new Daily Triage workflow.
- `n8n-workflows/inbox-triage-daily.test.js`
  Purpose: Contract test for workflow name, triggers, Gmail/Slack/OpenAI nodes, tier constants, and summary behavior.
- `docs/superpowers/plans/2026-04-21-inbox-triage-daily-triage.md`
  Purpose: This implementation plan.

### Files to modify

- `n8n-workflows/README.md`
  Purpose: Add the new workflow to the summary table and add a section with trigger, purpose, deploy command, and credential requirements.
- `n8n-workflows/WORKFLOWS.md`
  Purpose: Add the workflow to the workflow index, shared infra references, flow description, outputs, and failure handling.
- `n8n-workflows/connection-integrity.test.js`
  Purpose: Extend shared connection-integrity coverage to the new deploy script.

### Files to reference during implementation

- `docs/superpowers/specs/2026-04-21-inbox-triage-daily-triage-design.md`
- `.claude/skills/inbox-triage/SKILL.md`
- `n8n-workflows/deploy-eod-triage-summary.js`
- `n8n-workflows/eod-triage-workflow.test.js`

---

### Task 1: Add the Failing Contract Test for Daily Triage

**Files:**
- Create: `n8n-workflows/inbox-triage-daily.test.js`
- Test: `n8n-workflows/inbox-triage-daily.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const deployPath = path.join(__dirname, 'deploy-inbox-triage-daily.js');
const workflowsDocPath = path.join(__dirname, 'WORKFLOWS.md');
const readmePath = path.join(__dirname, 'README.md');

assert.ok(fs.existsSync(deployPath), 'Expected deploy-inbox-triage-daily.js to exist');

const deploySource = fs.readFileSync(deployPath, 'utf8');
const workflowsDoc = fs.readFileSync(workflowsDocPath, 'utf8');
const readmeDoc = fs.readFileSync(readmePath, 'utf8');

assert.match(deploySource, /name:\s+'Krave .* Inbox Triage Daily'/, 'Expected workflow name in deploy script');
assert.match(deploySource, /path:\s+'krave-inbox-triage-daily'/, 'Expected manual webhook path');
assert.match(deploySource, /scheduleTrigger/, 'Expected schedule trigger node');
assert.match(deploySource, /gmail/i, 'Expected Gmail integration in deploy script');
assert.match(deploySource, /slack/i, 'Expected Slack integration in deploy script');
assert.match(deploySource, /openAi/i, 'Expected OpenAI integration in deploy script');
assert.match(readmeDoc, /Inbox Triage Daily/, 'Expected workflow listed in README');
assert.match(workflowsDoc, /Inbox Triage Daily/, 'Expected workflow listed in WORKFLOWS.md');

console.log('Inbox triage daily workflow contract check passed.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node n8n-workflows/inbox-triage-daily.test.js`
Expected: FAIL with `Expected deploy-inbox-triage-daily.js to exist`

- [ ] **Step 3: Write minimal implementation**

Create the deploy-script stub so the first failure advances from missing file to missing contract details.

```javascript
const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = 'replace-me';

const workflow = {
  name: 'Krave - Inbox Triage Daily',
  nodes: [],
  connections: {},
};

module.exports = { workflow };
```

- [ ] **Step 4: Run test to verify it still fails for the right reason**

Run: `node n8n-workflows/inbox-triage-daily.test.js`
Expected: FAIL with a regex assertion such as `Expected manual webhook path`

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/inbox-triage-daily.test.js n8n-workflows/deploy-inbox-triage-daily.js
git commit -m "test: add inbox triage daily contract"
```

---

### Task 2: Scaffold the Workflow Skeleton and Shared Constants

**Files:**
- Modify: `n8n-workflows/deploy-inbox-triage-daily.js`
- Test: `n8n-workflows/inbox-triage-daily.test.js`

- [ ] **Step 1: Write the failing test for skeleton nodes and shared IDs**

Add assertions for the workflow constants, trigger nodes, and top-level routing skeleton.

```javascript
assert.match(deploySource, /const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD'/, 'Expected shared Slack credential id');
assert.match(deploySource, /const OPENAI_CRED_ID = 'UIREXIYn59JOH1zU'/, 'Expected shared OpenAI credential id');
assert.match(deploySource, /const AIRWALLEX_DRAFTS = 'C0AQZGJDR38'/, 'Expected #airwallexdrafts channel id');
assert.match(deploySource, /const NOA_USER_ID = 'U06TBGX9L93'/, 'Expected Noa DM user id');
assert.match(deploySource, /const TIMEZONE = 'Asia\/Manila'/, 'Expected Manila timezone constant');
assert.match(deploySource, /'Schedule 9am ICT Weekdays'/, 'Expected schedule trigger node');
assert.match(deploySource, /'Webhook Trigger'/, 'Expected manual webhook node');
assert.match(deploySource, /'Search Inbox'/, 'Expected Gmail search node');
assert.match(deploySource, /'Fetch Message Details'/, 'Expected Gmail detail node');
assert.match(deploySource, /'Build Slack Summary'/, 'Expected summary node');
assert.match(deploySource, /'Post to Airwallex Drafts'/, 'Expected channel summary node');
assert.match(deploySource, /'DM Noa Summary'/, 'Expected Noa DM node');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node n8n-workflows/inbox-triage-daily.test.js`
Expected: FAIL with `Expected shared Slack credential id`

- [ ] **Step 3: Write minimal implementation**

Expand the deploy script into the same top-level shape used by the existing workflow deploy files.

```javascript
const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiMTkwMWE5My02ZjJjLTRlNzEtOWI4ZC02ZjlhMzVhMjU4NzUiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiZjBlZjk1YTYtYzc2MS00Zjc2LWJkZTgtMWU1Y2FiN2UxMjcxIiwiaWF0IjoxNzc2NjY1NjMxfQ.uBo2H0dzui9S0_MktoRxdodKzzE58vcQtXSlu8VpcEY';
const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD';
const OPENAI_CRED_ID = 'UIREXIYn59JOH1zU';
const AIRWALLEX_DRAFTS = 'C0AQZGJDR38';
const NOA_USER_ID = 'U06TBGX9L93';
const TIMEZONE = 'Asia/Manila';

const workflow = {
  name: 'Krave - Inbox Triage Daily',
  settings: { executionOrder: 'v1', saveManualExecutions: true },
  nodes: [
    {
      id: 'n1',
      name: 'Schedule 9am ICT Weekdays',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [240, 220],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 1 * * 1-5' }] } }
    },
    {
      id: 'n2',
      name: 'Webhook Trigger',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [240, 420],
      webhookId: 'krave-inbox-triage-daily',
      parameters: { httpMethod: 'POST', path: 'krave-inbox-triage-daily', responseMode: 'onReceived', options: {} }
    },
    {
      id: 'n3',
      name: 'Search Inbox',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [480, 320],
      parameters: {}
    },
    {
      id: 'n4',
      name: 'Fetch Message Details',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [700, 320],
      parameters: {}
    },
    {
      id: 'n5',
      name: 'Build Slack Summary',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [920, 320],
      parameters: {}
    },
    {
      id: 'n6',
      name: 'Post to Airwallex Drafts',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [1140, 260],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {}
    },
    {
      id: 'n7',
      name: 'DM Noa Summary',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [1140, 380],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {}
    }
  ],
  connections: {
    'Schedule 9am ICT Weekdays': { main: [[{ node: 'Search Inbox', type: 'main', index: 0 }]] },
    'Webhook Trigger': { main: [[{ node: 'Search Inbox', type: 'main', index: 0 }]] }
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node n8n-workflows/inbox-triage-daily.test.js`
Expected: PASS for the constant and skeleton assertions added in this task

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/deploy-inbox-triage-daily.js n8n-workflows/inbox-triage-daily.test.js
git commit -m "feat: scaffold inbox triage daily workflow"
```

---

### Task 3: Implement Gmail Search and Normalization

**Files:**
- Modify: `n8n-workflows/deploy-inbox-triage-daily.js`
- Test: `n8n-workflows/inbox-triage-daily.test.js`

- [ ] **Step 1: Write the failing test for search query and normalization contract**

Add assertions for the Gmail query, normalized fields, and timezone-aware runtime date handling.

```javascript
assert.match(deploySource, /in:inbox after:/, 'Expected inbox-after-date Gmail query');
assert.match(deploySource, /gmail-message-id|message_id/, 'Expected normalized message id field');
assert.match(deploySource, /thread_id/, 'Expected normalized thread id field');
assert.match(deploySource, /from_name/, 'Expected normalized sender name field');
assert.match(deploySource, /from_email/, 'Expected normalized sender email field');
assert.match(deploySource, /subject/, 'Expected normalized subject field');
assert.match(deploySource, /snippet/, 'Expected normalized snippet field');
assert.match(deploySource, /body_preview/, 'Expected normalized body preview field');
assert.match(deploySource, /received_at/, 'Expected normalized timestamp field');
assert.match(deploySource, /Intl\.DateTimeFormat/, 'Expected runtime date formatting for Manila timezone');
assert.match(deploySource, /runOnceForEachItem/, 'Expected per-message normalization');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node n8n-workflows/inbox-triage-daily.test.js`
Expected: FAIL with `Expected inbox-after-date Gmail query`

- [ ] **Step 3: Write minimal implementation**

Add the runtime query builder and message-normalization code.

```javascript
const BUILD_QUERY_CODE = `
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const parts = formatter.formatToParts(new Date());
const year = parts.find((part) => part.type === 'year')?.value;
const month = parts.find((part) => part.type === 'month')?.value;
const day = parts.find((part) => part.type === 'day')?.value;
const todayIso = year + '-' + month + '-' + day;

const todayUtc = new Date(todayIso + 'T00:00:00Z');
todayUtc.setUTCDate(todayUtc.getUTCDate() - 1);
const y = todayUtc.getUTCFullYear();
const m = String(todayUtc.getUTCMonth() + 1).padStart(2, '0');
const d = String(todayUtc.getUTCDate()).padStart(2, '0');

return [{
  json: {
    query: 'in:inbox after:' + y + '/' + m + '/' + d,
    today_iso: todayIso,
    after_date: y + '/' + m + '/' + d
  }
}];
`.trim();

const NORMALIZE_EMAIL_CODE = `
function headerValue(headers, name) {
  return (headers || []).find((header) => String(header.name || '').toLowerCase() === name.toLowerCase())?.value || '';
}

function parseSender(raw) {
  const match = String(raw || '').match(/^(.*?)(?:\\s*<([^>]+)>)?$/);
  return {
    from_name: (match?.[1] || raw || '').replace(/["']/g, '').trim(),
    from_email: (match?.[2] || raw || '').trim()
  };
}

const payload = $json.payload || {};
const sender = parseSender(headerValue(payload.headers, 'From'));

return {
  json: {
    message_id: $json.id || '',
    thread_id: $json.threadId || '',
    from_name: sender.from_name,
    from_email: sender.from_email,
    subject: headerValue(payload.headers, 'Subject'),
    snippet: $json.snippet || '',
    body_preview: ($json.textPlain || $json.textHtml || '').replace(/\\s+/g, ' ').trim().slice(0, 800),
    received_at: headerValue(payload.headers, 'Date') || ''
  }
};
`.trim();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node n8n-workflows/inbox-triage-daily.test.js`
Expected: PASS for the search and normalization assertions added in this task

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/deploy-inbox-triage-daily.js n8n-workflows/inbox-triage-daily.test.js
git commit -m "feat: add inbox triage Gmail normalization"
```

---

### Task 4: Implement Rules-Based Classification Guardrails

**Files:**
- Modify: `n8n-workflows/deploy-inbox-triage-daily.js`
- Test: `n8n-workflows/inbox-triage-daily.test.js`

- [ ] **Step 1: Write the failing test for deterministic rule coverage**

Add assertions for the tier set, known-contact protection, and hard-coded risk keywords.

```javascript
assert.match(deploySource, /EA\/Urgent/, 'Expected urgent tier constant');
assert.match(deploySource, /EA\/Needs-Reply/, 'Expected needs-reply tier constant');
assert.match(deploySource, /EA\/FYI/, 'Expected FYI tier constant');
assert.match(deploySource, /EA\/Auto-Sorted/, 'Expected auto-sorted tier constant');
assert.match(deploySource, /EA\/Unsure/, 'Expected unsure tier constant');
assert.match(deploySource, /Amanda|Shin|Joshua|Amy|Shuo Shimpa|IM8/i, 'Expected known-contact protection list');
assert.match(deploySource, /legal|contract|overdue|deadline today|payment risk/i, 'Expected urgent keyword guardrails');
assert.match(deploySource, /newsletter|receipt|noreply@|no-reply@/i, 'Expected auto-sorted keyword guardrails');
assert.match(deploySource, /never auto-sort known contacts|known contacts/i, 'Expected explicit known-contact comment or code');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node n8n-workflows/inbox-triage-daily.test.js`
Expected: FAIL with `Expected urgent tier constant`

- [ ] **Step 3: Write minimal implementation**

Add a rules classifier code node that marks obvious cases before the AI step.

```javascript
const RULES_CLASSIFIER_CODE = `
const KNOWN_CONTACT_MARKERS = [
  'amanda',
  'shin',
  'joshua',
  'amy',
  'shuo shimpa',
  'im8',
  'krave',
];

const URGENT_PATTERNS = [
  /legal/i,
  /contract/i,
  /overdue/i,
  /deadline today/i,
  /payment risk/i,
];

const AUTO_SORT_PATTERNS = [
  /newsletter/i,
  /receipt/i,
  /noreply@/i,
  /no-reply@/i,
];

const haystack = [
  $json.from_name,
  $json.from_email,
  $json.subject,
  $json.snippet,
  $json.body_preview
].join(' ');

const knownContact = KNOWN_CONTACT_MARKERS.some((marker) => haystack.toLowerCase().includes(marker));
const urgentMatch = URGENT_PATTERNS.some((pattern) => pattern.test(haystack));
const autoSortMatch = AUTO_SORT_PATTERNS.some((pattern) => pattern.test(haystack));

if (urgentMatch) {
  return { json: { ...$json, tier: 'EA/Urgent', context_label: '', reason: 'Matched urgent rules', ai_needed: false, draft_required: true } };
}

if (knownContact) {
  return { json: { ...$json, tier: 'EA/Needs-Reply', context_label: '', reason: 'Matched known-contact rules', ai_needed: false, draft_required: true } };
}

// Never auto-sort known contacts even if notification language is present.
if (autoSortMatch && !knownContact) {
  return { json: { ...$json, tier: 'EA/Auto-Sorted', context_label: 'Receipts', reason: 'Matched auto-sort rules', ai_needed: false, draft_required: false } };
}

return { json: { ...$json, tier: '', context_label: '', reason: 'Needs AI review', ai_needed: true, draft_required: false } };
`.trim();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node n8n-workflows/inbox-triage-daily.test.js`
Expected: PASS for the deterministic rule assertions added in this task

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/deploy-inbox-triage-daily.js n8n-workflows/inbox-triage-daily.test.js
git commit -m "feat: add inbox triage rules classifier"
```

---

### Task 5: Add OpenAI Classification and Noa-Style Draft Generation

**Files:**
- Modify: `n8n-workflows/deploy-inbox-triage-daily.js`
- Test: `n8n-workflows/inbox-triage-daily.test.js`

- [ ] **Step 1: Write the failing test for AI classification and draft prompts**

Add assertions for the AI node, allowed tiers, context starter labels, and Noa-style draft prompt.

```javascript
assert.match(deploySource, /'AI Classifier'/, 'Expected AI classifier node');
assert.match(deploySource, /'Draft Reply'/, 'Expected draft-generation node');
assert.match(deploySource, /Return JSON only/i, 'Expected structured AI response instructions');
assert.match(deploySource, /EA\/Urgent[\s\S]*EA\/Needs-Reply[\s\S]*EA\/FYI[\s\S]*EA\/Auto-Sorted[\s\S]*EA\/Unsure/, 'Expected allowed tier list in prompt');
assert.match(deploySource, /Krave|IM8|Halo-Home|Skyvane|Invoices|Contracts|Receipts|Suppliers/, 'Expected starter context labels');
assert.match(deploySource, /3-and-1 Framework/, 'Expected 3-and-1 drafting instruction');
assert.match(deploySource, /No filler|direct|outcome-oriented/i, 'Expected Noa voice guidance');
assert.match(deploySource, /Draft ready in Gmail/i, 'Expected summary wording for drafted messages');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node n8n-workflows/inbox-triage-daily.test.js`
Expected: FAIL with `Expected AI classifier node`

- [ ] **Step 3: Write minimal implementation**

Add one OpenAI node for classification and one for draft generation.

```javascript
const AI_CLASSIFIER_PROMPT = [
  'You are classifying one email for Noa Takhel.',
  'Return JSON only with keys: tier, context_label, reason, draft_required, summary_line.',
  'Allowed tiers: EA/Urgent, EA/Needs-Reply, EA/FYI, EA/Auto-Sorted, EA/Unsure.',
  'Allowed context labels: Krave, IM8, Halo-Home, Skyvane, Invoices, Contracts, Receipts, Suppliers, blank.',
  'Choose EA/Needs-Reply instead of EA/FYI if action is ambiguous.',
  'Never auto-sort known contacts.',
].join('\\n');

const DRAFT_PROMPT_PREFIX = [
  'Write a Gmail draft in Noa Takhel\\'s voice.',
  'Be direct and outcome-oriented.',
  'No filler.',
  'Use the 3-and-1 Framework if the email asks for a decision.',
  'Do not send. Draft only.',
].join('\\n');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node n8n-workflows/inbox-triage-daily.test.js`
Expected: PASS for the AI classifier and draft prompt assertions

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/deploy-inbox-triage-daily.js n8n-workflows/inbox-triage-daily.test.js
git commit -m "feat: add inbox triage AI classification and drafting"
```

---

### Task 6: Implement Gmail Drafting, Labeling, and Archive Behavior

**Files:**
- Modify: `n8n-workflows/deploy-inbox-triage-daily.js`
- Test: `n8n-workflows/inbox-triage-daily.test.js`

- [ ] **Step 1: Write the failing test for Gmail mutation behavior**

Add assertions for Gmail draft creation, tier/context labeling, and `EA/Unsure` retention.

```javascript
assert.match(deploySource, /'Create Gmail Draft'/, 'Expected Gmail draft node');
assert.match(deploySource, /'Apply Tier Label'/, 'Expected Gmail tier label node');
assert.match(deploySource, /'Apply Context Label'/, 'Expected Gmail context label node');
assert.match(deploySource, /'Archive Non-Unsure'/, 'Expected Gmail archive node');
assert.match(deploySource, /EA\/Unsure/, 'Expected unsure branch handling');
assert.match(deploySource, /removeLabelIds/i, 'Expected archive step to remove INBOX');
assert.match(deploySource, /INBOX/, 'Expected explicit inbox removal target');
assert.match(deploySource, /draft_required/, 'Expected draft gating field');
assert.match(deploySource, /if\s*\(\$json\.tier === 'EA\/Unsure'\)|EA\/Unsure[\s\S]*remain/i, 'Expected unsure retention logic');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node n8n-workflows/inbox-triage-daily.test.js`
Expected: FAIL with `Expected Gmail draft node`

- [ ] **Step 3: Write minimal implementation**

Add the Gmail nodes and a code-node payload builder for labels and archive behavior.

```javascript
const PREPARE_GMAIL_MUTATION_CODE = `
return {
  json: {
    ...$json,
    tier_label_name: $json.tier,
    context_label_name: $json.context_label || '',
    archive_after_triage: $json.tier !== 'EA/Unsure',
    draft_subject: 'Re: ' + ($json.subject || ''),
    summary_draft_note: $json.draft_required ? 'Draft ready in Gmail' : ''
  }
};
`.trim();

// EA/Unsure emails remain in inbox for manual review.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node n8n-workflows/inbox-triage-daily.test.js`
Expected: PASS for the Gmail mutation assertions added in this task

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/deploy-inbox-triage-daily.js n8n-workflows/inbox-triage-daily.test.js
git commit -m "feat: add inbox triage Gmail mutation flow"
```

---

### Task 7: Build Slack Summary and Failure Alerts

**Files:**
- Modify: `n8n-workflows/deploy-inbox-triage-daily.js`
- Test: `n8n-workflows/inbox-triage-daily.test.js`

- [ ] **Step 1: Write the failing test for summary sections and retry behavior**

Add assertions for the final summary shape, both destinations, and failure alert handling.

```javascript
assert.match(deploySource, /Morning Triage/i, 'Expected morning-triage summary header');
assert.match(deploySource, /\[URGENT\]|Needs Your Reply|Review These|Auto-Sorted/i, 'Expected summary sections');
assert.match(deploySource, /Inbox: /, 'Expected final inbox count line');
assert.match(deploySource, /'Did Channel Send Fail\?'/, 'Expected channel send retry decision');
assert.match(deploySource, /'Did Noa DM Fail\?'/, 'Expected DM retry decision');
assert.match(deploySource, /'Post Failure Alert'/, 'Expected failure alert node');
assert.match(deploySource, /C0AQZGJDR38/, 'Expected failure alerts to route to #airwallexdrafts');
assert.match(deploySource, /U06TBGX9L93/, 'Expected Noa DM destination');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node n8n-workflows/inbox-triage-daily.test.js`
Expected: FAIL with `Expected morning-triage summary header`

- [ ] **Step 3: Write minimal implementation**

Add the summary-building code and Slack retry/failure nodes.

```javascript
const BUILD_SUMMARY_CODE = `
const rows = $input.all().map((item) => item.json);

function linesFor(tier) {
  return rows
    .filter((row) => row.tier === tier)
    .map((row) => '- ' + row.from_name + ' | ' + row.subject + ' - ' + row.summary_line + (row.summary_draft_note ? ' -> ' + row.summary_draft_note : ''));
}

const urgent = linesFor('EA/Urgent');
const reply = linesFor('EA/Needs-Reply');
const fyi = linesFor('EA/FYI');
const unsure = linesFor('EA/Unsure');
const autoSortedCount = rows.filter((row) => row.tier === 'EA/Auto-Sorted').length;

const sections = ['*Morning Triage - ' + new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric' }) + ' (ICT)*'];
if (urgent.length) sections.push('\\n*[URGENT] - Action today (' + urgent.length + ')*\\n' + urgent.join('\\n'));
if (reply.length) sections.push('\\n*Needs Your Reply (' + reply.length + ')*\\n' + reply.join('\\n'));
if (fyi.length) sections.push('\\n*FYI (' + fyi.length + ')*\\n' + fyi.join('\\n'));
if (unsure.length) sections.push('\\n*Review These (' + unsure.length + ')*\\n' + unsure.join('\\n'));
sections.push('\\n*Auto-Sorted (' + autoSortedCount + ')* - newsletters, receipts, notifications');
sections.push('\\nInbox: ' + unsure.length);

return [{ json: { summary_text: sections.join('\\n') } }];
`.trim();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node n8n-workflows/inbox-triage-daily.test.js`
Expected: PASS for the summary and retry assertions added in this task

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/deploy-inbox-triage-daily.js n8n-workflows/inbox-triage-daily.test.js
git commit -m "feat: add inbox triage Slack summary delivery"
```

---

### Task 8: Extend Connection Integrity Coverage

**Files:**
- Modify: `n8n-workflows/connection-integrity.test.js`
- Test: `n8n-workflows/connection-integrity.test.js`

- [ ] **Step 1: Write the failing test for the new deploy script**

Add the new workflow file to the shared list.

```javascript
const workflowFiles = [
  path.join(__dirname, 'deploy-invoice-reminder-cron.js'),
  path.join(__dirname, 'deploy-invoice-request-intake.js'),
  path.join(__dirname, 'deploy-slack-invoice-handler.js'),
  path.join(__dirname, 'deploy-inbox-triage-daily.js'),
];
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node n8n-workflows/connection-integrity.test.js`
Expected: FAIL if the new deploy script is missing a referenced node or the file does not exist yet

- [ ] **Step 3: Write minimal implementation**

Ensure every connection key in `deploy-inbox-triage-daily.js` maps to a declared node name.

```javascript
connections: {
  'Schedule 9am ICT Weekdays': { main: [[{ node: 'Build Gmail Query', type: 'main', index: 0 }]] },
  'Webhook Trigger': { main: [[{ node: 'Build Gmail Query', type: 'main', index: 0 }]] },
  'Build Gmail Query': { main: [[{ node: 'Search Inbox', type: 'main', index: 0 }]] },
  'Search Inbox': { main: [[{ node: 'Fetch Message Details', type: 'main', index: 0 }]] }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node n8n-workflows/connection-integrity.test.js`
Expected: PASS with `Workflow connection integrity check passed.`

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/connection-integrity.test.js n8n-workflows/deploy-inbox-triage-daily.js
git commit -m "test: cover inbox triage daily workflow connections"
```

---

### Task 9: Document the Workflow in Repo Handover Docs

**Files:**
- Modify: `n8n-workflows/README.md`
- Modify: `n8n-workflows/WORKFLOWS.md`
- Test: `n8n-workflows/inbox-triage-daily.test.js`

- [ ] **Step 1: Write the failing test for documentation coverage**

Add assertions that both docs describe the workflow purpose and key behaviors.

```javascript
assert.match(readmeDoc, /Inbox Triage Daily/, 'Expected workflow listed in README');
assert.match(readmeDoc, /Gmail drafts/i, 'Expected README to document draft-only email behavior');
assert.match(readmeDoc, /EA\/Unsure/i, 'Expected README to document inbox retention for unsure emails');
assert.match(readmeDoc, /#airwallexdrafts/i, 'Expected README to document archive channel summary');
assert.match(readmeDoc, /Noa/i, 'Expected README to document Noa DM delivery');

assert.match(workflowsDoc, /Inbox Triage Daily/, 'Expected workflow listed in WORKFLOWS.md');
assert.match(workflowsDoc, /krave-inbox-triage-daily/, 'Expected manual webhook documented');
assert.match(workflowsDoc, /EA\/Urgent[\s\S]*EA\/Needs-Reply[\s\S]*EA\/FYI[\s\S]*EA\/Auto-Sorted[\s\S]*EA\/Unsure/, 'Expected tier model documented');
assert.match(workflowsDoc, /Krave|IM8|Halo-Home|Skyvane|Invoices|Contracts|Receipts|Suppliers/, 'Expected starter context labels documented');
assert.match(workflowsDoc, /draft only|never send/i, 'Expected non-sending behavior documented');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node n8n-workflows/inbox-triage-daily.test.js`
Expected: FAIL with `Expected workflow listed in README`

- [ ] **Step 3: Write minimal implementation**

Add the new workflow to both docs using the same style as the existing entries.

```markdown
| Inbox Triage Daily | Planned | 9am ICT weekdays + manual webhook | [deploy-inbox-triage-daily.js](deploy-inbox-triage-daily.js) |
```

```markdown
## Inbox Triage Daily

Reads new inbox email from `noa@kravemedia.co`, classifies each message into the `EA/*` tier model, creates Gmail drafts for `EA/Urgent` and `EA/Needs-Reply`, applies Gmail labels, leaves `EA/Unsure` in the inbox, and posts the final summary to both `#airwallexdrafts` and Noa's Slack DM.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node n8n-workflows/inbox-triage-daily.test.js`
Expected: PASS for the documentation assertions

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/README.md n8n-workflows/WORKFLOWS.md n8n-workflows/inbox-triage-daily.test.js
git commit -m "docs: add inbox triage daily workflow docs"
```

---

### Task 10: Run Final Verification for the Workflow Slice

**Files:**
- Modify: `n8n-workflows/deploy-inbox-triage-daily.js`
- Test: `n8n-workflows/inbox-triage-daily.test.js`
- Test: `n8n-workflows/connection-integrity.test.js`
- Test: `n8n-workflows/eod-triage-workflow.test.js`
- Test: `n8n-workflows/slack-invoice-handler.test.js`

- [ ] **Step 1: Add one short clarifying comment above the non-obvious risk logic**

Keep comments minimal, but add one above the known-contact auto-sort guard and one above the `EA/Unsure` inbox-retention branch.

```javascript
// Never auto-sort a known contact even if the message looks like an automated notification.
// EA/Unsure stays in inbox so human review can happen after triage.
```

- [ ] **Step 2: Run the new workflow contract test**

Run: `node n8n-workflows/inbox-triage-daily.test.js`
Expected: PASS with `Inbox triage daily workflow contract check passed.`

- [ ] **Step 3: Run the shared integrity test**

Run: `node n8n-workflows/connection-integrity.test.js`
Expected: PASS with `Workflow connection integrity check passed.`

- [ ] **Step 4: Run regression checks on adjacent workflows**

Run: `node n8n-workflows/eod-triage-workflow.test.js`
Expected: PASS with `EOD triage workflow contract check passed.`

Run: `node n8n-workflows/slack-invoice-handler.test.js`
Expected: PASS with `Slack invoice handler workflow contract check passed.`

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/deploy-inbox-triage-daily.js n8n-workflows/inbox-triage-daily.test.js n8n-workflows/connection-integrity.test.js n8n-workflows/README.md n8n-workflows/WORKFLOWS.md
git commit -m "feat: finalize inbox triage daily workflow"
```

---

## Self-Review Notes

### Spec coverage

- weekday schedule and manual webhook: covered by Tasks 1 and 2
- Gmail search and normalization: covered by Task 3
- deterministic rules plus AI classification: covered by Tasks 4 and 5
- Noa-style draft generation: covered by Task 5
- Gmail labels and `EA/Unsure` inbox retention: covered by Task 6
- Slack summary to both `#airwallexdrafts` and Noa DM: covered by Task 7
- failure alerts and retry logic: covered by Task 7
- docs and shared integrity coverage: covered by Tasks 8 and 9

### Placeholder scan

No `TBD`, `TODO`, or “implement later” placeholders remain in the plan. The plan uses real file paths, concrete test snippets, specific workflow names, and exact commands.

### Type consistency

- normalized fields remain consistent across tasks: `message_id`, `thread_id`, `from_name`, `from_email`, `subject`, `snippet`, `body_preview`, `received_at`
- classification fields remain consistent across tasks: `tier`, `context_label`, `reason`, `draft_required`, `summary_line`
- summary wording remains consistent across tasks: `Draft ready in Gmail`, `EA/Unsure`, `Inbox:`
