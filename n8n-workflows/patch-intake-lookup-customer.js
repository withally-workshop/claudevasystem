// patch-intake-lookup-customer.js
//
// Fixes Lookup Billing Customer node in Invoice Request Intake (5XHxhQ7wB2rxE3qz):
//   - Replaces $helpers.httpRequest (not available on this n8n instance) with fetch
//
// Safe to re-run: skips if already patched.

const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = '5XHxhQ7wB2rxE3qz';

const NEW_LOOKUP_CODE = `
const ctx = $json;
const token = ctx.token || '';
const clientEmail = (ctx.client_email || '').trim();
const clientName = (ctx.client_name || '').trim();
const headers = {
  Authorization: 'Bearer ' + token,
  'x-api-version': '2025-06-16',
};

async function listCustomers(query) {
  const resp = await fetch('https://api.airwallex.com/api/v1/billing_customers' + query, {
    method: 'GET',
    headers,
  });
  const data = await resp.json();
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data)) return data;
  return [];
}

// email-first: reuse an existing billing customer by exact email before trying name.
let customer_lookup_items = [];
if (clientEmail) {
  customer_lookup_items = await listCustomers('?email=' + encodeURIComponent(clientEmail));
}

const normalizedEmail = clientEmail.toLowerCase();
const emailMatch = customer_lookup_items.find(customer => {
  const emails = [
    customer.email,
    customer.email_address,
    customer.primary_email,
    customer.contact && customer.contact.email,
  ].filter(Boolean).map(e => String(e).toLowerCase().trim());
  return emails.includes(normalizedEmail);
});

if (!emailMatch && clientName) {
  customer_lookup_items = await listCustomers('?name=' + encodeURIComponent(clientName));
}

return { json: { ...ctx, customer_lookup_items } };
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
  const node = nodes.find(n => n.name === 'Lookup Billing Customer');
  if (!node) {
    console.error('ERROR: Lookup Billing Customer node not found.');
    process.exit(1);
  }

  if (!(node.parameters.jsCode || '').includes('$helpers')) {
    console.log('Already using fetch (no $helpers found). Nothing to do.');
    return;
  }

  node.parameters.jsCode = NEW_LOOKUP_CODE;

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

  const verify = (updated.nodes || []).find(n => n.name === 'Lookup Billing Customer');
  if ((verify?.parameters?.jsCode || '').includes('$helpers')) {
    console.error('ERROR: $helpers still present after patch.');
    process.exit(1);
  }

  console.log('SUCCESS — Lookup Billing Customer patched.');
  console.log('  - $helpers.httpRequest replaced with fetch');
}

patch().catch(console.error);
