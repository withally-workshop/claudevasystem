// inspect-intake-live.js — read-only. Dumps the live Invoice Request Intake workflow
// (5XHxhQ7wB2rxE3qz) to snapshots/ and prints a structural summary so the deploy script
// can be reconciled against true live state. No writes to n8n.

const https = require('https');
const fs = require('fs');
const path = require('path');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = '5XHxhQ7wB2rxE3qz';

function n8nGet(p) {
  return new Promise((resolve, reject) => {
    const u = new URL(N8N_URL + p);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers: { 'X-N8N-API-KEY': API_KEY } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

const MARKERS = ['resolveByEmail', 'resolveByName', 'mostRecent', 'customer_block_reason', "fetch('https://api.airwallex", '$helpers', 'encodeURIComponent', 'customer_lookup_items', 'assertNotTest', 'TEST_CUSTOMER', 'billing_customers'];

(async () => {
  if (!API_KEY) { console.error('N8N_API_KEY not set'); process.exit(1); }
  const wf = await n8nGet(`/api/v1/workflows/${WORKFLOW_ID}`);
  if (!wf.id) { console.error('fetch failed', JSON.stringify(wf).slice(0, 300)); process.exit(1); }

  const snapDir = path.join(__dirname, 'snapshots');
  if (!fs.existsSync(snapDir)) fs.mkdirSync(snapDir, { recursive: true });
  const snapPath = path.join(snapDir, 'intake-live.json');
  fs.writeFileSync(snapPath, JSON.stringify(wf, null, 2));
  console.log('active:', wf.active, '| nodes:', (wf.nodes || []).length, '| snapshot:', snapPath);

  console.log('\n=== NODES ===');
  for (const n of wf.nodes || []) {
    const isCode = n.type === 'n8n-nodes-base.code';
    const code = n.parameters?.jsCode || '';
    const present = isCode ? MARKERS.filter((m) => code.includes(m)) : [];
    console.log(`- ${n.name}  [${n.type.replace('n8n-nodes-base.', '')}]${isCode ? '  jsLen=' + code.length : ''}${present.length ? '  {' + present.join(', ') + '}' : ''}`);
  }

  // Dump customer-related code nodes to individual files for exact comparison.
  const targets = ['Lookup Billing Customer', 'Resolve Customer', 'Customer Safety Gate', 'Set Customer ID'];
  console.log('\n=== CUSTOMER NODE CODE DUMPS ===');
  for (const name of targets) {
    const node = (wf.nodes || []).find((n) => n.name === name);
    if (!node) { console.log(`(absent) ${name}`); continue; }
    const f = path.join(snapDir, 'intake-live-' + name.replace(/[^a-z0-9]+/gi, '_') + '.js');
    fs.writeFileSync(f, node.parameters?.jsCode || '');
    console.log(`(present) ${name} -> ${f}`);
  }

  console.log('\n=== CONNECTIONS (customer region) ===');
  const conns = wf.connections || {};
  for (const src of Object.keys(conns)) {
    if (!/Customer|Lookup|Resolve|Merge Auth|Route Customer|Route Validation|Airwallex/i.test(src)) continue;
    const outs = (conns[src].main || []).map((branch, i) => `[${i}] ` + (branch || []).map((e) => e.node).join(', ')).join('  ');
    console.log(`${src} -> ${outs}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
