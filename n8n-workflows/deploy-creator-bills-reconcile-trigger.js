'use strict';

/**
 * Krave — Creator Bills EOD Reconcile (trigger)
 *
 * Tiny scheduler: every weekday EOD (19:00 PHT) it POSTs the krave-bot endpoint
 * /cron/reconcile-bills, which mirrors Airwallex Spend bills into the Creator &
 * AP Bills Tracker (fills missing Bill IDs + appends bills not yet in the sheet).
 * All the work + credentials live in the bot; this workflow only triggers it.
 *
 * The shared secret (x-cron-secret) is read from process.env.CRON_SECRET at deploy
 * time and stored in n8n — never committed as a literal.
 *
 * Deploy:  node n8n-workflows/deploy-creator-bills-reconcile-trigger.js
 */

const https = require('https');

const N8N_URL = process.env.N8N_URL || 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const BOT_URL = process.env.KRAVE_BOT_URL || 'https://krave-ai.onrender.com';

if (!API_KEY) throw new Error('N8N_API_KEY not set in env');
if (!CRON_SECRET) throw new Error('CRON_SECRET not set in env');

const workflow = {
  name: 'Krave — Creator Bills EOD Reconcile',
  nodes: [
    {
      id: 'n1', name: 'Schedule Trigger (EOD)',
      type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
      position: [260, 300],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 19 * * 1-5' }] } },
    },
    {
      id: 'n2', name: 'POST reconcile endpoint',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [520, 300],
      parameters: {
        method: 'POST',
        url: `${BOT_URL}/cron/reconcile-bills`,
        sendHeaders: true,
        headerParameters: { parameters: [{ name: 'x-cron-secret', value: CRON_SECRET }] },
        options: { timeout: 60000 },
      },
    },
  ],
  connections: {
    'Schedule Trigger (EOD)': { main: [[{ node: 'POST reconcile endpoint', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', timezone: 'Asia/Manila' },
};

function n8nRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const u = new URL(N8N_URL + path);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } }); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function deploy() {
  const list = await n8nRequest('GET', `/api/v1/workflows?name=${encodeURIComponent(workflow.name)}&limit=250`);
  const existing = (list.data || []).find((w) => w.name === workflow.name);
  let result = existing
    ? await n8nRequest('PUT', `/api/v1/workflows/${existing.id}`, workflow)
    : await n8nRequest('POST', '/api/v1/workflows', workflow);
  if (!result.id) { console.log('ERROR:', JSON.stringify(result).slice(0, 800)); return; }
  await n8nRequest('POST', `/api/v1/workflows/${result.id}/activate`);
  console.log('SUCCESS — active. Workflow ID:', result.id);
  console.log('URL: https://noatakhel.app.n8n.cloud/workflow/' + result.id);
}

if (require.main === module) deploy().catch((e) => console.error('Deploy failed:', e.message));
module.exports = { workflow };
