# Invoice Request Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an n8n workflow that accepts structured Slack invoice requests, attempts full Airwallex draft invoice creation automatically, and falls back to a manual-ready tracker record plus John DM alert when any Airwallex step fails.

**Architecture:** Add a new deploy script that defines one end-to-end n8n workflow with Slack intake, request normalization, Airwallex orchestration, tracker persistence, and Slack notifications. Keep the implementation aligned with the existing `n8n-workflows/*.js` deploy-script pattern, back it with focused contract tests, and document the workflow in the repo handover docs.

**Tech Stack:** Node.js, n8n Cloud workflow JSON via deploy scripts, Slack nodes/webhooks, HTTP Request nodes, Google Sheets node, built-in n8n Code nodes, `node:assert/strict`

---

## File Structure

### Files to create

- `n8n-workflows/deploy-invoice-request-intake.js`
  Purpose: Source-of-truth deploy script for the new workflow definition.
- `n8n-workflows/invoice-request-intake.test.js`
  Purpose: Contract test for workflow name, webhook path, Slack/Airwallex/tracker nodes, and key strings/constants.
- `docs/superpowers/plans/2026-04-21-invoice-request-intake.md`
  Purpose: This implementation plan.

### Files to modify

- `n8n-workflows/README.md`
  Purpose: Add the new workflow to the summary table and add a section with trigger, purpose, deploy command, and credential requirements.
- `n8n-workflows/WORKFLOWS.md`
  Purpose: Add the new workflow to the workflow index, shared infrastructure references if needed, node flow, outputs, error handling, and runbook.
- `n8n-workflows/connection-integrity.test.js`
  Purpose: Extend the connection-integrity guard so the new deploy script’s connection keys must map to declared nodes.

### Tracker dependencies to verify during implementation

- Existing sheet: `Invoices` tab in the Client Invoice Tracker
- Columns that likely need to exist or be added before live rollout:
  - `Request ID`
  - `Source`
  - `Creation Status`
  - `Failure Stage`
  - `Failure Reason`
  - `Line Items Payload`
  - `Airwallex Customer ID`
  - `Airwallex Invoice ID`

If the tracker cannot safely absorb these fields in the existing tab, implementation should switch to a dedicated intake tab and document that decision before deployment.

---

### Task 1: Add the Failing Contract Test for the New Workflow

**Files:**
- Create: `n8n-workflows/invoice-request-intake.test.js`
- Test: `n8n-workflows/invoice-request-intake.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const deployPath = path.join(__dirname, 'deploy-invoice-request-intake.js');
const workflowsDocPath = path.join(__dirname, 'WORKFLOWS.md');
const readmePath = path.join(__dirname, 'README.md');

assert.ok(fs.existsSync(deployPath), 'Expected deploy-invoice-request-intake.js to exist');

const deploySource = fs.readFileSync(deployPath, 'utf8');
const workflowsDoc = fs.readFileSync(workflowsDocPath, 'utf8');
const readmeDoc = fs.readFileSync(readmePath, 'utf8');

assert.match(deploySource, /name:\s+'Krave .* Invoice Request Intake'/, 'Expected workflow name in deploy script');
assert.match(deploySource, /path:\s+'krave-invoice-request-intake'/, 'Expected manual webhook path');
assert.match(deploySource, /slack/i, 'Expected Slack integration in deploy script');
assert.match(deploySource, /api\.airwallex\.com/, 'Expected Airwallex API usage in deploy script');
assert.match(deploySource, /googleSheets/i, 'Expected Google Sheets usage in deploy script');
assert.match(deploySource, /fallback_manual_required/, 'Expected fallback status handling');
assert.match(deploySource, /draft invoice created/i, 'Expected draft-only success handling');

assert.match(workflowsDoc, /Invoice Request Intake/, 'Expected Invoice Request Intake in WORKFLOWS.md');
assert.match(workflowsDoc, /krave-invoice-request-intake/, 'Expected manual webhook documented');
assert.match(readmeDoc, /Invoice Request Intake/, 'Expected workflow listed in README');

console.log('Invoice request intake workflow contract check passed.');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node n8n-workflows/invoice-request-intake.test.js`
Expected: FAIL with `Expected deploy-invoice-request-intake.js to exist`

- [ ] **Step 3: Write minimal implementation**

Create the deploy script stub so the first failure advances from “missing file” to “missing contract details”.

```javascript
const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = 'replace-me';

const workflow = {
  name: 'Krave - Invoice Request Intake',
  nodes: [],
  connections: {},
};

module.exports = { workflow };
```

- [ ] **Step 4: Run test to verify it still fails for the right reason**

Run: `node n8n-workflows/invoice-request-intake.test.js`
Expected: FAIL with a regex assertion such as `Expected manual webhook path`

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/invoice-request-intake.test.js n8n-workflows/deploy-invoice-request-intake.js
git commit -m "test: add invoice request intake workflow contract"
```

---

### Task 2: Implement the Workflow Skeleton and Wiring

**Files:**
- Modify: `n8n-workflows/deploy-invoice-request-intake.js`
- Test: `n8n-workflows/invoice-request-intake.test.js`

- [ ] **Step 1: Write the failing test for workflow wiring details**

Add assertions that the deploy script contains the expected top-level nodes and webhook wiring.

```javascript
assert.match(deploySource, /'Webhook Trigger'/, 'Expected manual webhook node');
assert.match(deploySource, /'Normalize Slack Submission'/, 'Expected normalization code node');
assert.match(deploySource, /'Airwallex Auth'/, 'Expected Airwallex auth node');
assert.match(deploySource, /'Write Tracker Success'/, 'Expected tracker success node');
assert.match(deploySource, /'Write Tracker Fallback'/, 'Expected tracker fallback node');
assert.match(deploySource, /'DM John Failure Alert'/, 'Expected John DM fallback alert node');
assert.match(deploySource, /'Requester Success Confirmation'/, 'Expected requester success confirmation node');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node n8n-workflows/invoice-request-intake.test.js`
Expected: FAIL with `Expected normalization code node`

- [ ] **Step 3: Write minimal implementation**

Expand the deploy script into the same pattern used by the existing workflow deploy files.

```javascript
const workflow = {
  name: 'Krave - Invoice Request Intake',
  settings: { executionOrder: 'v1', saveManualExecutions: true },
  nodes: [
    {
      id: 'n1',
      name: 'Webhook Trigger',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [240, 300],
      webhookId: 'krave-invoice-request-intake',
      parameters: {
        httpMethod: 'POST',
        path: 'krave-invoice-request-intake',
        responseMode: 'onReceived',
        options: {}
      }
    },
    {
      id: 'n2',
      name: 'Normalize Slack Submission',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [480, 300],
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: 'return [{ json: { status: "intake_received" } }];'
      }
    },
    {
      id: 'n3',
      name: 'Airwallex Auth',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [700, 300],
      parameters: { method: 'POST', url: 'https://api.airwallex.com/api/v1/authentication/login' }
    },
    {
      id: 'n4',
      name: 'Write Tracker Success',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [920, 220],
      parameters: {}
    },
    {
      id: 'n5',
      name: 'Write Tracker Fallback',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [920, 420],
      parameters: {}
    },
    {
      id: 'n6',
      name: 'Requester Success Confirmation',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [1140, 220],
      parameters: {}
    },
    {
      id: 'n7',
      name: 'DM John Failure Alert',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [1140, 420],
      parameters: {}
    }
  ],
  connections: {
    'Webhook Trigger': { main: [[{ node: 'Normalize Slack Submission', type: 'main', index: 0 }]] }
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node n8n-workflows/invoice-request-intake.test.js`
Expected: PASS for the new node-name assertions added in this task

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/deploy-invoice-request-intake.js n8n-workflows/invoice-request-intake.test.js
git commit -m "feat: scaffold invoice request intake workflow"
```

---

### Task 3: Implement Slack Submission Normalization and Validation

**Files:**
- Modify: `n8n-workflows/deploy-invoice-request-intake.js`
- Test: `n8n-workflows/invoice-request-intake.test.js`

- [ ] **Step 1: Write the failing test for canonical request fields**

Add assertions for the normalization code’s required fields and statuses.

```javascript
assert.match(deploySource, /request_id/, 'Expected request_id in normalization code');
assert.match(deploySource, /submitted_by_slack_user_id/, 'Expected Slack submitter field');
assert.match(deploySource, /line_items/, 'Expected line_items payload');
assert.match(deploySource, /failed_validation/, 'Expected validation failure status');
assert.match(deploySource, /intake_received/, 'Expected intake_received status');
assert.match(deploySource, /subtotal/, 'Expected subtotal calculation');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node n8n-workflows/invoice-request-intake.test.js`
Expected: FAIL with `Expected request_id in normalization code`

- [ ] **Step 3: Write minimal implementation**

Replace the placeholder normalization code with a real canonical object builder.

```javascript
const NORMALIZE_CODE = `
const payload = $json.body || $json;
const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
const requestId = 'invreq_' + Date.now();
const subtotal = lineItems.reduce((sum, item) => {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unit_price || 0);
  return sum + (quantity * unitPrice);
}, 0);

const missing = [];
if (!payload.client_name) missing.push('client_name');
if (!payload.currency) missing.push('currency');
if (!payload.due_date) missing.push('due_date');
if (!lineItems.length) missing.push('line_items');

if (missing.length) {
  return [{
    json: {
      request_id: requestId,
      submitted_at: new Date().toISOString(),
      submitted_by_slack_user_id: payload.submitted_by_slack_user_id || '',
      client_name: payload.client_name || '',
      client_email: payload.client_email || '',
      currency: payload.currency || '',
      due_date: payload.due_date || '',
      memo: payload.memo || '',
      line_items: lineItems,
      subtotal,
      status: 'failed_validation',
      failure_stage: 'validation',
      failure_reason: 'Missing required fields: ' + missing.join(', ')
    }
  }];
}

return [{
  json: {
    request_id: requestId,
    submitted_at: new Date().toISOString(),
    submitted_by_slack_user_id: payload.submitted_by_slack_user_id || '',
    client_name: payload.client_name,
    client_email: payload.client_email || '',
    currency: payload.currency,
    due_date: payload.due_date,
    memo: payload.memo || '',
    line_items: lineItems,
    subtotal,
    status: 'intake_received'
  }
}];
`.trim();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node n8n-workflows/invoice-request-intake.test.js`
Expected: PASS for the canonical field assertions added in this task

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/deploy-invoice-request-intake.js n8n-workflows/invoice-request-intake.test.js
git commit -m "feat: normalize and validate Slack invoice intake"
```

---

### Task 4: Implement Airwallex Auth and Customer Resolution

**Files:**
- Modify: `n8n-workflows/deploy-invoice-request-intake.js`
- Test: `n8n-workflows/invoice-request-intake.test.js`

- [ ] **Step 1: Write the failing test for auth and name-based customer resolution**

Add assertions for the auth endpoint, customer lookup behavior, and ambiguous-match fallback handling.

```javascript
assert.match(deploySource, /authentication\/login/, 'Expected Airwallex auth login endpoint');
assert.match(deploySource, /Find Billing Customer/, 'Expected customer lookup node');
assert.match(deploySource, /Create Billing Customer/, 'Expected customer create node');
assert.match(deploySource, /company name|client name/i, 'Expected name-based lookup comments or code');
assert.match(deploySource, /ambiguous customer match/i, 'Expected ambiguous customer fallback handling');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node n8n-workflows/invoice-request-intake.test.js`
Expected: FAIL with `Expected customer lookup node`

- [ ] **Step 3: Write minimal implementation**

Add auth and customer resolution nodes plus branching comments/constants that preserve the intended behavior.

```javascript
const CUSTOMER_RESOLUTION_CODE = `
const request = $json;
const candidates = Array.isArray($json.customer_candidates) ? $json.customer_candidates : [];

if (candidates.length > 1) {
  return [{
    json: {
      ...request,
      status: 'fallback_manual_required',
      failure_stage: 'customer_resolution',
      failure_reason: 'ambiguous customer match'
    }
  }];
}

if (candidates.length === 1) {
  return [{
    json: {
      ...request,
      airwallex_customer_id: candidates[0].id,
      status: 'airwallex_in_progress'
    }
  }];
}

return [{
  json: {
    ...request,
    create_customer: true,
    status: 'airwallex_in_progress'
  }
}];
`.trim();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node n8n-workflows/invoice-request-intake.test.js`
Expected: PASS for auth and customer-resolution assertions

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/deploy-invoice-request-intake.js n8n-workflows/invoice-request-intake.test.js
git commit -m "feat: add Airwallex auth and customer resolution"
```

---

### Task 5: Implement Product, Price, and Draft Invoice Creation

**Files:**
- Modify: `n8n-workflows/deploy-invoice-request-intake.js`
- Test: `n8n-workflows/invoice-request-intake.test.js`

- [ ] **Step 1: Write the failing test for dynamic Billing object creation**

Add assertions for per-line-item product/price creation and draft invoice flow.

```javascript
assert.match(deploySource, /Create Products/, 'Expected product creation node');
assert.match(deploySource, /Create Prices/, 'Expected price creation node');
assert.match(deploySource, /Create Draft Invoice/, 'Expected draft invoice node');
assert.match(deploySource, /Attach Invoice Line Items/, 'Expected line item attachment node');
assert.match(deploySource, /Products are request-specific|request-specific/i, 'Expected dynamic product handling');
assert.doesNotMatch(deploySource, /finalize the invoice/i, 'Should not auto-finalize in v1');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node n8n-workflows/invoice-request-intake.test.js`
Expected: FAIL with `Expected product creation node`

- [ ] **Step 3: Write minimal implementation**

Add the node names and request-building code for a draft-only Billing chain.

```javascript
const PRODUCT_PAYLOAD_CODE = `
const request = $json;
return request.line_items.map((item, index) => ({
  json: {
    request_id: request.request_id,
    line_index: index,
    description: item.description,
    quantity: Number(item.quantity),
    unit_price: Number(item.unit_price),
    currency: request.currency
  }
}));
`.trim();

const DRAFT_SUCCESS_CODE = `
return [{
  json: {
    ...$json,
    status: 'airwallex_created',
    success_note: 'draft invoice created'
  }
}];
`.trim();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node n8n-workflows/invoice-request-intake.test.js`
Expected: PASS for the product/price/draft assertions

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/deploy-invoice-request-intake.js n8n-workflows/invoice-request-intake.test.js
git commit -m "feat: add Airwallex draft invoice creation flow"
```

---

### Task 6: Implement Success Persistence and Requester Confirmation

**Files:**
- Modify: `n8n-workflows/deploy-invoice-request-intake.js`
- Test: `n8n-workflows/invoice-request-intake.test.js`

- [ ] **Step 1: Write the failing test for success-path tracker writes and requester messaging**

Add assertions for stored IDs, status, and success messaging.

```javascript
assert.match(deploySource, /Airwallex Customer ID/, 'Expected Airwallex customer ID mapping');
assert.match(deploySource, /Airwallex Invoice ID/, 'Expected Airwallex invoice ID mapping');
assert.match(deploySource, /Creation Status/, 'Expected creation status mapping');
assert.match(deploySource, /Slack Modal/, 'Expected source mapping');
assert.match(deploySource, /Airwallex draft invoice was created/i, 'Expected requester success confirmation text');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node n8n-workflows/invoice-request-intake.test.js`
Expected: FAIL with `Expected Airwallex customer ID mapping`

- [ ] **Step 3: Write minimal implementation**

Map the success payload into the tracker row and the requester Slack message.

```javascript
const SUCCESS_TRACKER_COLUMNS = {
  'Request ID': '={{ $json.request_id }}',
  'Source': 'Slack Modal',
  'Creation Status': '={{ $json.status }}',
  'Airwallex Customer ID': '={{ $json.airwallex_customer_id }}',
  'Airwallex Invoice ID': '={{ $json.airwallex_invoice_id }}',
  'Failure Stage': '',
  'Failure Reason': '',
  'Line Items Payload': '={{ JSON.stringify($json.line_items) }}'
};

const REQUESTER_SUCCESS_TEXT = "={{ 'Invoice request received. Airwallex draft invoice was created for ' + $json.client_name + ' (' + $json.currency + ' ' + $json.subtotal + '). Request ID: ' + $json.request_id }}";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node n8n-workflows/invoice-request-intake.test.js`
Expected: PASS for the success-path assertions

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/deploy-invoice-request-intake.js n8n-workflows/invoice-request-intake.test.js
git commit -m "feat: persist successful draft invoice requests"
```

---

### Task 7: Implement Fallback Persistence and John DM Alerts

**Files:**
- Modify: `n8n-workflows/deploy-invoice-request-intake.js`
- Test: `n8n-workflows/invoice-request-intake.test.js`

- [ ] **Step 1: Write the failing test for fallback behavior**

Add assertions that fallback stores full context and DMs John.

```javascript
assert.match(deploySource, /failure_stage/, 'Expected failure_stage persistence');
assert.match(deploySource, /failure_reason/, 'Expected failure_reason persistence');
assert.match(deploySource, /Line Items Payload/, 'Expected line item payload persistence');
assert.match(deploySource, /manual Airwallex creation required/i, 'Expected requester fallback text');
assert.match(deploySource, /DM John Failure Alert/, 'Expected John DM alert node');
assert.match(deploySource, /fallback_manual_required/, 'Expected fallback status value');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node n8n-workflows/invoice-request-intake.test.js`
Expected: FAIL with `Expected requester fallback text`

- [ ] **Step 3: Write minimal implementation**

Add the fallback row mapping and the John DM message body.

```javascript
const FALLBACK_TRACKER_COLUMNS = {
  'Request ID': '={{ $json.request_id }}',
  'Source': 'Slack Modal',
  'Creation Status': 'fallback_manual_required',
  'Failure Stage': '={{ $json.failure_stage }}',
  'Failure Reason': '={{ $json.failure_reason }}',
  'Airwallex Customer ID': '={{ $json.airwallex_customer_id || "" }}',
  'Airwallex Invoice ID': '={{ $json.airwallex_invoice_id || "" }}',
  'Line Items Payload': '={{ JSON.stringify($json.line_items) }}'
};

const REQUESTER_FALLBACK_TEXT = "={{ 'Invoice request received for ' + $json.client_name + '. Manual Airwallex creation required. Request ID: ' + $json.request_id }}";
const JOHN_DM_TEXT = "={{ 'Invoice intake fallback\\nRequest ID: ' + $json.request_id + '\\nClient: ' + $json.client_name + '\\nRequester: ' + $json.submitted_by_slack_user_id + '\\nSubtotal: ' + $json.currency + ' ' + $json.subtotal + '\\nFailure stage: ' + $json.failure_stage + '\\nFailure reason: ' + $json.failure_reason + '\\nLine items: ' + JSON.stringify($json.line_items) }}";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node n8n-workflows/invoice-request-intake.test.js`
Expected: PASS for the fallback-path assertions

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/deploy-invoice-request-intake.js n8n-workflows/invoice-request-intake.test.js
git commit -m "feat: add invoice intake fallback handling"
```

---

### Task 8: Extend Connection Integrity Coverage

**Files:**
- Modify: `n8n-workflows/connection-integrity.test.js`
- Test: `n8n-workflows/connection-integrity.test.js`

- [ ] **Step 1: Write the failing test for the new deploy script**

Change the test so it checks both workflow deploy scripts instead of only one.

```javascript
const workflowFiles = [
  path.join(__dirname, 'deploy-invoice-reminder-cron.js'),
  path.join(__dirname, 'deploy-invoice-request-intake.js'),
];

for (const filePath of workflowFiles) {
  const source = fs.readFileSync(filePath, 'utf8');
  const nodeNames = getNodeNames(source);
  const connectionKeys = getConnectionKeys(source);

  for (const connectionKey of connectionKeys) {
    assert.ok(
      nodeNames.has(connectionKey),
      `Connection "${connectionKey}" is missing a matching node declaration in ${path.basename(filePath)}`
    );
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node n8n-workflows/connection-integrity.test.js`
Expected: FAIL if the new deploy script is missing a referenced node or the file does not exist yet

- [ ] **Step 3: Write minimal implementation**

Ensure `deploy-invoice-request-intake.js` has a complete `connections` block where every connection key matches a declared node name.

```javascript
connections: {
  'Webhook Trigger': { main: [[{ node: 'Normalize Slack Submission', type: 'main', index: 0 }]] },
  'Normalize Slack Submission': { main: [[{ node: 'Airwallex Auth', type: 'main', index: 0 }]] }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node n8n-workflows/connection-integrity.test.js`
Expected: PASS with `Workflow connection integrity check passed.`

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/connection-integrity.test.js n8n-workflows/deploy-invoice-request-intake.js
git commit -m "test: cover invoice intake workflow connections"
```

---

### Task 9: Document the Workflow in Repo Handover Docs

**Files:**
- Modify: `n8n-workflows/README.md`
- Modify: `n8n-workflows/WORKFLOWS.md`
- Test: `n8n-workflows/invoice-request-intake.test.js`

- [ ] **Step 1: Write the failing test for documentation coverage**

Add assertions for README and WORKFLOWS details that describe the new workflow.

```javascript
assert.match(readmeDoc, /Structured Slack modal/, 'Expected Slack modal intake documented in README');
assert.match(readmeDoc, /draft invoice created/i, 'Expected draft-only behavior documented in README');
assert.match(workflowsDoc, /fallback_manual_required/, 'Expected fallback status documented in WORKFLOWS.md');
assert.match(workflowsDoc, /John DM/i, 'Expected John DM testing alert documented in WORKFLOWS.md');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node n8n-workflows/invoice-request-intake.test.js`
Expected: FAIL with `Expected Slack modal intake documented in README`

- [ ] **Step 3: Write minimal implementation**

Add the new workflow to both docs using the same style as the existing entries.

```markdown
| Invoice Request Intake | Planned | Manual trigger + Slack modal | [deploy-invoice-request-intake.js](deploy-invoice-request-intake.js) |
```

```markdown
## Invoice Request Intake

Accepts a structured Slack modal submission, attempts Airwallex draft invoice creation, writes the outcome to the tracker, and falls back to a manual-ready record plus John DM alert during testing.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node n8n-workflows/invoice-request-intake.test.js`
Expected: PASS for the documentation assertions

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/README.md n8n-workflows/WORKFLOWS.md n8n-workflows/invoice-request-intake.test.js
git commit -m "docs: add invoice request intake workflow docs"
```

---

### Task 10: Run Final Verification for the New Workflow Slice

**Files:**
- Modify: `n8n-workflows/deploy-invoice-request-intake.js`
- Test: `n8n-workflows/invoice-request-intake.test.js`
- Test: `n8n-workflows/connection-integrity.test.js`
- Test: `n8n-workflows/eod-triage-workflow.test.js`

- [ ] **Step 1: Write the final verification checklist into the code comments where needed**

Add one short comment above any non-obvious code block in `deploy-invoice-request-intake.js`, especially around customer ambiguity fallback and line-item payload shaping.

```javascript
// Do not guess across multiple name matches; fallback preserves the request for manual review.
```

- [ ] **Step 2: Run the new workflow contract test**

Run: `node n8n-workflows/invoice-request-intake.test.js`
Expected: PASS with `Invoice request intake workflow contract check passed.`

- [ ] **Step 3: Run the shared integrity test**

Run: `node n8n-workflows/connection-integrity.test.js`
Expected: PASS with `Workflow connection integrity check passed.`

- [ ] **Step 4: Run a regression check on the existing EOD contract test**

Run: `node n8n-workflows/eod-triage-workflow.test.js`
Expected: PASS with `EOD triage workflow contract check passed.`

- [ ] **Step 5: Commit**

```bash
git add n8n-workflows/deploy-invoice-request-intake.js n8n-workflows/invoice-request-intake.test.js n8n-workflows/connection-integrity.test.js n8n-workflows/README.md n8n-workflows/WORKFLOWS.md
git commit -m "feat: finalize invoice request intake workflow"
```

---

## Self-Review Notes

### Spec coverage

- Slack modal intake: covered by Tasks 2 and 3
- Multiple line items: covered by Tasks 3 and 5
- Name-based customer lookup: covered by Task 4
- Draft-only Airwallex creation: covered by Task 5
- Tracker success and fallback writes: covered by Tasks 6 and 7
- John DM testing alerts: covered by Task 7
- Repo documentation and handover: covered by Task 9

### Placeholder scan

No `TBD`, `TODO`, or “implement later” placeholders remain in the plan. The only conditional branch left open is the tracker-column decision, and the plan explicitly instructs the implementer to switch to a dedicated intake tab if the existing `Invoices` tab cannot safely absorb the new fields.

### Type consistency

- Request object fields use one consistent vocabulary across tasks: `request_id`, `line_items`, `airwallex_customer_id`, `airwallex_invoice_id`, `failure_stage`, `failure_reason`
- Status values stay consistent across tasks: `intake_received`, `failed_validation`, `airwallex_in_progress`, `airwallex_created`, `fallback_manual_required`

