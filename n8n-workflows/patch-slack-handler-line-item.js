// patch-slack-handler-line-item.js
//
// Fixes line item parsing in the Slack Invoice Handler (t7MMhlUo5H4HQmgL):
//   - Trailing number regex didn't allow a currency symbol ($, €, £) before the amount.
//   - "krave media x1 $1" parsed as unit_price=null (→ $0 invoice).
//   - Fix: strip leading currency prefix in trailing-number branch.
//
// Safe to re-run: skips if already patched.

const https = require('https');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf8');
env.split('\n').forEach(l => { const [k,...v]=l.split('='); if(k&&v) process.env[k.trim()]=v.join('=').trim(); });

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = 't7MMhlUo5H4HQmgL';

// Sentinel that uniquely identifies the patched version
const PATCH_SENTINEL = 'currencyPrefixStripped';

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
  console.log('Fetching live Slack handler workflow...');
  const wf = await n8nRequest('GET', `/api/v1/workflows/${WORKFLOW_ID}`);
  if (!wf.id) {
    console.error('ERROR: Could not fetch workflow:', JSON.stringify(wf).substring(0, 500));
    process.exit(1);
  }

  const nodes = wf.nodes || [];

  // Find the Parse Slack Submission node (contains parseLineItem)
  const parseNode = nodes.find(n =>
    n.name === 'Parse Slack Submission' ||
    (n.parameters?.jsCode || '').includes('parseLineItem')
  );
  if (!parseNode) {
    console.error('ERROR: Parse Slack Submission node not found.');
    console.log('Nodes:', nodes.map(n => n.name));
    process.exit(1);
  }

  const current = parseNode.parameters.jsCode || '';

  if (current.includes(PATCH_SENTINEL)) {
    console.log('Already patched. Nothing to do.');
    return;
  }

  // The old trailing-number branch (no currency prefix support):
  //   const trailingMatch = trimmed.match(/^(.*?)\s+(\d[\d,]*(?:\.\d+)?)\s*$/);
  // Replace with a version that strips an optional leading currency symbol:
  //   [$€£¥]? before the digit group captures "$1", "€500", "£250" etc.

  const OLD_TRAILING = `  // Trailing number: "April retainer 2500"
  const trailingMatch = trimmed.match(/^(.*?)\\s+(\\d[\\d,]*(?:\\.\\d+)?)\\s*$/);`;

  const NEW_TRAILING = `  // Trailing number: "April retainer 2500" or "krave media $1" (currency prefix allowed)
  // currencyPrefixStripped — strip leading $, €, £, ¥ before matching the number
  const trailingMatch = trimmed.match(/^(.*?)\\s+[$€£¥]?(\\d[\\d,]*(?:\\.\\d+)?)\\s*$/);`;

  if (!current.includes('const trailingMatch = trimmed.match')) {
    console.error('ERROR: Could not locate trailingMatch pattern in node code.');
    console.error('Current code snippet:', current.substring(0, 500));
    process.exit(1);
  }

  const patched = current.replace(
    /\/\/ Trailing number.*?\n  const trailingMatch = trimmed\.match\(\/\^/s,
    NEW_TRAILING.split('const trailingMatch')[0] + 'const trailingMatch = trimmed.match(/^'
  );

  // Simpler targeted replacement
  const patchedCode = current
    .replace(
      '// Trailing number: "April retainer 2500"\n  const trailingMatch = trimmed.match(/^(.*?)\\s+(\\d[\\d,]*(?:\\.\\d+)?)\\s*$/);',
      '// Trailing number: "April retainer 2500" or with currency prefix e.g. "$1"\n  // currencyPrefixStripped\n  const trailingMatch = trimmed.match(/^(.*?)\\s+[$\\u20ac\\u00a3\\u00a5]?(\\d[\\d,]*(?:\\.\\d+)?)\\s*$/);'
    );

  if (patchedCode === current) {
    console.error('ERROR: String replacement did not match. Printing current trailingMatch context:');
    const idx = current.indexOf('trailingMatch');
    console.error(current.substring(Math.max(0, idx - 100), idx + 200));
    process.exit(1);
  }

  parseNode.parameters.jsCode = patchedCode;

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

  const verify = (updated.nodes || []).find(n =>
    n.name === 'Parse Slack Submission' ||
    (n.parameters?.jsCode || '').includes('currencyPrefixStripped')
  );
  if (!(verify?.parameters?.jsCode || '').includes(PATCH_SENTINEL)) {
    console.error('ERROR: patch did not apply correctly.');
    process.exit(1);
  }

  console.log('SUCCESS — Parse Slack Submission patched.');
  console.log('  - trailingMatch regex now allows leading $, EUR, GBP, JPY symbols');
  console.log('  - "krave media x1 $1" will now parse as unit_price=1');
}

patch().catch(console.error);
