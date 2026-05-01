const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const deployPath = path.join(__dirname, 'deploy-invoice-reminder-reply-detection.js');
const workflowsDocPath = path.join(__dirname, 'WORKFLOWS.md');
const readmePath = path.join(__dirname, 'README.md');

assert.ok(fs.existsSync(deployPath), 'Expected deploy-invoice-reminder-reply-detection.js to exist');

const deploySource = fs.readFileSync(deployPath, 'utf8');
const workflowsDoc = fs.readFileSync(workflowsDocPath, 'utf8');
const readmeDoc = fs.readFileSync(readmePath, 'utf8');

assert.match(deploySource, /name:\s+'Krave .* Invoice Reminder Reply Detection'/, 'Expected workflow name');
assert.match(deploySource, /path:\s+'krave-invoice-reminder-reply-detection'/, 'Expected manual webhook path');
assert.match(deploySource, /john@kravemedia\.co/, 'Expected John-only Gmail scope');
assert.doesNotMatch(deploySource, /noa@kravemedia\.co|amanda@kravemedia\.co/i, 'Should not monitor Noa or strategist inboxes');
assert.match(deploySource, /range:\s*'A:Z'/, 'Expected tracker read through reply confidence column');
assert.match(deploySource, /Last Follow-Up Sent/, 'Expected follow-up sent column');
assert.match(deploySource, /Last Follow-Up Type/, 'Expected follow-up type column');
assert.match(deploySource, /Last Follow-Up Thread ID/, 'Expected follow-up thread id column');
assert.match(deploySource, /Last Client Reply Date/, 'Expected client reply date column');
assert.match(deploySource, /Client Reply Status/, 'Expected client reply status column');
assert.match(deploySource, /Client Reply Summary/, 'Expected client reply summary column');
assert.match(deploySource, /Follow-Up Attribution/, 'Expected follow-up attribution column');
assert.match(deploySource, /Reply Confidence/, 'Expected reply confidence column');
assert.match(deploySource, /No Reply Found/, 'Expected No Reply Found status');
assert.match(deploySource, /Possible Reply/, 'Expected Possible Reply status');
assert.match(deploySource, /Promise to Pay/, 'Expected Promise to Pay status');
assert.match(deploySource, /Question\/Dispute/, 'Expected Question/Dispute status');
assert.match(deploySource, /Needs Human/, 'Expected Needs Human status');
assert.match(deploySource, /Replied/, 'Expected Replied status');
assert.match(deploySource, /Confirmed/, 'Expected Confirmed confidence');
assert.match(deploySource, /Likely/, 'Expected Likely confidence');
assert.match(deploySource, /Unconfirmed/, 'Expected Unconfirmed confidence');
assert.match(deploySource, /from:.*after:/s, 'Expected fallback Gmail query from client after follow-up in John mailbox');
assert.doesNotMatch(deploySource, /gmailQuery[\s\S]{0,120}invoiceNum/, 'Fallback reply query must not require invoice number');
assert.match(deploySource, /\$\('Prepare Reply Queries'\)\.item\.json\.gmailQuery/, 'Expected Gmail search to use prepared query after baseline write');
assert.match(deploySource, /\$\('Prepare Reply Queries'\)\.all\(\)/, 'Expected classifier to map replies across all prepared invoice queries');
assert.match(deploySource, /message\.From/, 'Expected classifier to support Gmail capitalized From field');
assert.match(deploySource, /pairedItem/, 'Expected classifier to group Gmail results by paired source item');
assert.match(deploySource, /invoiceFromMessage/, 'Expected classifier to fall back to invoice number in Gmail subject');
assert.match(deploySource, /operation:\s*'getAll'/, 'Expected Gmail search operation');
assert.match(deploySource, /operation:\s*'appendOrUpdate'/, 'Expected tracker update operation');
assert.doesNotMatch(deploySource, /operation:\s*'send'|operation:\s*'create'/, 'Reply detection must not send email or create drafts');
assert.doesNotMatch(deploySource, /n8n-nodes-base\.slack/, 'Reply detection should not post Slack messages');
assert.doesNotMatch(deploySource, /['"]Status['"]\s*:/, 'Reply detection must not write formula/display column N');
assert.match(workflowsDoc, /Invoice Reminder Reply Detection/, 'Expected workflow listed in WORKFLOWS.md');
assert.match(readmeDoc, /Invoice Reminder Reply Detection/, 'Expected workflow listed in README.md');

console.log('Invoice reminder reply detection workflow contract check passed.');
