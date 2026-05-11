// patch-payment-detection-gmail-query.js
//
// Fixes the forwardedClause in the Claim Window node:
//   - Removes `subject:INV` — matches invoice delivery/reissue emails, not payment receipts
//   - Adds `-subject:reissued` and `-subject:invoice` exclusions
//
// Safe to re-run: GET → patch in memory → PUT.

const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = 'NurOLZkg3J6rur5Q';

const NEW_CLAIM_WINDOW_CODE = `
const staticData = $getWorkflowStaticData('global');
const lastRunTs = staticData.lastRunTs || 0;
const nowTs = Math.floor(Date.now() / 1000);
staticData.lastRunTs = nowTs;
const afterFilter = lastRunTs > 0 ? 'after:' + lastRunTs : 'newer_than:1d';

const airwallexClause = '(from:airwallex.com (subject:payment OR subject:deposit OR subject:received))';
// Forwarded payment receipts from John: require clear payment-signal words in subject.
// subject:INV removed — it matched invoice delivery/reissue emails, not payment receipts.
// Added -subject:reissued -subject:invoice as belt-and-suspenders exclusions.
const forwardedClause = '(from:john@kravemedia.co to:noa@kravemedia.co (subject:receipt OR subject:wire OR subject:transfer OR subject:paid OR subject:confirmation OR subject:fwd OR subject:fw) -subject:reminder -subject:"following up" -subject:"due today" -subject:overdue -subject:reissued -subject:invoice)';
const gmailQuery = '(' + airwallexClause + ' OR ' + forwardedClause + ') ' + afterFilter;

const clientReplyQuery = 'has:attachment -from:airwallex.com -from:noa@kravemedia.co -from:john@kravemedia.co -from:amanda@kravemedia.co -from:josh@kravemedia.co -subject:reminder -subject:"following up" -subject:"due today" -subject:overdue ' + afterFilter;

return [{ json: { lastRunTs, nowTs, gmailQuery, clientReplyQuery } }];
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
  const claimNode = nodes.find(n => n.name === 'Claim Window');
  if (!claimNode) {
    console.error('ERROR: Claim Window node not found.');
    process.exit(1);
  }

  const current = claimNode.parameters.jsCode || '';
  if (!current.includes('subject:INV')) {
    console.log('subject:INV already removed. Nothing to do.');
    return;
  }

  claimNode.parameters.jsCode = NEW_CLAIM_WINDOW_CODE;

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

  const verify = (updated.nodes || []).find(n => n.name === 'Claim Window');
  const code = verify?.parameters?.jsCode || '';
  if (code.includes('subject:INV')) {
    console.error('ERROR: subject:INV still present after patch.');
    process.exit(1);
  }

  console.log('SUCCESS — Claim Window patched.');
  console.log('  - subject:INV removed from forwardedClause');
  console.log('  - -subject:reissued added');
  console.log('  - -subject:invoice added');
}

patch().catch(console.error);
