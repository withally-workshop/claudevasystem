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
