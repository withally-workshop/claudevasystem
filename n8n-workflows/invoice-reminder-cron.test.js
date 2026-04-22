const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const deployPath = path.join(__dirname, 'deploy-invoice-reminder-cron.js');
const readmePath = path.join(__dirname, 'README.md');
const workflowsDocPath = path.join(__dirname, 'WORKFLOWS.md');

assert.ok(fs.existsSync(deployPath), 'Expected deploy-invoice-reminder-cron.js to exist');

const deploySource = fs.readFileSync(deployPath, 'utf8');
const readmeDoc = fs.readFileSync(readmePath, 'utf8');
const workflowsDoc = fs.readFileSync(workflowsDocPath, 'utf8');

assert.match(deploySource, /name:\s+'Krave .* Invoice Reminder Cron'/, 'Expected workflow name in deploy script');
assert.match(deploySource, /path:\s+'krave-invoice-reminder'/, 'Expected reminder webhook path');
assert.match(deploySource, /'Schedule 10am ICT'/, 'Expected schedule trigger node');
assert.match(deploySource, /'Has Client Email\?'/, 'Expected email guard node');
assert.ok(
  deploySource.includes("leftValue: '={{ $json.clientEmail }}'"),
  'Expected Has Client Email? to use a valid n8n expression for clientEmail'
);
assert.ok(
  !deploySource.includes("leftValue: '={{ .clientEmail }}'"),
  'Expected invalid bare .clientEmail expression to stay out of the deploy script'
);
assert.match(readmeDoc, /Invoice Reminder Cron/, 'Expected workflow listed in README');
assert.match(workflowsDoc, /Invoice Reminder Cron/, 'Expected workflow listed in WORKFLOWS.md');

console.log('Invoice reminder cron workflow contract check passed.');
