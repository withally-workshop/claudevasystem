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
