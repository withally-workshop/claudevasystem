const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function extractQuotedValues(source, regex) {
  return [...source.matchAll(regex)].map((match) => match[1]);
}

function getNodeNames(source) {
  return new Set(extractQuotedValues(source, /name:\s+'([^']+)'/g));
}

function getConnectionKeys(source) {
  const sectionMatch = source.match(/connections:\s*\{([\s\S]*?)\n\s*\},?\n\};/);
  assert.ok(sectionMatch, 'Expected workflow connections block to exist');

  return new Set(
    extractQuotedValues(sectionMatch[1], /'([^']+)':\s*\{/g)
  );
}

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

console.log('Workflow connection integrity check passed.');
