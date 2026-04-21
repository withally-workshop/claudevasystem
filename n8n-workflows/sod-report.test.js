const assert = require('node:assert/strict');
const path = require('path');

const deployPath = path.join(__dirname, 'deploy-sod-report.js');
const { workflow } = require(deployPath);

assert.ok(workflow, 'workflow should be defined');
assert.strictEqual(workflow.name, 'Krave - Start Of Day Report');

const nodeNames = workflow.nodes.map((node) => node.name);

for (const requiredName of [
  'Manual Trigger',
  'Webhook Trigger',
  'Prepare Drafts Channel',
  'Fetch Airwallex Drafts History',
  'Extract SOD Inputs',
  'Validate Required Inputs',
  'Are Inputs Complete?',
  'Build SOD Prompt',
  'Generate SOD Report',
  'Post to Airwallex Drafts',
  'Send SOD to Noa',
  'Post Failure Alert',
]) {
  assert.ok(nodeNames.includes(requiredName), `missing node: ${requiredName}`);
}

const webhookNode = workflow.nodes.find((node) => node.name === 'Webhook Trigger');
assert.strictEqual(webhookNode.parameters.path, 'krave-sod-report');

const historyNode = workflow.nodes.find((node) => node.name === 'Fetch Airwallex Drafts History');
assert.strictEqual(historyNode.credentials.slackApi.id, 'Bn2U6Cwe1wdiCXzD');
assert.strictEqual(
  historyNode.parameters.channelId.value,
  'C0AQZGJDR38',
  'history node should read directly from #airwallexdrafts'
);
assert.strictEqual(historyNode.parameters.channelId.mode, 'list');

const extractNode = workflow.nodes.find((node) => node.name === 'Extract SOD Inputs');
assert.match(extractNode.parameters.jsCode, /Today's Wrap-up/, 'extraction should look for prior-day EOD');
assert.match(extractNode.parameters.jsCode, /Morning Triage/, 'extraction should look for Morning Triage');
assert.match(extractNode.parameters.jsCode, /U0AM5EGRVTP/, 'extraction should look for John');
assert.match(extractNode.parameters.jsCode, /carryOverItems/, 'extraction should emit carry-over items');
assert.match(extractNode.parameters.jsCode, /reviewThese/, 'extraction should emit review-these items');
assert.match(
  extractNode.parameters.jsCode,
  /rawTexts/,
  'extraction should preserve John raw message text for prompt fallback'
);

const validateNode = workflow.nodes.find((node) => node.name === 'Validate Required Inputs');
assert.match(validateNode.parameters.jsCode, /Morning Triage/, 'validation should check Morning Triage');
assert.match(validateNode.parameters.jsCode, /John morning dump/, 'validation should check John morning dump');
assert.match(validateNode.parameters.jsCode, /Today's Wrap-up/, 'validation should check prior-day EOD');
assert.match(validateNode.parameters.jsCode, /validationPassed/, 'validation should emit a hard-stop flag');
assert.match(validateNode.parameters.jsCode, /missingSources/, 'validation should emit missing source detail');

const promptNode = workflow.nodes.find((node) => node.name === 'Build SOD Prompt');
assert.match(promptNode.parameters.jsCode, /### Today's Goals/, 'prompt should enforce the house heading');
assert.match(promptNode.parameters.jsCode, /\*\*Focus Goals\*\*/, 'prompt should include focus goals section');
assert.match(promptNode.parameters.jsCode, /\*\*Carry-over from Yesterday\*\*/, 'prompt should include carry-over section');
assert.match(promptNode.parameters.jsCode, /\*\*Blocker \/ Input Needed\*\*/, 'prompt should include blockers section');
assert.match(promptNode.parameters.jsCode, /\*\*BAU \/ Follow-ups \(Business As Usual\)\*\*/, 'prompt should include BAU section');

const aiNode = workflow.nodes.find((node) => node.name === 'Generate SOD Report');
assert.strictEqual(aiNode.credentials.openAiApi.id, 'UIREXIYn59JOH1zU');
assert.match(aiNode.parameters.messages.values[0].content, /start-of-day report/i);

const postNode = workflow.nodes.find((node) => node.name === 'Post to Airwallex Drafts');
assert.strictEqual(postNode.parameters.channelId.value, 'C0AQZGJDR38');

const dmNode = workflow.nodes.find((node) => node.name === 'Send SOD to Noa');
assert.strictEqual(dmNode.parameters.channelId.value, 'U06TBGX9L93');

const failureNode = workflow.nodes.find((node) => node.name === 'Post Failure Alert');
assert.strictEqual(failureNode.parameters.channelId.value, 'C0AQZGJDR38');
assert.match(failureNode.parameters.text, /SOD report blocked/, 'failure alert should mention hard-stop validation');
assert.match(failureNode.parameters.text, /manual follow-up/, 'failure alert should cover delivery failures');

assert.ok(workflow.connections['Manual Trigger'], 'manual trigger should be connected');
assert.ok(workflow.connections['Webhook Trigger'], 'webhook trigger should be connected');
assert.ok(workflow.connections['Prepare Drafts Channel'], 'drafts channel prep should be connected');
assert.ok(workflow.connections['Are Inputs Complete?'], 'validation gate should be connected');
assert.ok(workflow.connections['Did Channel Send Fail?'], 'channel delivery gate should be connected');
assert.ok(workflow.connections['Did Noa DM Fail?'], 'DM delivery gate should be connected');
assert.ok(workflow.connections['Retry Noa DM'], 'retry DM node should be connected');
assert.ok(workflow.connections['Did Retry DM Fail?'], 'retry failure gate should be connected');

console.log('SOD report workflow contract check passed.');
