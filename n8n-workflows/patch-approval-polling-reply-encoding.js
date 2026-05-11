// patch-approval-polling-reply-encoding.js
//
// Fixes garbled Unicode in Build John Thread Reply node (uCS9lzHtVKWlqYlk).
// The live node has double-encoded UTF-8 (â€¢ instead of •, etc.) because
// the deploy script's string literals were mis-encoded during deployment.
// Fix: replace all Unicode/emoji with plain ASCII equivalents.
//
// Safe to re-run.

const https = require('https');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf8');
env.split('\n').forEach(l => { const [k,...v]=l.split('='); if(k&&v) process.env[k.trim()]=v.join('=').trim(); });

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = 'uCS9lzHtVKWlqYlk';

const NEW_BUILD_JOHN_REPLY_CODE = `
const ctx = $('Extract Payment Link').item.json;
const clientName = ctx['Client Name'] || '';
const invoiceNum = ctx['Invoice #'] || '';
const amount = ctx['Amount'] || '';
const currency = ctx['Currency'] || '';
const dueDate = ctx['Due Date'] || '';
const link = ctx.payment_link || '';
const lines = [
  'Invoice approved and ready to send - ' + clientName,
  '- Invoice #: ' + invoiceNum,
  '- Amount: ' + currency + ' ' + amount,
  '- Due: ' + dueDate,
];
if (link) lines.push('- Payment link: ' + link);
else lines.push('Payment link unavailable - retrieve from Airwallex dashboard.');
lines.push('');
lines.push('@John please download the invoice from the link above and email it to the client (john@kravemedia.co) with:');
lines.push('  - The payment link');
lines.push('  - The downloaded invoice file as an attachment');
lines.push('  CC: john@kravemedia.co, noa@kravemedia.co');
return [{ json: { ...ctx, john_reply_text: lines.join('\\n') } }];
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
  const node = nodes.find(n => n.name === 'Build John Thread Reply');
  if (!node) {
    console.error('ERROR: Build John Thread Reply node not found.');
    process.exit(1);
  }

  const current = node.parameters.jsCode || '';
  if (!current.includes('â') && !current.includes('â€') && !current.includes('âœ')) {
    console.log('No garbled characters found — checking if already patched...');
    if (current.includes('Invoice approved and ready to send')) {
      console.log('Already patched. Nothing to do.');
      return;
    }
  }

  node.parameters.jsCode = NEW_BUILD_JOHN_REPLY_CODE;

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

  console.log('SUCCESS — Build John Thread Reply patched (plain ASCII, no encoding issues).');
}

patch().catch(console.error);
