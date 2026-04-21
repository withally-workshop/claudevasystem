const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const deployPath = path.join(__dirname, 'deploy-inbox-triage-daily.js');

assert.ok(fs.existsSync(deployPath), 'Expected deploy-inbox-triage-daily.js to exist');

const deploySource = fs.readFileSync(deployPath, 'utf8');

assert.match(deploySource, /name:\s+'Krave .* Inbox Triage Daily'/, 'Expected workflow name in deploy script');
assert.match(deploySource, /const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD'/, 'Expected shared Slack credential id');
assert.match(deploySource, /const OPENAI_CRED_ID = 'UIREXIYn59JOH1zU'/, 'Expected shared OpenAI credential id');
assert.match(deploySource, /const AIRWALLEX_DRAFTS = 'C0AQZGJDR38'/, 'Expected #airwallexdrafts channel id');
assert.match(deploySource, /const NOA_USER_ID = 'U06TBGX9L93'/, 'Expected Noa DM user id');
assert.match(deploySource, /const TIMEZONE = 'Asia\/Manila'/, 'Expected Manila timezone constant');
assert.match(deploySource, /path:\s+'krave-inbox-triage-daily'/, 'Expected manual webhook path');
assert.match(deploySource, /'Schedule 9am ICT Weekdays'/, 'Expected schedule trigger node');
assert.match(deploySource, /'Webhook Trigger'/, 'Expected manual webhook node');
assert.match(deploySource, /'Search Inbox'/, 'Expected Gmail search node');
assert.match(deploySource, /'Fetch Message Details'/, 'Expected Gmail detail node');
assert.match(deploySource, /'Build Slack Summary'/, 'Expected summary node');
assert.match(deploySource, /'Post to Airwallex Drafts'/, 'Expected channel summary node');
assert.match(deploySource, /'DM Noa Summary'/, 'Expected Noa DM node');
assert.match(deploySource, /scheduleTrigger/, 'Expected schedule trigger node');
assert.match(deploySource, /gmail/i, 'Expected Gmail integration in deploy script');
assert.match(deploySource, /slack/i, 'Expected Slack integration in deploy script');
assert.match(deploySource, /openAi/i, 'Expected OpenAI integration in deploy script');

console.log('Inbox triage daily workflow contract check passed.');
