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
assert.match(deploySource, /request_id/, 'Expected request_id in normalization code');
assert.match(deploySource, /submitted_by_slack_user_id/, 'Expected Slack submitter field');
assert.match(deploySource, /line_items/, 'Expected line_items payload');
assert.match(deploySource, /failed_validation/, 'Expected validation failure status');
assert.match(deploySource, /intake_received/, 'Expected intake_received status');
assert.match(deploySource, /subtotal/, 'Expected subtotal calculation');
assert.match(deploySource, /authentication\/login/, 'Expected Airwallex auth login endpoint');
assert.match(deploySource, /Find Billing Customer/, 'Expected customer lookup node');
assert.match(deploySource, /Create Billing Customer/, 'Expected customer create node');
assert.match(deploySource, /company name|client name/i, 'Expected name-based lookup comments or code');
assert.match(deploySource, /ambiguous customer match/i, 'Expected ambiguous customer fallback handling');
assert.match(deploySource, /Create Products/, 'Expected product creation node');
assert.match(deploySource, /Create Prices/, 'Expected price creation node');
assert.match(deploySource, /Create Draft Invoice/, 'Expected draft invoice node');
assert.match(deploySource, /Attach Invoice Line Items/, 'Expected line item attachment node');
assert.match(deploySource, /Products are request-specific|request-specific/i, 'Expected dynamic product handling');
assert.doesNotMatch(deploySource, /finalize the invoice/i, 'Should not auto-finalize in v1');
assert.match(deploySource, /Airwallex Customer ID/, 'Expected Airwallex customer ID mapping');
assert.match(deploySource, /Airwallex Invoice ID/, 'Expected Airwallex invoice ID mapping');
assert.match(deploySource, /Creation Status/, 'Expected creation status mapping');
assert.match(deploySource, /Slack Modal/, 'Expected source mapping');
assert.match(
  deploySource,
  /Airwallex draft invoice was created/i,
  'Expected requester success confirmation text'
);
assert.match(deploySource, /failure_stage/, 'Expected failure_stage persistence');
assert.match(deploySource, /failure_reason/, 'Expected failure_reason persistence');
assert.match(deploySource, /Line Items Payload/, 'Expected line item payload persistence');
assert.match(
  deploySource,
  /manual Airwallex creation required/i,
  'Expected requester fallback text'
);
assert.match(deploySource, /DM John Failure Alert/, 'Expected John DM alert node');
assert.match(deploySource, /fallback_manual_required/, 'Expected fallback status value');
assert.match(readmeDoc, /Invoice Request Intake/, 'Expected workflow listed in README');
assert.match(readmeDoc, /Structured Slack modal/, 'Expected Slack modal intake documented in README');
assert.match(readmeDoc, /draft invoice created/i, 'Expected draft-only behavior documented in README');
assert.match(workflowsDoc, /Invoice Request Intake/, 'Expected Invoice Request Intake in WORKFLOWS.md');
assert.match(workflowsDoc, /krave-invoice-request-intake/, 'Expected manual webhook documented');
assert.match(workflowsDoc, /fallback_manual_required/, 'Expected fallback status documented in WORKFLOWS.md');
assert.match(workflowsDoc, /John DM/i, 'Expected John DM testing alert documented in WORKFLOWS.md');
assert.match(
  deploySource,
  /https\.request\s*\(\s*options\s*,/,
  'Expected deploy script to create workflow via https.request'
);
assert.match(
  deploySource,
  /path:\s*url\.pathname/,
  'Expected deploy script to POST to /api/v1/workflows using parsed URL pathname'
);
assert.match(
  deploySource,
  /console\.log\('SUCCESS'\)/,
  'Expected deploy script success logging'
);
assert.match(
  deploySource,
  /Workflow ID:/,
  'Expected deploy script to print workflow id details on success'
);
assert.match(
  deploySource,
  /'Normalize Slack Submission':\s*{[\s\S]*node:\s+'Airwallex Auth'/,
  'Expected normalization to auth connection'
);
assert.match(
  deploySource,
  /'Airwallex Auth':\s*{[\s\S]*node:\s+'Find Billing Customer'/,
  'Expected auth to customer lookup connection'
);
assert.match(
  deploySource,
  /'Create Billing Customer':\s*{[\s\S]*node:\s+'Create Products'/,
  'Expected customer creation to product creation connection'
);
assert.match(
  deploySource,
  /'Create Draft Invoice':\s*{[\s\S]*node:\s+'Attach Invoice Line Items'/,
  'Expected draft invoice to line item attachment connection'
);
assert.match(
  deploySource,
  /'Route Validation Outcome'/,
  'Expected runtime validation decision node'
);
assert.match(
  deploySource,
  /'Normalize Slack Submission':\s*{[\s\S]*node:\s+'Route Validation Outcome'/,
  'Expected validation results to route through validation decision node'
);
assert.match(
  deploySource,
  /'Route Validation Outcome':\s*{[\s\S]*node:\s+'Write Tracker Fallback'/,
  'Expected validation decision node to reach Write Tracker Fallback'
);
assert.match(
  deploySource,
  /'Route Validation Outcome':\s*{[\s\S]*node:\s+'Airwallex Auth'/,
  'Expected validation success to continue to Airwallex auth'
);
assert.match(
  deploySource,
  /'Route Fallback Outcome'/,
  'Expected runtime fallback decision node'
);
assert.match(
  deploySource,
  /'Route Fallback Outcome':\s*{[\s\S]*node:\s+'DM John Failure Alert'/,
  'Expected fallback decision node to reach DM John Failure Alert'
);
assert.match(
  deploySource,
  /'Route Fallback Outcome':\s*{[\s\S]*node:\s+'Write Tracker Success'/,
  'Expected success path to continue through fallback decision node before tracker success'
);
assert.match(
  deploySource,
  /billing_customers\/create/,
  'Expected billing customer creation path aligned with billing customer docs'
);
assert.match(
  deploySource,
  /api\/v1\/products\/create/,
  'Expected product creation path aligned with product docs'
);
assert.match(
  deploySource,
  /api\/v1\/prices\/create/,
  'Expected price creation path aligned with price docs'
);
assert.match(
  deploySource,
  /api\/v1\/invoices\/create/,
  'Expected invoice creation path aligned with invoice docs'
);
assert.match(
  deploySource,
  /billing_customer_id/,
  'Expected invoice payload to use billing_customer_id'
);
assert.match(
  deploySource,
  /api\/v1\/invoices\/"\s*\+\s*\$json\.airwallex_invoice_id\s*\+\s*"\/add_line_items/,
  'Expected invoice line item endpoint naming aligned with docs'
);

console.log('Invoice request intake workflow contract check passed.');
