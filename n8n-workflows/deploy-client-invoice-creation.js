const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;

const SHEETS_CRED_ID    = '83MQOm78gYDvziTO';
const SLACK_CRED_ID     = 'Bn2U6Cwe1wdiCXzD';
const GMAIL_JOHN_CRED   = 'vsDW3WpKXqS9HUs3';
const SHEET_ID          = '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50';
const JOHN_CHANNEL      = 'C0AQZGJDR38';
const PAYMENTS_CHANNEL  = 'C09HN2EBPR7';

// Must match what deploy-invoice-request-intake.js writes (hyphen, not em dash)
const DRAFT_PENDING_STATUS = 'Draft - Pending John Review';
const SENT_STATUS          = 'Invoice Sent';

// Airwallex credentials — never hardcoded; always from env
const AIRWALLEX_CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID;
const AIRWALLEX_API_KEY   = process.env.AIRWALLEX_API_KEY;

// ─── Code node: find the notification message in John's channel ───────────────
const FIND_NOTIFICATION_CODE = `
const invoiceId   = $('Read Invoice Tracker').item.json['Airwallex Invoice ID'] || '';
const invoiceNum  = $('Read Invoice Tracker').item.json['Invoice #'] || '';
const clientName  = $('Read Invoice Tracker').item.json['Client Name'] || '';
const clientEmail = $('Read Invoice Tracker').item.json['Email Address'] || '';
const amount      = $('Read Invoice Tracker').item.json['Amount'] || '';
const currency    = $('Read Invoice Tracker').item.json['Currency'] || '';
const dueDate     = $('Read Invoice Tracker').item.json['Due Date'] || '';
const requestedBy = $('Read Invoice Tracker').item.json['Requested By'] || '';

const messages = ($json.messages || []);
const match = messages.find(m => m.bot_id && invoiceId && (m.text || '').includes(invoiceId));

const base = { invoiceId, invoiceNum, clientName, clientEmail, amount, currency, dueDate, requestedBy };

if (!match) {
  return [{ json: { ...base, notFound: true } }];
}
// Extract receipt_ts from the 🔗 thread URL encoded in the notification text
const urlMatch = (match.text || '').match(/\/p(\d{13,})/);
let receipt_ts = null;
if (urlMatch) {
  const digits = urlMatch[1];
  receipt_ts = digits.slice(0, -6) + '.' + digits.slice(-6);
}
return [{ json: { ...base, notFound: false, notification_ts: match.ts, receipt_ts } }];
`.trim();

// ─── Code node: find an unprocessed "approve" reply ──────────────────────────
const FIND_APPROVE_REPLY_CODE = `
const ctx     = $('Find Draft Notification').item.json;
const replies = ($json.messages || []);

for (const r of replies) {
  if (r.ts === ctx.notification_ts) continue;   // skip the parent message itself
  const isApprove    = (r.text || '').toLowerCase().includes('approve');
  const hasCheckmark = (r.reactions || []).some(rx => rx.name === 'white_check_mark');
  if (isApprove && !hasCheckmark) {
    return [{ json: { ...ctx, approvalFound: true, approval_reply_ts: r.ts } }];
  }
}
return [{ json: { ...ctx, approvalFound: false } }];
`.trim();

// ─── Code node: extract payment link from Get Invoice response ────────────────
const EXTRACT_PAYMENT_LINK_CODE = `
const resp = $json;
const link  = resp.hosted_invoice_url
           || resp.digital_invoice_link
           || resp.payment_link
           || resp.checkout_url
           || null;
const ctx = $('Find Approve Reply').item.json;
return [{ json: { ...ctx, payment_link: link, link_found: !!link } }];
`.trim();

// ─── Slack message templates ──────────────────────────────────────────────────
const JOHN_THREAD_REPLY_TEXT = `={{ '✅ *Invoice finalized — ' + $json.clientName + '*\\n• Invoice #: ' + $json.invoiceNum + '\\n• Amount: ' + $json.amount + ' ' + $json.currency + '\\n• Due: ' + $json.dueDate + (($json.link_found && $json.payment_link) ? '\\n• Payment link: ' + $json.payment_link : '\\n⚠️ Payment link unavailable — retrieve from Airwallex dashboard.') + '\\n\\nStrategist notified in #payments-invoices-updates.' }}`;

const STRATEGIST_NOTIFY_TEXT = `={{ '✅ *Invoice sent — ' + $json.clientName + '*\\n• Invoice #: ' + $json.invoiceNum + '\\n• Amount: ' + $json.amount + ' ' + $json.currency + '\\n• Due: ' + $json.dueDate + '\\n• Requested by: ' + $json.requestedBy + (($json.link_found && $json.payment_link) ? '\\n• Payment link: ' + $json.payment_link : '') }}`;

const AUTH_FAILED_TEXT = "={{ '⚠️ Airwallex auth failed — could not finalize invoice ' + $('Find Approve Reply').item.json.invoiceId + ' for ' + $('Find Approve Reply').item.json.clientName + '. Check credentials and finalize manually in Airwallex dashboard.' }}";

const EMAIL_SUBJECT = `={{ 'Invoice ' + $json.invoiceNum + ' — ' + $json.clientName + ' — ' + $json.amount + ' ' + $json.currency }}`;

const EMAIL_BODY = `={{ 'Hi ' + $json.clientName + ',\\n\\nPlease find your invoice details below.\\n\\nAmount: ' + $json.amount + ' ' + $json.currency + '\\nDue Date: ' + $json.dueDate + '\\nInvoice #: ' + $json.invoiceNum + ($json.payment_link ? '\\n\\nYou can view and pay your invoice here:\\n' + $json.payment_link : '') + '\\n\\nBest regards,\\nJohn\\nKrave Media' }}`;

// ─── Workflow definition ──────────────────────────────────────────────────────
const workflow = {
  name: 'Krave — Client Invoice Creation',
  nodes: [
    {
      id: 'n1', name: 'Schedule',
      type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
      position: [0, 200],
      parameters: {
        rule: { interval: [{ field: 'cronExpression', expression: '0 1,3,5,7,9 * * 1-5' }] }
      }
    },
    {
      id: 'n2', name: 'Webhook Trigger',
      type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [0, 400],
      parameters: {
        path: 'krave-client-invoice-creation',
        httpMethod: 'POST',
        responseMode: 'onReceived',
        responseData: 'allEntries',
        options: {}
      }
    },
    {
      id: 'n3', name: 'Read Invoice Tracker',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [250, 300],
      credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet',
        operation: 'read',
        documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        filtersUI: {},
        options: {}
      }
    },
    {
      id: 'n4', name: 'Is Draft Pending?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [500, 300],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [{ id: 'c1', leftValue: '={{ $json.Status }}', rightValue: DRAFT_PENDING_STATUS, operator: { type: 'string', operation: 'equals' } }],
          combinator: 'and'
        },
        options: {}
      }
    },
    {
      id: 'n5', name: 'Get John Channel History',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [750, 200],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'GET',
        url: 'https://slack.com/api/conversations.history',
        sendQuery: true,
        queryParameters: { parameters: [
          { name: 'channel', value: JOHN_CHANNEL },
          { name: 'limit', value: '200' },
        ]},
        options: {}
      }
    },
    {
      id: 'n6', name: 'Find Draft Notification',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1000, 200],
      parameters: { jsCode: FIND_NOTIFICATION_CODE, mode: 'runOnceForEachItem' }
    },
    {
      id: 'n7', name: 'Notification Found?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [1250, 200],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [{ id: 'c1', leftValue: '={{ $json.notFound }}', rightValue: true, operator: { type: 'boolean', operation: 'notEquals' } }],
          combinator: 'and'
        },
        options: {}
      }
    },
    {
      id: 'n8', name: 'Get Thread Replies',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [1500, 200],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'GET',
        url: 'https://slack.com/api/conversations.replies',
        sendQuery: true,
        queryParameters: { parameters: [
          { name: 'channel', value: JOHN_CHANNEL },
          { name: 'ts', value: '={{ $json.notification_ts }}' },
          { name: 'limit', value: '100' },
        ]},
        options: {}
      }
    },
    {
      id: 'n9', name: 'Find Approve Reply',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1750, 200],
      parameters: { jsCode: FIND_APPROVE_REPLY_CODE, mode: 'runOnceForEachItem' }
    },
    {
      id: 'n10', name: 'Approve Reply Found?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [2000, 200],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [{ id: 'c1', leftValue: '={{ $json.approvalFound }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
          combinator: 'and'
        },
        options: {}
      }
    },
    {
      // React immediately to claim the approval — prevents double-processing if
      // the tracker update later fails, since FIND_APPROVE_REPLY_CODE skips ✅ replies.
      id: 'n22', name: 'React Approved',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [2250, 200],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'POST',
        url: 'https://slack.com/api/reactions.add',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ { channel: '${JOHN_CHANNEL}', timestamp: $json.approval_reply_ts, name: 'white_check_mark' } }}`,
        options: {}
      }
    },
    {
      id: 'n11', name: 'Airwallex Auth',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [2500, 200],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: 'https://api.airwallex.com/api/v1/authentication/login',
        authentication: 'none',
        sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'x-client-id', value: AIRWALLEX_CLIENT_ID },
          { name: 'x-api-key', value: AIRWALLEX_API_KEY },
        ]},
        sendBody: false,
        options: {}
      }
    },
    {
      id: 'n12', name: 'Auth OK?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [2750, 200],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [{ id: 'c1', leftValue: '={{ $json.token }}', rightValue: '', operator: { type: 'string', operation: 'notEquals' } }],
          combinator: 'and'
        },
        options: {}
      }
    },
    {
      id: 'n13', name: 'Finalize Invoice',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [3000, 100],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: "={{ 'https://api.airwallex.com/api/v1/invoices/' + $('Find Approve Reply').item.json.invoiceId + '/finalize' }}",
        authentication: 'none',
        sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'Authorization', value: "={{ 'Bearer ' + $json.token }}" },
          { name: 'Content-Type', value: 'application/json' },
          { name: 'x-api-version', value: '2025-06-16' },
        ]},
        sendBody: true,
        specifyBody: 'json',
        jsonBody: "={{ { request_id: 'finalize_' + $('Find Approve Reply').item.json.invoiceId } }}",
        options: {}
      }
    },
    {
      id: 'n23', name: 'Finalize OK?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [3250, 100],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [{ id: 'c1', leftValue: '={{ $json.error ? true : false }}', rightValue: false, operator: { type: 'boolean', operation: 'equals' } }],
          combinator: 'and'
        },
        options: {}
      }
    },
    {
      id: 'n24', name: 'Alert Finalize Failed',
      type: 'n8n-nodes-base.slack', typeVersion: 2.2,
      position: [3250, 350],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message',
        operation: 'post',
        select: 'channel',
        channelId: { __rl: true, value: JOHN_CHANNEL, mode: 'id' },
        text: "={{ '⚠️ Invoice finalization failed for ' + $('Find Approve Reply').item.json.clientName + ' (' + $('Find Approve Reply').item.json.invoiceId + ').\\nError: ' + ($json.error ? ($json.error.message || JSON.stringify($json.error)) : 'Unknown') + '\\nPlease finalize manually in Airwallex dashboard.' }}",
        otherOptions: {}
      }
    },
    {
      id: 'n14', name: 'Get Invoice',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [3500, 100],
      continueOnFail: true,
      parameters: {
        method: 'GET',
        url: "={{ 'https://api.airwallex.com/api/v1/invoices/' + $('Find Approve Reply').item.json.invoiceId }}",
        authentication: 'none',
        sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'Authorization', value: "={{ 'Bearer ' + $('Airwallex Auth').item.json.token }}" },
          { name: 'x-api-version', value: '2025-06-16' },
        ]},
        sendBody: false,
        options: {}
      }
    },
    {
      id: 'n15', name: 'Extract Payment Link',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [3750, 100],
      parameters: { jsCode: EXTRACT_PAYMENT_LINK_CODE, mode: 'runOnceForEachItem' }
    },
    {
      id: 'n16', name: 'Update Tracker',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [4000, 100],
      credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet',
        operation: 'appendOrUpdate',
        documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            'Invoice #': "={{ $json.invoiceNum }}",
            Status: SENT_STATUS,
          },
          matchingColumns: ['Invoice #'],
          schema: []
        },
        options: {}
      }
    },
    {
      id: 'n17', name: 'Reply in John Thread',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [4250, 100],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'POST',
        url: 'https://slack.com/api/chat.postMessage',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ { channel: '${JOHN_CHANNEL}', thread_ts: $('Find Draft Notification').item.json.notification_ts, text: '✅ *Invoice finalized — ' + $json.clientName + '*\\n• Invoice #: ' + $json.invoiceNum + '\\n• Amount: ' + $json.amount + ' ' + $json.currency + '\\n• Due: ' + $json.dueDate + ($json.link_found ? '\\n• Payment link: ' + $json.payment_link : '\\n⚠️ Payment link unavailable — retrieve from Airwallex dashboard.') + '\\nStrategist notified in #payments-invoices-updates.' } }}`,
        options: {}
      }
    },
    {
      // Posts in the original receipt thread so the strategist sees the update in context.
      // Falls back to top-level post if receipt_ts is unavailable.
      id: 'n18', name: 'Notify Strategist',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [4500, 100],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'POST',
        url: 'https://slack.com/api/chat.postMessage',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ { channel: '${PAYMENTS_CHANNEL}', thread_ts: $json.receipt_ts || undefined, text: '✅ *Invoice sent — ' + $json.clientName + '*\\n• Invoice #: ' + $json.invoiceNum + '\\n• Amount: ' + $json.amount + ' ' + $json.currency + '\\n• Due: ' + $json.dueDate + '\\n• Requested by: ' + $json.requestedBy + ($json.link_found ? '\\n• Payment link: ' + $json.payment_link : '') } }}`,
        options: {}
      }
    },
    {
      id: 'n19', name: 'Has Client Email?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [4750, 100],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [{ id: 'c1', leftValue: '={{ $json.clientEmail }}', rightValue: '', operator: { type: 'string', operation: 'notEquals' } }],
          combinator: 'and'
        },
        options: {}
      }
    },
    {
      id: 'n20', name: 'Email Client',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [5000, 0],
      continueOnFail: true,
      credentials: { gmailOAuth2: { id: GMAIL_JOHN_CRED, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'send',
        sendTo: '={{ $json.clientEmail }}',
        subject: `={{ 'Invoice ' + $json.invoiceNum + ' — ' + $json.clientName + ' — ' + $json.amount + ' ' + $json.currency }}`,
        emailType: 'text',
        message: `={{ 'Hi ' + $json.clientName + ',\\n\\nPlease find your invoice details below.\\n\\nAmount: ' + $json.amount + ' ' + $json.currency + '\\nDue Date: ' + $json.dueDate + '\\nInvoice #: ' + $json.invoiceNum + ($json.link_found ? '\\n\\nYou can view and pay your invoice here:\\n' + $json.payment_link : '') + '\\n\\nBest regards,\\nJohn\\nKrave Media' }}`,
        options: {}
      }
    },
    {
      id: 'n21', name: 'Alert Auth Failed',
      type: 'n8n-nodes-base.slack', typeVersion: 2.2,
      position: [3000, 350],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message',
        operation: 'post',
        select: 'channel',
        channelId: { __rl: true, value: JOHN_CHANNEL, mode: 'id' },
        text: AUTH_FAILED_TEXT,
        otherOptions: {}
      }
    },
  ],
  settings: { executionOrder: 'v1' },
  connections: {
    'Schedule':                { main: [[{ node: 'Read Invoice Tracker', type: 'main', index: 0 }]] },
    'Webhook Trigger':         { main: [[{ node: 'Read Invoice Tracker', type: 'main', index: 0 }]] },
    'Read Invoice Tracker':    { main: [[{ node: 'Is Draft Pending?', type: 'main', index: 0 }]] },
    'Is Draft Pending?':       { main: [
      [{ node: 'Get John Channel History', type: 'main', index: 0 }],
      // false → discard row silently
    ]},
    'Get John Channel History':{ main: [[{ node: 'Find Draft Notification', type: 'main', index: 0 }]] },
    'Find Draft Notification': { main: [[{ node: 'Notification Found?', type: 'main', index: 0 }]] },
    'Notification Found?':     { main: [
      [{ node: 'Get Thread Replies', type: 'main', index: 0 }],
      // false → skip, no notification in channel yet
    ]},
    'Get Thread Replies':      { main: [[{ node: 'Find Approve Reply', type: 'main', index: 0 }]] },
    'Find Approve Reply':      { main: [[{ node: 'Approve Reply Found?', type: 'main', index: 0 }]] },
    'Approve Reply Found?':    { main: [
      [{ node: 'React Approved', type: 'main', index: 0 }],
      // false → no approve yet, skip
    ]},
    'React Approved':          { main: [[{ node: 'Airwallex Auth', type: 'main', index: 0 }]] },
    'Airwallex Auth':          { main: [[{ node: 'Auth OK?', type: 'main', index: 0 }]] },
    'Auth OK?':                { main: [
      [{ node: 'Finalize Invoice', type: 'main', index: 0 }],
      [{ node: 'Alert Auth Failed', type: 'main', index: 0 }],
    ]},
    'Finalize Invoice':        { main: [[{ node: 'Finalize OK?', type: 'main', index: 0 }]] },
    'Finalize OK?':            { main: [
      [{ node: 'Get Invoice', type: 'main', index: 0 }],
      [{ node: 'Alert Finalize Failed', type: 'main', index: 0 }],
    ]},
    'Get Invoice':             { main: [[{ node: 'Extract Payment Link', type: 'main', index: 0 }]] },
    'Extract Payment Link':    { main: [[{ node: 'Update Tracker', type: 'main', index: 0 }]] },
    'Update Tracker':          { main: [[{ node: 'Reply in John Thread', type: 'main', index: 0 }]] },
    'Reply in John Thread':    { main: [[{ node: 'Notify Strategist', type: 'main', index: 0 }]] },
    'Notify Strategist':       { main: [[{ node: 'Has Client Email?', type: 'main', index: 0 }]] },
    'Has Client Email?':       { main: [
      [{ node: 'Email Client', type: 'main', index: 0 }],
      // false → no email on file, skip silently
    ]},
  },
};

// ─── n8n API helpers ──────────────────────────────────────────────────────────
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
  const list = await n8nRequest('GET', `/api/v1/workflows?name=${encodeURIComponent(workflow.name)}&limit=250`);
  const existing = (list.data || []).find((w) => w.name === workflow.name && w.active !== null);

  let result;
  if (existing) {
    result = await n8nRequest('PUT', `/api/v1/workflows/${existing.id}`, workflow);
    if (!result.id) {
      result = await n8nRequest('POST', '/api/v1/workflows', workflow);
    }
  } else {
    result = await n8nRequest('POST', '/api/v1/workflows', workflow);
  }

  if (!result.id) {
    console.log('ERROR:', JSON.stringify(result, null, 2).substring(0, 2000));
    return;
  }

  await n8nRequest('POST', `/api/v1/workflows/${result.id}/activate`);
  console.log('SUCCESS');
  console.log('Workflow ID:', result.id);
  console.log('Name:', result.name);
  console.log('URL: https://noatakhel.app.n8n.cloud/workflow/' + result.id);
  console.log('\nTest via:');
  console.log('curl -s -X POST "https://noatakhel.app.n8n.cloud/webhook/krave-client-invoice-creation" -H "Content-Type: application/json" -d \'{}\'');
}

if (require.main === module) {
  deploy().catch((e) => console.error('Deploy failed:', e.message));
}

module.exports = {
  API_KEY,
  N8N_URL,
  SHEETS_CRED_ID,
  SLACK_CRED_ID,
  GMAIL_JOHN_CRED,
  SHEET_ID,
  JOHN_CHANNEL,
  PAYMENTS_CHANNEL,
  DRAFT_PENDING_STATUS,
  SENT_STATUS,
  AIRWALLEX_CLIENT_ID,
  AIRWALLEX_API_KEY,
  workflow,
};
