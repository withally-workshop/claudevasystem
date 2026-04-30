const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const deployPath = path.join(__dirname, 'deploy-payment-detection.js');
const skillPath = path.join(__dirname, '..', '.claude', 'skills', 'payment-detection', 'SKILL.md');
const workflowsDocPath = path.join(__dirname, 'WORKFLOWS.md');

const deploySource = fs.readFileSync(deployPath, 'utf8');
const skillDoc = fs.readFileSync(skillPath, 'utf8');
const workflowsDoc = fs.readFileSync(workflowsDocPath, 'utf8');
const { workflow } = require(deployPath);

const byName = new Map(workflow.nodes.map((node) => [node.name, node]));
const connections = workflow.connections || {};

assert.ok(
  deploySource.includes("j['Payment Status']") || deploySource.includes("r.json['Payment Status']"),
  'Payment detection should use Column J Payment Status as lifecycle state'
);
assert.ok(
  deploySource.includes("['Unpaid', 'Overdue', ''].includes(displayStatus)"),
  'Payment detection should only act on Column N Status values Unpaid, Overdue, or blank'
);
assert.ok(
  deploySource.includes("'Payment Status': 'Partial Payment'"),
  'Partial payment path must write Column J Payment Status'
);
assert.ok(
  deploySource.includes("'Payment Status': 'Payment Complete'"),
  'Full payment paths must write Column J Payment Status'
);
assert.ok(
  !deploySource.includes("'Status': 'Partial Payment'"),
  'Partial payment path must not write formula Column N Status'
);
assert.ok(
  !deploySource.includes("'Status': 'Payment Complete'"),
  'Full payment paths must not write formula Column N Status'
);
assert.match(deploySource, /'Amount Paid':/, 'Payment detection must write cumulative Column Q Amount Paid');
assert.match(deploySource, /const eventKey =/, 'Payment detection must dedupe payment events before matching');

assert.equal(
  byName.get('Search Airwallex Emails').parameters.filters.q,
  "={{ $('Claim Window').first().json.gmailQuery }}",
  'Gmail search must use the last-scan Claim Window query'
);
assert.ok(
  deploySource.includes("lastRunTs > 0 ? 'after:' + lastRunTs : 'newer_than:1d'"),
  'Gmail scan must search from last n8n scan, not the full inbox'
);
assert.deepEqual(
  connections['Claim Window'].main[0].map((edge) => edge.node).sort(),
  ['Get Invoice Tracker', 'Search Airwallex Emails'].sort(),
  'Claim Window should fan out once to tracker read and one Gmail search'
);
assert.ok(
  !connections['Get Invoice Tracker'].main[0].some((edge) => edge.node === 'Search Airwallex Emails'),
  'Tracker rows must not feed Search Airwallex Emails or Gmail will run once per tracker row'
);
assert.equal(
  byName.get('Combine Payment Signals').type,
  'n8n-nodes-base.merge',
  'Payment signals should use a Merge node to wait for Gmail and Airwallex paths'
);

assert.match(skillDoc, /Q \| Amount Paid/, 'Payment detection skill must document Column Q Amount Paid');
assert.match(skillDoc, /Do NOT write to Column N/i, 'Payment detection skill must keep Column N read-only');
assert.match(skillDoc, /Unpaid`, `Overdue`, or blank/, 'Payment detection skill must document Column N eligibility');
assert.match(workflowsDoc, /Q \| Amount Paid/, 'WORKFLOWS.md must document Column Q Amount Paid');
assert.match(workflowsDoc, /Unpaid`, `Overdue`, or blank/, 'WORKFLOWS.md must document Column N eligibility');

console.log('Payment detection tracker contract check passed.');
