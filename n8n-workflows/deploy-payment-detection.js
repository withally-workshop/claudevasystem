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
  // Detect "Payment 1/2", "Payment 2/2", etc. in email reference/body
  const fracMatch = searchText.match(/Payment\\s+(\\d+)\\s*\\/\\s*(\\d+)/i);
  const paymentNumber = fracMatch ? parseInt(fracMatch[1]) : null;
  const totalPayments = fracMatch ? parseInt(fracMatch[2]) : null;
  emails.push({ emailId: msg.id, subject, amount, currency, invoiceNumber, date: new Date().toISOString().split('T')[0], paymentNumber, totalPayments });
}
return [{ json: { emails, count: emails.length } }];
`.trim();

// Polls Airwallex invoice API directly for open invoices — second detection path for
// SWIFT bank transfers where no Airwallex notification email is generated.
// Receives tracker rows as $input; outputs emails array in same shape as PARSE_CODE.
// NOTE: Airwallex paid_amount field name is unconfirmed — inspect on first run with
// a live partial invoice and update the field name candidates below if needed.
const POLL_AW_CODE = `
const trackerRows = $input.all();
const today = new Date().toISOString().split('T')[0];

// Only poll non-Osome, payment-eligible rows that have an Airwallex Invoice ID.
// Column N Status is formula/display-only: read for eligibility, never write.
const openRows = trackerRows.filter(r => {
  const displayStatus = (r.json['Status'] || '').toString().trim();
  const paymentStatus = (r.json['Payment Status'] || '').toString().trim();
  const awId = (r.json['Airwallex Invoice ID'] || '').toString().trim();
  const notes = (r.json['Notes'] || '').toString().toLowerCase();
  const isOsome = notes.includes('osome') || !awId;
  return ['Unpaid', 'Overdue', ''].includes(displayStatus) &&
    !['Payment Complete', 'Collections'].includes(paymentStatus) &&
    !paymentStatus.startsWith('Draft') &&
    !isOsome;
});

if (openRows.length === 0) return [{ json: { emails: [], count: 0, source: 'airwallex-api' } }];

let token = null;
try {
  const authResp = await $helpers.httpRequest({
    method: 'POST',
    url: 'https://api.airwallex.com/api/v1/authentication/login',
    headers: {
      'x-client-id': 'JaQA4uJ1SDSBkTdFigT9sw',
      'x-api-key': '5611f8e189ef357e5b3493916208efb80413595b50e7201b8fc98af5c91666f50b10ee64fd87fa3db7435e8dc5c07721'
    }
  });
  token = authResp.token;
} catch(e) {
  return [{ json: { emails: [], count: 0, source: 'airwallex-api', error: 'auth-failed: ' + e.message } }];
}

const emails = [];
for (const row of openRows) {
  const awId = row.json['Airwallex Invoice ID'].trim();
  const invoiceNumber = (row.json['Invoice #'] || '').toString().trim().toUpperCase();
  const currency = (row.json['Currency'] || '').toString().trim().toUpperCase();
  const existingAmountPaid = parseFloat((row.json['Amount Paid'] || '0').toString().replace(/,/g, ''));
  try {
    const inv = await $helpers.httpRequest({
      method: 'GET',
      url: 'https://api.airwallex.com/api/v1/invoices/' + awId,
      headers: { 'Authorization': 'Bearer ' + token, 'x-api-version': '2025-06-16' }
    });
    // Check common Airwallex field name candidates for amount received
    const apiPaidAmount = inv.paid_amount ?? inv.amount_paid ?? inv.total_paid ?? null;
    if (apiPaidAmount === null) continue;
    const newPaymentAmount = apiPaidAmount - existingAmountPaid;
    if (newPaymentAmount > 1.00) {
      emails.push({
        emailId: 'api-' + awId,
        subject: 'Airwallex API: payment on ' + invoiceNumber,
        amount: newPaymentAmount,
        currency,
        invoiceNumber,
        date: today,
        paymentNumber: null,
        totalPayments: null,
        source: 'airwallex-api'
      });
    }
  } catch(e) {
    // Per-invoice failure is silent — Gmail scan remains primary
  }
}
return [{ json: { emails, count: emails.length, source: 'airwallex-api' } }];
`.trim();

// Merges Gmail-detected and Airwallex API-detected emails; Gmail takes precedence
// for the same invoice number to avoid double-processing.
const COMBINE_SIGNALS_CODE = `
const allItems = $input.all();
const gmailItem = allItems.find(i => !i.json.source);
const apiItem   = allItems.find(i => i.json.source === 'airwallex-api');
const gmailEmails = (gmailItem && gmailItem.json.emails) || [];
const apiEmails   = (apiItem   && apiItem.json.emails)   || [];
const seen = new Set(gmailEmails.filter(e => e.invoiceNumber).map(e => e.invoiceNumber));
const emails = [...gmailEmails, ...apiEmails.filter(e => !e.invoiceNumber || !seen.has(e.invoiceNumber))];
return [{ json: { emails, count: emails.length } }];
`.trim();

const MATCH_CODE = `
const signalItems = $('Combine Payment Signals').all();
const rawEmails = signalItems.flatMap(item => item.json.emails || []);
const seenEvents = new Set();
const emails = [];
for (const email of rawEmails) {
  const invoiceKey = (email.invoiceNumber || '').toString().trim().toUpperCase();
  const amountKey = email.amount === null || email.amount === undefined ? '' : Number(email.amount).toFixed(2);
  const currencyKey = (email.currency || '').toString().trim().toUpperCase();
  const dateKey = email.date || '';
  const fallbackKey = email.emailId || email.subject || '';
  const eventKey = invoiceKey
    ? invoiceKey + '|' + amountKey + '|' + currencyKey + '|' + dateKey
    : fallbackKey + '|' + amountKey + '|' + currencyKey + '|' + dateKey;
  if (seenEvents.has(eventKey)) continue;
  seenEvents.add(eventKey);
  emails.push(email);
}
const today = new Date().toISOString().split('T')[0];
if (emails.length === 0) return [];
const allRows = $('Get Invoice Tracker').all();
const openRows = allRows.filter(r => {
  const displayStatus = (r.json['Status'] || '').toString().trim();
  const paymentStatus = (r.json['Payment Status'] || '').toString().trim();
  return ['Unpaid', 'Overdue', ''].includes(displayStatus) &&
    !['Payment Complete', 'Collections'].includes(paymentStatus) &&
    !paymentStatus.startsWith('Draft') &&
    r.json['Invoice #'];
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
    const notes = (match.json['Notes'] || '').toString().toLowerCase();
    const airwallexId = (match.json['Airwallex Invoice ID'] || '').toString().trim();
    const isOsome = notes.includes('osome') || !airwallexId;
    const invoiceAmount = parseFloat((match.json['Amount'] || '0').toString().replace(/,/g, ''));
    const existingAmountPaid = parseFloat((match.json['Amount Paid'] || '0').toString().replace(/,/g, ''));
    const newAmountPaid = existingAmountPaid + (email.amount || 0);
    const remainingAmount = Math.max(0, invoiceAmount - newAmountPaid);
    // Partial if cumulative paid still falls short of invoice total by more than $1
    const isPartial = remainingAmount > 1.00;
    results.push({
      clientName: match.json['Client Name'] || '',
      invoiceNumber: match.json['Invoice #'] || '',
      airwallexInvoiceId: airwallexId,
      amount: email.amount, currency: email.currency, paymentDate: today,
      isOsome, isPartial,
      invoiceAmount, newAmountPaid, remainingAmount
    });
  }
}
return results.map(r => ({ json: r }));
`.trim();

const SLACK_PARTIAL_TEXT = "={{ '🔄 *Partial Payment Received — ' + $json.clientName + '*\\n• Invoice: ' + $json.invoiceNumber + '\\n• Received: ' + $json.amount + ' ' + $json.currency + '\\n• Total paid: ' + $json.newAmountPaid + ' / ' + $json.invoiceAmount + ' ' + $json.currency + '\\n• Remaining: ' + $json.remainingAmount + ' ' + $json.currency + '\\n• Tracker: Updated to Partial Payment' }}";

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
      // Tracker rows feed matching and the Airwallex API poll only. They must not
      // feed the Gmail node, or Gmail will run once per tracker row.
      id: 'n4', name: 'Get Invoice Tracker',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [680, 300],
      credentials: { googleSheetsOAuth2Api: { id: '83MQOm78gYDvziTO', name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet', operation: 'read',
        documentId: { __rl: true, value: '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50', mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        filtersUI: {}, options: {}
      }
    },
    {
      id: 'n2', name: 'Search Airwallex Emails',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [900, 140],
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
      position: [1120, 140],
      parameters: { mode: 'runOnceForAllItems', jsCode: PARSE_CODE }
    },
    {
      // Second detection path: polls Airwallex invoice API for open invoices.
      // Catches SWIFT bank-transfer payments where no Airwallex email is sent.
      id: 'n17', name: 'Poll Airwallex Invoices',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [900, 460],
      continueOnFail: true,
      parameters: { mode: 'runOnceForAllItems', jsCode: POLL_AW_CODE }
    },
    {
      // Waits for both paths. Match Deposits To Invoices dedupes the merged signals
      // before any tracker update or Slack notification can happen.
      id: 'n18', name: 'Combine Payment Signals',
      type: 'n8n-nodes-base.merge', typeVersion: 2,
      position: [1340, 300],
      parameters: { mode: 'append' }
    },
    {
      id: 'n5', name: 'Match Deposits To Invoices',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1560, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: MATCH_CODE }
    },
    {
      // Route on whether this is a partial payment (cumulative paid < invoice total by >$1).
      id: 'n19', name: 'Is Partial?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [1780, 300],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [{ id: 'c1', leftValue: '={{ $json.isPartial }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
          combinator: 'and'
        },
        options: {}
      }
    },
    {
      // Partial path: record in tracker; do NOT call Airwallex mark_paid.
      id: 'n20', name: 'Update Partial Tracker',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [2000, 140],
      credentials: { googleSheetsOAuth2Api: { id: '83MQOm78gYDvziTO', name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet', operation: 'appendOrUpdate',
        documentId: { __rl: true, value: '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50', mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            'Invoice #': '={{ $json.invoiceNumber }}',
            'Payment Status': 'Partial Payment',
            'Payment Confirmed Date': '={{ $json.paymentDate }}',
            'Amount Paid': '={{ $json.newAmountPaid }}'
          },
          matchingColumns: ['Invoice #'],
          schema: []
        },
        options: {}
      }
    },
    {
      id: 'n21', name: 'Slack Partial Alert',
      type: 'n8n-nodes-base.slack', typeVersion: 2.2,
      position: [2220, 140],
      credentials: { slackApi: { id: 'Bn2U6Cwe1wdiCXzD', name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message', operation: 'post',
        select: 'channel',
        channelId: { __rl: true, value: 'C09HN2EBPR7', mode: 'id' },
        text: SLACK_PARTIAL_TEXT,
        otherOptions: {}
      }
    },
    {
      // Full payment path: route on whether invoice was created in Osome (no Airwallex record).
      id: 'n14', name: 'Is Osome?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [2000, 460],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [{ id: 'c1', leftValue: '={{ $json.isOsome }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
          combinator: 'and'
        },
        options: {}
      }
    },
    {
      id: 'n7', name: 'Airwallex Auth',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [2220, 340],
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
      position: [2440, 340],
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
      position: [2660, 340],
      credentials: { googleSheetsOAuth2Api: { id: '83MQOm78gYDvziTO', name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet', operation: 'appendOrUpdate',
        documentId: { __rl: true, value: '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50', mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            'Invoice #': "={{ $('Match Deposits To Invoices').item.json.invoiceNumber }}",
            'Payment Status': 'Payment Complete',
            'Payment Confirmed Date': "={{ $('Match Deposits To Invoices').item.json.paymentDate }}",
            'Amount Paid': "={{ $('Match Deposits To Invoices').item.json.invoiceAmount }}"
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
      position: [2880, 340],
      credentials: { slackApi: { id: 'Bn2U6Cwe1wdiCXzD', name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message', operation: 'post',
        select: 'channel',
        channelId: { __rl: true, value: 'C09HN2EBPR7', mode: 'id' },
        text: SLACK_CONFIRMED_TEXT,
        otherOptions: {}
      }
    },
    {
      // Osome path: tracker update only — no Airwallex call since Osome has no API.
      id: 'n15', name: 'Update Osome Invoice Status',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [2220, 580],
      credentials: { googleSheetsOAuth2Api: { id: '83MQOm78gYDvziTO', name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet', operation: 'appendOrUpdate',
        documentId: { __rl: true, value: '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50', mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            'Invoice #': "={{ $('Match Deposits To Invoices').item.json.invoiceNumber }}",
            'Payment Status': 'Payment Complete',
            'Payment Confirmed Date': "={{ $('Match Deposits To Invoices').item.json.paymentDate }}",
            'Amount Paid': "={{ $('Match Deposits To Invoices').item.json.invoiceAmount }}"
          },
          matchingColumns: ['Invoice #'],
          schema: []
        },
        options: {}
      }
    },
    {
      id: 'n16', name: 'Slack Osome Payment Confirmed',
      type: 'n8n-nodes-base.slack', typeVersion: 2.2,
      position: [2440, 580],
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
    'Claim Window': { main: [[
      { node: 'Get Invoice Tracker', type: 'main', index: 0 },
      { node: 'Search Airwallex Emails', type: 'main', index: 0 }
    ]]},
    // Tracker rows feed the Airwallex API poll and matching lookup, not Gmail.
    'Get Invoice Tracker': { main: [[
      { node: 'Poll Airwallex Invoices', type: 'main', index: 0 }
    ]]},
    'Search Airwallex Emails': { main: [[{ node: 'Parse All Emails',         type: 'main', index: 0 }]] },
    'Parse All Emails':        { main: [[{ node: 'Combine Payment Signals',  type: 'main', index: 0 }]] },
    'Poll Airwallex Invoices': { main: [[{ node: 'Combine Payment Signals',  type: 'main', index: 1 }]] },
    'Combine Payment Signals': { main: [[{ node: 'Match Deposits To Invoices', type: 'main', index: 0 }]] },
    'Match Deposits To Invoices': { main: [[{ node: 'Is Partial?', type: 'main', index: 0 }]] },
    'Is Partial?': { main: [
      [{ node: 'Update Partial Tracker', type: 'main', index: 0 }],  // true — partial
      [{ node: 'Is Osome?',             type: 'main', index: 0 }]   // false — full payment
    ]},
    'Update Partial Tracker': { main: [[{ node: 'Slack Partial Alert', type: 'main', index: 0 }]] },
    'Is Osome?': { main: [
      [{ node: 'Update Osome Invoice Status', type: 'main', index: 0 }],  // true — Osome: skip Airwallex
      [{ node: 'Airwallex Auth',              type: 'main', index: 0 }]   // false — Airwallex invoice
    ]},
    'Airwallex Auth':              { main: [[{ node: 'Airwallex Mark Paid',            type: 'main', index: 0 }]] },
    'Airwallex Mark Paid':         { main: [[{ node: 'Update Invoice Status',          type: 'main', index: 0 }]] },
    'Update Invoice Status':       { main: [[{ node: 'Slack Payment Confirmed',        type: 'main', index: 0 }]] },
    'Update Osome Invoice Status': { main: [[{ node: 'Slack Osome Payment Confirmed',  type: 'main', index: 0 }]] }
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
  console.log('NOTE: Verify Airwallex paid_amount field name on first run with a live partial invoice.');
}

if (require.main === module) {
  deploy().catch((e) => console.error('Deploy failed:', e.message));
}

module.exports = { workflow };
