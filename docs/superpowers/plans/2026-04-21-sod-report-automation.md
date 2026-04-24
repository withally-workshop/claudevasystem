# Start Of Day Report Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the SOD workflow to n8n in an active webhook-ready state, update it to handle John's raw-text fallback plus one Noa DM retry, and verify it with one controlled real-data run.

**Architecture:** Keep the existing single-file deploy-script pattern in `n8n-workflows/deploy-sod-report.js`, with deterministic Slack extraction/validation in code nodes, OpenAI only for final synthesis, and lightweight Node contract tests guarding the workflow shape. Rollout is local-first, then active live deploy, then one webhook test against real `#airwallexdrafts` history.

**Tech Stack:** Node.js deploy scripts, n8n workflow JSON, Slack nodes, OpenAI node, repo contract tests, Markdown docs, PowerShell live deploy commands

---

## File Structure

### Modify

- `n8n-workflows/deploy-sod-report.js`
  - Add John raw-text fallback context, DM retry logic, and canonical live-workflow targeting needed for stable active rollout.
- `n8n-workflows/sod-report.test.js`
  - Expand the contract test to assert John raw-text fallback and DM retry behavior.
- `n8n-workflows/README.md`
  - Keep workflow status/usage notes aligned after live deploy.
- `n8n-workflows/WORKFLOWS.md`
  - Record the final live workflow ID/status once deployed and confirm active webhook operation.
- `.claude/skills/sod-report/SKILL.md`
  - Sync the local operational skill with the shipped workflow behavior.
- `references/sops/sod-report.md`
  - Sync the SOP with the shipped workflow behavior.

### Reference

- `docs/superpowers/specs/2026-04-21-sod-report-automation-design.md`
- `n8n-workflows/deploy-eod-triage-summary.js`
- `n8n-workflows/connection-integrity.test.js`

---

### Task 1: Update The Local SOD Contract Test First

**Files:**
- Modify: `n8n-workflows/sod-report.test.js`
- Reference: `docs/superpowers/specs/2026-04-21-sod-report-automation-design.md`

- [ ] **Step 1: Add failing assertions for John raw-text fallback**

```js
assert.match(
  extractNode.parameters.jsCode,
  /rawTexts/,
  'extraction should preserve John raw message text for prompt fallback'
);
```

- [ ] **Step 2: Add failing assertions for DM retry behavior**

```js
assert.ok(workflow.connections['Did Noa DM Fail?'], 'DM failure gate should be connected');
assert.ok(workflow.connections['Retry Noa DM'], 'retry DM node should be connected');
assert.ok(workflow.connections['Did Retry DM Fail?'], 'retry failure gate should be connected');
```

- [ ] **Step 3: Run the targeted test to verify it fails**

Run: `node n8n-workflows/sod-report.test.js`
Expected: FAIL on the new raw-text or retry assertions.

- [ ] **Step 4: Commit**

```bash
git add n8n-workflows/sod-report.test.js
git commit -m "test: cover sod raw text and retry"
```

### Task 2: Implement John Raw-Text Fallback In The Deploy Script

**Files:**
- Modify: `n8n-workflows/deploy-sod-report.js`
- Test: `n8n-workflows/sod-report.test.js`

- [ ] **Step 1: Extend the extraction payload with raw John texts**

Add to the extraction payload:

```js
johnMorning: {
  messageCount: johnMessages.length,
  sourceTexts: johnMessages.map((msg) => msg.text),
  focusGoals: uniqueItems(johnBuckets.focusGoals),
  blockers: uniqueItems(johnBuckets.blockers),
  notes: uniqueItems(johnBuckets.notes),
  rawTexts: johnMessages.map((msg) => msg.text).filter(Boolean),
},
```

- [ ] **Step 2: Update the prompt builder to include fallback raw John context**

Add logic like:

```js
const johnRawFallback = (payload.johnMorning?.rawTexts || []).join('\n\n');
const johnSection = payload.johnMorning?.focusGoals?.length || payload.johnMorning?.blockers?.length || payload.johnMorning?.notes?.length
  ? structuredJohnSection
  : `**John Raw Context**\n${johnRawFallback || 'none'}`;
```

- [ ] **Step 3: Run the SOD contract test and confirm the raw-text assertions now pass**

Run: `node n8n-workflows/sod-report.test.js`
Expected: either PASS or fail later on retry-path assertions.

- [ ] **Step 4: Commit**

```bash
git add n8n-workflows/deploy-sod-report.js n8n-workflows/sod-report.test.js
git commit -m "feat: add sod john raw fallback"
```

### Task 3: Implement DM Retry After Archive Post

**Files:**
- Modify: `n8n-workflows/deploy-sod-report.js`
- Test: `n8n-workflows/sod-report.test.js`

- [ ] **Step 1: Add a retry DM node after the first Noa DM failure path**

Add workflow nodes/connections so the success path is:

```text
[Post to Airwallex Drafts]
        |
[Send SOD to Noa]
        |
[Did Noa DM Fail?]
   | false               | true
   v                     v
 [finish]          [Retry Noa DM]
                           |
                    [Did Retry DM Fail?]
                     | false        | true
                     v              v
                  [finish]   [Post Failure Alert]
```

- [ ] **Step 2: Keep failure alerts compact**

Ensure the failure alert text only reports the delivery failure and does not rerun extraction/generation.

- [ ] **Step 3: Run the targeted test and confirm it passes**

Run: `node n8n-workflows/sod-report.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add n8n-workflows/deploy-sod-report.js n8n-workflows/sod-report.test.js
git commit -m "feat: retry sod noa dm once"
```

### Task 4: Run The Full Local Verification Set

**Files:**
- Test: `n8n-workflows/sod-report.test.js`
- Test: `n8n-workflows/connection-integrity.test.js`
- Reference: `n8n-workflows/invoice-request-intake.test.js`
- Reference: `n8n-workflows/slack-invoice-handler.test.js`

- [ ] **Step 1: Run the SOD test**

Run: `node n8n-workflows/sod-report.test.js`
Expected: PASS.

- [ ] **Step 2: Run cross-workflow integrity**

Run: `node n8n-workflows/connection-integrity.test.js`
Expected: PASS.

- [ ] **Step 3: Run adjacent workflow contract checks**

Run: `node n8n-workflows/invoice-request-intake.test.js`
Run: `node n8n-workflows/slack-invoice-handler.test.js`
Expected: PASS for both.

- [ ] **Step 4: Commit**

```bash
git add n8n-workflows/deploy-sod-report.js n8n-workflows/sod-report.test.js
git commit -m "test: verify sod workflow locally"
```

### Task 5: Deploy The SOD Workflow To n8n And Keep It Active

**Files:**
- Modify: `n8n-workflows/README.md`
- Modify: `n8n-workflows/WORKFLOWS.md`

- [ ] **Step 1: Deploy to n8n**

Run:

```bash
node n8n-workflows/deploy-sod-report.js
```

Expected: `SUCCESS`, printed workflow ID, live workflow URL, and production webhook path.

- [ ] **Step 2: Verify the workflow exists in n8n and is active**

Run a live workflow lookup and confirm:
- workflow name is `Krave - Start Of Day Report`
- workflow is non-archived
- workflow is active after deployment

- [ ] **Step 3: Update docs with the final workflow ID and active status**

Document:
- live workflow ID
- manual webhook path
- active webhook-ready operating mode

- [ ] **Step 4: Commit**

```bash
git add n8n-workflows/README.md n8n-workflows/WORKFLOWS.md
git commit -m "docs: record sod live workflow state"
```

### Task 6: Run One Controlled Real-Data Test

**Files:**
- Modify: `n8n-workflows/README.md`
- Modify: `n8n-workflows/WORKFLOWS.md`
- Modify: `.claude/skills/sod-report/SKILL.md`
- Modify: `references/sops/sod-report.md`

- [ ] **Step 1: Manually trigger the live webhook once**

Run:

```bash
curl -s -X POST "https://noatakhel.app.n8n.cloud/webhook/krave-sod-report" -H "Content-Type: application/json" -d '{}'
```

Expected: accepted webhook response from n8n.

- [ ] **Step 2: Review the live run outcome**

Confirm one of:
- success: report posted to `#airwallexdrafts`, then DM sent to Noa
- validation failure: alert only names missing input(s)
- delivery issue: one DM retry happened before failure alert

- [ ] **Step 3: Sync operator docs to the actual shipped behavior**

Update the skill and SOP so they reflect:
- `Morning Triage` optional-input behavior
- John raw-text fallback behavior
- archive-first then DM
- one DM retry
- active webhook-based daily operation

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/sod-report/SKILL.md references/sops/sod-report.md n8n-workflows/README.md n8n-workflows/WORKFLOWS.md
git commit -m "docs: sync sod manual workflow behavior"
```

---

## Self-Review

- Spec coverage: this plan covers raw-text fallback, DM retry, active live deploy, one controlled real-data run, and downstream docs sync.
- Placeholder scan: no `TODO`/`TBD` implementation steps remain in the task list.
- Type consistency: node names and workflow files match the current repo naming for the SOD workflow.
