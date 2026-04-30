const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function extractQuotedValues(source, regex) {
  return [...source.matchAll(regex)].map((match) => match[1]);
}

function getConnectionKeysFromSource(source) {
  const sectionMatch = source.match(/connections:\s*\{([\s\S]*?)\n\s*\},?\n\};/);
  assert.ok(sectionMatch, 'Expected workflow connections block to exist');

  return new Set(
    extractQuotedValues(sectionMatch[1], /'([^']+)':\s*\{/g)
  );
}

const workflowFiles = [
  path.join(__dirname, 'deploy-invoice-reminder-cron.js'),
  path.join(__dirname, 'deploy-invoice-request-intake.js'),
  path.join(__dirname, 'deploy-slack-invoice-handler.js'),
  path.join(__dirname, 'deploy-inbox-triage-daily.js'),
  path.join(__dirname, 'deploy-client-invoice-creation.js'),
  path.join(__dirname, 'deploy-payment-detection.js'),
];

for (const filePath of workflowFiles) {
  const source = fs.readFileSync(filePath, 'utf8');
  const exported = require(filePath);
  const workflow = exported.workflow;

  const nodeNames = workflow
    ? new Set(workflow.nodes.map((node) => node.name))
    : new Set(extractQuotedValues(source, /name:\s+'([^']+)'/g));
  const connectionKeys = workflow
    ? new Set(Object.keys(workflow.connections || {}))
    : getConnectionKeysFromSource(source);

  for (const connectionKey of connectionKeys) {
    assert.ok(
      nodeNames.has(connectionKey),
      `Connection "${connectionKey}" is missing a matching node declaration in ${path.basename(filePath)}`
    );
  }
}

console.log('Workflow connection integrity check passed.');
