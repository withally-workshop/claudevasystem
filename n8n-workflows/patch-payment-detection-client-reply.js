// Surgical patch: Payment Detection — add Client Payment Reply branch
//
// Adds a third detection branch that catches client-reply payment confirmations
// (from non-Airwallex bank flows like Eclipse Ventures Pte. Ltd.) and routes
// them to the existing Slack Needs Review node — never auto-marks paid.
//
// Reason: 2026-05-07 Nutrition Kitchen 2/2 silent-miss exposed gap.
// Spec:   docs/superpowers/specs/2026-05-07-payment-detection-client-reply-branch.md
//
// Usage:
//   node n8n-workflows/patch-payment-detection-client-reply.js --dry-run   # diff only
//   node n8n-workflows/patch-payment-detection-client-reply.js --apply     # PUT live
//
// Live workflow ID: NurOLZkg3J6rur5Q

const https = require('https');
const fs = require('fs');
const path = require('path');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const WORKFLOW_ID = 'NurOLZkg3J6rur5Q';
const API_KEY = process.env.N8N_API_KEY;
if (!API_KEY) { console.error('N8N_API_KEY not set'); process.exit(1); }

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const APPLY = args.includes('--apply');
if (!DRY_RUN && !APPLY) { console.error('pass --dry-run or --apply'); process.exit(1); }

// ─── New Claim Window code (adds clientReplyQuery field, preserves gmailQuery) ───
const NEW_CLAIM_WINDOW_CODE = `
const staticData = $getWorkflowStaticData('global');
const lastRunTs = staticData.lastRunTs || 0;
const nowTs = Math.floor(Date.now() / 1000);
staticData.lastRunTs = nowTs;
const afterFilter = lastRunTs > 0 ? 'after:' + lastRunTs : 'newer_than:1d';

const airwallexClause = '(from:airwallex.com (subject:payment OR subject:deposit OR subject:received))';
// Forwarded receipts: require to:noa@kravemedia.co (skips reminder CCs) AND
// explicitly exclude reminder/follow-up phrases as a belt-and-suspenders guard.
const forwardedClause = '(from:john@kravemedia.co to:noa@kravemedia.co (subject:receipt OR subject:wire OR subject:transfer OR subject:paid OR subject:confirmation OR subject:fwd OR subject:fw OR subject:INV) -subject:reminder -subject:"following up" -subject:"due today" -subject:overdue)';
const gmailQuery = '(' + airwallexClause + ' OR ' + forwardedClause + ') ' + afterFilter;

// Client-reply payment confirmations (non-Airwallex bank flows). Coarse net at
// the Gmail layer; the parser does strict phrase + tracker matching downstream.
const clientReplyQuery = 'has:attachment -from:airwallex.com -from:noa@kravemedia.co -from:john@kravemedia.co -from:amanda@kravemedia.co -from:josh@kravemedia.co -subject:reminder -subject:"following up" -subject:"due today" -subject:overdue ' + afterFilter;

return [{ json: { lastRunTs, nowTs, gmailQuery, clientReplyQuery } }];
`.trim();

// ─── New Parse Client Replies code ───
// Reads $('Get Invoice Tracker') for fuzzy match by sender domain.
// Emits payloads in the shape Slack Needs Review expects:
//   { subject, source, parsedAmount, parsedCurrency, parsedInvoiceNumber,
//     parsedClientName, reason, emailId }
// Uses processedClientReplyIds (last 200) static data for idempotency,
// separate from processedEmailIds to avoid colliding with Airwallex branch.
const PARSE_CLIENT_REPLIES_CODE = `
const staticData = $getWorkflowStaticData('global');
const seen = staticData.processedClientReplyIds || [];
const seenSet = new Set(seen);

const PHRASES = [
  'payment is done', 'payment done', 'payment completed', 'payment has been made',
  'payment was made', 'transfer details', 'transfer notice', 'payment slip',
  'remittance advice', 'proof of payment', 'transferred today', 'kindly find attached',
  'please find attached the transfer', 'pls find attached the transfer'
];
const NEG = ['following up','gentle reminder','wanted to check in','chasing','just checking','will pay','will be paid','will transfer'];
const DENY_DOMAINS = ['stripe.com','shopify.com','paypal.com','gusto.com','airwallex.com','kravemedia.co'];

let trackerRows = [];
try { trackerRows = $('Get Invoice Tracker').all(); } catch(e) {}

const items = $input.all();
const out = [];
for (const item of items) {
  const msg = item.json;
  const emailId = msg.id;
  if (seenSet.has(emailId)) continue;

  const headers = (msg.payload && msg.payload.headers) || [];
  const subject = (headers.find(h => h.name && h.name.toLowerCase() === 'subject') || {}).value || '';
  const fromHeader = (headers.find(h => h.name && h.name.toLowerCase() === 'from') || {}).value || '';
  const fromMatch = fromHeader.match(/<([^>]+)>/) || [null, fromHeader];
  const fromEmail = (fromMatch[1] || '').toLowerCase().trim();
  const fromDomain = fromEmail.split('@')[1] || '';

  if (!fromDomain || DENY_DOMAINS.includes(fromDomain)) continue;

  let body = '';
  try {
    const payload = msg.payload || {};
    if (payload.body && payload.body.data) {
      body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    } else if (payload.parts) {
      for (const part of (payload.parts || [])) {
        if (part.mimeType === 'text/plain' && part.body && part.body.data) {
          body = Buffer.from(part.body.data, 'base64').toString('utf-8'); break;
        }
        for (const sub of (part.parts || [])) {
          if (sub.mimeType === 'text/plain' && sub.body && sub.body.data) {
            body = Buffer.from(sub.body.data, 'base64').toString('utf-8'); break;
          }
        }
      }
    }
    if (!body && msg.snippet) body = msg.snippet;
  } catch(e) {}

  const haystack = (subject + ' ' + body).toLowerCase();
  if (NEG.some(n => haystack.includes(n))) continue;
  if (!PHRASES.some(p => haystack.includes(p))) continue;

  // Tracker fuzzy match by sender domain
  let trackerHit = null;
  for (const r of trackerRows) {
    const j = r.json || {};
    const clientEmail = (j['Client Email'] || '').toString().toLowerCase();
    const clientDomain = clientEmail.split('@')[1] || '';
    const status = (j['Payment Status'] || '').toString().toLowerCase();
    if (clientDomain && fromDomain.endsWith(clientDomain) && status !== 'payment complete' && status !== 'paid') {
      trackerHit = j; break;
    }
  }

  // Inline invoice# (rare on client replies but check anyway)
  const invMatch = (subject + ' ' + body).match(/INV-[\\w\\d-]+/i);
  const invoiceNumber = invMatch ? invMatch[0].toUpperCase() : (trackerHit ? (trackerHit['Invoice Number'] || trackerHit['Invoice'] || null) : null);

  if (!trackerHit && !invoiceNumber) continue; // insufficient evidence

  const parsedAmount = trackerHit ? (trackerHit['Outstanding'] || trackerHit['Amount'] || null) : null;
  const parsedCurrency = trackerHit ? (trackerHit['Currency'] || '') : '';
  const parsedClientName = trackerHit ? (trackerHit['Client'] || trackerHit['Client Name'] || fromDomain) : fromDomain;

  out.push({
    json: {
      subject,
      source: 'client-reply',
      parsedAmount,
      parsedCurrency,
      parsedInvoiceNumber: invoiceNumber,
      parsedClientName,
      reason: 'Client payment-confirmation reply detected (phrase + tracker domain match). Forward from john@→noa@ to mark paid.',
      emailId
    }
  });

  seen.push(emailId);
}

// Cap idempotency list at last 200
staticData.processedClientReplyIds = seen.slice(-200);

// Cap Slack volume to 10/run as a safety
const capped = out.slice(0, 10);
return capped;
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

  const hasPatch = wf.nodes.some(n => n.name === 'Search Client Replies' || n.name === 'Parse Client Replies');
  if (hasPatch) {
    console.log('Patch already applied — Search Client Replies / Parse Client Replies node present. Aborting.');
    process.exit(0);
  }

  // 1) Update Claim Window jsCode
  const claim = wf.nodes.find(n => n.name === 'Claim Window');
  if (!claim) throw new Error('Claim Window node not found');
  claim.parameters.jsCode = NEW_CLAIM_WINDOW_CODE;

  // 2) Find existing template nodes for credential reuse
  const tplGmail = wf.nodes.find(n => n.name === 'Search Airwallex Emails');
  const tplSlackReview = wf.nodes.find(n => n.name === 'Slack Needs Review');
  if (!tplGmail || !tplSlackReview) throw new Error('template nodes missing');

  // Position new nodes below existing ones in the canvas
  const pos = (claim.position || [0, 0]);
  const newSearch = {
    id: 'n24',
    name: 'Search Client Replies',
    type: 'n8n-nodes-base.gmail',
    typeVersion: tplGmail.typeVersion,
    position: [pos[0] + 320, pos[1] + 360],
    parameters: {
      operation: 'getAll',
      limit: 50,
      filters: { q: "={{ $('Claim Window').first().json.clientReplyQuery }}" }
    },
    credentials: tplGmail.credentials
  };
  const newParse = {
    id: 'n25',
    name: 'Parse Client Replies',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [pos[0] + 640, pos[1] + 360],
    parameters: { jsCode: PARSE_CLIENT_REPLIES_CODE }
  };

  wf.nodes.push(newSearch, newParse);

  // 3) Connections — fan Claim Window into the new search; route parser → Slack Needs Review
  const c = wf.connections;
  // Add Claim Window → Search Client Replies (in addition to existing fan-out)
  c['Claim Window'].main[0].push({ node: 'Search Client Replies', type: 'main', index: 0 });
  // Search Client Replies → Parse Client Replies
  c['Search Client Replies'] = { main: [[{ node: 'Parse Client Replies', type: 'main', index: 0 }]] };
  // Parse Client Replies → Slack Needs Review (direct, bypassing Match Deposits)
  c['Parse Client Replies'] = { main: [[{ node: 'Slack Needs Review', type: 'main', index: 0 }]] };

  // 4) Strip read-only fields for PUT — public PUT schema rejects unknown
  // settings properties (e.g. availableInMCP), so allowlist explicitly.
  const allowedSettingsKeys = ['executionOrder','saveManualExecutions','saveDataErrorExecution','saveDataSuccessExecution','saveExecutionProgress','timezone','timeSavedPerExecution','errorWorkflow','callerPolicy','executionTimeout'];
  const settings = {};
  for (const k of allowedSettingsKeys) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
  const payload = {
    name: wf.name,
    nodes: wf.nodes,
    connections: wf.connections,
    settings
  };
  if (wf.staticData) payload.staticData = wf.staticData;

  // Diff summary
  console.log('\n=== DIFF ===');
  console.log('Claim Window: jsCode updated (+ clientReplyQuery)');
  console.log('Added nodes:');
  console.log('  + Search Client Replies (Gmail) — q = clientReplyQuery');
  console.log('  + Parse Client Replies (Code)   — phrase + tracker fuzzy match → Needs Review payload');
  console.log('Connections:');
  console.log('  + Claim Window → Search Client Replies');
  console.log('  + Search Client Replies → Parse Client Replies');
  console.log('  + Parse Client Replies → Slack Needs Review');
  console.log('Total nodes: ' + wf.nodes.length);

  // Save the patched payload for inspection
  const patchedPath = path.join(__dirname, 'snapshots', 'payment-detection-post-client-reply.json');
  fs.writeFileSync(patchedPath, JSON.stringify(payload, null, 2));
  console.log('Patched payload written to', patchedPath);

  if (DRY_RUN) {
    console.log('\nDRY RUN — no changes applied. Re-run with --apply to PUT.');
    return;
  }

  console.log('\nPUT', WORKFLOW_ID);
  await req('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, payload);
  console.log('OK — workflow updated.');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
