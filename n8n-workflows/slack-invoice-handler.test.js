const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const deployPath = path.join(__dirname, 'deploy-slack-invoice-handler.js');
const workflowsDocPath = path.join(__dirname, 'WORKFLOWS.md');
const readmePath = path.join(__dirname, 'README.md');

assert.ok(fs.existsSync(deployPath), 'Expected deploy-slack-invoice-handler.js to exist');

const deploySource = fs.readFileSync(deployPath, 'utf8');
const workflowsDoc = fs.readFileSync(workflowsDocPath, 'utf8');
const readmeDoc = fs.readFileSync(readmePath, 'utf8');

assert.match(deploySource, /name:\s+'Krave .* Slack Invoice Handler'/, 'Expected workflow name in deploy script');
assert.match(deploySource, /path:\s+'slack-invoice-handler'/, 'Expected shared Slack handler webhook path');
assert.match(
  deploySource,
  /const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD'/,
  'Expected shared Slack credential id in deploy script'
);
assert.match(
  deploySource,
  /const PAYMENTS_UPDATES_CHANNEL = 'C09HN2EBPR7'/,
  'Expected payments channel id for submission receipts'
);
assert.match(
  deploySource,
  /const INTAKE_WEBHOOK_URL = 'https:\/\/noatakhel\.app\.n8n\.cloud\/webhook\/krave-invoice-request-intake'/,
  'Expected invoice intake webhook handoff target'
);
assert.match(
  deploySource,
  /responseMode:\s+'responseNode'/,
  'Expected Slack webhook to respond through explicit response nodes'
);
assert.match(deploySource, /views\.open/, 'Expected Slack modal open API call');
assert.match(deploySource, /invoice_request_modal/, 'Expected modal callback id');
assert.match(deploySource, /line_items_raw/, 'Expected line items modal field');
assert.match(deploySource, /submitted_by_slack_user_id/, 'Expected submitter field normalization');
assert.match(deploySource, /line_items/, 'Expected normalized line items payload');
assert.match(
  deploySource,
  /response_action:\s*'update'/,
  'Expected modal submit acknowledgement to update the view with a confirmation screen'
);
assert.match(
  deploySource,
  /white_check_mark|Submitted|Invoice request received/i,
  'Expected submitted confirmation copy in the modal response'
);
assert.match(
  deploySource,
  /name:\s+'Parse Slack Payload'[\s\S]*mode:\s+'runOnceForEachItem'/,
  'Expected parser to run once for each item'
);
assert.match(
  deploySource,
  /name:\s+'Normalize Modal Submission'[\s\S]*mode:\s+'runOnceForEachItem'/,
  'Expected modal normalizer to run once for each item'
);
assert.doesNotMatch(
  deploySource,
  /return\s+\[\{\s*json:\s*\{/,
  'Code nodes running once per item should return a single json object, not an array'
);
assert.match(
  deploySource,
  /Description \| Quantity \| Unit Price/,
  'Expected line item input format hint'
);
assert.match(deploySource, /'Webhook Trigger'/, 'Expected webhook trigger node');
assert.match(deploySource, /'Parse Slack Payload'/, 'Expected payload parser node');
assert.match(deploySource, /'Route Slack Event'/, 'Expected slash vs interaction decision node');
assert.match(deploySource, /'Open Invoice Modal'/, 'Expected modal opener node');
assert.match(deploySource, /'Route Interaction Type'/, 'Expected interaction-type decision node');
assert.match(deploySource, /'Normalize Modal Submission'/, 'Expected modal normalization node');
assert.match(deploySource, /'Send To Invoice Intake'/, 'Expected handoff node to invoice intake workflow');
assert.match(deploySource, /'Post Channel Receipt'/, 'Expected Slack channel receipt node');
assert.match(deploySource, /'Acknowledge Slash Command'/, 'Expected explicit slash-command response node');
assert.match(deploySource, /'Acknowledge Modal Submission'/, 'Expected explicit modal-submit response node');
assert.match(
  deploySource,
  /'Webhook Trigger':\s*{[\s\S]*node:\s+'Parse Slack Payload'/,
  'Expected webhook to parser wiring'
);
assert.match(
  deploySource,
  /'Parse Slack Payload':\s*{[\s\S]*node:\s+'Route Slack Event'/,
  'Expected parser to route slack event decision node'
);
assert.match(
  deploySource,
  /'Route Slack Event':\s*{[\s\S]*node:\s+'Open Invoice Modal'/,
  'Expected slash command branch to open modal'
);
assert.match(
  deploySource,
  /'Open Invoice Modal':\s*{[\s\S]*node:\s+'Acknowledge Slash Command'/,
  'Expected slash command branch to acknowledge Slack after opening the modal'
);
assert.match(
  deploySource,
  /'Route Slack Event':\s*{[\s\S]*node:\s+'Route Interaction Type'/,
  'Expected interaction branch to route interaction type'
);
assert.match(
  deploySource,
  /'Route Interaction Type':\s*{[\s\S]*node:\s+'Normalize Modal Submission'/,
  'Expected modal submission branch to normalize payload'
);
assert.match(
  deploySource,
  /'Normalize Modal Submission':\s*{[\s\S]*node:\s+'Send To Invoice Intake'/,
  'Expected normalized submission to forward to invoice intake'
);
assert.match(
  deploySource,
  /'Normalize Modal Submission':\s*{[\s\S]*node:\s+'Post Channel Receipt'/,
  'Expected normalized submission to post a channel receipt'
);
assert.match(
  deploySource,
  /'Normalize Modal Submission':\s*{[\s\S]*node:\s+'Acknowledge Modal Submission'/,
  'Expected modal submit branch to acknowledge Slack immediately with a confirmation view'
);

assert.match(readmeDoc, /Slack Invoice Handler/, 'Expected handler workflow listed in README');
assert.match(
  readmeDoc,
  /same Request URL.*Slash Commands.*Interactivity/i,
  'Expected README to explain using the same request URL for Slack app setup'
);
assert.match(
  readmeDoc,
  /posts a structured receipt to `#payments-invoices-updates`/i,
  'Expected README to document the channel receipt behavior'
);
assert.match(workflowsDoc, /Slack Invoice Handler/, 'Expected handler workflow listed in WORKFLOWS.md');
assert.match(workflowsDoc, /slack-invoice-handler/, 'Expected shared Slack handler webhook documented');
assert.match(
  workflowsDoc,
  /views\.open|open the modal/i,
  'Expected Slack modal opening documented in WORKFLOWS.md'
);
assert.match(
  workflowsDoc,
  /payments-invoices-updates|channel receipt/i,
  'Expected WORKFLOWS.md to document the channel receipt behavior'
);
assert.match(
  workflowsDoc,
  /krave-invoice-request-intake/,
  'Expected downstream invoice intake handoff documented'
);

console.log('Slack invoice handler workflow contract check passed.');
