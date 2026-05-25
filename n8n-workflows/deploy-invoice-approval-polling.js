const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = process.env.INVOICE_APPROVAL_POLLING_WORKFLOW_ID || 'uCS9lzHtVKWlqYlk';
const RENDER_DASHBOARD_URL = process.env.RENDER_DASHBOARD_URL || 'https://krave-ops-dashboard.onrender.com';
const SEND_INVOICE_EMAIL_SECRET = process.env.SEND_INVOICE_EMAIL_SECRET;

const SHEET_ID = '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50';
const SHEETS_CRED_ID = '83MQOm78gYDvziTO';
const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD';
const JOHN_APPROVAL_CHANNEL = 'C0AQZGJDR38';
const PAYMENTS_CHANNEL = 'C09HN2EBPR7';
const AW_CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID;
const AW_API_KEY = process.env.AIRWALLEX_API_KEY;
const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;

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
  return { json: { ...ctx, approve_reply_ts: approveReply.ts, approve_reply_text: approveReply.text || '' } };
}).filter(Boolean);
const response = ($input.all()[0] || {}).json || {};
const replies = response.messages || [];
const ctx = $('Find Draft Notification').item.json;
const approveReply = replies.find(r => {
  const text = (r.text || '').toLowerCase();
  return text.includes('approve') && r.bot_id == null;
});
if (!approveReply) return [];
return [{ json: { ...ctx, approve_reply_ts: approveReply.ts, approve_reply_text: approveReply.text || '' } }];
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
  const pdfUrl = getInvoice.pdf_url || finalize.pdf_url || '';
  return { json: { ...ctx, 'Invoice #': finalizedInvoiceNumber, payment_link: link, pdf_url: pdfUrl, link_found: !!link } };
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
const pdfUrl = getInvoice.pdf_url || finalize.pdf_url || '';
return [{ json: { ...ctx, 'Invoice #': finalizedInvoiceNumber, payment_link: link, pdf_url: pdfUrl, link_found: !!link } }];
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
  'Invoice finalized - ' + clientName,
  '- Invoice #: ' + invoiceNum,
  '- Amount: ' + currency + ' ' + amount,
  '- Due: ' + dueDate,
];
if (link) lines.push('- Payment link: ' + link);
lines.push('');
lines.push('Email with invoice PDF is being sent to the client automatically.');
return [{ json: { ...ctx, john_reply_text: lines.join('\n') } }];
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
  requesterTag + ' Invoice approved and emailed to client' + (colC ? ' (' + colC + ')' : '') + ' with PDF attached.',
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
  '✅ *Invoice approved — ' + clientName + '*',
  '• Invoice #: ' + invoiceNum,
  '• Amount: ' + amount + ' ' + currency,
  '• Due: ' + dueDate,
  '• Payment link: ' + (link || '⚠️ retrieve from Airwallex dashboard'),
  '',
  requesterTag + ' Invoice approved and emailed to client' + (colC ? ' (' + colC + ')' : '') + ' with PDF attached.',
];
if (requesterWarning) lines.push(requesterWarning);

return [{ json: {
  ...ctx,
  strategist_text: lines.join('\\n'),
  origin_thread_ts: originThreadTs,
}}];
`.trim();

const PARSE_CLICKUP_TASK_CODE = `
const ctx = ($input.all()[0] || {}).json || {};
const text = ctx.approve_reply_text || '';
const m = text.match(/app\\.clickup\\.com\\/t\\/([a-z0-9]+)/i);
const clickupTaskId = m ? m[1] : null;
// Parse due date from Sheets col I into ms timestamp for ClickUp date field
const dueDateStr = ctx['Due Date'] || '';
let dueDateMs = null;
if (dueDateStr) {
  const d = new Date(dueDateStr);
  if (!isNaN(d.getTime())) dueDateMs = d.getTime();
}
return [{ json: { ...ctx, clickupTaskId, dueDateMs } }];
`.trim();

// ── Workflow definition ──────────────────────────────────────────────────────

const workflow = {
  name: 'Krave — Invoice Approval Polling',
  settings: { executionOrder: 'v1', saveManualExecutions: true, timezone: 'Asia/Manila' },
  nodes: [
    {
      id: 'n1', name: 'Schedule Trigger',
      type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
      position: [240, 200],
      parameters: {
        rule: { interval: [{ field: 'cronExpression', expression: '0 9,11,13,15,17 * * 1-5' }] }
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

    // ── Email invoice to client (parallel branch from Update Tracker) ───────
    {
      id: 'n24', name: 'Build Email Payload',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [2700, 740],
      parameters: { mode: 'runOnceForAllItems', jsCode: `
const items = $items('Extract Payment Link').map(i => i.json);
return items.map(ctx => {
  const clientName = ctx['Client Name'] || '';
  const invoiceNum = ctx['Invoice #'] || '';
  const amount = ctx['Amount'] || '';
  const currency = ctx['Currency'] || '';
  const dueDate = ctx['Due Date'] || '';
  const clientEmail = ctx['Email Address'] || '';
  const link = ctx.payment_link || '';
  const pdfUrl = ctx.pdf_url || '';
  const projectDescription = ctx['Project Description'] || ctx['D'] || '';
  const originThreadTs = (ctx['Origin Thread TS'] || '').trim();
  const requesterUsername = (ctx['Requested By'] || '').trim().toLowerCase().replace(/^@/, '');
  const requesterEmail = requesterUsername ? requesterUsername + '@kravemedia.co' : '';
  const ccList = ['noa@kravemedia.co', ...(requesterEmail && requesterEmail !== 'noa@kravemedia.co' ? [requesterEmail] : [])].join(', ');

  const monthYear = (() => {
    const d = dueDate ? new Date(dueDate) : new Date();
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'Asia/Manila' });
  })();
  const subject = '[FYA - Invoice ' + invoiceNum + '] - Krave Media x ' + clientName + ' [' + monthYear + ']';

  return { json: {
    ...ctx,
    email_to: clientEmail,
    email_cc: ccList,
    email_subject: subject,
    email_pdf_url: pdfUrl,
    email_filename: invoiceNum + '.pdf',
    email_compose_body: true,
    email_client_name: clientName,
    email_invoice_number: invoiceNum,
    email_amount: amount,
    email_currency: currency,
    email_due_date: dueDate,
    email_project_description: projectDescription,
    email_payment_link: link,
    origin_thread_ts: originThreadTs,
  }};
});
`.trim() },
    },
    {
      id: 'n25', name: 'Send Invoice Email',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [2920, 740],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: `${RENDER_DASHBOARD_URL}/api/send-invoice-email`,
        sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'Authorization', value: `Bearer ${SEND_INVOICE_EMAIL_SECRET}` },
          { name: 'Content-Type', value: 'application/json' },
        ]},
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ { to: $json.email_to, cc: $json.email_cc, subject: $json.email_subject, pdf_url: $json.email_pdf_url, pdf_auth_token: 'Bearer ' + $('Airwallex Auth').item.json.token, filename: $json.email_filename, compose_body: $json.email_compose_body, client_name: $json.email_client_name, invoice_number: $json.email_invoice_number, amount: $json.email_amount, currency: $json.email_currency, due_date: $json.email_due_date, project_description: $json.email_project_description, payment_link: $json.email_payment_link } }}`,
        options: {},
      },
    },
    {
      id: 'n26', name: 'Restore Context for Confirm',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [3140, 740],
      parameters: { mode: 'runOnceForAllItems', jsCode: `
const contexts = $items('Build Email Payload').map(i => i.json);
return $input.all().map((item, idx) => {
  const ctx = contexts[idx] || {};
  const emailOk = (item.json || {}).ok !== false;
  return { json: { ...ctx, email_sent: emailOk } };
});
`.trim() },
    },
    {
      id: 'n27', name: 'Confirm Email in Thread',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [3360, 740],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'POST',
        url: 'https://slack.com/api/chat.postMessage',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ { channel: '${PAYMENTS_CHANNEL}', thread_ts: $json.origin_thread_ts || undefined, text: ($json.email_sent ? ('Invoice emailed to ' + $json.email_to + ' with PDF attached.') : ('Invoice approved. Email send failed - send manually to ' + $json.email_to + '.')) } }}`,
        options: {},
      },
    },

    // ── ClickUp sync branch (parallel from Update Tracker) ─────────────────
    // Parses ClickUp task ID from John's approval reply text.
    // No task ID (WhatsApp clients, new clients, deposits) → IF gates everything off.
    {
      id: 'n18', name: 'Parse ClickUp Task ID',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [2700, 520],
      parameters: { mode: 'runOnceForAllItems', jsCode: PARSE_CLICKUP_TASK_CODE },
    },
    {
      id: 'n19', name: 'Has ClickUp Task?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [2920, 520],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [{ id: 'c1', leftValue: '={{ !!$json.clickupTaskId }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
          combinator: 'and',
        },
        options: {},
      },
    },
    {
      id: 'n20', name: 'ClickUp Set Collections',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [3140, 520],
      continueOnFail: true,
      parameters: {
        method: 'PUT',
        url: "={{ 'https://api.clickup.com/api/v2/task/' + $json.clickupTaskId }}",
        authentication: 'none', sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'Authorization', value: CLICKUP_API_KEY },
          { name: 'Content-Type', value: 'application/json' },
        ]},
        sendBody: true, specifyBody: 'json',
        jsonBody: '={{ ({ status: "collections" }) }}',
        options: {},
      },
    },
    {
      id: 'n21', name: 'ClickUp Set Invoice Sent Date',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [3360, 520],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: "={{ 'https://api.clickup.com/api/v2/task/' + $('Parse ClickUp Task ID').first().json.clickupTaskId + '/field/79d9a123-4903-44ba-83cd-7d07b349617f' }}",
        authentication: 'none', sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'Authorization', value: CLICKUP_API_KEY },
          { name: 'Content-Type', value: 'application/json' },
        ]},
        sendBody: true, specifyBody: 'json',
        jsonBody: '={{ ({ value: Date.now() }) }}',
        options: {},
      },
    },
    {
      id: 'n22', name: 'ClickUp Set Invoice Due Date',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [3580, 520],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: "={{ 'https://api.clickup.com/api/v2/task/' + $('Parse ClickUp Task ID').first().json.clickupTaskId + '/field/8552675a-689e-43fa-a4d0-2f102e1d7fc5' }}",
        authentication: 'none', sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'Authorization', value: CLICKUP_API_KEY },
          { name: 'Content-Type', value: 'application/json' },
        ]},
        sendBody: true, specifyBody: 'json',
        jsonBody: "={{ ({ value: $('Parse ClickUp Task ID').first().json.dueDateMs || Date.now() }) }}",
        options: {},
      },
    },
    {
      // Writes ClickUp task ID to tracker col "ClickUp Task ID".
      // PREREQUISITE: add "ClickUp Task ID" column header to the Invoices sheet (col T or next free).
      id: 'n23', name: 'Write ClickUp ID to Tracker',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [3800, 520],
      continueOnFail: true,
      credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet', operation: 'appendOrUpdate',
        documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            'Airwallex Invoice ID': "={{ $('Parse ClickUp Task ID').first().json['Airwallex Invoice ID'] }}",
            'Clickup Task ID': "={{ $('Parse ClickUp Task ID').first().json.clickupTaskId }}",
          },
          matchingColumns: ['Airwallex Invoice ID'],
          schema: [],
        },
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
    'Update Tracker':           { main: [[
      { node: 'Build John Thread Reply', type: 'main', index: 0 },
      { node: 'Parse ClickUp Task ID',   type: 'main', index: 0 },
      { node: 'Build Email Payload',     type: 'main', index: 0 },
    ]]},
    'Build Email Payload':       { main: [[{ node: 'Send Invoice Email', type: 'main', index: 0 }]] },
    'Send Invoice Email':        { main: [[{ node: 'Restore Context for Confirm', type: 'main', index: 0 }]] },
    'Restore Context for Confirm': { main: [[{ node: 'Confirm Email in Thread', type: 'main', index: 0 }]] },
    'Build John Thread Reply':  { main: [[{ node: 'Reply in John Thread', type: 'main', index: 0 }]] },
    'Reply in John Thread':     { main: [[{ node: 'Build Strategist Message', type: 'main', index: 0 }]] },
    'Build Strategist Message': { main: [[{ node: 'Notify Strategist', type: 'main', index: 0 }]] },

    // ClickUp sync branch
    'Parse ClickUp Task ID':    { main: [[{ node: 'Has ClickUp Task?', type: 'main', index: 0 }]] },
    'Has ClickUp Task?': { main: [
      [{ node: 'ClickUp Set Collections',       type: 'main', index: 0 }],  // true
      [],                                                                      // false — dead end
    ]},
    'ClickUp Set Collections':      { main: [[{ node: 'ClickUp Set Invoice Sent Date', type: 'main', index: 0 }]] },
    'ClickUp Set Invoice Sent Date': { main: [[{ node: 'ClickUp Set Invoice Due Date',  type: 'main', index: 0 }]] },
    'ClickUp Set Invoice Due Date':  { main: [[{ node: 'Write ClickUp ID to Tracker',  type: 'main', index: 0 }]] },
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
