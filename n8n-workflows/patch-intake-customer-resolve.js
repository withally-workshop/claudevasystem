// patch-intake-customer-resolve.js
//
// Hardens the Resolve Customer node in Invoice Request Intake (5XHxhQ7wB2rxE3qz):
//   - When multiple customers match an email, picks the most recently updated one
//     instead of whatever the API returns first (unpredictable order).
//   - Same for name matches — also prefers most recently updated.
//
// Safe to re-run: GET → patch in memory → PUT. Skips if already patched.

const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = '5XHxhQ7wB2rxE3qz';

const NEW_RESOLVE_CODE = `
const ctx = $('Merge Auth Token').item.json;
const items = Array.isArray($json.customer_lookup_items) ? $json.customer_lookup_items : [];
const clientName = (ctx.client_name || '').toLowerCase().trim();
const clientEmail = (ctx.client_email || '').toLowerCase().trim();

function emailsFor(customer) {
  return [
    customer.email,
    customer.email_address,
    customer.primary_email,
    customer.contact && customer.contact.email,
  ].filter(Boolean).map(e => String(e).toLowerCase().trim());
}

// When multiple customers match, prefer the most recently updated.
// Prevents stale test/duplicate records from being picked over the real one.
function mostRecent(matches) {
  if (!matches.length) return null;
  return matches.slice().sort((a, b) => {
    const ta = new Date(a.updated_at || a.created_at || 0).getTime();
    const tb = new Date(b.updated_at || b.created_at || 0).getTime();
    return tb - ta;
  })[0];
}

function resolveByEmail(customers) {
  if (!clientEmail) return null;
  const matches = customers.filter(c => emailsFor(c).includes(clientEmail));
  return mostRecent(matches);
}

function resolveByName(customers) {
  const matches = customers.filter(c => (c.name || '').toLowerCase().trim() === clientName);
  return mostRecent(matches);
}

const found = resolveByEmail(items) || resolveByName(items);
return { json: { ...ctx, airwallex_customer_id: found ? found.id : '' } };
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
  console.log('Fetching live workflow...');
  const wf = await n8nRequest('GET', `/api/v1/workflows/${WORKFLOW_ID}`);
  if (!wf.id) {
    console.error('ERROR: Could not fetch workflow:', JSON.stringify(wf).substring(0, 500));
    process.exit(1);
  }

  const nodes = wf.nodes || [];
  const resolveNode = nodes.find(n => n.name === 'Resolve Customer');
  if (!resolveNode) {
    console.error('ERROR: Resolve Customer node not found.');
    process.exit(1);
  }

  if ((resolveNode.parameters.jsCode || '').includes('mostRecent')) {
    console.log('Patch already applied (mostRecent function found). Nothing to do.');
    return;
  }

  resolveNode.parameters.jsCode = NEW_RESOLVE_CODE;

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

  const verify = (updated.nodes || []).find(n => n.name === 'Resolve Customer');
  if (!(verify?.parameters?.jsCode || '').includes('mostRecent')) {
    console.error('ERROR: patch did not apply correctly.');
    process.exit(1);
  }

  console.log('SUCCESS — Resolve Customer patched.');
  console.log('  - resolveByEmail: now picks most recently updated match');
  console.log('  - resolveByName: now picks most recently updated match');
}

patch().catch(console.error);
