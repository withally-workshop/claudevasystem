const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD'; // Krave Slack Bot
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_DOMAIN = 'homewithhalo.myshopify.com';

// After first deploy, set this to update in place
const WORKFLOW_ID = process.env.HALO_HOME_INVENTORY_ALERT_WORKFLOW_ID || null;

// Get channel ID: right-click #halo-home in Slack → Copy link → extract C0XXXXXXXX
const HALO_HOME_CHANNEL_ID = process.env.HALO_HOME_SLACK_CHANNEL_ID || '';

// Key-value store name used to persist OOS state across runs
const KV_STORE_KEY = 'halo_home_oos_state';

// Code node: fetch products + compare against saved OOS state
const CHECK_INVENTORY_CODE = `
const token = '${SHOPIFY_TOKEN.replace(/'/g, "\\'")}';
const domain = '${SHOPIFY_DOMAIN}';

// Fetch all products from Shopify
async function fetchProducts() {
  const url = \`https://\${domain}/admin/api/2024-10/products.json?limit=250&fields=id,title,status,variants\`;
  const res = await $helpers.httpRequest({
    method: 'GET',
    url,
    headers: { 'X-Shopify-Access-Token': token },
  });
  return res.products || [];
}

// Load previous OOS set from static data node (injected as input)
const prevOosRaw = $input.first()?.json?.oos_state || '{}';
let prevOos = {};
try { prevOos = JSON.parse(prevOosRaw); } catch {}

const products = await fetchProducts();

// Build current OOS map: variantId → { title, variantTitle }
const currentOos = {};
const newlyOos = [];   // products that just went OOS (not in prevOos)
const backInStock = []; // products that came back (in prevOos, not in current)

for (const product of products) {
  if (product.status !== 'active') continue;
  for (const v of product.variants || []) {
    const key = String(v.id);
    const label = v.title && v.title !== 'Default Title'
      ? \`\${product.title} — \${v.title}\`
      : product.title;
    if (v.inventory_management === 'shopify' && v.inventory_policy === 'deny' && v.inventory_quantity <= 0) {
      currentOos[key] = label;
      if (!prevOos[key]) newlyOos.push(label);
    } else {
      if (prevOos[key]) backInStock.push(prevOos[key]);
    }
  }
}

return [{
  json: {
    newly_oos: newlyOos,
    back_in_stock: backInStock,
    current_oos_state: JSON.stringify(currentOos),
    has_changes: newlyOos.length > 0 || backInStock.length > 0,
  }
}];
`.trim();

// Code node: build Slack message blocks
const BUILD_MESSAGE_CODE = `
const newlyOos = $json.newly_oos || [];
const backInStock = $json.back_in_stock || [];

const lines = [];

if (newlyOos.length > 0) {
  lines.push('*Out of Stock (new):*');
  for (const item of newlyOos) lines.push(\`  ⚠ \${item}\`);
}
if (backInStock.length > 0) {
  if (lines.length > 0) lines.push('');
  lines.push('*Back In Stock:*');
  for (const item of backInStock) lines.push(\`  ✓ \${item}\`);
}

const text = '*Halo Home — Inventory Update*\\n' + lines.join('\\n');
return [{ json: { text } }];
`.trim();

// Code node: save current OOS state to n8n static data (persistent between runs)
const SAVE_STATE_CODE = `
// Pass current OOS state forward for the static data node
return [{ json: { oos_state: $('Check Inventory').item.json.current_oos_state } }];
`.trim();

const workflow = {
  name: 'Halo Home - Inventory Alert',
  settings: {
    executionOrder: 'v1',
    saveManualExecutions: true,
    timezone: 'Asia/Manila',
  },
  nodes: [
    {
      id: 'n1',
      name: 'Schedule Trigger',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [240, 300],
      parameters: {
        rule: {
          interval: [{ field: 'cronExpression', expression: '0 0 * * *' }], // midnight UTC = 8 AM PHT
        },
      },
    },
    {
      id: 'n2',
      name: 'Load OOS State',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [460, 300],
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: `
// Load persisted OOS state from workflow static data
const workflowStaticData = $getWorkflowStaticData('global');
const oos_state = workflowStaticData.oos_state || '{}';
return [{ json: { oos_state } }];
`.trim(),
      },
    },
    {
      id: 'n3',
      name: 'Check Inventory',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [700, 300],
      onError: 'continueRegularOutput',
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: `
const token = process.env.SHOPIFY_ACCESS_TOKEN;
const domain = '${SHOPIFY_DOMAIN}';

async function fetchProducts() {
  const res = await $helpers.httpRequest({
    method: 'GET',
    url: \`https://\${domain}/admin/api/2024-10/products.json?limit=250&fields=id,title,status,variants\`,
    headers: { 'X-Shopify-Access-Token': token },
  });
  return res.products || [];
}

const prevOosRaw = $input.first()?.json?.oos_state || '{}';
let prevOos = {};
try { prevOos = JSON.parse(prevOosRaw); } catch {}

const products = await fetchProducts();

const currentOos = {};
const newlyOos = [];
const backInStock = [];

for (const product of products) {
  if (product.status !== 'active') continue;
  for (const v of product.variants || []) {
    const key = String(v.id);
    const label = v.title && v.title !== 'Default Title'
      ? \`\${product.title} — \${v.title}\`
      : product.title;
    if (v.inventory_management === 'shopify' && v.inventory_policy === 'deny' && (v.inventory_quantity == null || v.inventory_quantity <= 0)) {
      currentOos[key] = label;
      if (!prevOos[key]) newlyOos.push(label);
    } else {
      if (prevOos[key]) backInStock.push(prevOos[key]);
    }
  }
}

return [{
  json: {
    newly_oos: newlyOos,
    back_in_stock: backInStock,
    current_oos_state: JSON.stringify(currentOos),
    has_changes: newlyOos.length > 0 || backInStock.length > 0,
  }
}];
`.trim(),
      },
    },
    {
      id: 'n4',
      name: 'Has Changes?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2,
      position: [940, 300],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
          conditions: [
            {
              id: 'c1',
              leftValue: '={{ $json.has_changes }}',
              rightValue: true,
              operator: { type: 'boolean', operation: 'equals' },
            },
          ],
          combinator: 'and',
        },
      },
    },
    {
      id: 'n5',
      name: 'Build Message',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1160, 200],
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: `
const newlyOos = $json.newly_oos || [];
const backInStock = $json.back_in_stock || [];
const lines = [];
if (newlyOos.length > 0) {
  lines.push('*Out of Stock (new):*');
  for (const item of newlyOos) lines.push(\`  ⚠ \${item}\`);
}
if (backInStock.length > 0) {
  if (lines.length > 0) lines.push('');
  lines.push('*Back In Stock:*');
  for (const item of backInStock) lines.push(\`  ✓ \${item}\`);
}
const text = '*Halo Home — Inventory Update*\\n' + lines.join('\\n');
return [{ json: { text } }];
`.trim(),
      },
    },
    {
      id: 'n6',
      name: 'Post to Slack',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [1380, 200],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message',
        operation: 'post',
        select: 'channel',
        channelId: { __rl: true, value: HALO_HOME_CHANNEL_ID || 'REPLACE_WITH_HALO_HOME_CHANNEL_ID', mode: 'id' },
        text: '={{ $json.text }}',
        otherOptions: {},
      },
    },
    {
      id: 'n7',
      name: 'Save OOS State',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1380, 420],
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: `
// Persist the current OOS state for next run's comparison
const workflowStaticData = $getWorkflowStaticData('global');
workflowStaticData.oos_state = $('Check Inventory').item.json.current_oos_state;
return [{ json: { saved: true } }];
`.trim(),
      },
    },
  ],
  connections: {
    'Schedule Trigger': { main: [[{ node: 'Load OOS State', type: 'main', index: 0 }]] },
    'Load OOS State': { main: [[{ node: 'Check Inventory', type: 'main', index: 0 }]] },
    'Check Inventory': { main: [[{ node: 'Has Changes?', type: 'main', index: 0 }]] },
    'Has Changes?': {
      main: [
        [{ node: 'Build Message', type: 'main', index: 0 }], // true → alert
        [{ node: 'Save OOS State', type: 'main', index: 0 }], // false → just save
      ],
    },
    'Build Message': { main: [[{ node: 'Post to Slack', type: 'main', index: 0 }]] },
    'Post to Slack': { main: [[{ node: 'Save OOS State', type: 'main', index: 0 }]] },
  },
};

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
  if (!SHOPIFY_TOKEN) { console.error('ERROR: SHOPIFY_ACCESS_TOKEN not set'); process.exit(1); }
  if (!HALO_HOME_CHANNEL_ID) { console.warn('WARNING: HALO_HOME_SLACK_CHANNEL_ID not set — update Post to Slack node manually after deploy'); }

  let result;
  if (WORKFLOW_ID) {
    result = await n8nRequest('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, workflow);
  } else {
    result = await n8nRequest('POST', '/api/v1/workflows', workflow);
  }

  if (!result.id) {
    console.error('ERROR:', JSON.stringify(result, null, 2).substring(0, 2000));
    process.exit(1);
  }

  await n8nRequest('POST', `/api/v1/workflows/${result.id}/activate`);
  console.log('SUCCESS');
  console.log('Workflow ID:', result.id);
  console.log('URL: https://noatakhel.app.n8n.cloud/workflow/' + result.id);
  console.log('Schedule: daily at midnight UTC (8 AM PHT)');
  console.log('\nNote: First run will save baseline OOS state. Alerts only fire on *changes* from run to run.');
  console.log('\nSet env: HALO_HOME_INVENTORY_ALERT_WORKFLOW_ID=' + result.id);
}

if (require.main === module) {
  deploy().catch((e) => console.error('Deploy failed:', e.message));
}

module.exports = { workflow };
