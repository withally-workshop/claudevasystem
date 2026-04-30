const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const deployPath = path.join(__dirname, 'deploy-invoice-approval-polling.js');
const skillPath = path.join(__dirname, '..', '.claude', 'skills', 'invoice-approval-polling', 'SKILL.md');
const readmePath = path.join(__dirname, 'README.md');
const workflowsDocPath = path.join(__dirname, 'WORKFLOWS.md');

const deploySource = fs.readFileSync(deployPath, 'utf8');
const skillDoc = fs.readFileSync(skillPath, 'utf8');
const readmeDoc = fs.readFileSync(readmePath, 'utf8');
const workflowsDoc = fs.readFileSync(workflowsDocPath, 'utf8');

assert.match(deploySource, /name:\s+'Krave .* Invoice Approval Polling'/, 'Expected approval polling workflow name');
assert.match(deploySource, /path:\s+'krave-invoice-approval-polling'/, 'Expected approval polling webhook path');

assert.ok(
  deploySource.includes("r.json['Payment Status']"),
  'Approval polling must filter pending drafts from Column J Payment Status'
);
assert.ok(
  !deploySource.includes("r.json['Status'] || '').toString().trim();\n  return status === 'Draft - Pending John Review'"),
  'Approval polling must not use formula Column N Status to find pending drafts'
);

assert.ok(
  deploySource.includes("'Payment Status': 'Invoice Sent'"),
  'Approval polling must write Column J Payment Status = Invoice Sent'
);
assert.ok(
  deploySource.includes("'Invoice URL':"),
  'Approval polling must write Column R Invoice URL'
);
assert.ok(
  deploySource.includes("matchingColumns: ['Airwallex Invoice ID']"),
  'Approval polling must match tracker updates by stable Column F Airwallex Invoice ID'
);
assert.match(
  deploySource,
  /getInvoice\.number[\s\S]*getInvoice\.invoice_number[\s\S]*finalize\.number[\s\S]*finalize\.invoice_number/,
  'Approval polling must refresh Column E Invoice # from finalized Airwallex invoice data'
);
assert.ok(
  !deploySource.includes("'Status': 'Invoice Sent'"),
  'Approval polling must never write formula Column N Status'
);

assert.match(deploySource, /STRAT_SLACK/i, 'Approval polling must include requester name to Slack ID mapping');
assert.match(deploySource, /toLowerCase\(\)/, 'Requester mapping must handle case differences such as john');
assert.match(
  deploySource,
  /https:\/\/slack\.com\/api\/conversations\.history/,
  'Approval polling must use Slack Web API conversations.history for channel history'
);
assert.match(
  deploySource,
  /https:\/\/slack\.com\/api\/conversations\.replies/,
  'Approval polling must use Slack Web API conversations.replies for approval replies'
);
assert.ok(
  !deploySource.includes("operation: 'getAll'") && !deploySource.includes("operation: 'getReplies'"),
  'Approval polling must not use unsupported Slack message getAll/getReplies operations'
);
assert.match(
  deploySource,
  /name:\s+'Find Draft Notification'[\s\S]*mode:\s+'runOnceForAllItems'/,
  'Find Draft Notification must run once for all items so it can return an item array'
);
assert.match(
  deploySource,
  /name:\s+'Find Approve Reply'[\s\S]*mode:\s+'runOnceForAllItems'/,
  'Find Approve Reply must run once for all items so it can return an item array'
);
assert.match(
  deploySource,
  /\$items\('Filter Pending Drafts'\)/,
  'Approval polling must evaluate every pending draft, not only the first tracker row'
);
assert.match(
  deploySource,
  /\$items\('Find Draft Notification'\)/,
  'Approval polling must evaluate approval replies for every matching draft notification'
);
assert.match(
  deploySource,
  /\$items\('Find Approve Reply'\)/,
  'Approval polling must preserve each approved draft context through Airwallex finalization'
);
assert.ok(
  !deploySource.includes("runOnceForEachItem"),
  'Approval polling Code nodes return item arrays, so none should run once for each item'
);
assert.match(
  deploySource,
  /hosted_url/,
  'Approval polling must extract Airwallex hosted_url as the payment link'
);
assert.match(
  deploySource,
  /name:\s+'Reply in John Thread'[\s\S]*credentials:\s*\{ slackApi:\s*\{ id: SLACK_CRED_ID, name: 'Krave Slack Bot' \} \}/,
  'Expected John thread finalization reply to post via Krave Slack Bot'
);
assert.match(
  deploySource,
  /name:\s+'Notify Strategist'[\s\S]*credentials:\s*\{ slackApi:\s*\{ id: SLACK_CRED_ID, name: 'Krave Slack Bot' \} \}/,
  'Expected strategist notification to post via Krave Slack Bot'
);
assert.match(
  deploySource,
  /name:\s+'Reply in John Thread'[\s\S]*https:\/\/slack\.com\/api\/chat\.postMessage[\s\S]*thread_ts:\s*\$json\.approval_message_ts/,
  'Expected John finalization reply to use Slack Web API with explicit thread_ts'
);
assert.match(
  deploySource,
  /name:\s+'Notify Strategist'[\s\S]*https:\/\/slack\.com\/api\/chat\.postMessage[\s\S]*thread_ts:\s*\$json\.origin_thread_ts/,
  'Expected strategist finalization notification to use Slack Web API with explicit origin thread_ts'
);

assert.match(skillDoc, /J \| Payment Status/, 'Skill doc must document Column J as Payment Status');
assert.match(skillDoc, /N \| Status.*never write/i, 'Skill doc must document Column N as read-only Status');
assert.match(skillDoc, /R \| Invoice URL/, 'Skill doc must document Column R as Invoice URL');
assert.match(readmeDoc, /Invoice Approval Polling/, 'README must list approval polling');
assert.match(workflowsDoc, /Invoice Approval Polling/, 'WORKFLOWS.md must list approval polling');

console.log('Invoice approval polling tracker contract check passed.');
