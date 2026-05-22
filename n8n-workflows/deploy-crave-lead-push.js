const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;

// Baked in at deploy time — n8n Starter has no runtime env vars. Redeploy to rotate.
const SMARTLEAD_API_KEY = process.env.SMARTLEAD_API_KEY;

if (!SMARTLEAD_API_KEY) throw new Error('SMARTLEAD_API_KEY not set in local .env');

const SHEETS_CRED_ID = '83MQOm78gYDvziTO';
const SHEET_ID = '1eLQrDP3IX9ec9dtFN0UyRdlTplzkLfRG9Asyqj1gLrI';
const SMARTLEAD_CAMPAIGN_ID = '3375376';
const SMARTLEAD_PUSH_URL = `https://server.smartlead.ai/api/v1/campaigns/${SMARTLEAD_CAMPAIGN_ID}/leads`;

const WORKFLOW_ID = 'ke52OLrSUXk8mPVw';

// ─── Code: Filter approved leads + build Smartlead payload ────────────────────
const FILTER_AND_BUILD_CODE = `
const rows = $input.all();
const leads = [];
const rowNumbers = [];

for (const item of rows) {
  const d = item.json;
  const status = (d.status || '').trim();
  const email = (d.email || '').trim();
  const outreachSentAt = (d.outreach_sent_at || '').trim();

  if (status === 'approved' && email && !outreachSentAt) {
    leads.push({
      email,
      first_name: (d.first_name || '').trim() || (d.handle || '').replace('@', ''),
      last_name: '',
      custom_fields: {
        handle: (d.handle || '').trim(),
        niche: (d.niche || '').trim(),
        followers: String(d.followers || ''),
      },
    });
    rowNumbers.push(d.row_number);
  }
}

if (leads.length === 0) return [];

return [{ json: { leads, rowNumbers, count: leads.length, pushedAt: new Date().toISOString() } }];
`;

// ─── Code: Expand row numbers back into per-row update items ─────────────────
const EXPAND_UPDATES_CODE = `
const filterResult = $('Filter and Build').first().json;
const { rowNumbers, pushedAt } = filterResult;

return rowNumbers.map(rowNumber => ({
  json: { row_number: rowNumber, status: 'outreach_queued', outreach_sent_at: pushedAt },
}));
`;

// ─── Workflow definition ──────────────────────────────────────────────────────
const workflow = {
  name: 'Crave - Daily Lead Push',
  settings: {
    timezone: 'Asia/Manila',
    executionOrder: 'v1',
  },
  nodes: [
    {
      id: 'n1',
      name: 'Schedule Trigger',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [0, 0],
      parameters: {
        rule: {
          interval: [{ field: 'cronExpression', expression: '0 9 * * *' }],
        },
      },
    },
    {
      id: 'n2',
      name: 'Get Sheet Rows',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [220, 0],
      credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet',
        operation: 'getRows',
        documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
        sheetName: { __rl: true, value: 0, mode: 'list', cachedResultName: 'Sheet1' },
        options: {},
      },
    },
    {
      id: 'n3',
      name: 'Filter and Build',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [440, 0],
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: FILTER_AND_BUILD_CODE,
      },
    },
    {
      id: 'n4',
      name: 'Push to Smartlead',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [660, 0],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: SMARTLEAD_PUSH_URL,
        sendQuery: true,
        queryParameters: {
          parameters: [{ name: 'api_key', value: SMARTLEAD_API_KEY }],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ lead_list: $json.leads, settings: { ignore_global_block_list: false, ignore_unsubscribe_list: true, ignore_community_bounce_list: false } }) }}`,
        options: {},
      },
    },
    {
      id: 'n5',
      name: 'Expand Row Updates',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [880, 0],
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: EXPAND_UPDATES_CODE,
      },
    },
    {
      id: 'n6',
      name: 'Mark Outreach Queued',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [1100, 0],
      credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet',
        operation: 'update',
        documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
        sheetName: { __rl: true, value: 0, mode: 'list', cachedResultName: 'Sheet1' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            row_number: '={{ $json.row_number }}',
            status: '={{ $json.status }}',
            outreach_sent_at: '={{ $json.outreach_sent_at }}',
          },
          matchingColumns: ['row_number'],
          schema: [
            { id: 'row_number', displayName: 'row_number', required: false, defaultMatch: true, display: true, type: 'string', canBeUsedToMatch: true },
            { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
            { id: 'outreach_sent_at', displayName: 'outreach_sent_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          ],
        },
        options: {},
      },
    },
  ],
  connections: {
    'Schedule Trigger':  { main: [[{ node: 'Get Sheet Rows',       type: 'main', index: 0 }]] },
    'Get Sheet Rows':    { main: [[{ node: 'Filter and Build',      type: 'main', index: 0 }]] },
    'Filter and Build':  { main: [[{ node: 'Push to Smartlead',     type: 'main', index: 0 }]] },
    'Push to Smartlead': { main: [[{ node: 'Expand Row Updates',    type: 'main', index: 0 }]] },
    'Expand Row Updates':{ main: [[{ node: 'Mark Outreach Queued',  type: 'main', index: 0 }]] },
  },
};

// ─── Deploy ───────────────────────────────────────────────────────────────────
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

async function deploy() {
  if (!API_KEY) {
    console.error('N8N_API_KEY env var is required');
    process.exit(1);
  }

  let result;
  if (WORKFLOW_ID) {
    console.log('Updating existing workflow:', WORKFLOW_ID);
    result = await n8nRequest('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, workflow);
  } else {
    console.log('Creating new workflow...');
    result = await n8nRequest('POST', '/api/v1/workflows', workflow);
  }

  if (!result.id) {
    console.error('ERROR:', JSON.stringify(result, null, 2).substring(0, 1000));
    return;
  }

  console.log('SUCCESS');
  console.log('Workflow ID:', result.id);
  console.log('URL: https://noatakhel.app.n8n.cloud/workflow/' + result.id);
  console.log('');
  console.log('NOTE: Workflow is created INACTIVE — do not activate until warm-up completes (~2026-06-12).');
  console.log('After first deploy, set WORKFLOW_ID =', `'${result.id}'`, 'in this script for future redeploys.');
  console.log('');
  console.log('To activate when ready:');
  console.log('  node n8n-workflows/deploy-crave-lead-push.js  (then activate in n8n UI)');
}

if (require.main === module) {
  deploy().catch((e) => console.error('Deploy failed:', e.message));
}
