// patch-approval-reply-trigger.js
//
// Hardens the Approval Reply Trigger workflow (arUrmWEgjzuVc27Y):
//
// Fix 1: Add Slack retry guard — if X-Slack-Retry-Num header is present,
//         respond 200 immediately without triggering the polling.
//         Prevents double-firing when Slack retries a slow response.
//
// Fix 2: Tighten "approve" match from startsWith("approve") to
//         /^approve(\s|$)/i — prevents false matches on "approved", "approving" etc.
//
// Safe to re-run.

const https = require('https');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf8');
env.split('\n').forEach(l => { const [k,...v]=l.split('='); if(k&&v) process.env[k.trim()]=v.join('=').trim(); });

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = 'arUrmWEgjzuVc27Y';

const JOHN_USER_ID        = 'U0AM5EGRVTP';
const JOHN_APPROVAL_CHANNEL = 'C0AQZGJDR38';

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
  const connections = wf.connections || {};

  // --- Fix 1: Add Slack Retry Guard node after Webhook Trigger ---
  const hasRetryGuard = nodes.some(n => n.name === 'Is Slack Retry?');

  if (!hasRetryGuard) {
    // Retry guard IF node — positioned between Webhook and Is URL Verification?
    const retryGuardNode = {
      id: 'ng1', name: 'Is Slack Retry?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.1,
      position: [110, 0],
      parameters: {
        conditions: {
          options: { caseSensitive: false, leftValue: '', typeValidation: 'loose' },
          conditions: [{
            id: 'r1',
            leftValue: '={{ $json.headers["x-slack-retry-num"] || "" }}',
            rightValue: '',
            operator: { type: 'string', operation: 'notEquals' },
          }],
          combinator: 'and',
        },
        options: {},
      },
    };

    // Retry respond node — 200 OK and stop
    const retryRespondNode = {
      id: 'ng2', name: 'Respond OK (Retry)',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: [330, -160],
      parameters: {
        respondWith: 'json',
        responseBody: '={{ { ok: true } }}',
        options: { responseCode: 200 },
      },
    };

    nodes.push(retryGuardNode, retryRespondNode);

    // Re-wire: Webhook → Is Slack Retry? (instead of directly to Is URL Verification?)
    const webhookNode = nodes.find(n => n.name === 'Slack Event Webhook');
    if (webhookNode) {
      connections['Slack Event Webhook'] = {
        main: [[{ node: 'Is Slack Retry?', type: 'main', index: 0 }]],
      };
    }

    // Is Slack Retry? true → Respond OK (Retry); false → Is URL Verification?
    connections['Is Slack Retry?'] = {
      main: [
        [{ node: 'Respond OK (Retry)',    type: 'main', index: 0 }], // true = is a retry
        [{ node: 'Is URL Verification?', type: 'main', index: 0 }], // false = first delivery
      ],
    };

    console.log('Fix 1: Is Slack Retry? guard node added.');
  } else {
    console.log('Fix 1: retry guard already present, skipping.');
  }

  // --- Fix 2: Tighten "approve" match in Is John Approval? node ---
  const approvalNode = nodes.find(n => n.name === 'Is John Approval?');
  if (!approvalNode) {
    console.error('ERROR: Is John Approval? node not found.');
    process.exit(1);
  }

  const conditions = approvalNode.parameters?.conditions?.conditions || [];
  const approveCondition = conditions.find(c =>
    (c.leftValue || '').includes('startsWith')
  );

  if (approveCondition) {
    // Replace startsWith with regex test
    approveCondition.leftValue =
      '={{ /^approve(\\s|$)/i.test(($json.body.event?.text || "").trimStart()) }}';
    approveCondition.rightValue = true;
    console.log('Fix 2: "approve" match tightened to /^approve(\\s|$)/i.');
  } else {
    // Already patched or using different form — check
    const alreadyPatched = conditions.some(c =>
      (c.leftValue || '').includes('/^approve')
    );
    if (alreadyPatched) {
      console.log('Fix 2: already patched, skipping.');
    } else {
      console.warn('WARN: Could not locate approve condition to patch. Current conditions:');
      conditions.forEach((c, i) => console.warn('  [' + i + ']', JSON.stringify(c).substring(0, 200)));
    }
  }

  const updated = await n8nRequest('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, {
    name: wf.name,
    nodes,
    connections,
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

  console.log('SUCCESS — Approval Reply Trigger hardened.');
}

patch().catch(console.error);
