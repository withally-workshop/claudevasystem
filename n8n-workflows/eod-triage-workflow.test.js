const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const deployPath = path.join(__dirname, 'deploy-eod-triage-summary.js');
const workflowsDocPath = path.join(__dirname, 'WORKFLOWS.md');
const readmePath = path.join(__dirname, 'README.md');

assert.ok(fs.existsSync(deployPath), 'Expected deploy-eod-triage-summary.js to exist');

const deploySource = fs.readFileSync(deployPath, 'utf8');
const workflowsDoc = fs.readFileSync(workflowsDocPath, 'utf8');
const readmeDoc = fs.readFileSync(readmePath, 'utf8');

assert.match(deploySource, /name:\s+'Krave .* EOD Triage Summary'/, 'Expected workflow name in deploy script');
assert.match(deploySource, /path:\s+'krave-eod-triage-summary'/, 'Expected manual webhook path');
assert.match(deploySource, /n8n-nodes-langchain\.openAi/, 'Expected OpenAI node in deploy script');
assert.match(deploySource, /C0AQZGJDR38/, 'Expected #airwallexdrafts channel id');
assert.match(deploySource, /C0AGEM919QV/, 'Expected #ad-production-internal channel id');
assert.match(deploySource, /C09HN2EBPR7/, 'Expected #payments-invoices-updates channel id');
assert.match(deploySource, /U06TBGX9L93/, 'Expected Noa DM user id');

assert.match(workflowsDoc, /Workflow 3 .* EOD Triage Summary/, 'Expected EOD workflow in WORKFLOWS.md');
assert.match(workflowsDoc, /krave-eod-triage-summary/, 'Expected EOD webhook documented');
assert.match(readmeDoc, /EOD Triage Summary/, 'Expected EOD workflow listed in README');

console.log('EOD triage workflow contract check passed.');
