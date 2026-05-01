const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;

const GMAIL_CRED_ID  = 'vsDW3WpKXqS9HUs3';   // Gmail account (john@kravemedia.co)
const SHEETS_CRED_ID = '83MQOm78gYDvziTO';   // Google Sheets account

const SHEET_ID = '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50';
const JOHN_EMAIL = 'john@kravemedia.co';

const PREPARE_REPLY_QUERIES_CODE = `
const rows = $input.all();
const out = [];

for (const row of rows) {
  const j = row.json;
  const invoiceNum = (j['Invoice #'] || '').toString().trim();
  const clientName = (j['Client Name'] || '').toString().trim();
  const rawEmail = (j['Email Address'] || '').toString().trim();
  const lastFollowUpSent = (j['Last Follow-Up Sent'] || '').toString().trim();
  const lastFollowUpType = (j['Last Follow-Up Type'] || '').toString().trim();
  const lastFollowUpThreadId = (j['Last Follow-Up Thread ID'] || '').toString().trim();
  const currentReplyDate = (j['Last Client Reply Date'] || '').toString().trim();

  if (!invoiceNum || !lastFollowUpSent || !rawEmail) continue;
  const emails = rawEmail
    .split(/[,;\\s]+/)
    .map(e => e.trim())
    .filter(e => /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(e));
  if (!emails.length) continue;

  const after = lastFollowUpSent.replace(/-/g, '/');
  const senderQuery = emails.map(e => 'from:' + e).join(' OR ');
  const query = '(' + senderQuery + ') after:' + after;

  out.push({
    json: {
      invoiceNum,
      clientName,
      clientEmails: emails,
      lastFollowUpSent,
      lastFollowUpType,
      lastFollowUpThreadId,
      replyConfidence: lastFollowUpThreadId ? 'Confirmed' : 'Likely',
      currentReplyDate,
      gmailQuery: query
    }
  });
}

return out;
`.trim();

const CLASSIFY_REPLY_CODE = `
let sourceItems = [];
try {
  sourceItems = $('Prepare Reply Queries').all();
} catch (e) {
  try { sourceItems = $items('Prepare Reply Queries'); } catch (_) { sourceItems = []; }
}
const sources = sourceItems.map(item => item.json);
const sourcesByInvoice = new Map(sources.map(source => [source.invoiceNum, source]));
const messageItems = $input.all();

function normalizeDate(value) {
  if (!value) return '';
  const raw = value.toString();
  const d = /^\\d+$/.test(raw) ? new Date(Number(raw)) : new Date(raw);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function bodyText(message) {
  return [
    message.textPlain,
    message.textHtml,
    message.snippet,
    message.subject,
    message.Subject
  ].filter(Boolean).join(' ');
}

function fromEmail(message) {
  const raw = ((message.from && message.from.email) || message.from || message.From || '').toString();
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

function pairedIndex(item) {
  const paired = item.pairedItem;
  if (Array.isArray(paired)) return paired[0] && paired[0].item;
  return paired && paired.item;
}

function invoiceFromMessage(message) {
  const text = [message.Subject, message.subject, message.snippet].filter(Boolean).join(' ');
  const match = text.match(/INV[A-Z0-9-]*/);
  return match ? match[0] : '';
}

const grouped = new Map();
for (const item of messageItems) {
  const index = pairedIndex(item);
  const source = index === undefined || index === null ? null : sources[index];
  const message = item.json;
  const messageInvoiceNum = invoiceFromMessage(message);
  const invoiceNum = messageInvoiceNum || (source && source.invoiceNum);
  if (!invoiceNum) continue;
  const matchedSource = sourcesByInvoice.get(invoiceNum) || (source && source.invoiceNum === invoiceNum ? source : null);
  if (!grouped.has(invoiceNum)) grouped.set(invoiceNum, { source: matchedSource, messages: [] });
  grouped.get(invoiceNum).messages.push(message);
}

const out = [];
for (const [invoiceNum, group] of grouped.entries()) {
  const source = group.source || {};
  const replies = group.messages
    .sort((a, b) => Number(b.internalDate || 0) - Number(a.internalDate || 0));

  if (!replies.length) continue;

  const latest = replies[0];
  const text = bodyText(latest).replace(/\\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  const isExactThreadMatch = !!(source.lastFollowUpThreadId && latest.threadId && latest.threadId === source.lastFollowUpThreadId);
  let clientReplyStatus = isExactThreadMatch ? 'Replied' : 'Possible Reply';
  let replyConfidence = isExactThreadMatch ? 'Confirmed' : 'Likely';
  if (/pay|paid|payment|settle|transfer|wire|remit|tomorrow|today|this week|next week/.test(lower)) {
    clientReplyStatus = 'Promise to Pay';
  }
  if (/question|issue|problem|wrong|incorrect|dispute|why|cannot|can't|need invoice|po\\b|purchase order/.test(lower)) {
    clientReplyStatus = 'Question/Dispute';
  }
  if (/urgent|call|speak|confused|not our invoice|cancel|refund|legal|cc\\b|finance team|w8|w-8|w8-ben|w-8ben/.test(lower)) {
    clientReplyStatus = 'Needs Human';
  }

  out.push({
    json: {
      invoiceNum,
      lastClientReplyDate: normalizeDate(latest.date || latest.internalDate),
      clientReplyStatus,
      clientReplySummary: text.slice(0, 240),
      replyConfidence,
      followUpAttribution: source.lastFollowUpType && source.lastFollowUpSent
        ? 'Client emailed John after ' + source.lastFollowUpType + ' follow-up on ' + source.lastFollowUpSent
        : 'Client emailed John after tracked follow-up'
    }
  });
}

return out;
`.trim();

const workflow = {
  name: 'Krave - Invoice Reminder Reply Detection',
  settings: { executionOrder: 'v1', saveManualExecutions: true },
  nodes: [
    {
      id: 'n1', name: 'Schedule Reply Check',
      type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
      position: [220, 300],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '30 3 * * 1-5' }] } }
    },
    {
      id: 'n2', name: 'Webhook Trigger',
      type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [220, 480],
      webhookId: 'krave-invoice-reminder-reply-detection',
      parameters: { httpMethod: 'POST', path: 'krave-invoice-reminder-reply-detection', responseMode: 'onReceived', options: {} }
    },
    {
      id: 'n3', name: 'Get Invoice Tracker',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [460, 390],
      credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet', operation: 'read',
        documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        range: 'A:Z',
        filtersUI: {}, options: {}
      }
    },
    {
      id: 'n4', name: 'Prepare Reply Queries',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [700, 390],
      parameters: { mode: 'runOnceForAllItems', jsCode: PREPARE_REPLY_QUERIES_CODE }
    },
    {
      id: 'n5', name: 'Set No Reply Baseline',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [940, 520],
      credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet', operation: 'appendOrUpdate',
        documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            'Invoice #': "={{ $json.invoiceNum }}",
            'Last Client Reply Date': '',
            'Client Reply Status': 'No Reply Found',
            'Client Reply Summary': '',
            'Follow-Up Attribution': "={{ 'No matching John Gmail reply found after ' + $json.lastFollowUpType + ' follow-up on ' + $json.lastFollowUpSent }}",
            'Reply Confidence': 'Unconfirmed'
          },
          matchingColumns: ['Invoice #'],
          schema: []
        },
        options: {}
      }
    },
    {
      id: 'n6', name: 'Search John Gmail Replies',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [1180, 390],
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'getAll',
        returnAll: true,
        filters: { q: "={{ $('Prepare Reply Queries').item.json.gmailQuery }}" },
        options: {}
      }
    },
    {
      id: 'n7', name: 'Classify Reply',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1420, 390],
      parameters: { mode: 'runOnceForAllItems', jsCode: CLASSIFY_REPLY_CODE }
    },
    {
      id: 'n8', name: 'Update Reply Attribution',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [1660, 390],
      credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet', operation: 'appendOrUpdate',
        documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            'Invoice #': "={{ $json.invoiceNum }}",
            'Last Client Reply Date': "={{ $json.lastClientReplyDate }}",
            'Client Reply Status': "={{ $json.clientReplyStatus }}",
            'Client Reply Summary': "={{ $json.clientReplySummary }}",
            'Follow-Up Attribution': "={{ $json.followUpAttribution }}",
            'Reply Confidence': "={{ $json.replyConfidence }}"
          },
          matchingColumns: ['Invoice #'],
          schema: []
        },
        options: {}
      }
    }
  ],
  connections: {
    'Schedule Reply Check': { main: [[{ node: 'Get Invoice Tracker', type: 'main', index: 0 }]] },
    'Webhook Trigger': { main: [[{ node: 'Get Invoice Tracker', type: 'main', index: 0 }]] },
    'Get Invoice Tracker': { main: [[{ node: 'Prepare Reply Queries', type: 'main', index: 0 }]] },
    'Prepare Reply Queries': { main: [[{ node: 'Set No Reply Baseline', type: 'main', index: 0 }]] },
    'Set No Reply Baseline': { main: [[{ node: 'Search John Gmail Replies', type: 'main', index: 0 }]] },
    'Search John Gmail Replies': { main: [[{ node: 'Classify Reply', type: 'main', index: 0 }]] },
    'Classify Reply': { main: [[{ node: 'Update Reply Attribution', type: 'main', index: 0 }]] }
  }
};

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
    if (!result.id) result = await n8nRequest('POST', '/api/v1/workflows', workflow);
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
  console.log('Manual test via: POST https://noatakhel.app.n8n.cloud/webhook/krave-invoice-reminder-reply-detection');
}

if (require.main === module) {
  deploy().catch((e) => console.error('Deploy failed:', e.message));
}

module.exports = { workflow };
