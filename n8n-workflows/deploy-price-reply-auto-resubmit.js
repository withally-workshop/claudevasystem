const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = process.env.PRICE_REPLY_RESUBMIT_WORKFLOW_ID || '';

const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD';
const PAYMENTS_CHANNEL = 'C09HN2EBPR7';
const INTAKE_WEBHOOK = 'https://noatakhel.app.n8n.cloud/webhook/krave-invoice-request-intake';

// ── Code nodes ──────────────────────────────────────────────────────────────

// Finds bot "price is missing" messages in #payments-invoices-updates that:
// - contain "price is missing from the line item"
// - do NOT have a ✅ reaction (i.e. not yet actioned)
const FIND_PRICE_PROMPTS_CODE = `
const messages = ($input.all()[0] || {}).json?.messages || [];
const pricePrompts = messages.filter(m => {
  const text = (m.text || '').toLowerCase();
  const isBot = !!(m.bot_id || m.app_id);
  const hasPriceMissing = text.includes('price is missing from line item') || text.includes('price is missing from the line item');
  const hasCheck = (m.reactions || []).some(r => r.name === 'white_check_mark');
  return isBot && hasPriceMissing && !hasCheck;
});
if (pricePrompts.length === 0) return [];
return pricePrompts.map(m => ({
  json: {
    prompt_ts: m.ts,
    thread_ts: m.thread_ts || m.ts,
  }
}));
`.trim();

// For each price-prompt thread, extracts the amount reply and original receipt.
// Zips: $items('Find Price Prompts')[i] ↔ $input.all()[i] (thread replies)
// Outputs one item per valid thread (i.e. has a non-bot amount reply without ✅)
const STRAT_ID_MAP = JSON.stringify({
  amanda: 'U07J8SRCPGU',
  jeneena: 'U07R7FU4WBV',
  sybil: 'U0A2HLNV8NM',
  noa: 'U06TBGX9L93',
  john: 'U0AM5EGRVTP',
});

const PARSE_REPLY_CONTEXT_CODE = `
const STRAT_SLACK = ${STRAT_ID_MAP};
const prompts = $items('Find Price Prompts').map(i => i.json);
const results = [];

$input.all().forEach((item, idx) => {
  const prompt = prompts[idx] || {};
  const messages = (item.json.messages || []);
  if (messages.length === 0) return;

  // Thread parent = messages[0] (original receipt)
  const receiptMsg = messages[0] || {};
  const receiptText = receiptMsg.text || '';

  // Find amount reply: non-bot, contains a number, no ✅
  const amountReply = messages.find(m => {
    if (m.ts === receiptMsg.ts) return false;
    if (m.bot_id || m.app_id) return false;
    const hasNumber = /[\\d,]+/.test((m.text || '').replace(/\\s/g, ''));
    const hasCheck = (m.reactions || []).some(r => r.name === 'white_check_mark');
    return hasNumber && !hasCheck;
  });
  if (!amountReply) return;

  // Parse original receipt fields
  const field = (label) => {
    const m = receiptText.match(new RegExp('- ' + label + ':\\\\s*(.+)'));
    return m ? m[1].trim() : '';
  };

  const clientName = field('Client');
  const clientEmail = field('Email');
  const amountLine = field('Amount');
  const currency = (amountLine.match(/^([A-Z]{3})/) || [])[1] || 'USD';
  const payoutRaw = field('Payout') || '7 day payout';
  const dueDate = field('Due Date');
  const memo = field('Memo');
  const requesterRaw = field('Requester');
  const lineItemsRaw = field('Line Items');

  if (!clientName || !clientEmail) return;

  // Resolve requester to Slack user ID
  const requesterLower = requesterRaw.toLowerCase().replace(/^@/, '');
  const requesterSlackId = STRAT_SLACK[requesterLower] || requesterRaw;

  // Parse amount from reply text
  const replyText = amountReply.text || '';
  const amtMatch = replyText.match(/([\\d,]+(?:\\.\\d+)?)/);
  const unitPrice = amtMatch ? parseFloat(amtMatch[1].replace(/,/g, '')) : 0;
  if (!unitPrice) return;

  // Parse line item description from receipt (first item, extract description)
  const firstItem = (lineItemsRaw.split(';')[0] || '').trim();
  const descMatch = firstItem.match(/^(.+?)(?:\\s*[|@]|\\s+[\\d,.]+$)/);
  const description = (descMatch ? descMatch[1] : firstItem).trim() || 'Services';

  const today = new Date().toISOString().split('T')[0];

  results.push({ json: {
    reply_ts: amountReply.ts,
    original_ts: prompt.thread_ts,
    intake_payload: JSON.stringify({
      client_name: clientName,
      client_email: clientEmail,
      currency,
      payout_raw: payoutRaw,
      invoice_date: today,
      memo,
      origin_channel_id: '${PAYMENTS_CHANNEL}',
      origin_thread_ts: prompt.thread_ts,
      submitted_by_slack_user_id: requesterSlackId,
      line_items: [{ description, quantity: 1, unit_price: unitPrice }],
    }),
  }});
});

return results;
`.trim();

// Restore context from Parse step for Submit to Intake
const RESTORE_FOR_INTAKE_CODE = `
const contexts = $items('Parse Reply Context').map(i => i.json);
return $input.all().map((item, idx) => ({ json: contexts[idx] || {} })).filter(i => i.json.intake_payload);
`.trim();

// Restore context from Parse step for React to Original
const RESTORE_FOR_ORIGINAL_CODE = `
const contexts = $items('Parse Reply Context').map(i => i.json);
return $input.all().map((item, idx) => ({ json: contexts[idx] || {} })).filter(i => i.json.original_ts);
`.trim();

// ── Workflow definition ──────────────────────────────────────────────────────

const workflow = {
  name: 'Krave — Price Reply Auto-Resubmit',
  settings: { executionOrder: 'v1', saveManualExecutions: true, timezone: 'Asia/Manila' },
  nodes: [
    // ── Triggers ──────────────────────────────────────────────────────────
    {
      id: 'n1', name: 'Schedule Trigger',
      type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
      position: [200, 200],
      parameters: {
        rule: { interval: [{ field: 'cronExpression', expression: '*/10 * * * *' }] },
      },
    },
    {
      id: 'n2', name: 'Webhook Trigger',
      type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [200, 400],
      webhookId: 'krave-price-reply-resubmit',
      parameters: { httpMethod: 'POST', path: 'krave-price-reply-resubmit', responseMode: 'onReceived', options: {} },
    },

    // ── Step 1: Scan channel ───────────────────────────────────────────────
    {
      id: 'n3', name: 'Get Channel History',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [440, 300],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'GET',
        url: 'https://slack.com/api/conversations.history',
        sendQuery: true,
        queryParameters: { parameters: [
          { name: 'channel', value: PAYMENTS_CHANNEL },
          { name: 'limit', value: '200' },
        ]},
        options: {},
      },
    },
    {
      id: 'n4', name: 'Find Price Prompts',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [660, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: FIND_PRICE_PROMPTS_CODE },
    },

    // ── Step 2: Get thread replies for each prompt ─────────────────────────
    {
      id: 'n5', name: 'Get Thread Replies',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [880, 300],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'GET',
        url: 'https://slack.com/api/conversations.replies',
        sendQuery: true,
        queryParameters: { parameters: [
          { name: 'channel', value: PAYMENTS_CHANNEL },
          { name: 'ts', value: '={{ $json.thread_ts }}' },
          { name: 'limit', value: '50' },
        ]},
        options: {},
      },
    },
    {
      id: 'n6', name: 'Parse Reply Context',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1100, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: PARSE_REPLY_CONTEXT_CODE },
    },

    // ── Step 3: React ✅ to amount reply ────────────────────────────────────
    {
      id: 'n7', name: 'React to Amount Reply',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [1320, 300],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'POST',
        url: 'https://slack.com/api/reactions.add',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ { channel: '${PAYMENTS_CHANNEL}', timestamp: $json.reply_ts, name: 'white_check_mark' } }}`,
        options: {},
      },
    },

    // ── Step 4: Restore context and submit to intake webhook ───────────────
    {
      id: 'n8', name: 'Restore for Intake',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1540, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: RESTORE_FOR_INTAKE_CODE },
    },
    {
      id: 'n9', name: 'Submit to Intake Webhook',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [1760, 300],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: INTAKE_WEBHOOK,
        sendBody: true,
        specifyBody: 'string',
        body: '={{ $json.intake_payload }}',
        sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'Content-Type', value: 'application/json' },
        ]},
        options: {},
      },
    },

    // ── Step 5: React ✅ to original receipt ────────────────────────────────
    {
      id: 'n10', name: 'Restore for Original',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1980, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: RESTORE_FOR_ORIGINAL_CODE },
    },
    {
      id: 'n11', name: 'React to Original Receipt',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [2200, 300],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'POST',
        url: 'https://slack.com/api/reactions.add',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ { channel: '${PAYMENTS_CHANNEL}', timestamp: $json.original_ts, name: 'white_check_mark' } }}`,
        options: {},
      },
    },
  ],

  connections: {
    'Schedule Trigger':        { main: [[{ node: 'Get Channel History', type: 'main', index: 0 }]] },
    'Webhook Trigger':         { main: [[{ node: 'Get Channel History', type: 'main', index: 0 }]] },
    'Get Channel History':     { main: [[{ node: 'Find Price Prompts', type: 'main', index: 0 }]] },
    'Find Price Prompts':      { main: [[{ node: 'Get Thread Replies', type: 'main', index: 0 }]] },
    'Get Thread Replies':      { main: [[{ node: 'Parse Reply Context', type: 'main', index: 0 }]] },
    'Parse Reply Context':     { main: [[{ node: 'React to Amount Reply', type: 'main', index: 0 }]] },
    'React to Amount Reply':   { main: [[{ node: 'Restore for Intake', type: 'main', index: 0 }]] },
    'Restore for Intake':      { main: [[{ node: 'Submit to Intake Webhook', type: 'main', index: 0 }]] },
    'Submit to Intake Webhook':{ main: [[{ node: 'Restore for Original', type: 'main', index: 0 }]] },
    'Restore for Original':    { main: [[{ node: 'React to Original Receipt', type: 'main', index: 0 }]] },
  },
};

// ── Deploy ───────────────────────────────────────────────────────────────────

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

async function deploy() {
  let result;
  if (WORKFLOW_ID) {
    result = await n8nRequest('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, workflow);
  } else {
    result = await n8nRequest('POST', `/api/v1/workflows`, workflow);
  }
  if (!result.id) {
    console.log('ERROR:', JSON.stringify(result, null, 2).substring(0, 2000));
    return;
  }
  await n8nRequest('POST', `/api/v1/workflows/${result.id}/activate`);
  console.log('SUCCESS');
  console.log('Workflow ID:', result.id);
  console.log('Name:', result.name);
  console.log('URL:', `${N8N_URL}/workflow/${result.id}`);
  console.log('');
  console.log('Manual trigger webhook:');
  console.log(`${N8N_URL}/webhook/krave-price-reply-resubmit`);
  console.log('');
  console.log('Next: set PRICE_REPLY_RESUBMIT_WORKFLOW_ID=' + result.id + ' in .env');
}

deploy().catch(console.error);
