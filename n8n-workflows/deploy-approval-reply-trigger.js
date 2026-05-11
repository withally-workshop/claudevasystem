// deploy-approval-reply-trigger.js
//
// Deploys: Approval Reply Trigger (new workflow)
//
// Purpose: fires the Invoice Approval Polling workflow the moment John posts
// "approve" (or "approve <URL>") in #airwallex-drafts, instead of waiting
// for the next scheduled run.
//
// How it works:
//   1. Slack Events API sends a POST to the webhook URL whenever a message
//      is posted in a channel the Slack app has joined.
//   2. This workflow filters to: John's messages in #airwallex-drafts that
//      start with "approve".
//   3. On match: calls the approval polling webhook immediately.
//   4. Slack URL verification (the one-time challenge) is handled inline.
//
// After deploying, do the following ONE-TIME setup in the Slack app:
//   1. Go to https://api.slack.com/apps → your app → Event Subscriptions
//   2. Turn on "Enable Events"
//   3. Set Request URL to:
//        https://noatakhel.app.n8n.cloud/webhook/krave-approval-reply-trigger
//      Slack will send a challenge — the workflow handles it automatically.
//   4. Under "Subscribe to bot events", add: message.channels
//   5. Save and reinstall the app (Slack will prompt).
//   6. Make sure the Krave bot is a member of #airwallex-drafts.

const https = require('https');
const fs = require('fs');

// Load .env
const env = fs.readFileSync('.env', 'utf8');
env.split('\n').forEach(l => { const [k,...v]=l.split('='); if(k&&v) process.env[k.trim()]=v.join('=').trim(); });

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;

const JOHN_APPROVAL_CHANNEL = 'C0AQZGJDR38'; // #airwallex-drafts
const JOHN_USER_ID          = 'U0AM5EGRVTP';
const APPROVAL_POLLING_WEBHOOK = 'https://noatakhel.app.n8n.cloud/webhook/krave-invoice-approval-polling';
const WEBHOOK_PATH = 'krave-approval-reply-trigger';

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

const workflow = {
  name: 'Approval Reply Trigger',
  settings: {
    timezone: 'Asia/Manila',
    executionOrder: 'v1',
    saveManualExecutions: true,
  },
  nodes: [
    // 1. Webhook — receives all Slack event payloads
    {
      id: 'n1', name: 'Slack Event Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [0, 0],
      webhookId: WEBHOOK_PATH,
      parameters: {
        httpMethod: 'POST',
        path: WEBHOOK_PATH,
        responseMode: 'responseNode', // Respond via Respond to Webhook nodes
        options: {},
      },
    },

    // 2. Is this a URL verification challenge from Slack?
    {
      id: 'n2', name: 'Is URL Verification?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.1,
      position: [220, 0],
      parameters: {
        conditions: {
          options: { caseSensitive: false, leftValue: '', typeValidation: 'loose' },
          conditions: [{
            id: 'c1',
            leftValue: '={{ $json.body.type }}',
            rightValue: 'url_verification',
            operator: { type: 'string', operation: 'equals' },
          }],
          combinator: 'and',
        },
        options: {},
      },
    },

    // 3a. TRUE branch — echo the challenge back to Slack
    {
      id: 'n3', name: 'Respond Challenge',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: [440, -120],
      parameters: {
        respondWith: 'json',
        responseBody: '={{ { challenge: $json.body.challenge } }}',
        options: { responseCode: 200 },
      },
    },

    // 3b. FALSE branch — is this John's "approve" message in #airwallex-drafts?
    {
      id: 'n4', name: 'Is John Approval?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.1,
      position: [440, 120],
      parameters: {
        conditions: {
          options: { caseSensitive: false, leftValue: '', typeValidation: 'loose' },
          conditions: [
            {
              id: 'c1',
              leftValue: '={{ $json.body.event?.type }}',
              rightValue: 'message',
              operator: { type: 'string', operation: 'equals' },
            },
            {
              id: 'c2',
              leftValue: '={{ $json.body.event?.user }}',
              rightValue: JOHN_USER_ID,
              operator: { type: 'string', operation: 'equals' },
            },
            {
              id: 'c3',
              leftValue: '={{ $json.body.event?.channel }}',
              rightValue: JOHN_APPROVAL_CHANNEL,
              operator: { type: 'string', operation: 'equals' },
            },
            {
              id: 'c4',
              // message text starts with "approve" (case insensitive)
              leftValue: '={{ ($json.body.event?.text || "").toLowerCase().trimStart().startsWith("approve") }}',
              rightValue: true,
              operator: { type: 'boolean', operation: 'equals' },
            },
            {
              id: 'c5',
              // ignore bot messages and edits
              leftValue: '={{ !$json.body.event?.subtype }}',
              rightValue: true,
              operator: { type: 'boolean', operation: 'equals' },
            },
          ],
          combinator: 'and',
        },
        options: {},
      },
    },

    // 4. Fire the approval polling webhook
    {
      id: 'n5', name: 'Trigger Approval Polling',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [660, 0],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: APPROVAL_POLLING_WEBHOOK,
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '{}',
        options: {},
      },
    },

    // 5. Acknowledge to Slack (200 OK)
    {
      id: 'n6', name: 'Respond OK',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: [880, 0],
      parameters: {
        respondWith: 'json',
        responseBody: '={{ { ok: true } }}',
        options: { responseCode: 200 },
      },
    },

    // 6. Slack sent something we don't care about — still 200 OK
    {
      id: 'n7', name: 'Respond OK (No-op)',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: [660, 240],
      parameters: {
        respondWith: 'json',
        responseBody: '={{ { ok: true } }}',
        options: { responseCode: 200 },
      },
    },
  ],

  connections: {
    'Slack Event Webhook':  { main: [[{ node: 'Is URL Verification?', type: 'main', index: 0 }]] },
    'Is URL Verification?': {
      main: [
        [{ node: 'Respond Challenge', type: 'main', index: 0 }],   // true
        [{ node: 'Is John Approval?', type: 'main', index: 0 }],   // false
      ],
    },
    'Is John Approval?': {
      main: [
        [{ node: 'Trigger Approval Polling', type: 'main', index: 0 }], // true
        [{ node: 'Respond OK (No-op)',        type: 'main', index: 0 }], // false
      ],
    },
    'Trigger Approval Polling': { main: [[{ node: 'Respond OK', type: 'main', index: 0 }]] },
  },

  staticData: null,
};

async function deploy() {
  if (!API_KEY) {
    console.error('ERROR: N8N_API_KEY not set in .env');
    process.exit(1);
  }

  // Check for existing workflow by name
  console.log('Checking for existing Approval Reply Trigger workflow...');
  const existing = await n8nRequest('GET', '/api/v1/workflows?limit=100');
  const found = (existing.data || []).find(w => w.name === 'Approval Reply Trigger');
  if (found) {
    console.log('Found existing workflow:', found.id, '— updating...');
    const updated = await n8nRequest('PUT', `/api/v1/workflows/${found.id}`, {
      name: workflow.name,
      nodes: workflow.nodes,
      connections: workflow.connections,
      settings: workflow.settings,
      staticData: null,
    });
    if (!updated.id) {
      console.error('ERROR during PUT:', JSON.stringify(updated, null, 2).substring(0, 2000));
      process.exit(1);
    }
    // Activate
    await n8nRequest('POST', `/api/v1/workflows/${updated.id}/activate`);
    console.log('SUCCESS — workflow updated and activated.');
    console.log('Workflow ID:', updated.id);
  } else {
    console.log('Creating new workflow...');
    const { active: _active, ...workflowBody } = workflow;
    const created = await n8nRequest('POST', '/api/v1/workflows', workflowBody);
    if (!created.id) {
      console.error('ERROR during POST:', JSON.stringify(created, null, 2).substring(0, 2000));
      process.exit(1);
    }
    await n8nRequest('POST', `/api/v1/workflows/${created.id}/activate`);
    console.log('SUCCESS — workflow created and activated.');
    console.log('Workflow ID:', created.id);
  }

  console.log('');
  console.log('Webhook URL (use this in Slack app Event Subscriptions):');
  console.log(`  ${N8N_URL}/webhook/${WEBHOOK_PATH}`);
  console.log('');
  console.log('One-time Slack app setup:');
  console.log('  1. https://api.slack.com/apps → your app → Event Subscriptions');
  console.log('  2. Enable Events → Request URL: ' + N8N_URL + '/webhook/' + WEBHOOK_PATH);
  console.log('  3. Bot Events → Add: message.channels');
  console.log('  4. Save → reinstall app');
  console.log('  5. Invite the bot to #airwallex-drafts if not already a member');
}

deploy().catch(console.error);
