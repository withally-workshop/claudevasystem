const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = process.env.INVOICE_APPROVAL_POLLING_WORKFLOW_ID || 'uCS9lzHtVKWlqYlk';

const SHEET_ID = '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50';
const SHEETS_CRED_ID = '83MQOm78gYDvziTO';
const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD';
const JOHN_APPROVAL_CHANNEL = 'C0AQZGJDR38';
const PAYMENTS_CHANNEL = 'C09HN2EBPR7';
const AW_CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID;
const AW_API_KEY = process.env.AIRWALLEX_API_KEY;

// ── Code nodes ──────────────────────────────────────────────────────────────

const FILTER_PENDING_CODE = `
const rows = $input.all();
const pending = rows.filter(r => {
  const status = (r.json['Payment Status'] || '').toString().trim();
  return status === 'Draft - Pending John Review';
});
if (pending.length === 0) return [];
return pending.map(r => ({ json: r.json }));
`.trim();

const FIND_APPROVAL_MESSAGE_CODE = `
const response = ($input.all()[0] || {}).json || {};
const messages = response.messages || [];
const pending = $items('Filter Pending Drafts').map(item => item.json);
return pending.map(row => {
  const invoiceId = row['Airwallex Invoice ID'] || '';
  if (!invoiceId) return null;
  const found = messages.find(m => {
    const text = (m.text || '').toLowerCase();
    return text.includes(invoiceId.toLowerCase()) &&
      (text.includes('new invoice draft') || text.includes('ðŸ“‹'));
  });
  if (!found) return null;
  return { json: {
    ...row,
    approval_message_ts: found.ts,
    approval_channel: found.channel || '${JOHN_APPROVAL_CHANNEL}',
  }};
}).filter(Boolean);
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
const contexts = $items('Find Draft Notification').map(item => item.json);
return $input.all().map((item, index) => {
  const replies = (item.json || {}).messages || [];
  const ctx = contexts[index] || {};
  const approveReply = replies.find(r => {
    const text = (r.text || '').toLowerCase();
    return text.includes('approve') && r.bot_id == null;
  });
  if (!approveReply) return null;
  return { json: { ...ctx, approve_reply_ts: approveReply.ts } };
}).filter(Boolean);
const response = ($input.all()[0] || {}).json || {};
const replies = response.messages || [];
const ctx = $('Find Draft Notification').item.json;
const approveReply = replies.find(r => {
  const text = (r.text || '').toLowerCase();
  return text.includes('approve') && r.bot_id == null;
});
if (!approveReply) return [];
return [{ json: { ...ctx, approve_reply_ts: approveReply.ts } }];
`.trim();

const EXTRACT_PAYMENT_LINK_CODE = `
const contexts = $items('Find Approve Reply').map(item => item.json);
const finalizes = $items('Finalize Invoice').map(item => item.json);
return $input.all().map((item, index) => {
  const finalize = finalizes[index] || {};
  const getInvoice = item.json || {};
  const ctx = contexts[index] || {};
  const link =
    finalize.hosted_invoice_url ||
    finalize.hosted_url ||
    finalize.digital_invoice_link ||
    finalize.payment_link ||
    finalize.checkout_url ||
    getInvoice.hosted_invoice_url ||
    getInvoice.hosted_url ||
    getInvoice.digital_invoice_link ||
    getInvoice.payment_link ||
    getInvoice.checkout_url ||
    '';
  const finalizedInvoiceNumber =
    getInvoice.number ||
    getInvoice.invoice_number ||
    finalize.number ||
    finalize.invoice_number ||
    ctx['Invoice #'] ||
    '';
  return { json: { ...ctx, 'Invoice #': finalizedInvoiceNumber, payment_link: link, link_found: !!link } };
});
const finalize = $('Finalize Invoice').item.json;
const getInvoice = (($input.all()[0] || {}).json) || {};
const ctx = $('Find Approve Reply').item.json;
const link =
  finalize.hosted_invoice_url ||
  finalize.hosted_url ||
  finalize.digital_invoice_link ||
  finalize.payment_link ||
  finalize.checkout_url ||
  getInvoice.hosted_invoice_url ||
  getInvoice.hosted_url ||
  getInvoice.digital_invoice_link ||
  getInvoice.payment_link ||
  getInvoice.checkout_url ||
  '';
const finalizedInvoiceNumber =
  getInvoice.number ||
  getInvoice.invoice_number ||
  finalize.number ||
  finalize.invoice_number ||
  ctx['Invoice #'] ||
  '';
return [{ json: { ...ctx, 'Invoice #': finalizedInvoiceNumber, payment_link: link, link_found: !!link } }];
`.trim();


const BUILD_JOHN_THREAD_REPLY_CODE = `
return $items('Extract Payment Link').map(item => {
const ctx = item.json;
const clientName = ctx['Client Name'] || '';
const invoiceNum = ctx['Invoice #'] || '';
const amount = ctx['Amount'] || '';
const currency = ctx['Currency'] || '';
const dueDate = ctx['Due Date'] || '';
const link = ctx.payment_link || '';
const lines = [
  'âœ… *Invoice finalized â€” ' + clientName + '*',
  'â€¢ Invoice #: ' + invoiceNum,
  'â€¢ Amount: ' + amount + ' ' + currency,
  'â€¢ Due: ' + dueDate,
];
if (link) lines.push('â€¢ Payment link: ' + link);
else lines.push('âš ï¸ Payment link unavailable â€” retrieve from Airwallex dashboard.');
lines.push('');
lines.push('Strategist notified in #payments-invoices-updates.');
return { json: { ...ctx, john_reply_text: lines.join('\\n') } };
});
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
const STRAT_SLACK = {
  amanda: 'U07J8SRCPGU',
  jeneena: 'U07R7FU4WBV',
  sybil: 'U0A2HLNV8NM',
  noa: 'U06TBGX9L93',
  john: 'U0AM5EGRVTP'
};
return $items('Build John Thread Reply').map(item => {
const ctx = item.json;
const clientName = ctx['Client Name'] || '';
const invoiceNum = ctx['Invoice #'] || '';
const amount = ctx['Amount'] || '';
const currency = ctx['Currency'] || '';
const dueDate = ctx['Due Date'] || '';
const link = ctx.payment_link || '';
const colK = (ctx['Requested By'] || '').trim();
const mappedSlackId = STRAT_SLACK[colK.toLowerCase()] || '';
const requesterTag = colK.match(/^U[A-Z0-9]{8,}$/)
  ? '<@' + colK + '>'
  : (mappedSlackId ? '<@' + mappedSlackId + '>' : (colK || 'unknown'));
const requesterWarning = colK && !mappedSlackId && !colK.match(/^U[A-Z0-9]{8,}$/)
  ? '\\nâ€¢ âš ï¸ Unknown requester "' + colK + '" on tracker - update strategist map if this should tag someone.'
  : '';
const colC = (ctx['Email Address'] || '').trim();
const originThreadTs = (ctx['Origin Thread TS'] || '').trim();

const lines = [
  'âœ… *Invoice approved and ready to send â€” ' + clientName + '*',
  'â€¢ Invoice #: ' + invoiceNum,
  'â€¢ Amount: ' + amount + ' ' + currency,
  'â€¢ Due: ' + dueDate,
  'â€¢ Payment link: ' + (link || 'âš ï¸ retrieve from Airwallex dashboard'),
  '',
  requesterTag + ' please download the invoice from the link above and email it to the client' + (colC ? ' (' + colC + ')' : '') + ' with:',
  '  - The payment link',
  '  - The downloaded invoice file as an attachment',
  '  CC: john@kravemedia.co, noa@kravemedia.co',
];
if (requesterWarning) lines.push(requesterWarning);

return { json: {
  ...ctx,
  strategist_text: lines.join('\\n'),
  origin_thread_ts: originThreadTs,
}};
});
const ctx = $('Extract Payment Link').item.json;
const clientName = ctx['Client Name'] || '';
const invoiceNum = ctx['Invoice #'] || '';
const amount = ctx['Amount'] || '';
const currency = ctx['Currency'] || '';
const dueDate = ctx['Due Date'] || '';
const link = ctx.payment_link || '';
const colK = (ctx['Requested By'] || '').trim();
const mappedSlackId = STRAT_SLACK[colK.toLowerCase()] || '';
const requesterTag = colK.match(/^U[A-Z0-9]{8,}$/)
  ? '<@' + colK + '>'
  : (mappedSlackId ? '<@' + mappedSlackId + '>' : (colK || 'unknown'));
const requesterWarning = colK && !mappedSlackId && !colK.match(/^U[A-Z0-9]{8,}$/)
  ? '\\n• ⚠️ Unknown requester "' + colK + '" on tracker - update strategist map if this should tag someone.'
  : '';
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
if (requesterWarning) lines.push(requesterWarning);

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
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [940, 300],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'GET',
        url: 'https://slack.com/api/conversations.history',
        sendQuery: true,
        queryParameters: { parameters: [
          { name: 'channel', value: JOHN_APPROVAL_CHANNEL },
          { name: 'limit', value: '200' },
        ]},
        options: {},
      },
    },
    {
      id: 'n6', name: 'Find Draft Notification',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1160, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: FIND_APPROVAL_MESSAGE_CODE },
    },

    // ── Step 2b: Get thread replies ─────────────────────────────────────────
    {
      id: 'n7', name: 'Get Thread Replies',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [1380, 300],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'GET',
        url: 'https://slack.com/api/conversations.replies',
        sendQuery: true,
        queryParameters: { parameters: [
          { name: 'channel', value: JOHN_APPROVAL_CHANNEL },
          { name: 'ts', value: '={{ $json.approval_message_ts }}' },
          { name: 'limit', value: '100' },
        ]},
        options: {},
      },
    },
    {
      id: 'n8', name: 'Find Approve Reply',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1600, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: FIND_APPROVE_REPLY_CODE },
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
      parameters: { mode: 'runOnceForAllItems', jsCode: EXTRACT_PAYMENT_LINK_CODE },
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
            'Airwallex Invoice ID': "={{ $('Extract Payment Link').item.json['Airwallex Invoice ID'] }}",
            'Payment Status': 'Invoice Sent',
            'Invoice URL': "={{ $('Extract Payment Link').item.json.payment_link || '' }}",
          },
          matchingColumns: ['Airwallex Invoice ID'],
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
      parameters: { mode: 'runOnceForAllItems', jsCode: BUILD_JOHN_THREAD_REPLY_CODE },
    },
    {
      id: 'n15', name: 'Reply in John Thread',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [3140, 300],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'POST',
        url: 'https://slack.com/api/chat.postMessage',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ { channel: '${JOHN_APPROVAL_CHANNEL}', thread_ts: $json.approval_message_ts, text: $json.john_reply_text } }}`,
        options: {},
      },
    },

    // ── Step 6: Tag requester in origin thread ─────────────────────────────
    {
      id: 'n16', name: 'Build Strategist Message',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [3360, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: BUILD_STRATEGIST_MESSAGE_CODE },
    },
    {
      id: 'n17', name: 'Notify Strategist',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [3580, 300],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'POST',
        url: 'https://slack.com/api/chat.postMessage',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ { channel: '${PAYMENTS_CHANNEL}', thread_ts: $json.origin_thread_ts || undefined, text: $json.strategist_text } }}`,
        options: {},
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
