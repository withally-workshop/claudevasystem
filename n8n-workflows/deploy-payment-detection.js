const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;

// Reads n8n workflow static data for the last run timestamp, claims the new window
// by writing nowTs back immediately, then builds the time-windowed Gmail query.
// Static data persists across executions with no external storage required.
const CLAIM_WINDOW_CODE = `
const staticData = $getWorkflowStaticData('global');
const lastRunTs = staticData.lastRunTs || 0;
const nowTs = Math.floor(Date.now() / 1000);
staticData.lastRunTs = nowTs;
const afterFilter = lastRunTs > 0 ? 'after:' + lastRunTs : 'newer_than:1d';
const gmailQuery = 'from:airwallex.com (subject:payment OR subject:deposit OR subject:received) ' + afterFilter;
return [{ json: { lastRunTs, nowTs, gmailQuery } }];
`.trim();

const PARSE_CODE = `
const items = $input.all();
const emails = [];
for (const item of items) {
  const msg = item.json;
  let body = '';
  try {
    const payload = msg.payload || {};
    if (payload.body && payload.body.data) {
      body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    } else if (payload.parts) {
      for (const part of (payload.parts || [])) {
        if (part.mimeType === 'text/plain' && part.body && part.body.data) {
          body = Buffer.from(part.body.data, 'base64').toString('utf-8'); break;
        }
        for (const sub of (part.parts || [])) {
          if (sub.mimeType === 'text/plain' && sub.body && sub.body.data) {
            body = Buffer.from(sub.body.data, 'base64').toString('utf-8'); break;
          }
        }
      }
    }
    if (!body && msg.snippet) body = msg.snippet;
  } catch(e) {}
  const headers = (msg.payload && msg.payload.headers) || [];
  const subject = (headers.find(h => h.name && h.name.toLowerCase() === 'subject') || {}).value || msg.snippet || '';
  const searchText = body + ' ' + subject;
  if (searchText.toLowerCase().includes('shopify')) continue;
  let amount = null, currency = null;
  const p1 = searchText.match(/([A-Z]{3})[\\s$]*([\\d,]+\\.?\\d*)/);
  const p2 = searchText.match(/([\\d,]+\\.?\\d*)\\s*(USD|SGD|HKD|AUD|EUR|GBP)/);
  if (p1 && /^[A-Z]{3}$/.test(p1[1])) { currency = p1[1]; amount = parseFloat(p1[2].replace(/,/g,'')); }
  else if (p2) { amount = parseFloat(p2[1].replace(/,/g,'')); currency = p2[2]; }
  const invMatch = searchText.match(/INV-[\\w\\d-]+/i);
  const invoiceNumber = invMatch ? invMatch[0].toUpperCase() : null;
  emails.push({ emailId: msg.id, subject, amount, currency, invoiceNumber, date: new Date().toISOString().split('T')[0] });
}
return [{ json: { emails, count: emails.length } }];
`.trim();

const MATCH_CODE = `
const parsedData = $('Parse All Emails').first().json;
const emails = parsedData.emails || [];
const today = new Date().toISOString().split('T')[0];
if (emails.length === 0) return [];
const allRows = $input.all();
const openRows = allRows.filter(r => {
  const s = (r.json['Status'] || '').toString().trim();
  return !['Payment Complete','Collections'].includes(s) && r.json['Invoice #'];
});
const results = [];
for (const email of emails) {
  let match = null, confidence = 'none';
  if (email.invoiceNumber) {
    const found = openRows.find(r => (r.json['Invoice #'] || '').toString().trim().toUpperCase() === email.invoiceNumber);
    if (found) { match = found; confidence = 'high'; }
  }
  if (!match && email.amount) {
    const hits = openRows.filter(r => {
      const amt = parseFloat((r.json['Amount'] || '0').toString().replace(/,/g,''));
      const cur = (r.json['Currency'] || '').toString().trim().toUpperCase();
      return Math.abs(amt - email.amount) < 0.01 && cur === email.currency;
    });
    if (hits.length === 1) { match = hits[0]; confidence = 'medium'; }
    else if (hits.length > 1) confidence = 'ambiguous';
  }
  if (match) {
    results.push({
      clientName: match.json['Client Name'] || '',
      invoiceNumber: match.json['Invoice #'] || '',
      airwallexInvoiceId: match.json['Airwallex Invoice ID'] || '',
      amount: email.amount, currency: email.currency, paymentDate: today });
  }
}
return results.map(r => ({ json: r }));
`.trim();

const SLACK_CONFIRMED_TEXT = "={{ '✅ *Payment Received — ' + $('Match Deposits To Invoices').item.json.clientName + '*\\n• Invoice: ' + $('Match Deposits To Invoices').item.json.invoiceNumber + '\\n• Amount: ' + $('Match Deposits To Invoices').item.json.amount + ' ' + $('Match Deposits To Invoices').item.json.currency + '\\n• Confirmed: ' + $('Match Deposits To Invoices').item.json.paymentDate + '\\n• Tracker: Updated to Payment Complete' }}";


const AW_MARK_PAID_URL = "={{ 'https://api.airwallex.com/api/v1/invoices/' + $('Match Deposits To Invoices').item.json.airwallexInvoiceId + '/mark_as_paid' }}";
const AW_BEARER = "={{ 'Bearer ' + $json.token }}";

const workflow = {
  name: 'Krave — Payment Detection',
  settings: { executionOrder: 'v1', saveManualExecutions: true },
  nodes: [
    {
      id: 'n1', name: 'Hourly',
      type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
      position: [240, 200],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 * * * *' }] } }
    },
    {
      id: 'n12', name: 'Webhook Trigger',
      type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [240, 400],
      webhookId: 'krave-payment-detection',
      parameters: { httpMethod: 'POST', path: 'krave-payment-detection', responseMode: 'onReceived', options: {} }
    },
    {
      // Reads lastRunTs from n8n static data, writes nowTs back immediately to
      // claim the window, then outputs the time-windowed Gmail query.
      id: 'n13', name: 'Claim Window',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [460, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: CLAIM_WINDOW_CODE }
    },
    {
      id: 'n2', name: 'Search Airwallex Emails',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [680, 300],
      credentials: { gmailOAuth2: { id: 'vxHex5lFrkakcsPi', name: 'Gmail account' } },
      parameters: {
        resource: 'message', operation: 'getAll',
        returnAll: false, limit: 20,
        filters: { q: "={{ $('Claim Window').first().json.gmailQuery }}" },
        options: { format: 'full' }
      }
    },
    {
      id: 'n3', name: 'Parse All Emails',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [900, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: PARSE_CODE }
    },
    {
      id: 'n4', name: 'Get Invoice Tracker',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [1120, 300],
      credentials: { googleSheetsOAuth2Api: { id: '83MQOm78gYDvziTO', name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet', operation: 'read',
        documentId: { __rl: true, value: '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50', mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        filtersUI: {}, options: {}
      }
    },
    {
      id: 'n5', name: 'Match Deposits To Invoices',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1340, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: MATCH_CODE }
    },
    {
      id: 'n7', name: 'Airwallex Auth',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [1780, 160],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: 'https://api.airwallex.com/api/v1/authentication/login',
        authentication: 'none', sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'x-client-id', value: 'JaQA4uJ1SDSBkTdFigT9sw' },
          { name: 'x-api-key', value: '5611f8e189ef357e5b3493916208efb80413595b50e7201b8fc98af5c91666f50b10ee64fd87fa3db7435e8dc5c07721' }
        ]},
        sendBody: false, options: {}
      }
    },
    {
      id: 'n8', name: 'Airwallex Mark Paid',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [2000, 160],
      continueOnFail: true,
      parameters: {
        method: 'POST', url: AW_MARK_PAID_URL,
        authentication: 'none', sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'Authorization', value: AW_BEARER },
          { name: 'Content-Type', value: 'application/json' },
          { name: 'x-api-version', value: '2025-06-16' }
        ]},
        sendBody: false, options: {}
      }
    },
    {
      id: 'n9', name: 'Update Invoice Status',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [2220, 160],
      credentials: { googleSheetsOAuth2Api: { id: '83MQOm78gYDvziTO', name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet', operation: 'appendOrUpdate',
        documentId: { __rl: true, value: '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50', mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            'Invoice #': "={{ $('Match Deposits To Invoices').item.json.invoiceNumber }}",
            'Status': 'Payment Complete',
            'Payment Confirmed Date': "={{ $('Match Deposits To Invoices').item.json.paymentDate }}"
          },
          matchingColumns: ['Invoice #'],
          schema: []
        },
        options: {}
      }
    },
    {
      id: 'n10', name: 'Slack Payment Confirmed',
      type: 'n8n-nodes-base.slack', typeVersion: 2.2,
      position: [2440, 160],
      credentials: { slackApi: { id: 'Bn2U6Cwe1wdiCXzD', name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message', operation: 'post',
        select: 'channel',
        channelId: { __rl: true, value: 'C09HN2EBPR7', mode: 'id' },
        text: SLACK_CONFIRMED_TEXT,
        otherOptions: {}
      }
    },
  ],
  connections: {
    'Hourly':          { main: [[{ node: 'Claim Window', type: 'main', index: 0 }]] },
    'Webhook Trigger': { main: [[{ node: 'Claim Window', type: 'main', index: 0 }]] },
    'Claim Window':    { main: [[{ node: 'Search Airwallex Emails', type: 'main', index: 0 }]] },
    'Search Airwallex Emails': { main: [[{ node: 'Parse All Emails', type: 'main', index: 0 }]] },
    'Parse All Emails': { main: [[{ node: 'Get Invoice Tracker', type: 'main', index: 0 }]] },
    'Get Invoice Tracker': { main: [[{ node: 'Match Deposits To Invoices', type: 'main', index: 0 }]] },
    'Match Deposits To Invoices': { main: [[{ node: 'Airwallex Auth', type: 'main', index: 0 }]] },
    'Airwallex Auth': { main: [[{ node: 'Airwallex Mark Paid', type: 'main', index: 0 }]] },
    'Airwallex Mark Paid': { main: [[{ node: 'Update Invoice Status', type: 'main', index: 0 }]] },
    'Update Invoice Status': { main: [[{ node: 'Slack Payment Confirmed', type: 'main', index: 0 }]] }
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
  console.log('Last-run timestamp is stored in n8n workflow static data — no external setup required.');
}

deploy().catch((e) => console.error('Deploy failed:', e.message));
