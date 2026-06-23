// patch-intake-currency-amount.js
//
// Hardens the "Normalize Slack Submission" node in Invoice Request Intake (5XHxhQ7wB2rxE3qz):
//   - The Slack modal has a single "Currency" field. Requesters often type the amount
//     there too (e.g. "SGD 1300"), so the figure never reached a line item and the old
//     validation hard-failed on "missing unit_price" (the 2026-06-23 "Get Customers"
//     incident). This splits the currency field into a clean 3-letter code + embedded
//     total, then feeds the total into the existing single-line-item fallback.
//
// Surgical: GET -> string-replace inside the node jsCode -> PUT. Preserves credentials and
// the earlier Lookup/Resolve Customer patches. Safe to re-run (skips if already patched).

const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = '5XHxhQ7wB2rxE3qz';
const NODE_NAME = 'Normalize Slack Submission';

const OLD_BLOCK = `// If all items have null prices but a total is available in the payload, consolidate into one line item.
const nullPriceItems = lineItems.filter(i => i.unit_price === null || i.unit_price === undefined);
let resolvedLineItems = lineItems;
if (nullPriceItems.length === lineItems.length && lineItems.length > 0) {
  const rawAmount = payload.amount || payload.total || payload.subtotal_amount || 0;`;

const NEW_BLOCK = `// The Slack modal has a single "Currency" field. Requesters frequently type the
// amount there too (e.g. "SGD 1300"), so the figure never reaches a line item and the
// old validation hard-failed on "missing unit_price". Split that field into a clean
// 3-letter currency code and any embedded total, then feed the total into the
// line-item fallback below so the amount no longer has to live inside a line item.
const rawCurrency = String(payload.currency || '').trim();
const currencyCodeMatch = rawCurrency.match(/[A-Za-z]{3}/);
const cleanCurrency = currencyCodeMatch
  ? currencyCodeMatch[0].toUpperCase()
  : (rawCurrency.replace(/[^A-Za-z]/g, '').toUpperCase() || rawCurrency.toUpperCase());
const currencyEmbeddedAmount = Number((rawCurrency.match(/[0-9][0-9,.]*/g) || []).join('').replace(/,/g, '')) || 0;

// If all items have null prices but a total is available (payload field or embedded in
// the currency field), consolidate into one line item instead of failing.
const nullPriceItems = lineItems.filter(i => i.unit_price === null || i.unit_price === undefined);
let resolvedLineItems = lineItems;
if (nullPriceItems.length === lineItems.length && lineItems.length > 0) {
  const rawAmount = payload.amount || payload.total || payload.subtotal_amount || currencyEmbeddedAmount || 0;`;

// (old string, new string) single-line replacements
const SIMPLE_REPLACEMENTS = [
  ["if (!payload.currency) missing.push('currency');", "if (!cleanCurrency) missing.push('currency');"],
  ['currency: payload.currency || \'\',', 'currency: cleanCurrency || \'\','],
];

function patchCode(code) {
  let out = code;
  if (!out.includes(OLD_BLOCK)) throw new Error('OLD_BLOCK anchor not found in node jsCode — node may already be patched or changed.');
  out = out.replace(OLD_BLOCK, NEW_BLOCK);
  for (const [oldStr, newStr] of SIMPLE_REPLACEMENTS) {
    if (!out.includes(oldStr)) throw new Error('Anchor not found: ' + oldStr);
    out = out.replace(oldStr, newStr);
  }
  return out;
}

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
  const node = nodes.find((n) => n.name === NODE_NAME);
  if (!node) { console.error(`ERROR: "${NODE_NAME}" node not found.`); process.exit(1); }

  if ((node.parameters.jsCode || '').includes('currencyEmbeddedAmount')) {
    console.log('Patch already applied (currencyEmbeddedAmount found). Nothing to do.');
    return;
  }

  node.parameters.jsCode = patchCode(node.parameters.jsCode || '');

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

  const verify = (updated.nodes || []).find((n) => n.name === NODE_NAME);
  if (!(verify?.parameters?.jsCode || '').includes('currencyEmbeddedAmount')) {
    console.error('ERROR: patch did not apply correctly.'); process.exit(1);
  }
  console.log('SUCCESS — Normalize Slack Submission patched (currency-embedded amount fallback).');
}

patch().catch(console.error);
