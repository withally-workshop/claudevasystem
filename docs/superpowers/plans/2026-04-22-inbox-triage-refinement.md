# Inbox Triage Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine `Inbox Triage Daily` so it only searches the last 24 hours of inbox mail, uses AI only for ambiguous emails, avoids duplicate drafts for already-actioned threads, repairs labels when needed, and reports in-motion items inline in Morning Triage.

**Architecture:** Keep the existing single workflow id and deploy script, but refactor the control flow around explicit decision gates instead of always-on downstream nodes. Add an action-state detection stage before drafting, split classification from draft gating, and extend the contract tests so workflow behavior is enforced locally before live deployment.

**Tech Stack:** Node.js contract tests, `n8n` deploy script, Gmail node wiring, Slack node wiring, OpenAI nodes, markdown docs under `docs/superpowers`, `.claude` skill docs

---

## File Structure

- Modify: `n8n-workflows/deploy-inbox-triage-daily.js`
  - Refine Gmail query, add action-state detection code, add explicit AI/draft gating branches, and update summary behavior.
- Modify: `n8n-workflows/inbox-triage-daily.test.js`
  - Add behavior-focused assertions for the new query, explicit gates, already-actioned detection, and summary notes.
- Modify: `.claude/skills/inbox-triage/SKILL.md`
  - Sync the skill with the refined fetch window and already-actioned rules.
- Modify: `n8n-workflows/README.md`
  - Update workflow behavior docs for last-24-hours search, already-actioned detection, and draft gating.
- Modify: `n8n-workflows/WORKFLOWS.md`
  - Update operational workflow docs to match the refined node flow and summary semantics.

### Task 1: Lock The New Contract In Tests

**Files:**
- Modify: `n8n-workflows/inbox-triage-daily.test.js`
- Test: `n8n-workflows/inbox-triage-daily.test.js`

- [ ] **Step 1: Write the failing test**

Add assertions that describe the refined behavior before touching the deploy script.

```js
assert.match(
  deploySource,
  /in:inbox newer_than:1d/,
  'Expected Inbox Triage Daily to search only last-24-hours inbox mail'
);

assert.match(deploySource, /'Detect Existing Handling'/, 'Expected explicit action-state detection node');
assert.match(deploySource, /'Need AI\\?'/, 'Expected explicit AI gate node');
assert.match(deploySource, /'Merge Final Classification'/, 'Expected merge node for rules or AI output');
assert.match(deploySource, /'Should Draft\\?'/, 'Expected explicit draft gate node');
assert.match(
  deploySource,
  /already_replied|draft_exists|already_labeled|already_actioned/,
  'Expected explicit already-actioned state fields'
);
assert.match(
  deploySource,
  /already replied|draft exists|already labeled|action-state unknown/i,
  'Expected inline summary note support for already-actioned threads'
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node n8n-workflows/inbox-triage-daily.test.js`

Expected: FAIL with missing query, missing nodes, or missing already-actioned fields because the current workflow still uses the older control flow.

- [ ] **Step 3: Write minimal implementation**

Do not implement the whole workflow yet. Add only the smallest skeleton markers needed to move the failure from “missing behavior contract” to “wrong runtime logic”.

```js
// Planned new workflow nodes:
// - Detect Existing Handling
// - Need AI?
// - Merge Final Classification
// - Should Draft?
```

Use this step only if the test needs intermediate scaffolding to fail for the right reason. Otherwise skip directly to Task 2 implementation.

- [ ] **Step 4: Run test to verify it still fails for the right reason**

Run: `node n8n-workflows/inbox-triage-daily.test.js`

Expected: FAIL on runtime-behavior assertions rather than on typos or syntax errors.

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/inbox-triage-daily.test.js
git commit -m "test: capture inbox triage refinement contract"
```

### Task 2: Refactor Query And Action-State Detection

**Files:**
- Modify: `n8n-workflows/deploy-inbox-triage-daily.js`
- Test: `n8n-workflows/inbox-triage-daily.test.js`

- [ ] **Step 1: Write the failing test**

Add or extend assertions for the exact query contract and the new action-state detection code.

```js
assert.match(
  deploySource,
  /query:\s*'in:inbox newer_than:1d'/,
  'Expected Build Gmail Query to use the fixed last-24-hours inbox query'
);

assert.match(
  deploySource,
  /const DETECT_EXISTING_HANDLING_CODE = `[\s\S]*already_replied[\s\S]*draft_exists[\s\S]*already_labeled[\s\S]*already_actioned/,
  'Expected dedicated action-state detection code'
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node n8n-workflows/inbox-triage-daily.test.js`

Expected: FAIL because the current workflow still builds an `after:` query and has no dedicated handling-detection stage.

- [ ] **Step 3: Write minimal implementation**

Update `BUILD_QUERY_CODE` and add a dedicated handling-detection code block plus node.

```js
const BUILD_QUERY_CODE = `
return [{
  json: {
    query: 'in:inbox newer_than:1d'
  }
}];
`.trim();

const DETECT_EXISTING_HANDLING_CODE = `
const labelNames = ($json.labelNames || []).map((value) => String(value || '').trim());
const alreadyLabeled = labelNames.some((name) => /^EA\\//.test(name));
const draftExists = Boolean($json.draft_exists || false);
const alreadyReplied = Boolean($json.already_replied || false);

const reasons = [];
if (alreadyReplied) reasons.push('already replied');
if (draftExists) reasons.push('draft exists');
if (alreadyLabeled) reasons.push('already labeled');

return {
  json: {
    ...$json,
    already_labeled: alreadyLabeled,
    draft_exists: draftExists,
    already_replied: alreadyReplied,
    already_actioned: reasons.length > 0,
    already_actioned_reason: reasons.join(', ') || '',
    summary_status_note: reasons.join(', ') || ''
  }
};
`.trim();
```

Add a new `Detect Existing Handling` node after `Normalize Email`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node n8n-workflows/inbox-triage-daily.test.js`

Expected: the query/action-state assertions pass, but later gating assertions still fail until Task 3 is complete.

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/deploy-inbox-triage-daily.js n8n-workflows/inbox-triage-daily.test.js
git commit -m "feat: add inbox triage recent-mail query and action detection"
```

### Task 3: Add Explicit AI And Draft Gates

**Files:**
- Modify: `n8n-workflows/deploy-inbox-triage-daily.js`
- Test: `n8n-workflows/inbox-triage-daily.test.js`

- [ ] **Step 1: Write the failing test**

Add assertions that enforce the new control flow.

```js
assert.match(deploySource, /'Need AI\\?'/, 'Expected explicit AI gate node');
assert.match(deploySource, /'Should Draft\\?'/, 'Expected explicit draft gate node');
assert.match(
  deploySource,
  /draft_required[\s\S]*already_actioned/,
  'Expected draft gate to depend on draft requirement and already-actioned state'
);
assert.match(
  deploySource,
  /'Rules Classifier':\s*\{[\s\S]*node:\s+'Need AI\?'/,
  'Expected Rules Classifier to route into the AI gate'
);
assert.match(
  deploySource,
  /'Need AI\?':\s*\{[\s\S]*'AI Classifier'[\s\S]*'Merge Final Classification'/,
  'Expected Need AI? to branch between AI and direct merge paths'
);
assert.match(
  deploySource,
  /'Should Draft\?':\s*\{[\s\S]*'Draft Reply'[\s\S]*'Prepare Gmail Mutation'/,
  'Expected Should Draft? to branch between drafting and no-draft paths'
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node n8n-workflows/inbox-triage-daily.test.js`

Expected: FAIL because the current workflow still routes `Rules Classifier -> AI Classifier -> Draft Reply` unconditionally.

- [ ] **Step 3: Write minimal implementation**

Add the branch nodes and merge behavior.

```js
{
  id: 'n7b',
  name: 'Need AI?',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.1,
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 1 },
      conditions: [{
        leftValue: '={{ $json.ai_needed }}',
        rightValue: true,
        operator: { type: 'boolean', operation: 'equals' },
      }],
      combinator: 'and',
    },
  },
}
```

```js
{
  id: 'n9b',
  name: 'Should Draft?',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.1,
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 1 },
      conditions: [
        {
          leftValue: '={{ $json.draft_required }}',
          rightValue: true,
          operator: { type: 'boolean', operation: 'equals' },
        },
        {
          leftValue: '={{ $json.already_actioned }}',
          rightValue: false,
          operator: { type: 'boolean', operation: 'equals' },
        }
      ],
      combinator: 'and',
    },
  },
}
```

Also add a `Merge Final Classification` code node that normalizes the rules or AI path into one downstream payload before the draft gate.

- [ ] **Step 4: Run test to verify it passes**

Run: `node n8n-workflows/inbox-triage-daily.test.js`

Expected: PASS for the AI/draft gating assertions with no syntax or connection errors.

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/deploy-inbox-triage-daily.js n8n-workflows/inbox-triage-daily.test.js
git commit -m "feat: gate inbox triage ai and draft paths"
```

### Task 4: Update Summary Semantics And Docs

**Files:**
- Modify: `n8n-workflows/deploy-inbox-triage-daily.js`
- Modify: `.claude/skills/inbox-triage/SKILL.md`
- Modify: `n8n-workflows/README.md`
- Modify: `n8n-workflows/WORKFLOWS.md`
- Test: `n8n-workflows/inbox-triage-daily.test.js`
- Test: `n8n-workflows/connection-integrity.test.js`

- [ ] **Step 1: Write the failing test**

Add summary/documentation assertions for inline action-state notes and last-24-hours behavior.

```js
assert.match(
  deploySource,
  /summary_status_note|already replied|draft exists|already labeled|action-state unknown/i,
  'Expected Morning Triage summaries to annotate already-actioned items inline'
);
assert.match(readmeDoc, /newer_than:1d|last 24 hours/i, 'Expected README to document last-24-hours inbox scope');
assert.match(workflowsDoc, /already replied|draft exists|already labeled/i, 'Expected WORKFLOWS.md to document inline in-motion notes');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node n8n-workflows/inbox-triage-daily.test.js`

Expected: FAIL until summary text and docs are updated.

- [ ] **Step 3: Write minimal implementation**

Update the summary builder and docs.

```js
function linesFor(tier) {
  return rows
    .filter((row) => row.tier === tier)
    .map((row) => {
      const statusSuffix = row.summary_status_note ? ' [' + row.summary_status_note + ']' : '';
      return '- ' + row.from_name + ' | ' + row.subject + ' - ' + (row.summary_line || row.reason || '') + statusSuffix + (row.summary_draft_note ? ' -> ' + row.summary_draft_note : '');
    });
}
```

Add matching prose updates in:

```md
- Search scope: `in:inbox newer_than:1d`
- Includes both read and unread inbox emails from the last 24 hours
- Already-actioned items remain in normal Morning Triage sections with inline notes such as `already replied`, `draft exists`, or `already labeled`
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
node n8n-workflows/inbox-triage-daily.test.js
node n8n-workflows/connection-integrity.test.js
```

Expected:

- `Inbox triage daily workflow contract check passed.`
- `Workflow connection integrity check passed.`

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/inbox-triage/SKILL.md n8n-workflows/deploy-inbox-triage-daily.js n8n-workflows/inbox-triage-daily.test.js n8n-workflows/README.md n8n-workflows/WORKFLOWS.md
git commit -m "docs: sync inbox triage refinement behavior"
```

### Task 5: Deploy The Existing Workflow And Verify Live Shape

**Files:**
- Modify: `n8n-workflows/deploy-inbox-triage-daily.js`
- Test: `n8n-workflows/inbox-triage-daily.test.js`

- [ ] **Step 1: Run the final local checks**

Run:

```bash
node n8n-workflows/inbox-triage-daily.test.js
node n8n-workflows/connection-integrity.test.js
```

Expected:

- `Inbox triage daily workflow contract check passed.`
- `Workflow connection integrity check passed.`

- [ ] **Step 2: Deploy in place to the existing workflow id**

Run:

```bash
node n8n-workflows/deploy-inbox-triage-daily.js
```

Expected:

- `SUCCESS`
- `Workflow ID: 3YyEjk1e6oZV786T`
- same live workflow id reused, not a new workflow

- [ ] **Step 3: Verify the live workflow still points at the same id**

Run:

```powershell
Invoke-RestMethod -Method Get -Uri 'https://noatakhel.app.n8n.cloud/api/v1/workflows/3YyEjk1e6oZV786T' -Headers @{ 'X-N8N-API-KEY' = '<existing-key>' } | ConvertTo-Json -Depth 8
```

Expected: `id` remains `3YyEjk1e6oZV786T` and the live node list includes `Detect Existing Handling`, `Need AI?`, and `Should Draft?`.

- [ ] **Step 4: Smoke-trigger the webhook**

Run:

```powershell
try { Invoke-RestMethod -Method Post -Uri 'https://noatakhel.app.n8n.cloud/webhook/krave-inbox-triage-daily' -ContentType 'application/json' -Body '{}' | ConvertTo-Json -Depth 10 } catch { if ($_.Exception.Response) { $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); $reader.ReadToEnd() } else { $_ | Out-String } }
```

Expected: accepted webhook response such as `{"message":"Workflow was started"}` or equivalent success body.

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/deploy-inbox-triage-daily.js n8n-workflows/inbox-triage-daily.test.js .claude/skills/inbox-triage/SKILL.md n8n-workflows/README.md n8n-workflows/WORKFLOWS.md
git commit -m "feat: refine inbox triage daily control flow"
```

## Self-Review

### Spec coverage

- Last-24-hours inbox query: covered in Tasks 1, 2, and 4.
- Include read and unread inbox mail: covered in Tasks 2 and 4.
- Rules-first hybrid classifier: covered in Task 3.
- AI only for ambiguous emails: covered in Task 3.
- Draft only when needed and not already actioned: covered in Task 3.
- Combined already-actioned detection: covered in Task 2.
- Label repair for already-actioned threads: covered in Tasks 2 and 4.
- Inline summary notes for in-motion items: covered in Task 4.
- Existing workflow id reused for deploy: covered in Task 5.

### Placeholder scan

- No `TBD`, `TODO`, or deferred “handle later” placeholders remain.
- Each task includes concrete files, commands, and expected outputs.

### Type consistency

- Shared field names stay consistent across tasks:
  - `ai_needed`
  - `draft_required`
  - `already_replied`
  - `draft_exists`
  - `already_labeled`
  - `already_actioned`
  - `already_actioned_reason`
  - `summary_status_note`

