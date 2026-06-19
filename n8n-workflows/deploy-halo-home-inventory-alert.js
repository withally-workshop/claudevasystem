const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const HALO_BOT_TOKEN = process.env.HALO_HOME_BOT_TOKEN;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_DOMAIN = 'homewithhalo.myshopify.com';

const WORKFLOW_ID = process.env.HALO_HOME_INVENTORY_ALERT_WORKFLOW_ID || 'NBvfYPmjdTXzrKfb';
const HALO_HOME_CHANNEL_ID = process.env.HALO_HOME_SLACK_CHANNEL_ID || '';

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN RULE: Code nodes = data transformation only. HTTP calls = HTTP Request nodes.
// n8n sandboxes Code nodes — $helpers.httpRequest is not available.
// ─────────────────────────────────────────────────────────────────────────────

// n2: Load persisted OOS state from workflow static data
const LOAD_OOS_STATE_CODE = `
const workflowStaticData = $getWorkflowStaticData('global');
const oos_state = workflowStaticData.oos_state || '{}';
return [{ json: { oos_state } }];
`.trim();

const LOW_STOCK_THRESHOLD = 10;

// n4: Compare fetched products against saved state. Identifies new OOS, back-in-stock, and low-stock.
// $json = Shopify products response. $('Load OOS State').item.json = previous state.
const CHECK_INVENTORY_CODE = `
const LOW_STOCK_THRESHOLD = ${LOW_STOCK_THRESHOLD};
const products = ($json.products || []);
const prevStateRaw = $('Load OOS State').item.json.oos_state || '{}';
let prevState = {};
try { prevState = JSON.parse(prevStateRaw); } catch {}

const currentOos = {};
const currentLowStock = {};
const newlyOos = [];
const backInStock = [];
const newlyLowStock = [];
const backAboveThreshold = [];

for (const product of products) {
  if (product.status !== 'active') continue;
  for (const v of product.variants || []) {
    const key = String(v.id);
    const label = (v.title && v.title !== 'Default Title')
      ? product.title + ' — ' + v.title
      : product.title;
    const qty = v.inventory_quantity;
    const isOos = v.inventory_management === 'shopify' && v.inventory_policy === 'deny' && (qty == null || qty <= 0);
    const isLow = v.inventory_management === 'shopify' && !isOos && qty != null && qty < LOW_STOCK_THRESHOLD;

    if (isOos) {
      currentOos[key] = label;
      if (!prevState['oos_' + key]) newlyOos.push(label);
    } else {
      if (prevState['oos_' + key]) backInStock.push(label);
    }

    if (isLow) {
      currentLowStock[key] = label + ' (' + qty + ' units)';
      if (!prevState['low_' + key]) newlyLowStock.push(label + ' — ' + qty + ' units left');
    } else {
      // Only "restocked above threshold" if it went UP. A LOW->OOS drop also exits the
      // low bucket but must NOT be reported as restocked (it's covered by newlyOos).
      if (prevState['low_' + key] && !isOos) backAboveThreshold.push(label);
    }
  }
}

// Build state snapshot for next run
const nextState = {};
for (const k of Object.keys(currentOos)) nextState['oos_' + k] = currentOos[k];
for (const k of Object.keys(currentLowStock)) nextState['low_' + k] = currentLowStock[k];

return [{ json: {
  newly_oos: newlyOos,
  back_in_stock: backInStock,
  newly_low_stock: newlyLowStock,
  back_above_threshold: backAboveThreshold,
  current_oos_state: JSON.stringify(nextState),
  has_changes: newlyOos.length > 0 || backInStock.length > 0 || newlyLowStock.length > 0 || backAboveThreshold.length > 0,
} }];
`.trim();

// n6: Build Slack message from inventory changes (OOS, back-in-stock, low-stock)
const BUILD_MESSAGE_CODE = `
const newlyOos = $json.newly_oos || [];
const backInStock = $json.back_in_stock || [];
const newlyLow = $json.newly_low_stock || [];
const backAbove = $json.back_above_threshold || [];
const lines = [];
if (newlyOos.length > 0) {
  lines.push('*Out of Stock (new):*');
  for (const item of newlyOos) lines.push('  ✗ ' + item);
}
if (backInStock.length > 0) {
  if (lines.length > 0) lines.push('');
  lines.push('*Back In Stock:*');
  for (const item of backInStock) lines.push('  ✓ ' + item);
}
if (newlyLow.length > 0) {
  if (lines.length > 0) lines.push('');
  lines.push('*Low Stock — Reorder Soon:*');
  for (const item of newlyLow) lines.push('  ⚠ ' + item);
}
if (backAbove.length > 0) {
  if (lines.length > 0) lines.push('');
  lines.push('*Restocked (above threshold):*');
  for (const item of backAbove) lines.push('  ✓ ' + item);
}
const text = '*Halo Home — Inventory Update*\\n' + lines.join('\\n');
return [{ json: { text } }];
`.trim();

// n8: Persist current OOS state for next run's comparison
const SAVE_STATE_CODE = `
const workflowStaticData = $getWorkflowStaticData('global');
workflowStaticData.oos_state = $('Check Inventory').item.json.current_oos_state;
return [{ json: { saved: true } }];
`.trim();

const workflow = {
  name: 'Halo Home - Inventory Alert',
  settings: { executionOrder: 'v1', saveManualExecutions: true, timezone: 'Asia/Manila' },
  nodes: [
    // n1: Schedule — 10 AM PHT daily
    { id: 'n1', name: 'Schedule Trigger', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [240, 300],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 9 * * *' }] } } }, // 9 AM PHT (workflow tz Asia/Manila)

    // n2: Load persisted OOS state from static data
    { id: 'n2', name: 'Load OOS State', type: 'n8n-nodes-base.code', typeVersion: 2, position: [460, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: LOAD_OOS_STATE_CODE } },

    // n3: Fetch all products from Shopify (HTTP Request node — no sandbox issue)
    { id: 'n3', name: 'Fetch Products', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [700, 300],
      onError: 'continueRegularOutput',
      parameters: { method: 'GET',
        url: `https://${SHOPIFY_DOMAIN}/admin/api/2024-10/products.json?limit=250&fields=id,title,status,variants`,
        sendHeaders: true, headerParameters: { parameters: [{ name: 'X-Shopify-Access-Token', value: SHOPIFY_TOKEN }] }, options: {} } },

    // n4: Compare fetched products against saved OOS state
    { id: 'n4', name: 'Check Inventory', type: 'n8n-nodes-base.code', typeVersion: 2, position: [940, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: CHECK_INVENTORY_CODE } },

    // n5: Only continue if something changed
    { id: 'n5', name: 'Has Changes?', type: 'n8n-nodes-base.if', typeVersion: 2, position: [1160, 300],
      parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ id: 'c1', leftValue: '={{ $json.has_changes }}', rightValue: true,
          operator: { type: 'boolean', operation: 'equals' } }], combinator: 'and' } } },

    // n6: Build Slack message (true branch only)
    { id: 'n6', name: 'Build Message', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1380, 200],
      parameters: { mode: 'runOnceForAllItems', jsCode: BUILD_MESSAGE_CODE } },

    // n7: Post to Slack
    { id: 'n7', name: 'Post to Slack', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1600, 200],
      parameters: { method: 'POST', url: 'https://slack.com/api/chat.postMessage',
        sendHeaders: true, headerParameters: { parameters: [
          { name: 'Authorization', value: `=Bearer ${HALO_BOT_TOKEN}` },
          { name: 'Content-Type', value: 'application/json; charset=utf-8' },
        ] },
        sendBody: true, specifyBody: 'json',
        jsonBody: `={{ { channel: '${HALO_HOME_CHANNEL_ID}', text: $json.text } }}`, options: {} } },

    // n8: Save updated OOS state (both branches)
    { id: 'n8', name: 'Save OOS State', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1600, 420],
      parameters: { mode: 'runOnceForAllItems', jsCode: SAVE_STATE_CODE } },
  ],
  connections: {
    'Schedule Trigger': { main: [[{ node: 'Load OOS State',   type: 'main', index: 0 }]] },
    'Load OOS State':   { main: [[{ node: 'Fetch Products',   type: 'main', index: 0 }]] },
    'Fetch Products':   { main: [[{ node: 'Check Inventory',  type: 'main', index: 0 }]] },
    'Check Inventory':  { main: [[{ node: 'Has Changes?',     type: 'main', index: 0 }]] },
    'Has Changes?':     { main: [[{ node: 'Build Message',    type: 'main', index: 0 }],
                                  [{ node: 'Save OOS State',  type: 'main', index: 0 }]] },
    'Build Message':    { main: [[{ node: 'Post to Slack',    type: 'main', index: 0 }]] },
    'Post to Slack':    { main: [[{ node: 'Save OOS State',   type: 'main', index: 0 }]] },
  },
};

function n8nRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const u = new URL(N8N_URL + path);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method,
      headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d||'{}')); } catch { resolve({}); } }); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function deploy() {
  if (!SHOPIFY_TOKEN)    { console.error('ERROR: SHOPIFY_ACCESS_TOKEN not set'); process.exit(1); }
  if (!HALO_BOT_TOKEN)   { console.error('ERROR: HALO_HOME_BOT_TOKEN not set');  process.exit(1); }
  if (!HALO_HOME_CHANNEL_ID) { console.warn('WARNING: HALO_HOME_SLACK_CHANNEL_ID not set'); }

  const result = WORKFLOW_ID
    ? await n8nRequest('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, workflow)
    : await n8nRequest('POST', '/api/v1/workflows', workflow);

  if (!result.id) { console.error('ERROR:', JSON.stringify(result).slice(0, 2000)); process.exit(1); }
  await n8nRequest('POST', `/api/v1/workflows/${result.id}/activate`);
  console.log('SUCCESS — Workflow ID:', result.id);
  console.log('URL: https://noatakhel.app.n8n.cloud/workflow/' + result.id);
  console.log('Schedule: daily at 10 AM PHT (2 AM UTC)');
  console.log('Note: First run saves baseline OOS state. Alerts only fire on changes.');
}

if (require.main === module) deploy().catch(e => console.error('Deploy failed:', e.message));
module.exports = { workflow };
