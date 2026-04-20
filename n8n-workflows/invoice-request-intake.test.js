const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const deployPath = path.join(__dirname, 'deploy-invoice-request-intake.js');

assert.ok(fs.existsSync(deployPath), 'Expected deploy-invoice-request-intake.js to exist');

const deploySource = fs.readFileSync(deployPath, 'utf8');

assert.match(deploySource, /name:\s+'Krave .* Invoice Request Intake'/, 'Expected workflow name in deploy script');
assert.match(deploySource, /path:\s+'krave-invoice-request-intake'/, 'Expected manual webhook path');
assert.match(deploySource, /slack/i, 'Expected Slack integration in deploy script');
assert.match(deploySource, /api\.airwallex\.com/, 'Expected Airwallex API usage in deploy script');
assert.match(deploySource, /googleSheets/i, 'Expected Google Sheets usage in deploy script');
assert.match(deploySource, /fallback_manual_required/, 'Expected fallback status handling');
assert.match(deploySource, /draft invoice created/i, 'Expected draft-only success handling');
assert.match(deploySource, /'Webhook Trigger'/, 'Expected manual webhook node');
assert.match(deploySource, /'Normalize Slack Submission'/, 'Expected normalization code node');
assert.match(deploySource, /'Airwallex Auth'/, 'Expected Airwallex auth node');
assert.match(deploySource, /'Write Tracker Success'/, 'Expected tracker success node');
assert.match(deploySource, /'Write Tracker Fallback'/, 'Expected tracker fallback node');
assert.match(deploySource, /'DM John Failure Alert'/, 'Expected John DM fallback alert node');
assert.match(deploySource, /'Requester Success Confirmation'/, 'Expected requester success confirmation node');
assert.match(deploySource, /'Webhook Trigger':\s*{/, 'Expected webhook connection key');
assert.match(
  deploySource,
  /node:\s+'Normalize Slack Submission',\s*type:\s+'main',\s*index:\s+0/,
  'Expected webhook to normalization wiring'
);

console.log('Invoice request intake workflow contract check passed.');
