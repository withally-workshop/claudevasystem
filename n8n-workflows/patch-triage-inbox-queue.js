/**
 * patch-triage-inbox-queue.js — 2026-06-15
 *
 * Surgical patch to the LIVE Inbox Triage Daily v2 workflow (EuT6REDs5PUaoycE):
 *   1. Mis-tiering fix  — KNOWN-contact match uses sender only (senderHay), not the
 *      body haystack. Injected into the live 'Classify Email' node code (preserves
 *      the live robust extractFrom from patch-triage-v2.js).
 *   2. Over-archiving fix — 'Restore Email Metadata' computes archive_ok (true ONLY
 *      for EA/FYI + EA/Auto-Sorted, never _Payment_Received), and 'Archive?' gates on
 *      it. Urgent / Needs-Reply / Unsure now stay in the inbox.
 *
 * Usage:
 *   node patch-triage-inbox-queue.js --dry-run   # GET + snapshot + show plan, no write
 *   node patch-triage-inbox-queue.js --apply     # patch + PUT + verify
 *
 * Credential-preserving (GET → edit nodes by name → PUT). No secrets as literals.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const MODE = process.argv.includes('--apply') ? 'apply' : 'dry-run';
const ID = 'EuT6REDs5PUaoycE';
const PAYMENT_LABEL = 'Label_5194298534623747326';

// Load .env (same pattern as patch-triage-v2.js)
fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/).forEach(line => {
  const m = line.match(/^([^#=\s][^=]*)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
});
const key = process.env.N8N_API_KEY;
if (!key) { console.error('N8N_API_KEY missing from .env'); process.exit(1); }

function req(method, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const opts = {
      hostname: 'noatakhel.app.n8n.cloud',
      path: '/api/v1/workflows/' + ID + (method === 'ACTIVATE' ? '/activate' : ''),
      method: method === 'ACTIVATE' ? 'POST' : method,
      headers: { 'X-N8N-API-KEY': key, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': data.length } : {}) },
    };
    const r = https.request(opts, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, body: b }); } });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

const RESTORE_CODE = `const orig = $('Resolve Final Tier').item.json;
const labelIds = $json.labelIds || [];
// Archive ONLY noise tiers. Urgent + Needs-Reply + Unsure stay in the inbox.
// Client payments (_Payment_Received) are EA/FYI but always kept in inbox.
const ARCHIVABLE = ['EA/FYI', 'EA/Auto-Sorted'];
const isPayment = labelIds.includes('${PAYMENT_LABEL}');
const archive_ok = ARCHIVABLE.includes(orig.tier) && !isPayment;
return { json: { ...orig, labelIds, archive_ok } };`;

const ARCHIVE_CONDITIONS = {
  combinator: 'and',
  // 'loose' so drafted Urgent/Needs-Reply items (which reach Archive? as Gmail draft
  // objects without archive_ok) evaluate undefined -> false -> NOT archived (stay in
  // inbox). Their tier is never archivable anyway, so this is correct in every case.
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 1 },
  conditions: [{
    id: 'archive-ok-cond',
    leftValue: '={{ $json.archive_ok }}',
    rightValue: true,
    operator: { type: 'boolean', operation: 'equals' },
  }],
};

(async () => {
  console.log(`\n=== patch-triage-inbox-queue [${MODE}] — workflow ${ID} ===\n`);
  const { status: getStatus, body: wf } = await req('GET');
  if (getStatus !== 200) { console.error('GET failed:', getStatus, JSON.stringify(wf).slice(0, 300)); process.exit(1); }
  console.log(`GET ok — "${wf.name}", active=${wf.active}, ${wf.nodes.length} nodes\n`);

  // Snapshot (gitignored dir)
  const snapDir = path.join(__dirname, 'snapshots');
  if (!fs.existsSync(snapDir)) fs.mkdirSync(snapDir);
  const snapPath = path.join(snapDir, 'inbox-triage-pre-queue-fix.json');
  fs.writeFileSync(snapPath, JSON.stringify(wf, null, 2));
  console.log(`Snapshot written: ${snapPath}\n`);

  const find = name => { const n = wf.nodes.find(x => x.name === name); if (!n) { console.error(`Node not found: "${name}"`); process.exit(1); } return n; };

  // ── Fix 1: Classify Email — KNOWN match on sender only ────────────────────
  const classify = find('Classify Email');
  let code = classify.parameters.jsCode;
  let fix1 = 'unchanged';
  if (code.includes('senderHay')) {
    fix1 = 'already patched (senderHay present) — skipped';
  } else {
    // Drift-proof: inject senderHay immediately before the KNOWN check and switch the
    // match in one replacement (independent of how the haystack line is quoted/evolved).
    const knownIf = 'if (KNOWN.some(k => haystack.includes(k))) {';
    if (!code.includes(knownIf)) { console.error('ABORT: expected KNOWN haystack check not found in live Classify Email code.'); process.exit(1); }
    const replacement =
      "// Sender-only match for KNOWN contacts — never match short tokens (amy/shin/cody) against the body.\n" +
      "const senderHay = (sender.name + ' ' + sender.email).toLowerCase();\n" +
      'if (KNOWN.some(k => senderHay.includes(k))) {';
    code = code.replace(knownIf, replacement);
    classify.parameters.jsCode = code;
    fix1 = 'patched (senderHay injected before KNOWN + match switched to senderHay)';
  }
  console.log('Fix 1 (Classify Email):', fix1);

  // ── Fix 2a: Restore Email Metadata — compute archive_ok ───────────────────
  const restore = find('Restore Email Metadata');
  let fix2a;
  if (restore.parameters.jsCode.includes('archive_ok')) {
    fix2a = 'already patched (archive_ok present) — skipped';
  } else {
    console.log('  current Restore Email Metadata code:\n    ' + restore.parameters.jsCode.replace(/\n/g, '\n    '));
    restore.parameters.jsCode = RESTORE_CODE;
    fix2a = 'replaced with archive_ok version';
  }
  console.log('Fix 2a (Restore Email Metadata):', fix2a);

  // ── Fix 2b: Archive? — gate on archive_ok ─────────────────────────────────
  const archive = find('Archive?');
  console.log('  current Archive? conditions:\n    ' + JSON.stringify(archive.parameters.conditions));
  archive.parameters.conditions = ARCHIVE_CONDITIONS;
  console.log('Fix 2b (Archive?): conditions set to { $json.archive_ok == true }');

  // Sanity: confirm Restore After Draft (live-only node) passes the metadata through to Archive?
  const rad = wf.nodes.find(x => x.name === 'Restore After Draft');
  console.log(`\nLive flow note: 'Restore After Draft' present=${!!rad} (it returns Restore Email Metadata's json, so archive_ok reaches Archive?).`);

  if (MODE === 'dry-run') {
    console.log('\n[dry-run] No PUT sent. Re-run with --apply to deploy.');
    return;
  }

  // ── Apply ─────────────────────────────────────────────────────────────────
  const { executionOrder, availableInMCP, timezone } = wf.settings || {};
  const settings = { executionOrder };
  if (availableInMCP !== undefined) settings.availableInMCP = availableInMCP;
  if (timezone !== undefined) settings.timezone = timezone;
  const putBody = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings, staticData: wf.staticData ?? null };
  const { status: putStatus, body: putRes } = await req('PUT', putBody);
  console.log('\nPUT status:', putStatus);
  if (putStatus !== 200) { console.error('PUT failed:', JSON.stringify(putRes).slice(0, 500)); process.exit(1); }

  // Verify
  const { body: after } = await req('GET');
  const aRestore = after.nodes.find(n => n.name === 'Restore Email Metadata');
  const aArchive = after.nodes.find(n => n.name === 'Archive?');
  const aClassify = after.nodes.find(n => n.name === 'Classify Email');
  const ok = aRestore.parameters.jsCode.includes('archive_ok')
    && JSON.stringify(aArchive.parameters.conditions).includes('archive_ok')
    && aClassify.parameters.jsCode.includes('senderHay');
  console.log('Verify — archive_ok in Restore:', aRestore.parameters.jsCode.includes('archive_ok'),
    '| Archive? gates archive_ok:', JSON.stringify(aArchive.parameters.conditions).includes('archive_ok'),
    '| senderHay in Classify:', aClassify.parameters.jsCode.includes('senderHay'));

  if (!after.active) {
    const { status: actStatus } = await req('ACTIVATE');
    console.log('Re-activate status:', actStatus);
  } else {
    console.log('Workflow still active=true.');
  }
  console.log(ok ? '\n✅ All three patches verified live.' : '\n⚠️ Verification incomplete — inspect the workflow.');
})().catch(e => console.error('ERROR:', e.message));
