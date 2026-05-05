const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;

// Credential IDs in n8n — same as invoice reminder cron
const SHEETS_CRED_ID = '83MQOm78gYDvziTO';   // Google Sheets account
const SLACK_CRED_ID  = 'Bn2U6Cwe1wdiCXzD';   // Krave Slack Bot

const SHEET_ID      = '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50';
const SLACK_CHANNEL = 'C09HN2EBPR7';

const SUMMARY_CODE = `
const STRAT_SLACK = {
  Amanda: 'U07J8SRCPGU',
  Jeneena: 'U07R7FU4WBV',
  Sybil:   'U0A2HLNV8NM',
  Noa:     'U06TBGX9L93',
  John:    'U0AM5EGRVTP'
};

const today    = new Date();
const todayStr = today.toISOString().split('T')[0];
const msDay    = 86400000;
const rows     = $input.all();

const collections = [];
const lateFee     = [];
const overdue     = [];
const dueThisWeek = [];
const upcoming    = [];

for (const row of rows) {
  const j = row.json;

  const status        = (j['Status']         || '').toString().trim();
  const paymentStatus = (j['Payment Status'] || '').toString().trim();

  // Skip paid and draft rows
  if (
    status === 'Paid'                    ||
    status === 'Payment Complete'        ||
    paymentStatus === 'Payment Complete' ||
    status.startsWith('Draft')           ||
    paymentStatus.startsWith('Draft')
  ) continue;

  if (!j['Invoice #'] || !j['Due Date']) continue;

  const dueDate = new Date(j['Due Date'].toString().trim());
  if (isNaN(dueDate.getTime())) continue;

  const daysDiff = Math.round((dueDate.getTime() - today.getTime()) / msDay);

  const clientName  = (j['Client Name']   || '').toString().trim();
  const invoiceNum  = (j['Invoice #']     || '').toString().trim();
  const amount      = (j['Amount']        || '').toString().trim();
  const currency    = (j['Currency']      || '').toString().trim();
  const dueDateStr  = j['Due Date'].toString().trim();
  const requestedBy = (j['Requested By']  || '').toString().trim();

  const isPartial  = paymentStatus === 'Partial Payment';
  const amountPaid = isPartial ? parseFloat((j['Amount Paid'] || '0').toString().replace(/,/g, '')) : 0;
  const fullAmt    = parseFloat((amount || '0').replace(/,/g, ''));
  const displayAmt = isPartial ? Math.max(0, fullAmt - amountPaid).toFixed(2) : amount;

  const stratSlackId = STRAT_SLACK[requestedBy] || null;
  const stratMention = stratSlackId ? '<@' + stratSlackId + '>' : (requestedBy || '—');
  const daysOverdue  = daysDiff < 0 ? Math.abs(daysDiff) : 0;

  const entry = { clientName, invoiceNum, displayAmt, currency, dueDateStr, daysDiff, daysOverdue, stratMention, isPartial };

  if (paymentStatus === 'Collections' || daysDiff <= -60) {
    collections.push(entry);
  } else if (daysDiff <= -8) {
    lateFee.push(entry);
  } else if (daysDiff <= -1) {
    overdue.push(entry);
  } else if (daysDiff <= 7) {
    dueThisWeek.push(entry);
  } else {
    upcoming.push(entry);
  }
}

const fmtOverdue = e => {
  const partial = e.isPartial ? ' _(partial — remaining)_' : '';
  return '• ' + e.clientName + ' — ' + e.invoiceNum + ' — ' + e.displayAmt + ' ' + e.currency + partial + ' — ' + e.daysOverdue + ' day' + (e.daysOverdue !== 1 ? 's' : '') + ' overdue — ' + e.stratMention;
};
const fmtUpcoming = e => {
  const partial = e.isPartial ? ' _(partial — remaining)_' : '';
  return '• ' + e.clientName + ' — ' + e.invoiceNum + ' — ' + e.displayAmt + ' ' + e.currency + partial + ' — Due ' + e.dueDateStr;
};

const lines = ['*📊 Weekly Invoice Summary — ' + todayStr + '*'];

if (collections.length) {
  lines.push('\\n*🔴 Collections (' + collections.length + '):*');
  collections.forEach(e => lines.push(fmtOverdue(e)));
}
if (lateFee.length) {
  lines.push('\\n*🟠 Late Fee Applied (' + lateFee.length + '):*');
  lateFee.forEach(e => lines.push(fmtOverdue(e)));
}
if (overdue.length) {
  lines.push('\\n*🟡 Overdue — Needs Chase (' + overdue.length + '):*');
  overdue.forEach(e => lines.push(fmtOverdue(e)));
}
if (dueThisWeek.length) {
  lines.push('\\n*🔵 Due This Week (' + dueThisWeek.length + '):*');
  dueThisWeek.forEach(e => lines.push(fmtUpcoming(e)));
}
if (upcoming.length) {
  lines.push('\\n*⚪ Pending — Upcoming (' + upcoming.length + '):*');
  upcoming.forEach(e => lines.push(fmtUpcoming(e)));
}

const total = collections.length + lateFee.length + overdue.length + dueThisWeek.length + upcoming.length;
const summaryText = total === 0
  ? '✅ No outstanding invoices — all paid or no open items.'
  : lines.join('\\n');

return [{ json: { summaryText } }];
`.trim();

const workflow = {
  name: 'Krave — Weekly Invoice Summary',
  settings: { executionOrder: 'v1', saveManualExecutions: true },
  nodes: [
    {
      id: 'n1', name: 'Schedule Monday 9am ICT',
      type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
      position: [240, 300],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 2 * * 1' }] } }
    },
    {
      id: 'n2', name: 'Webhook Trigger',
      type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [240, 480],
      webhookId: 'krave-weekly-invoice-summary',
      parameters: { httpMethod: 'POST', path: 'krave-weekly-invoice-summary', responseMode: 'onReceived', options: {} }
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
        filtersUI: {}, options: {}
      }
    },
    {
      id: 'n4', name: 'Build Weekly Summary',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [680, 390],
      parameters: { mode: 'runOnceForAllItems', jsCode: SUMMARY_CODE }
    },
    {
      id: 'n5', name: 'Post Weekly Summary',
      type: 'n8n-nodes-base.slack', typeVersion: 2.2,
      position: [900, 390],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message', operation: 'post',
        select: 'channel',
        channelId: { __rl: true, value: SLACK_CHANNEL, mode: 'id' },
        text: '={{ $json.summaryText }}',
        otherOptions: {}
      }
    }
  ],
  connections: {
    'Schedule Monday 9am ICT': { main: [[{ node: 'Get Invoice Tracker', type: 'main', index: 0 }]] },
    'Webhook Trigger':         { main: [[{ node: 'Get Invoice Tracker', type: 'main', index: 0 }]] },
    'Get Invoice Tracker':     { main: [[{ node: 'Build Weekly Summary', type: 'main', index: 0 }]] },
    'Build Weekly Summary':    { main: [[{ node: 'Post Weekly Summary',  type: 'main', index: 0 }]] }
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
  const list     = await n8nRequest('GET', `/api/v1/workflows?name=${encodeURIComponent(workflow.name)}&limit=250`);
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
  console.log('\nManual test via:');
  console.log('POST https://noatakhel.app.n8n.cloud/webhook/krave-weekly-invoice-summary');
}

if (require.main === module) {
  deploy().catch((e) => console.error('Deploy failed:', e.message));
}

module.exports = { workflow };
