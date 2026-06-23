// patch-slack-handler-currency-amount.js
//
// Slack Invoice Handler (t7MMhlUo5H4HQmgL): the modal has one "Currency" field, but
// requesters type the amount there too (e.g. "SGD 1300"). This patch:
//   1. "Normalize Modal Submission" node — splits the field into a clean 3-letter
//      currency code + an `amount`, so a clean currency/amount flows to the intake.
//   2. "Post Channel Receipt" node — shows the parsed amount instead of "SGD 1300 0".
//
// Surgical: GET -> string-replace inside the two nodes -> PUT. Preserves credentials and
// the earlier line-item patch. Safe to re-run (each replacement is guarded).

const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = 't7MMhlUo5H4HQmgL';

const NORMALIZE_NODE = 'Normalize Modal Submission';
const RECEIPT_NODE = 'Post Channel Receipt';

const NORMALIZE_OLD = `  .filter(Boolean);

return {
  json: {
    origin_channel_id: originChannelId,`;

const NORMALIZE_NEW = `  .filter(Boolean);

const rawCurrency = String(getValue('currency') || '').trim();
const currencyCodeMatch = rawCurrency.match(/[A-Za-z]{3}/);
const currencyCode = currencyCodeMatch
  ? currencyCodeMatch[0].toUpperCase()
  : (rawCurrency.replace(/[^A-Za-z]/g, '').toUpperCase() || rawCurrency.toUpperCase());
const amount = Number((rawCurrency.match(/[0-9][0-9,.]*/g) || []).join('').replace(/,/g, '')) || 0;

return {
  json: {
    origin_channel_id: originChannelId,`;

const NORMALIZE_CURRENCY_OLD = `    currency: getValue('currency'),`;
const NORMALIZE_CURRENCY_NEW = `    currency: currencyCode,
    amount,`;

const RECEIPT_OLD = `' ' + $json.line_items.reduce((sum, item) => sum + ((Number(item.quantity || 1)) * (Number(item.unit_price || 0))), 0) +`;
const RECEIPT_NEW = `' ' + ($json.amount || $json.line_items.reduce((sum, item) => sum + ((Number(item.quantity || 1)) * (Number(item.unit_price || 0))), 0)) +`;

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
      res.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function patch() {
  if (!API_KEY) { console.error('ERROR: N8N_API_KEY not set in env.'); process.exit(1); }
  console.log('Fetching live workflow...');
  const wf = await n8nRequest('GET', `/api/v1/workflows/${WORKFLOW_ID}`);
  if (!wf.id) { console.error('ERROR: Could not fetch workflow:', JSON.stringify(wf).slice(0, 500)); process.exit(1); }

  const nodes = wf.nodes || [];
  const normalize = nodes.find((n) => n.name === NORMALIZE_NODE);
  const receipt = nodes.find((n) => n.name === RECEIPT_NODE);
  if (!normalize) { console.error(`ERROR: "${NORMALIZE_NODE}" node not found.`); process.exit(1); }
  if (!receipt) { console.error(`ERROR: "${RECEIPT_NODE}" node not found.`); process.exit(1); }

  let changed = false;

  // 1. Normalize node
  let code = normalize.parameters.jsCode || '';
  if (code.includes('const amount = Number(')) {
    console.log('Normalize node already patched. Skipping.');
  } else {
    if (!code.includes(NORMALIZE_OLD)) throw new Error('Normalize anchor (return block) not found.');
    if (!code.includes(NORMALIZE_CURRENCY_OLD)) throw new Error('Normalize anchor (currency line) not found.');
    code = code.replace(NORMALIZE_OLD, NORMALIZE_NEW).replace(NORMALIZE_CURRENCY_OLD, NORMALIZE_CURRENCY_NEW);
    normalize.parameters.jsCode = code;
    changed = true;
  }

  // 2. Receipt node
  let text = receipt.parameters.text || '';
  if (text.includes('$json.amount ||')) {
    console.log('Receipt node already patched. Skipping.');
  } else {
    if (!text.includes(RECEIPT_OLD)) throw new Error('Receipt anchor not found.');
    receipt.parameters.text = text.replace(RECEIPT_OLD, RECEIPT_NEW);
    changed = true;
  }

  if (!changed) { console.log('Nothing to do — both nodes already patched.'); return; }

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
  if (!updated.id) { console.error('ERROR during PUT:', JSON.stringify(updated, null, 2).slice(0, 2000)); process.exit(1); }

  const vNorm = (updated.nodes || []).find((n) => n.name === NORMALIZE_NODE);
  const vRcpt = (updated.nodes || []).find((n) => n.name === RECEIPT_NODE);
  if (!(vNorm?.parameters?.jsCode || '').includes('const amount = Number(') ||
      !(vRcpt?.parameters?.text || '').includes('$json.amount ||')) {
    console.error('ERROR: patch did not apply correctly.'); process.exit(1);
  }
  console.log('SUCCESS — Slack handler patched (clean currency + amount + receipt display).');
}

patch().catch(console.error);
