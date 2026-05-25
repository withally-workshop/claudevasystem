const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;

// Baked in at deploy time — n8n Starter has no runtime env vars. Redeploy to rotate.
const SMARTLEAD_API_KEY = process.env.SMARTLEAD_API_KEY;

if (!SMARTLEAD_API_KEY) throw new Error('SMARTLEAD_API_KEY not set in local .env');

const SHEETS_CRED_ID = '83MQOm78gYDvziTO';
const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD';
const SHEET_ID = '1eLQrDP3IX9ec9dtFN0UyRdlTplzkLfRG9Asyqj1gLrI';
const SLACK_CHANNEL = 'C0B5MQF50RX'; // #krave-creator-outreach
const SMARTLEAD_CAMPAIGN_ID = '3375376';
const SMARTLEAD_LEADS_URL = `https://server.smartlead.ai/api/v1/campaigns/${SMARTLEAD_CAMPAIGN_ID}/leads?limit=500&api_key=${SMARTLEAD_API_KEY}`;

const WORKFLOW_ID = 'uUGxA3GW1W0vq6el';

// ─── Code: Aggregate Smartlead statuses into a single lookup map ──────────────
// Runs after GET Smartlead leads (which returns array → N items, one per lead).
// Collapses N items into 1 item: { statusMap: { email: lead_status, ... } }
const AGGREGATE_STATUSES_CODE = `
const leads = $input.all();
const statusMap = {};

for (const item of leads) {
  const lead = item.json;
  const email = (lead.email || '').toLowerCase().trim();
  if (email && lead.lead_status) {
    statusMap[email] = (lead.lead_status || '').toUpperCase();
  }
}

return [{ json: { statusMap } }];
`;

// ─── Code: Join Sheet rows with Smartlead statuses, emit update items ─────────
// Runs after Get Sheet Rows. References Aggregate Statuses node for the map.
const BUILD_UPDATES_CODE = `
const sheetRows = $input.all();
const statusMap = $('Aggregate Statuses').first().json.statusMap;
const TERMINAL = new Set(['replied', 'bounced']);
const now = new Date().toISOString();
const updates = [];

for (const item of sheetRows) {
  const d = item.json;
  const email = (d.email || '').toLowerCase().trim();
  if (!email) continue;

  const slStatus = statusMap[email];
  if (!slStatus) continue;

  const currentStatus = (d.status || '').trim();
  if (TERMINAL.has(currentStatus)) continue;

  const rowNum = d.row_number;

  if (slStatus === 'REPLIED') {
    updates.push({ row_number: rowNum, status: 'replied', replied_at: now, bounced: '', opened_at: '' });
  } else if (slStatus === 'BOUNCED' || slStatus === 'HARD_BOUNCED') {
    updates.push({ row_number: rowNum, status: 'bounced', bounced: 'TRUE', replied_at: '', opened_at: '' });
  } else if ((slStatus === 'OPENED' || slStatus === 'CLICKED') && currentStatus !== 'replied') {
    if (!(d.opened_at || '').trim()) {
      updates.push({ row_number: rowNum, status: 'opened', opened_at: now, replied_at: '', bounced: '' });
    }
  }
}

if (updates.length === 0) return [];
return updates.map(u => ({ json: u }));
`;

// ─── Code: Collapse per-row updates into a single summary item ───────────────
const SUMMARIZE_SYNC_CODE = `
const items = $input.all();
const replied  = items.filter(i => i.json.status === 'replied').length;
const bounced  = items.filter(i => i.json.status === 'bounced').length;
const opened   = items.filter(i => i.json.status === 'opened').length;
const total    = items.length;
return [{ json: { total, replied, bounced, opened } }];
`;

// ─── Workflow definition ──────────────────────────────────────────────────────
const workflow = {
  name: 'Crave - Status Sync',
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
      name: 'Get Smartlead Leads',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [220, 0],
      continueOnFail: true,
      parameters: {
        method: 'GET',
        url: SMARTLEAD_LEADS_URL,
        options: {},
      },
    },
    {
      id: 'n3',
      name: 'Aggregate Statuses',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [440, 0],
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: AGGREGATE_STATUSES_CODE,
      },
    },
    {
      id: 'n4',
      name: 'Get Sheet Rows',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [660, 0],
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
      id: 'n5',
      name: 'Build Updates',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [880, 0],
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: BUILD_UPDATES_CODE,
      },
    },
    {
      id: 'n6',
      name: 'Update Sheet Row',
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
            row_number:  '={{ $json.row_number }}',
            status:      '={{ $json.status }}',
            replied_at:  '={{ $json.replied_at }}',
            bounced:     '={{ $json.bounced }}',
            opened_at:   '={{ $json.opened_at }}',
          },
          matchingColumns: ['row_number'],
          schema: [
            { id: 'row_number', displayName: 'row_number', required: false, defaultMatch: true,  display: true, type: 'string', canBeUsedToMatch: true  },
            { id: 'status',     displayName: 'status',     required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
            { id: 'replied_at', displayName: 'replied_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
            { id: 'bounced',    displayName: 'bounced',    required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
            { id: 'opened_at',  displayName: 'opened_at',  required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          ],
        },
        options: {},
      },
    },
    {
      id: 'n7',
      name: 'Summarize Sync',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1320, 0],
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: SUMMARIZE_SYNC_CODE,
      },
    },
    {
      id: 'n8',
      name: 'Notify Slack',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.2,
      position: [1540, 0],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message',
        operation: 'post',
        channel: SLACK_CHANNEL,
        text: `=*Status sync complete* — {{ $json.total }} rows updated in <https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit|Sheet>\n• Replied: {{ $json.replied }}  |  Opened: {{ $json.opened }}  |  Bounced: {{ $json.bounced }}`,
        otherOptions: {},
      },
    },
  ],
  connections: {
    'Schedule Trigger':   { main: [[{ node: 'Get Smartlead Leads', type: 'main', index: 0 }]] },
    'Get Smartlead Leads':{ main: [[{ node: 'Aggregate Statuses',  type: 'main', index: 0 }]] },
    'Aggregate Statuses': { main: [[{ node: 'Get Sheet Rows',      type: 'main', index: 0 }]] },
    'Get Sheet Rows':     { main: [[{ node: 'Build Updates',       type: 'main', index: 0 }]] },
    'Build Updates':      { main: [[{ node: 'Update Sheet Row',    type: 'main', index: 0 }]] },
    'Update Sheet Row':   { main: [[{ node: 'Summarize Sync',      type: 'main', index: 0 }]] },
    'Summarize Sync':     { main: [[{ node: 'Notify Slack',        type: 'main', index: 0 }]] },
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
}

if (require.main === module) {
  deploy().catch((e) => console.error('Deploy failed:', e.message));
}
