// Surgical patch: Payment Detection — v7 confidence-gated Airwallex mark-as-paid
//
// Re-introduces Airwallex mark_as_paid on the full-payment path, but gated:
//   1. CONFIDENCE GATE (in Match Deposits To Invoices):
//      awMarkEligible = true only when
//        - invoice-number match ('high' / 'high-tracker-amount'), OR
//        - 'medium-client' AND a single payment settles the exact full
//          invoice amount (existingAmountPaid 0, |amount - invoiceAmount| < 0.01)
//      Partial payments and Osome invoices are never eligible.
//   2. RUNTIME VERIFICATION GUARD (new node, before any mark_as_paid call):
//      GET the live Airwallex invoice and require currency match, total_amount
//      match (±0.01) vs tracker, and payment_status not already PAID/VOID.
//      Any mismatch or API error → no write, Slack says NEEDS MANUAL.
//   3. VISIBILITY: Slack Payment Confirmed now always carries an
//      "• Airwallex: ..." line — auto-marked, already paid, or needs manual.
//
// Context: May 2026 WELLE incident removed unconditional auto mark-paid
// (Airwallex has no unpay; wrong mark-paid = credit-note-and-replace).
// 2026-06-10 AMPLIFIED MARKETING INV-AG2H2WFA-0001 showed the over-correction:
// exact-amount match updated the tracker but left Airwallex unpaid silently.
// Decision (John, 2026-06-11): auto-mark only at high confidence with a
// live verification guard; everything else gets an explicit manual flag.
//
// Usage:
//   node n8n-workflows/patch-payment-detection-aw-markpaid.js --dry-run   # diff only
//   node n8n-workflows/patch-payment-detection-aw-markpaid.js --apply     # PUT live
//
// Requires env: N8N_API_KEY (AIRWALLEX_* env vars only used to redact the
// legacy n17 inline creds from the local snapshot). The guard node authenticates
// via n8n credential 'Airwallex API (login headers)' (httpCustomAuth, Ry37bj6SFVD1zcd0).
// Live workflow ID: NurOLZkg3J6rur5Q

const https = require('https');
const fs = require('fs');
const path = require('path');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const WORKFLOW_ID = 'NurOLZkg3J6rur5Q';
const API_KEY = process.env.N8N_API_KEY;
if (!API_KEY) { console.error('N8N_API_KEY not set'); process.exit(1); }

// Airwallex auth lives in the n8n credential store (httpCustomAuth), created
// 2026-06-11 — NOT inlined in workflow code, unlike the legacy n17 pattern.
const AW_CRED_ID = 'Ry37bj6SFVD1zcd0';
const AW_CRED_NAME = 'Airwallex API (login headers)';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const APPLY = args.includes('--apply');
if (!DRY_RUN && !APPLY) { console.error('pass --dry-run or --apply'); process.exit(1); }

// ─── Eligibility block inserted into Match Deposits To Invoices (n5) ───
// Anchored after `const isPartial = remainingAmount > 1.00;`
const ELIGIBILITY_BLOCK = `
    // v7: confidence gate for guarded auto mark-as-paid in Airwallex.
    // Runtime verification against the live Airwallex record happens
    // downstream before any mark_as_paid call.
    let awMarkEligible = false;
    let awEligibilityReason = '';
    if (isOsome) {
      awEligibilityReason = 'Osome invoice - no Airwallex record';
    } else if (isPartial) {
      awEligibilityReason = 'partial payment - mark-as-paid is all-or-nothing';
    } else if (confidence === 'high' || confidence === 'high-tracker-amount') {
      awMarkEligible = true;
      awEligibilityReason = 'invoice-number match (' + confidence + ')';
    } else if (confidence === 'medium-client' && existingAmountPaid === 0 && email.amount && Math.abs(email.amount - invoiceAmount) < 0.01) {
      awMarkEligible = true;
      awEligibilityReason = 'exact full-amount + currency + client-name match';
    } else {
      awEligibilityReason = 'confidence ' + confidence + ' below auto-mark threshold';
    }`;

// ─── New node: Airwallex Guarded Mark Paid ───
// Per-item; never throws. Verifies the live Airwallex invoice before writing.
const AW_GUARD_CODE = `
const match = $('Match Deposits To Invoices').item.json;
const out = {
  awAction: 'manual',
  awStatusLine: '',
  invoiceNumber: match.invoiceNumber,
  airwallexInvoiceId: match.airwallexInvoiceId
};
try {
  if (!match.awMarkEligible) {
    out.awStatusLine = '⚠️ NEEDS MANUAL mark-as-paid — ' + (match.awEligibilityReason || 'below auto-mark confidence threshold');
    return { json: out };
  }
  // Token comes from the upstream 'Airwallex Auth' HTTP Request node, which
  // authenticates via the httpCustomAuth credential — no secrets in code.
  // (Code nodes on this instance have this.helpers.httpRequest but NOT
  // requestWithAuthentication — verified 2026-06-11.)
  const token = $('Airwallex Auth').item.json.token;
  if (!token) {
    out.awStatusLine = '⚠️ NEEDS MANUAL mark-as-paid — Airwallex auth failed (no token)';
    return { json: out };
  }
  const inv = await this.helpers.httpRequest({
    method: 'GET',
    url: 'https://api.airwallex.com/api/v1/invoices/' + match.airwallexInvoiceId,
    headers: { 'Authorization': 'Bearer ' + token, 'x-api-version': '2025-06-16' }
  });
  const awCurrency = (inv.currency || '').toString().toUpperCase();
  const awTotal = parseFloat(String(inv.total_amount ?? inv.total ?? 'NaN').replace(/,/g, ''));
  const payStatus = String(inv.payment_status || '').toUpperCase();
  const invStatus = String(inv.status || '').toUpperCase();
  if (payStatus === 'PAID') {
    out.awAction = 'noop';
    out.awStatusLine = 'already PAID in Airwallex — no action taken';
  } else if (['VOID', 'VOIDED', 'CANCELLED'].includes(invStatus) || ['VOID', 'VOIDED', 'CANCELLED'].includes(payStatus)) {
    out.awStatusLine = '⚠️ NEEDS MANUAL review — Airwallex invoice status is ' + (payStatus || invStatus);
  } else if (awCurrency !== (match.currency || '').toString().toUpperCase()) {
    out.awStatusLine = '⚠️ NEEDS MANUAL mark-as-paid — currency mismatch (Airwallex ' + awCurrency + ' vs deposit ' + match.currency + ')';
  } else if (!(Math.abs(awTotal - match.invoiceAmount) < 0.01)) {
    out.awStatusLine = '⚠️ NEEDS MANUAL mark-as-paid — Airwallex total ' + awTotal + ' ' + awCurrency + ' does not match tracker amount ' + match.invoiceAmount;
  } else {
    await this.helpers.httpRequest({
      method: 'POST',
      url: 'https://api.airwallex.com/api/v1/invoices/' + match.airwallexInvoiceId + '/mark_as_paid',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'x-api-version': '2025-06-16' }
    });
    out.awAction = 'auto';
    out.awStatusLine = '✅ marked paid automatically (' + match.awEligibilityReason + '; verified vs live Airwallex record)';
  }
} catch (e) {
  out.awStatusLine = '⚠️ NEEDS MANUAL mark-as-paid — Airwallex API error: ' + (e.message || 'unknown');
}
return { json: out };
`.trim();

// ─── Patch logic ───
function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(N8N_URL + urlPath);
    const opts = {
      method, hostname: url.hostname, path: url.pathname + url.search,
      headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json' }
    };
    const r = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        else resolve(JSON.parse(data));
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

(async () => {
  console.log('GET', WORKFLOW_ID);
  const wf = await req('GET', `/api/v1/workflows/${WORKFLOW_ID}`);

  // Idempotent ensure-state: safe to re-run after a partial or v1 apply.

  // 1) Eligibility block + output fields in Match Deposits To Invoices
  const matchNode = wf.nodes.find(n => n.name === 'Match Deposits To Invoices');
  if (!matchNode) throw new Error('Match Deposits To Invoices node not found');
  let code = matchNode.parameters.jsCode;
  if (!code.includes('awMarkEligible')) {
    const anchorPartial = 'const isPartial = remainingAmount > 1.00;';
    if (!code.includes(anchorPartial)) throw new Error('anchor not found: isPartial line');
    code = code.replace(anchorPartial, anchorPartial + '\n' + ELIGIBILITY_BLOCK);
    const anchorConf = 'matchConfidence: confidence,';
    if (code.split(anchorConf).length !== 2) throw new Error('anchor not unique: matchConfidence with comma');
    code = code.replace(anchorConf, anchorConf + '\n        awMarkEligible: awMarkEligible,\n        awEligibilityReason: awEligibilityReason,');
    matchNode.parameters.jsCode = code;
    console.log('match node: eligibility gate inserted');
  } else {
    console.log('match node: eligibility gate already present');
  }

  const updateNode = wf.nodes.find(n => n.name === 'Update Invoice Status');
  const slackNode = wf.nodes.find(n => n.name === 'Slack Payment Confirmed');
  if (!updateNode || !slackNode) throw new Error('Update Invoice Status / Slack Payment Confirmed not found');
  const upos = updateNode.position || [0, 0];

  // 2) Airwallex Auth node — HTTP Request with the stored httpCustomAuth
  // credential. Code nodes on this instance lack requestWithAuthentication,
  // so auth must happen in a regular node.
  let authNode = wf.nodes.find(n => n.name === 'Airwallex Auth');
  if (!authNode) {
    authNode = {
      id: 'n27',
      name: 'Airwallex Auth',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [upos[0] + 110, upos[1] + 180],
      continueOnFail: true,
      credentials: { httpCustomAuth: { id: AW_CRED_ID, name: AW_CRED_NAME } },
      parameters: {
        method: 'POST',
        url: 'https://api.airwallex.com/api/v1/authentication/login',
        authentication: 'genericCredentialType',
        genericAuthType: 'httpCustomAuth',
        options: {}
      }
    };
    wf.nodes.push(authNode);
    console.log('auth node: added');
  } else {
    console.log('auth node: already present');
  }

  // 3) Guarded mark-paid node — create or overwrite jsCode with current version
  let guardNode = wf.nodes.find(n => n.name === 'Airwallex Guarded Mark Paid');
  if (!guardNode) {
    guardNode = {
      id: 'n26',
      name: 'Airwallex Guarded Mark Paid',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [upos[0] + 220, upos[1] + 180],
      continueOnFail: true,
      parameters: { mode: 'runOnceForEachItem', jsCode: AW_GUARD_CODE }
    };
    wf.nodes.push(guardNode);
    console.log('guard node: added');
  } else {
    guardNode.parameters.jsCode = AW_GUARD_CODE;
    delete guardNode.credentials; // v1 attached the credential here; auth node owns it now
    console.log('guard node: jsCode updated to auth-node version');
  }

  // 4) Wiring: Update Invoice Status → Airwallex Auth → Guarded → Slack
  //    (ClickUp branch from Update Invoice Status untouched)
  const c = wf.connections;
  const outs = c['Update Invoice Status'].main[0];
  const downstreamIdx = outs.findIndex(o => o.node === 'Slack Payment Confirmed' || o.node === 'Airwallex Guarded Mark Paid' || o.node === 'Airwallex Auth');
  if (downstreamIdx === -1) throw new Error('Update Invoice Status downstream connection not found');
  outs[downstreamIdx] = { node: 'Airwallex Auth', type: 'main', index: 0 };
  c['Airwallex Auth'] = { main: [[{ node: 'Airwallex Guarded Mark Paid', type: 'main', index: 0 }]] };
  c['Airwallex Guarded Mark Paid'] = { main: [[{ node: 'Slack Payment Confirmed', type: 'main', index: 0 }]] };

  // 5) Append Airwallex status line to the Slack confirmation text
  if (!slackNode.parameters.text.includes('awStatusLine')) {
    const tail = "' }}";
    if (!slackNode.parameters.text.endsWith(tail)) throw new Error('Slack Payment Confirmed text does not end with expected tail');
    slackNode.parameters.text = slackNode.parameters.text.slice(0, -tail.length)
      + "\\n• Airwallex: ' + ($json.awStatusLine || 'status unknown') }}";
    console.log('slack node: Airwallex status line appended');
  } else {
    console.log('slack node: Airwallex status line already present');
  }

  // 5) Strip read-only fields for PUT — allowlist settings keys
  const allowedSettingsKeys = ['executionOrder','saveManualExecutions','saveDataErrorExecution','saveDataSuccessExecution','saveExecutionProgress','timezone','timeSavedPerExecution','errorWorkflow','callerPolicy','executionTimeout'];
  const settings = {};
  for (const k of allowedSettingsKeys) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
  const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings };
  if (wf.staticData) payload.staticData = wf.staticData;

  console.log('\n=== TARGET STATE ===');
  console.log('Match Deposits To Invoices: awMarkEligible/awEligibilityReason confidence gate');
  console.log('Airwallex Auth (HTTP Request, httpCustomAuth credential ' + AW_CRED_ID + ') — login, no secrets in code');
  console.log('Airwallex Guarded Mark Paid (Code) — GET invoice → verify currency/amount/status → mark_as_paid');
  console.log('Wiring: Update Invoice Status → Airwallex Auth → Guarded Mark Paid → Slack Payment Confirmed');
  console.log('Slack Payment Confirmed: "• Airwallex: <status>" line');
  console.log('Total nodes: ' + wf.nodes.length);

  // Snapshot for inspection. The new guard node carries no secrets (creds live
  // in the n8n credential store); legacy n17 inline creds are redacted if the
  // env vars are present.
  let snapshotText = JSON.stringify(payload, null, 2);
  for (const [envKey, label] of [['AIRWALLEX_API_KEY', '<REDACTED_AIRWALLEX_API_KEY>'], ['AIRWALLEX_CLIENT_ID', '<REDACTED_AIRWALLEX_CLIENT_ID>']]) {
    if (process.env[envKey]) snapshotText = snapshotText.split(process.env[envKey]).join(label);
  }
  const patchedPath = path.join(__dirname, 'snapshots', 'payment-detection-post-aw-markpaid.json');
  fs.writeFileSync(patchedPath, snapshotText);
  console.log('Patched payload written to', patchedPath, '(legacy inline creds redacted)');

  if (DRY_RUN) {
    console.log('\nDRY RUN — no changes applied. Re-run with --apply to PUT.');
    return;
  }

  console.log('\nPUT', WORKFLOW_ID);
  await req('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, payload);
  console.log('OK — workflow updated.');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
