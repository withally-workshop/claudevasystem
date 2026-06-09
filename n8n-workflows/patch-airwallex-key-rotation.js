// patch-airwallex-key-rotation.js
//
// 2026-06-10 — Airwallex API key rotation (old key was exposed in git history
// on a public remote; rotated in the Airwallex dashboard, old key revoked).
//
// Sweeps ALL workflows on noatakhel.app.n8n.cloud for the OLD key value baked
// into nodes (code nodes, HTTP header params — any node type) and replaces it
// with the NEW key from process.env.AIRWALLEX_API_KEY. Saves a pre-patch
// snapshot of every modified workflow to snapshots/ for rollback.
//
// Requires env: N8N_API_KEY, AIRWALLEX_API_KEY (new), AIRWALLEX_OLD_API_KEY.
// Never prints key values. Safe to re-run (no-op once nothing matches).
//
// Usage:
//   node patch-airwallex-key-rotation.js --dry-run   # read-only: report matches, change nothing
//   node patch-airwallex-key-rotation.js             # apply patches

const https = require('https');
const fs = require('fs');
const path = require('path');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const NEW_KEY = process.env.AIRWALLEX_API_KEY;
const OLD_KEY = process.env.AIRWALLEX_OLD_API_KEY;

if (!API_KEY || !NEW_KEY || !OLD_KEY) {
  console.error('Missing N8N_API_KEY / AIRWALLEX_API_KEY / AIRWALLEX_OLD_API_KEY in env');
  process.exit(1);
}
if (NEW_KEY === OLD_KEY) {
  console.error('New key equals old key — nothing to rotate. Aborting.');
  process.exit(1);
}

function n8nRequest(method, p, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const u = new URL(N8N_URL + p);
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
        if (res.statusCode >= 400) return reject(new Error(`${method} ${p} -> HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
        try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function countOccurrences(str, needle) {
  return str.split(needle).length - 1;
}

const DRY_RUN = process.argv.includes('--dry-run');

(async () => {
  const snapDir = path.join(__dirname, 'snapshots');
  if (!fs.existsSync(snapDir)) fs.mkdirSync(snapDir, { recursive: true });

  // List all workflows (paginated)
  const all = [];
  let cursor;
  do {
    const page = await n8nRequest('GET', '/api/v1/workflows?limit=100' + (cursor ? `&cursor=${cursor}` : ''));
    all.push(...(page.data || []));
    cursor = page.nextCursor;
  } while (cursor);
  console.log(`Scanning ${all.length} workflows for old Airwallex key...`);

  let patched = 0;
  for (const wfSummary of all) {
    const wf = await n8nRequest('GET', `/api/v1/workflows/${wfSummary.id}`);
    const nodesJson = JSON.stringify(wf.nodes || []);
    const hits = countOccurrences(nodesJson, OLD_KEY);
    if (!hits) continue;

    if (wf.isArchived) {
      console.log(`SKIPPED  ${wf.name} (${wf.id}) — archived (API forbids updates; contains only the revoked key, re-patch if ever unarchived)`);
      continue;
    }

    if (DRY_RUN) {
      const nodeNames = (wf.nodes || [])
        .filter((n) => countOccurrences(JSON.stringify(n), OLD_KEY) > 0)
        .map((n) => `"${n.name}" [${n.type.replace('n8n-nodes-base.', '')}]`);
      console.log(`WOULD PATCH  ${wf.name} (${wf.id}) — active=${wf.active}; ${hits} occurrence(s) in: ${nodeNames.join(', ')}`);
      patched++;
      continue;
    }

    // snapshot before mutating
    const snapFile = path.join(snapDir, `${wf.name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}-pre-key-rotation.json`);
    fs.writeFileSync(snapFile, JSON.stringify(wf, null, 2));

    const newNodes = JSON.parse(nodesJson.split(OLD_KEY).join(NEW_KEY));
    // n8n public API PUT rejects settings keys it returns on GET — whitelist only schema-allowed ones
    const ALLOWED_SETTINGS = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'];
    const settings = {};
    for (const k of ALLOWED_SETTINGS) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
    const body = {
      name: wf.name,
      nodes: newNodes,
      connections: wf.connections,
      settings,
    };
    if (wf.staticData) body.staticData = wf.staticData; // preserve idempotency state

    await n8nRequest('PUT', `/api/v1/workflows/${wf.id}`, body);
    patched++;
    console.log(`PATCHED  ${wf.name} (${wf.id}) — ${hits} occurrence(s) replaced; active=${wf.active}; snapshot: ${path.basename(snapFile)}`);
  }

  console.log(
    patched
      ? `${DRY_RUN ? '[dry-run] ' : 'Done. '}${patched} workflow(s) ${DRY_RUN ? 'would be' : ''} patched.`
      : 'No workflows contained the old key. Nothing changed.'
  );
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
