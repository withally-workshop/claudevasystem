const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'deploy-client-invoice-creation.js'), 'utf8');
const mod = require('./deploy-client-invoice-creation');

// ─── Credentials — never hardcoded ───────────────────────────────────────────
assert.ok(
  src.includes('process.env.AIRWALLEX_CLIENT_ID'),
  'AIRWALLEX_CLIENT_ID must come from process.env'
);
assert.ok(
  src.includes('process.env.AIRWALLEX_API_KEY'),
  'AIRWALLEX_API_KEY must come from process.env'
);
assert.ok(
  !src.includes('JaQA4uJ1SDSBkTdFigT9sw'),
  'Hardcoded Airwallex client ID must not appear in deploy script'
);
assert.ok(
  !src.includes('5611f8e189ef357e5b3493916208efb8'),
  'Hardcoded Airwallex API key must not appear in deploy script'
);
assert.ok(
  src.includes('process.env.N8N_API_KEY'),
  'N8N_API_KEY must come from process.env'
);

// ─── Key constants ────────────────────────────────────────────────────────────
assert.equal(mod.SHEETS_CRED_ID,   '83MQOm78gYDvziTO', 'SHEETS_CRED_ID mismatch');
assert.equal(mod.SLACK_CRED_ID,    'Bn2U6Cwe1wdiCXzD', 'SLACK_CRED_ID mismatch');
assert.equal(mod.GMAIL_JOHN_CRED,  'vsDW3WpKXqS9HUs3', 'GMAIL_JOHN_CRED mismatch');
assert.equal(mod.SHEET_ID,         '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50', 'SHEET_ID mismatch');
assert.equal(mod.JOHN_CHANNEL,     'C0AQZGJDR38',      'JOHN_CHANNEL mismatch');
assert.equal(mod.PAYMENTS_CHANNEL, 'C09HN2EBPR7',      'PAYMENTS_CHANNEL mismatch');
assert.equal(mod.DRAFT_PENDING_STATUS, 'Draft - Pending John Review', 'DRAFT_PENDING_STATUS must use hyphen to match intake workflow');
assert.equal(mod.SENT_STATUS,      'Invoice Sent',     'SENT_STATUS mismatch');
assert.equal(mod.N8N_URL,          'https://noatakhel.app.n8n.cloud', 'N8N_URL mismatch');

// ─── Workflow metadata ────────────────────────────────────────────────────────
const wf = mod.workflow;
assert.equal(wf.name, 'Krave — Client Invoice Creation', 'workflow name mismatch');
assert.ok(src.includes('krave-client-invoice-creation'), 'webhook path must be krave-client-invoice-creation');
assert.ok(
  src.includes('ALLOW_LEGACY_CLIENT_INVOICE_CREATION_DEPLOY'),
  'Legacy Client Invoice Creation deploy must require an explicit override'
);

// ─── Required nodes present ───────────────────────────────────────────────────
const nodeNames = new Set(wf.nodes.map(n => n.name));
const required = [
  'Schedule',
  'Webhook Trigger',
  'Read Invoice Tracker',
  'Is Draft Pending?',
  'Get John Channel History',
  'Find Draft Notification',
  'Notification Found?',
  'Get Thread Replies',
  'Find Approve Reply',
  'Approve Reply Found?',
  'Airwallex Auth',
  'Auth OK?',
  'Finalize Invoice',
  'Get Invoice',
  'Extract Payment Link',
  'Update Tracker',
  'Reply in John Thread',
  'Notify Strategist',
  'Has Client Email?',
  'Email Client',
  'Alert Auth Failed',
];
for (const name of required) {
  assert.ok(nodeNames.has(name), `Missing required node: "${name}"`);
}

// ─── Airwallex endpoints ──────────────────────────────────────────────────────
assert.ok(src.includes('/api/v1/authentication/login'), 'Auth endpoint must be /authentication/login');
assert.ok(src.includes('/finalize'),                   'Finalize endpoint must include /finalize (not /confirm)');
assert.ok(!src.includes('/confirm'),                   '/confirm must not be used — correct endpoint is /finalize');

// ─── Dedup + logic ────────────────────────────────────────────────────────────
assert.ok(src.includes('white_check_mark'), 'Must check for white_check_mark reaction for dedup');
assert.ok(src.includes('approve'),          'Must scan replies for "approve"');
assert.ok(src.includes('notification_ts'),  'Must carry notification_ts through chain');
assert.ok(src.includes('approvalFound'),    'Must set approvalFound flag');

// ─── Payment link extraction ──────────────────────────────────────────────────
assert.ok(src.includes('hosted_invoice_url'),   'Must check hosted_invoice_url');
assert.ok(src.includes('digital_invoice_link'), 'Must check digital_invoice_link');
assert.ok(src.includes('link_found'),           'Must set link_found flag');

// ─── Tracker update ───────────────────────────────────────────────────────────
const updateNode = wf.nodes.find(n => n.name === 'Update Tracker');
assert.ok(updateNode, 'Update Tracker node must exist');
assert.equal(updateNode.parameters.operation, 'appendOrUpdate', 'Update Tracker must use appendOrUpdate');
assert.deepEqual(updateNode.parameters.columns.matchingColumns, ['Invoice #'], 'Must match on Invoice #');
assert.equal(updateNode.parameters.columns.value['Payment Status'], 'Invoice Sent', 'Payment Status must be "Invoice Sent"');
assert.ok(
  !JSON.stringify(updateNode.parameters).includes('row_number') &&
  !JSON.stringify(updateNode.parameters).includes('"N"'),
  'Must never write to Col N'
);

// ─── Schedule ────────────────────────────────────────────────────────────────
const scheduleNode = wf.nodes.find(n => n.name === 'Schedule');
assert.ok(scheduleNode, 'Schedule node must exist');
const cron = JSON.stringify(scheduleNode.parameters);
assert.ok(cron.includes('cronExpression'), 'Schedule must use cronExpression');
assert.ok(cron.includes('1,3,5,7,9'), 'Schedule must run every 2 hrs Mon–Fri 9am–5pm PHT (UTC hours 1,3,5,7,9)');

// ─── Credentials on Airwallex HTTP nodes ─────────────────────────────────────
const authNode = wf.nodes.find(n => n.name === 'Airwallex Auth');
assert.ok(authNode, 'Airwallex Auth node must exist');
assert.equal(authNode.parameters.authentication, 'none', 'Airwallex nodes must use manual header auth');
assert.ok(authNode.continueOnFail, 'Airwallex Auth must have continueOnFail: true');

const finalizeNode = wf.nodes.find(n => n.name === 'Finalize Invoice');
assert.ok(finalizeNode, 'Finalize Invoice node must exist');
assert.ok(finalizeNode.continueOnFail, 'Finalize Invoice must have continueOnFail: true');

// ─── Slack nodes use correct credential ──────────────────────────────────────
const slackNodes = wf.nodes.filter(n => n.credentials && n.credentials.slackApi);
for (const node of slackNodes) {
  assert.equal(
    node.credentials.slackApi.id, 'Bn2U6Cwe1wdiCXzD',
    `Node "${node.name}" must use SLACK_CRED_ID`
  );
}

// ─── Gmail node ───────────────────────────────────────────────────────────────
const gmailNode = wf.nodes.find(n => n.name === 'Email Client');
assert.ok(gmailNode, 'Email Client (Gmail) node must exist');
assert.equal(gmailNode.credentials.gmailOAuth2.id, 'vsDW3WpKXqS9HUs3', 'Gmail node must use John Gmail credential');
assert.ok(gmailNode.continueOnFail, 'Email Client must have continueOnFail: true');

// ─── Connection integrity ─────────────────────────────────────────────────────
const connectionKeys = new Set(Object.keys(wf.connections));
for (const key of connectionKeys) {
  assert.ok(nodeNames.has(key), `Connection key "${key}" has no matching node`);
}

console.log(`client-invoice-creation: all ${required.length} required nodes present, credentials clean, connection integrity verified.`);
