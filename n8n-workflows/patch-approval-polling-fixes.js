// patch-approval-polling-fixes.js
//
// Fixes two issues in Invoice Approval Polling (uCS9lzHtVKWlqYlk):
//
// 1. Airwallex Auth headers had empty values (credentials wiped during redeploy
//    because AIRWALLEX_CLIENT_ID / AIRWALLEX_API_KEY env vars were not set).
//    Restores x-client-id and x-api-key from env.
//
// 2. Parse ClickUp Task ID reads from $input (Update Tracker output) which strips
//    approve_reply_text. Fixed to read from $('Find Approve Reply').item.json.
//
// Safe to re-run.

const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = 'uCS9lzHtVKWlqYlk';
const AW_CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID;
const AW_API_KEY = process.env.AIRWALLEX_API_KEY;
const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;

const NEW_PARSE_CLICKUP_CODE = `
const approveRow = $('Find Approve Reply').item.json;
const text = approveRow.approve_reply_text || '';
const m = text.match(/app\\.clickup\\.com\\/t\\/([a-z0-9]+)/i);
const clickupTaskId = m ? m[1] : null;
const dueDateStr = ($input.first().json['Due Date'] || approveRow['Due Date'] || '');
let dueDateMs = null;
if (dueDateStr) {
  const d = new Date(dueDateStr);
  if (!isNaN(d.getTime())) dueDateMs = d.getTime();
}
return [{ json: { ...$input.first().json, clickupTaskId, dueDateMs } }];
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
  if (!AW_CLIENT_ID || !AW_API_KEY) {
    console.error('ERROR: AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY must be set.');
    process.exit(1);
  }

  console.log('Fetching live workflow...');
  const wf = await n8nRequest('GET', `/api/v1/workflows/${WORKFLOW_ID}`);
  if (!wf.id) {
    console.error('ERROR: Could not fetch workflow:', JSON.stringify(wf).substring(0, 500));
    process.exit(1);
  }

  const nodes = wf.nodes || [];

  // Fix 1: Restore Airwallex Auth headers
  const authNode = nodes.find(n => n.name === 'Airwallex Auth');
  if (!authNode) { console.error('ERROR: Airwallex Auth node not found.'); process.exit(1); }

  authNode.parameters.headerParameters = {
    parameters: [
      { name: 'x-client-id', value: AW_CLIENT_ID },
      { name: 'x-api-key', value: AW_API_KEY },
    ]
  };
  console.log('Fix 1: Airwallex Auth headers restored.');

  // Fix 2: Parse ClickUp Task ID — read from Find Approve Reply
  const parseNode = nodes.find(n => n.name === 'Parse ClickUp Task ID');
  if (!parseNode) { console.error('ERROR: Parse ClickUp Task ID node not found.'); process.exit(1); }

  parseNode.parameters.jsCode = NEW_PARSE_CLICKUP_CODE;
  console.log('Fix 2: Parse ClickUp Task ID updated to read from Find Approve Reply.');

  // Fix 3: Restore ClickUp HTTP node Authorization headers (also wiped in redeploy)
  const clickupNodes = ['ClickUp Set Collections', 'ClickUp Set Invoice Sent Date', 'ClickUp Set Invoice Due Date'];
  for (const nodeName of clickupNodes) {
    const node = nodes.find(n => n.name === nodeName);
    if (node && node.parameters.headerParameters) {
      const authHeader = node.parameters.headerParameters.parameters?.find(p => p.name === 'Authorization');
      if (authHeader && !authHeader.value) {
        authHeader.value = CLICKUP_API_KEY;
        console.log(`Fix 3: ${nodeName} Authorization header restored.`);
      }
    }
  }

  const updated = await n8nRequest('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, {
    name: wf.name,
    nodes,
    connections: wf.connections || {},
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

  console.log('SUCCESS — all fixes applied.');
  console.log('URL: https://noatakhel.app.n8n.cloud/workflow/' + updated.id);
}

patch().catch(console.error);
