const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = process.env.INVOICE_APPROVAL_POLLING_WORKFLOW_ID || null; // set after first deploy

const SHEET_ID = '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50';
const SHEETS_CRED_ID = '83MQOm78gYDvziTO';
const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD';
const JOHN_APPROVAL_CHANNEL = 'C0AQZGJDR38';
const PAYMENTS_CHANNEL = 'C09HN2EBPR7';
const AW_CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID || 'JaQA4uJ1SDSBkTdFigT9sw';
const AW_API_KEY = process.env.AIRWALLEX_API_KEY || '5611f8e189ef357e5b3493916208efb80413595b50e7201b8fc98af5c91666f50b10ee64fd87fa3db7435e8dc5c07721';

// ── Code nodes ──────────────────────────────────────────────────────────────

const FILTER_PENDING_CODE = `
const rows = $input.all();
const pending = rows.filter(r => {
  const status = (r.json['Status'] || '').toString().trim();
  return status === 'Draft - Pending John Review';
});
if (pending.length === 0) return [];
return pending.map(r => ({ json: r.json }));
`.trim();

const FIND_APPROVAL_MESSAGE_CODE = `
const messages = $input.all().map(i => i.json);
const invoiceId = $('Filter Pending Drafts').item.json['Airwallex Invoice ID'] || '';
const found = messages.find(m => {
  const text = (m.text || '').toLowerCase();
  return text.includes(invoiceId.toLowerCase()) &&
    (text.includes('new invoice draft') || text.includes('📋'));
});
if (!found) return [];
return [{ json: {
  ...$('Filter Pending Drafts').item.json,
  approval_message_ts: found.ts,
  approval_channel: found.channel || '${JOHN_APPROVAL_CHANNEL}',
}}];
`.trim();

const FIND_APPROVE_REPLY_CODE = `
const replies = $input.all().map(i => i.json);
const ctx = $('Find Draft Notification').item.json;
const approveReply = replies.find(r => {
  const text = (r.text || '').toLowerCase();
  return text.includes('approve') && r.bot_id == null;
});
if (!approveReply) return [];
return [{ json: { ...ctx, approve_reply_ts: approveReply.ts } }];
`.trim();

const EXTRACT_PAYMENT_LINK_CODE = `
const finalize = $('Finalize Invoice').item.json;
const getInvoice = $input.item.json;
const link =
  finalize.hosted_invoice_url ||
  finalize.digital_invoice_link ||
  finalize.payment_link ||
  finalize.checkout_url ||
  getInvoice.hosted_invoice_url ||
  getInvoice.digital_invoice_link ||
  getInvoice.payment_link ||
  getInvoice.checkout_url ||
  '';
const ctx = $('Find Approve Reply').item.json;
return [{ json: { ...ctx, payment_link: link, link_found: !!link } }];
`.trim();


const BUILD_JOHN_THREAD_REPLY_CODE = `
const ctx = $('Extract Payment Link').item.json;
const clientName = ctx['Client Name'] || '';
const invoiceNum = ctx['Invoice #'] || '';
const amount = ctx['Amount'] || '';
const currency = ctx['Currency'] || '';
const dueDate = ctx['Due Date'] || '';
const link = ctx.payment_link || '';
const lines = [
  '✅ *Invoice finalized — ' + clientName + '*',
  '• Invoice #: ' + invoiceNum,
  '• Amount: ' + amount + ' ' + currency,
  '• Due: ' + dueDate,
];
if (link) lines.push('• Payment link: ' + link);
else lines.push('⚠️ Payment link unavailable — retrieve from Airwallex dashboard.');
lines.push('');
lines.push('Strategist notified in #payments-invoices-updates.');
return [{ json: { ...ctx, john_reply_text: lines.join('\\n') } }];
`.trim();

const BUILD_STRATEGIST_MESSAGE_CODE = `
const ctx = $('Extract Payment Link').item.json;
const clientName = ctx['Client Name'] || '';
const invoiceNum = ctx['Invoice #'] || '';
const amount = ctx['Amount'] || '';
const currency = ctx['Currency'] || '';
const dueDate = ctx['Due Date'] || '';
const link = ctx.payment_link || '';
const colK = (ctx['Requested By'] || '').trim();
const requesterTag = colK.match(/^U[A-Z0-9]{8,}$/) ? '<@' + colK + '>' : (colK || 'unknown');
const colC = (ctx['Email Address'] || '').trim();
const originThreadTs = (ctx['Origin Thread TS'] || '').trim();

const lines = [
  '✅ *Invoice approved and ready to send — ' + clientName + '*',
  '• Invoice #: ' + invoiceNum,
  '• Amount: ' + amount + ' ' + currency,
  '• Due: ' + dueDate,
  '• Payment link: ' + (link || '⚠️ retrieve from Airwallex dashboard'),
  '',
  requesterTag + ' please download the invoice from the link above and email it to the client' + (colC ? ' (' + colC + ')' : '') + ' with:',
  '  - The payment link',
  '  - The downloaded invoice file as an attachment',
  '  CC: john@kravemedia.co, noa@kravemedia.co',
];

return [{ json: {
  ...ctx,
  strategist_text: lines.join('\\n'),
  origin_thread_ts: originThreadTs,
}}];
`.trim();

// ── Workflow definition ──────────────────────────────────────────────────────

const workflow = {
  name: 'Krave — Invoice Approval Polling',
  settings: { executionOrder: 'v1', saveManualExecutions: true },
  nodes: [
    {
      id: 'n1', name: 'Schedule Trigger',
      type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
      position: [240, 200],
      parameters: {
        rule: { interval: [{ field: 'cronExpression', expression: '0 1,3,5,7,9 * * 1-5' }] }
      },
    },
    {
      id: 'n2', name: 'Webhook Trigger',
      type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [240, 400],
      webhookId: 'krave-invoice-approval-polling',
      parameters: { httpMethod: 'POST', path: 'krave-invoice-approval-polling', responseMode: 'onReceived', options: {} },
    },

    // ── Step 1: Read tracker ────────────────────────────────────────────────
    {
      id: 'n3', name: 'Read Invoice Tracker',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [500, 300],
      credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet', operation: 'read',
        documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        filtersUI: {}, options: {},
      },
    },
    {
      id: 'n4', name: 'Filter Pending Drafts',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [720, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: FILTER_PENDING_CODE },
    },

    // ── Step 2: Get channel history and find bot message ────────────────────
    {
      id: 'n5', name: 'Get John Channel History',
      type: 'n8n-nodes-base.slack', typeVersion: 2.3,
      position: [940, 300],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message', operation: 'getAll',
        returnAll: false, limit: 200,
        filters: { channelId: { __rl: true, value: JOHN_APPROVAL_CHANNEL, mode: 'id' } },
        options: {},
      },
    },
    {
      id: 'n6', name: 'Find Draft Notification',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1160, 300],
      parameters: { mode: 'runOnceForEachItem', jsCode: FIND_APPROVAL_MESSAGE_CODE },
    },

    // ── Step 2b: Get thread replies ─────────────────────────────────────────
    {
      id: 'n7', name: 'Get Thread Replies',
      type: 'n8n-nodes-base.slack', typeVersion: 2.3,
      position: [1380, 300],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message', operation: 'getReplies',
        channelId: { __rl: true, value: JOHN_APPROVAL_CHANNEL, mode: 'id' },
        ts: '={{ $json.approval_message_ts }}',
        returnAll: true,
        options: {},
      },
    },
    {
      id: 'n8', name: 'Find Approve Reply',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1600, 300],
      parameters: { mode: 'runOnceForEachItem', jsCode: FIND_APPROVE_REPLY_CODE },
    },

    // ── Step 3: Airwallex auth + finalize ───────────────────────────────────
    {
      id: 'n9', name: 'Airwallex Auth',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [1820, 300],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: 'https://api.airwallex.com/api/v1/authentication/login',
        authentication: 'none', sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'x-client-id', value: AW_CLIENT_ID },
          { name: 'x-api-key', value: AW_API_KEY },
        ]},
        sendBody: false, options: {},
      },
    },
    {
      id: 'n10', name: 'Finalize Invoice',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [2040, 300],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: "={{ 'https://api.airwallex.com/api/v1/invoices/' + $('Find Approve Reply').item.json['Airwallex Invoice ID'] + '/finalize' }}",
        authentication: 'none', sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'Authorization', value: "={{ 'Bearer ' + $('Airwallex Auth').item.json.token }}" },
          { name: 'Content-Type', value: 'application/json' },
          { name: 'x-api-version', value: '2025-06-16' },
        ]},
        sendBody: false, options: {},
      },
    },
    {
      id: 'n11', name: 'Get Invoice',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [2260, 300],
      continueOnFail: true,
      parameters: {
        method: 'GET',
        url: "={{ 'https://api.airwallex.com/api/v1/invoices/' + $('Find Approve Reply').item.json['Airwallex Invoice ID'] }}",
        authentication: 'none', sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'Authorization', value: "={{ 'Bearer ' + $('Airwallex Auth').item.json.token }}" },
          { name: 'x-api-version', value: '2025-06-16' },
        ]},
        sendBody: false, options: {},
      },
    },
    {
      id: 'n12', name: 'Extract Payment Link',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [2480, 300],
      parameters: { mode: 'runOnceForEachItem', jsCode: EXTRACT_PAYMENT_LINK_CODE },
    },

    // ── Step 4: Update tracker ──────────────────────────────────────────────
    {
      id: 'n13', name: 'Update Tracker',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [2700, 300],
      credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet', operation: 'appendOrUpdate',
        documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            'Invoice #': "={{ $('Extract Payment Link').item.json['Invoice #'] }}",
            'Status': 'Invoice Sent',
          },
          matchingColumns: ['Invoice #'],
          schema: [],
        },
        options: {},
      },
    },

    // ── Step 5: Reply in John's thread ─────────────────────────────────────
    {
      id: 'n14', name: 'Build John Thread Reply',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [2920, 300],
      parameters: { mode: 'runOnceForEachItem', jsCode: BUILD_JOHN_THREAD_REPLY_CODE },
    },
    {
      id: 'n15', name: 'Reply in John Thread',
      type: 'n8n-nodes-base.slack', typeVersion: 2.3,
      position: [3140, 300],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message', operation: 'post',
        select: 'channel',
        channelId: { __rl: true, value: JOHN_APPROVAL_CHANNEL, mode: 'id' },
        text: '={{ $json.john_reply_text }}',
        otherOptions: { thread_ts: '={{ $json.approval_message_ts }}' },
      },
    },

    // ── Step 6: Tag requester in origin thread ─────────────────────────────
    {
      id: 'n16', name: 'Build Strategist Message',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [3360, 300],
      parameters: { mode: 'runOnceForEachItem', jsCode: BUILD_STRATEGIST_MESSAGE_CODE },
    },
    {
      id: 'n17', name: 'Notify Strategist',
      type: 'n8n-nodes-base.slack', typeVersion: 2.3,
      position: [3580, 300],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message', operation: 'post',
        select: 'channel',
        channelId: { __rl: true, value: PAYMENTS_CHANNEL, mode: 'id' },
        text: '={{ $json.strategist_text }}',
        otherOptions: {
          thread_ts: "={{ $json.origin_thread_ts || undefined }}",
        },
      },
    },
  ],

  connections: {
    'Schedule Trigger': { main: [[{ node: 'Read Invoice Tracker', type: 'main', index: 0 }]] },
    'Webhook Trigger':  { main: [[{ node: 'Read Invoice Tracker', type: 'main', index: 0 }]] },
    'Read Invoice Tracker':   { main: [[{ node: 'Filter Pending Drafts', type: 'main', index: 0 }]] },
    'Filter Pending Drafts':  { main: [[{ node: 'Get John Channel History', type: 'main', index: 0 }]] },
    'Get John Channel History': { main: [[{ node: 'Find Draft Notification', type: 'main', index: 0 }]] },
    'Find Draft Notification':  { main: [[{ node: 'Get Thread Replies', type: 'main', index: 0 }]] },
    'Get Thread Replies':       { main: [[{ node: 'Find Approve Reply', type: 'main', index: 0 }]] },
    'Find Approve Reply':       { main: [[{ node: 'Airwallex Auth', type: 'main', index: 0 }]] },
    'Airwallex Auth':           { main: [[{ node: 'Finalize Invoice', type: 'main', index: 0 }]] },
    'Finalize Invoice':         { main: [[{ node: 'Get Invoice', type: 'main', index: 0 }]] },
    'Get Invoice':              { main: [[{ node: 'Extract Payment Link', type: 'main', index: 0 }]] },
    'Extract Payment Link':     { main: [[{ node: 'Update Tracker', type: 'main', index: 0 }]] },
    'Update Tracker':           { main: [[{ node: 'Build John Thread Reply', type: 'main', index: 0 }]] },
    'Build John Thread Reply':  { main: [[{ node: 'Reply in John Thread', type: 'main', index: 0 }]] },
    'Reply in John Thread':     { main: [[{ node: 'Build Strategist Message', type: 'main', index: 0 }]] },
    'Build Strategist Message': { main: [[{ node: 'Notify Strategist', type: 'main', index: 0 }]] },
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
  console.log('Webhook URL:');
  console.log(`${N8N_URL}/webhook/krave-invoice-approval-polling`);
  console.log('');
  console.log('Next: set INVOICE_APPROVAL_POLLING_WORKFLOW_ID=' + result.id + ' in .env');
}

deploy().catch(console.error);
