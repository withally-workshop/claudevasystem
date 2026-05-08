// patch-payment-detection-clickup.js
//
// Surgical patch: adds ClickUp "payment complete" status update to the live
// Payment Detection workflow (NurOLZkg3J6rur5Q) without touching any of the
// hardened logic (idempotency, strict matching, PDF extraction, etc.).
//
// What this patch adds (after Update Invoice Status and Update Osome Invoice Status):
//   1. "Get ClickUp Task ID" (Code) — looks up ClickUp Task ID from tracker rows
//   2. "Has ClickUp Task? (Payment)" (IF) — gates on whether the ID is present
//   3. "ClickUp Set Payment Complete" (HTTP Request) — PATCHes task status
//
// Safe to re-run: GET → patch in memory → PUT. If nodes already exist (by name),
// the script skips adding duplicates.
//
// PREREQUISITE: "ClickUp Task ID" column header must exist in the Invoices sheet.
// Set CLICKUP_API_KEY env var before running.

const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = 'NurOLZkg3J6rur5Q';
const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;

// Code node: reads ClickUp Task ID from the tracker rows already in memory.
// Runs after Update Invoice Status / Update Osome Invoice Status.
const GET_CLICKUP_TASK_ID_CODE = `
const invoiceNumber = ($('Match Deposits To Invoices').item.json.invoiceNumber || '').toString().trim().toUpperCase();
const allRows = $('Get Invoice Tracker').all();
const matchedRow = allRows.find(r =>
  (r.json['Invoice #'] || '').toString().trim().toUpperCase() === invoiceNumber
);
const clickupTaskId = matchedRow
  ? (matchedRow.json['Clickup Task ID'] || '').toString().trim()
  : '';
return [{ json: { ...$input.first().json, clickupTaskId } }];
`.trim();

function n8nRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const u = new URL(N8N_URL + path);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        'X-N8N-API-KEY': API_KEY,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function patch() {
  if (!CLICKUP_API_KEY) {
    console.error('ERROR: CLICKUP_API_KEY env var not set.');
    process.exit(1);
  }

  console.log('Fetching live workflow...');
  const wf = await n8nRequest('GET', `/api/v1/workflows/${WORKFLOW_ID}`);
  if (!wf.id) {
    console.error('ERROR: Could not fetch workflow:', JSON.stringify(wf).substring(0, 500));
    process.exit(1);
  }

  const nodes = wf.nodes || [];
  const connections = wf.connections || {};

  // Guard: skip if already patched
  if (nodes.some(n => n.name === 'Get ClickUp Task ID')) {
    console.log('Patch already applied (Get ClickUp Task ID node found). Nothing to do.');
    return;
  }

  // Find the two full-payment nodes we insert after
  const updateInvoiceNode = nodes.find(n => n.name === 'Update Invoice Status');
  const updateOsomeNode   = nodes.find(n => n.name === 'Update Osome Invoice Status');

  if (!updateInvoiceNode || !updateOsomeNode) {
    console.error('ERROR: Could not find Update Invoice Status or Update Osome Invoice Status nodes.');
    console.log('Node names in workflow:', nodes.map(n => n.name));
    process.exit(1);
  }

  // Position new nodes below Update Invoice Status
  const baseX = updateInvoiceNode.position[0];
  const baseY = updateInvoiceNode.position[1] + 200;

  // Three new nodes — shared across both full-payment paths (non-Osome and Osome)
  const newNodes = [
    {
      id: 'cu1', name: 'Get ClickUp Task ID',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [baseX, baseY],
      parameters: { mode: 'runOnceForAllItems', jsCode: GET_CLICKUP_TASK_ID_CODE },
    },
    {
      id: 'cu2', name: 'Has ClickUp Task? (Payment)',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [baseX + 220, baseY],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [{ id: 'c1', leftValue: '={{ !!$json.clickupTaskId }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
          combinator: 'and',
        },
        options: {},
      },
    },
    {
      id: 'cu3', name: 'ClickUp Set Payment Complete',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [baseX + 440, baseY],
      continueOnFail: true,
      parameters: {
        method: 'PUT',
        url: "={{ 'https://api.clickup.com/api/v2/task/' + $json.clickupTaskId }}",
        authentication: 'none', sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'Authorization', value: CLICKUP_API_KEY },
          { name: 'Content-Type', value: 'application/json' },
        ]},
        sendBody: true, specifyBody: 'json',
        jsonBody: '={{ ({ status: "payment complete" }) }}',
        options: {},
      },
    },
  ];

  nodes.push(...newNodes);

  // Wire: both Update Invoice Status AND Update Osome Invoice Status feed Get ClickUp Task ID
  // (they run on the same invoice data; a single ClickUp update handles both paths)
  const addConnection = (fromName, toName, outputIndex = 0) => {
    if (!connections[fromName]) connections[fromName] = { main: [] };
    while (connections[fromName].main.length <= outputIndex) connections[fromName].main.push([]);
    connections[fromName].main[outputIndex].push({ node: toName, type: 'main', index: 0 });
  };

  addConnection('Update Invoice Status',      'Get ClickUp Task ID');
  addConnection('Update Osome Invoice Status', 'Get ClickUp Task ID');
  addConnection('Get ClickUp Task ID',         'Has ClickUp Task? (Payment)');
  // Has ClickUp Task? true branch → ClickUp Set Payment Complete; false → dead end
  if (!connections['Has ClickUp Task? (Payment)']) {
    connections['Has ClickUp Task? (Payment)'] = { main: [
      [{ node: 'ClickUp Set Payment Complete', type: 'main', index: 0 }],
      [],
    ]};
  }

  // PUT the patched workflow back — only send fields the API accepts
  const updated = await n8nRequest('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, {
    name: wf.name,
    nodes,
    connections,
    settings: {
      ...(wf.settings?.timezone ? { timezone: wf.settings.timezone } : {}),
      ...(wf.settings?.executionOrder ? { executionOrder: wf.settings.executionOrder } : {}),
      ...(wf.settings?.saveManualExecutions !== undefined ? { saveManualExecutions: wf.settings.saveManualExecutions } : {}),
      ...(wf.settings?.callerPolicy ? { callerPolicy: wf.settings.callerPolicy } : {}),
    },
    staticData: wf.staticData || null,
  });

  if (!updated.id) {
    console.error('ERROR during PUT:', JSON.stringify(updated, null, 2).substring(0, 2000));
    process.exit(1);
  }

  console.log('SUCCESS — patch applied.');
  console.log('Workflow ID:', updated.id);
  console.log('URL: https://noatakhel.app.n8n.cloud/workflow/' + updated.id);
  console.log('');
  console.log('New nodes added:');
  console.log('  - Get ClickUp Task ID');
  console.log('  - Has ClickUp Task? (Payment)');
  console.log('  - ClickUp Set Payment Complete');
  console.log('');
  console.log('Verify in n8n: Update Invoice Status and Update Osome Invoice Status');
  console.log('should both have a downstream connection to Get ClickUp Task ID.');
}

patch().catch(console.error);
