const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;

// Credential IDs in n8n
const GMAIL_CRED_ID  = 'vsDW3WpKXqS9HUs3';   // Gmail account (john@kravemedia.co)
const SHEETS_CRED_ID = '83MQOm78gYDvziTO';   // Google Sheets account
const SLACK_CRED_ID  = 'Bn2U6Cwe1wdiCXzD';   // Krave Slack Bot

const SHEET_ID      = '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50';
const SLACK_CHANNEL = 'C09HN2EBPR7';

const PROCESS_CODE = `
const STRAT_EMAILS = {
  Amanda: 'amanda@kravemedia.co',
  Jeneena: 'jeneena@kravemedia.co',
  Sybil: 'sybil@kravemedia.co',
  Noa: 'noa@kravemedia.co',
  John: 'john@kravemedia.co'
};
const STRAT_SLACK = {
  Amanda: 'U07J8SRCPGU',
  Jeneena: 'U07R7FU4WBV',
  Sybil: 'U0A2HLNV8NM',
  Noa: 'U06TBGX9L93',
  John: 'U0AM5EGRVTP'
};
const AMANDA_ID = 'U07J8SRCPGU';
const NOA_ID    = 'U06TBGX9L93';

const today    = new Date();
const todayStr = today.toISOString().split('T')[0];
const msDay    = 86400000;
const rows     = $input.all();
const actions  = [];

for (const row of rows) {
  const j      = row.json;
  const status = (j['Status'] || '').toString().trim();

  // Skip completed, escalated, or not-yet-sent invoices
  if (
    status === 'Payment Complete' ||
    status === 'Collections'      ||
    status.startsWith('Draft')
  ) continue;
  if (!j['Invoice #'] || !j['Due Date']) continue;

  const dueDateStr = j['Due Date'].toString().trim();
  const dueDate    = new Date(dueDateStr);
  if (isNaN(dueDate.getTime())) continue;

  const daysDiff = Math.round((dueDate.getTime() - today.getTime()) / msDay);

  const clientName   = (j['Client Name']   || '').toString().trim();
  const clientEmail  = (j['Email Address'] || '').toString().trim();
  const invoiceNum   = (j['Invoice #']     || '').toString().trim();
  const amount       = (j['Amount']        || '').toString().trim();
  const currency     = (j['Currency']      || '').toString().trim();
  const requestedBy  = (j['Requested By']  || '').toString().trim();
  const remindersLog = (j['Reminders Sent']|| '').toString().trim();

  let reminderType = null;
  if      (daysDiff === 7)                   reminderType = '7d';
  else if (daysDiff === 5)                   reminderType = '5d';
  else if (daysDiff === 3)                   reminderType = '3d';
  else if (daysDiff === 1)                   reminderType = '1d';
  else if (daysDiff === 0)                   reminderType = 'due-today';
  else if (daysDiff < 0 && daysDiff >= -6)   reminderType = 'overdue';
  else if (daysDiff === -7)                  reminderType = 'late-fee';
  else if (daysDiff < -7 && daysDiff > -60)  reminderType = 'late-fee-followup';
  else if (daysDiff <= -60)                  reminderType = 'collections';
  else continue;

  // Deduplication — skip if same type sent within 2 days (7 days for late-fee-followup)
  let alreadySent = false;
  for (const e of remindersLog.split('|').map(s => s.trim()).filter(Boolean)) {
    const parts = e.split(' ');
    if (parts.length < 2) continue;
    const eDate = new Date(parts[1]);
    if (isNaN(eDate.getTime())) continue;
    const daysSince = Math.round((today.getTime() - eDate.getTime()) / msDay);
    const eType = parts[0];
    if (eType === reminderType && daysSince <= 2) { alreadySent = true; break; }
    if (reminderType === 'late-fee-followup' && (eType === 'late-fee' || eType === 'late-fee-followup') && daysSince <= 7) { alreadySent = true; break; }
  }
  if (alreadySent) continue;

  const stratEmail   = STRAT_EMAILS[requestedBy] || null;
  const stratSlackId = STRAT_SLACK[requestedBy]  || null;
  const unknownStrat = !!(requestedBy && !stratEmail);
  const ccArr = [];
  if (stratEmail && stratEmail !== 'john@kravemedia.co') ccArr.push(stratEmail);
  if (!ccArr.includes('noa@kravemedia.co')) ccArr.push('noa@kravemedia.co');
  const ccEmails = ccArr.join(', ');

  const daysOverdue = daysDiff < 0 ? Math.abs(daysDiff) : 0;

  let subject = '', body = '';
  const sig = '\\n\\nBest regards,\\nJohn\\nKrave Media';
  if (['7d','5d','3d','1d'].includes(reminderType)) {
    subject = 'Payment Reminder — ' + invoiceNum + ' — ' + clientName;
    body    = 'Hi ' + clientName + ',\\n\\nJust a reminder that invoice ' + invoiceNum + ' for ' + amount + ' ' + currency + ' is due on ' + dueDateStr + '.\\n\\nPlease arrange payment at your earliest convenience.' + sig;
  } else if (reminderType === 'due-today') {
    subject = 'Invoice Due Today — ' + invoiceNum + ' — ' + clientName;
    body    = 'Hi ' + clientName + ',\\n\\nInvoice ' + invoiceNum + ' for ' + amount + ' ' + currency + ' is due today.\\n\\nPlease arrange payment today to avoid a late fee being applied.' + sig;
  } else if (reminderType === 'overdue') {
    subject = 'Overdue Invoice — ' + invoiceNum + ' — ' + clientName;
    body    = 'Hi ' + clientName + ',\\n\\nInvoice ' + invoiceNum + ' for ' + amount + ' ' + currency + ' was due on ' + dueDateStr + ' and remains unpaid.\\n\\nPlease arrange payment immediately. A USD $200 late fee will be applied after 7 days overdue per our payment terms.' + sig;
  } else if (reminderType === 'late-fee' || reminderType === 'late-fee-followup') {
    subject = 'Late Fee Applied — ' + invoiceNum + ' — ' + clientName;
    body    = 'Hi ' + clientName + ',\\n\\nAs payment for invoice ' + invoiceNum + ' has not been received, a late fee of USD $200 has been applied per our payment terms.\\n\\nUpdated invoice total: ' + amount + ' ' + currency + ' + USD $200.\\n\\nPlease arrange payment at your earliest convenience to avoid additional fees.' + sig;
  } else if (reminderType === 'collections') {
    subject = 'Final Notice — ' + invoiceNum + ' — ' + clientName;
    body    = 'Hi ' + clientName + ',\\n\\nInvoice ' + invoiceNum + ' for ' + amount + ' ' + currency + ' has been outstanding for more than 60 days. This matter has been escalated for collections.\\n\\nPlease arrange immediate payment to avoid further action.' + sig;
  }

  let newStatus = status;
  if (reminderType === 'late-fee')    newStatus = 'Late Fee Applied — ' + todayStr;
  if (reminderType === 'collections') newStatus = 'Collections';

  const newReminders = remindersLog
    ? remindersLog + ' | ' + reminderType + ' ' + todayStr
    : reminderType + ' ' + todayStr;

  const needsSlack = ['due-today','overdue','late-fee','late-fee-followup','collections'].includes(reminderType);
  let slackMessage = '';
  if (needsSlack || !clientEmail) {
    const stratMention  = stratSlackId ? '<@' + stratSlackId + '>' : (requestedBy || 'Unknown');
    const amandaMention = '<@' + AMANDA_ID + '>';
    if (!clientEmail) {
      slackMessage = '⚠️ No client email on file for ' + clientName + ' (' + invoiceNum + ') — reminder not sent. Add to Col C in tracker.';
    } else if (reminderType === 'collections') {
      slackMessage = '⛔ *Collections Flagged — ' + clientName + '*\\n• Invoice: ' + invoiceNum + '\\n• Amount: ' + amount + ' ' + currency + '\\n• Due: ' + dueDateStr + ' (' + daysOverdue + ' days overdue)\\n• ' + stratMention + ' ' + amandaMention + ' <@' + NOA_ID + '>';
    } else if (reminderType === 'late-fee' || reminderType === 'late-fee-followup') {
      slackMessage = '⚠️ *Late Fee Needed — ' + clientName + '*\\n• Invoice: ' + invoiceNum + '\\n• Amount: ' + amount + ' ' + currency + '\\n• ' + daysOverdue + ' days overdue\\n• Add \\"Late Payment Fee — USD $200\\" line item in Airwallex → Invoices\\n• ' + stratMention + ' ' + amandaMention;
    } else {
      slackMessage = '🔔 *Overdue Invoice — ' + clientName + '*\\n• Invoice: ' + invoiceNum + '\\n• Amount: ' + amount + ' ' + currency + '\\n• Due: ' + dueDateStr + ' (' + daysOverdue + ' days overdue)\\n• ' + stratMention + ' ' + amandaMention;
    }
    if (unknownStrat) slackMessage += '\\n• ⚠️ Unknown strategist "' + requestedBy + '" on record — CC not sent';
  }

  const isOverdue = ['overdue','late-fee','late-fee-followup','collections'].includes(reminderType);
  const gmailQuery = '"' + invoiceNum + '"';
  actions.push({
    skipEmail: !clientEmail,
    clientEmail, ccEmails, invoiceNum, clientName,
    amount, currency, dueDateStr, daysDiff, reminderType,
    subject, body, newStatus, newReminders,
    needsSlack: needsSlack || !clientEmail,
    slackMessage, isOverdue, gmailQuery
  });
}

return actions.map(a => ({ json: a }));
`.trim();

// Merges invoice item (always present) with optional Gmail search result (0 or 1 items).
// Determines whether an existing email thread was found for this invoice.
const RESOLVE_THREAD_CODE = `
const allItems = $input.all();
const invoiceItem = allItems.find(i => i.json.invoiceNum);
const gmailItem = allItems.find(i => i.json.id && i.json.threadId);
const base = invoiceItem ? invoiceItem.json : {};
const threadFound = !!(gmailItem && gmailItem.json.id);
const replyMessageId = threadFound ? gmailItem.json.id : null;
return [{ json: { ...base, threadFound, replyMessageId } }];
`.trim();

const workflow = {
  name: 'Krave — Invoice Reminder Cron',
  settings: { executionOrder: 'v1', saveManualExecutions: true },
  nodes: [
    {
      id: 'n1', name: 'Schedule 10am ICT',
      type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
      position: [240, 260],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 2 * * *' }] } }
    },
    {
      id: 'n2', name: 'Webhook Trigger',
      type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [240, 460],
      webhookId: 'krave-invoice-reminder',
      parameters: { httpMethod: 'POST', path: 'krave-invoice-reminder', responseMode: 'onReceived', options: {} }
    },
    {
      id: 'n3', name: 'Get Invoice Tracker',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [460, 360],
      credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet', operation: 'read',
        documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        filtersUI: {}, options: {}
      }
    },
    {
      id: 'n4', name: 'Process Invoices',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [680, 360],
      parameters: { mode: 'runOnceForAllItems', jsCode: PROCESS_CODE }
    },
    {
      id: 'n5', name: 'Has Client Email?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [900, 360],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [{
            id: 'c1',
            leftValue: '={{ $json.clientEmail }}',
            rightValue: '',
            operator: { type: 'string', operation: 'notEquals' }
          }],
          combinator: 'and'
        },
        options: {}
      }
    },
    {
      // Pre-due (7d/5d/3d/1d/due-today) → send new email directly.
      // Overdue/late-fee/collections → search john@ for existing thread first.
      id: 'n11', name: 'Is Overdue Type?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [1120, 220],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [{
            id: 'c1',
            leftValue: '={{ $json.isOverdue }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'equals' }
          }],
          combinator: 'and'
        },
        options: {}
      }
    },
    {
      id: 'n6', name: 'Send Reminder Email',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [1340, 60],
      continueOnFail: true,
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'send',
        sendTo: '={{ $json.clientEmail }}',
        subject: '={{ $json.subject }}',
        emailType: 'text',
        message: '={{ $json.body }}',
        options: { ccList: '={{ $json.ccEmails }}' }
      }
    },
    {
      // Search john@kravemedia.co for an existing thread mentioning the invoice number.
      // Strategists often email clients and CC john — if found, reply to keep context.
      id: 'n12', name: 'Search Gmail Thread',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [1340, 360],
      continueOnFail: true,
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'getAll',
        returnAll: false,
        limit: 1,
        filters: { q: '={{ $json.gmailQuery }}' },
        options: { format: 'minimal' }
      }
    },
    {
      // Append mode: collects items from both inputs (invoice data + Gmail result).
      // Outputs even when Gmail returns 0 results — invoice item always present.
      id: 'n13', name: 'Merge Overdue Data',
      type: 'n8n-nodes-base.merge', typeVersion: 2,
      position: [1560, 300],
      parameters: { mode: 'append' }
    },
    {
      id: 'n14', name: 'Resolve Thread Result',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1780, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: RESOLVE_THREAD_CODE }
    },
    {
      id: 'n15', name: 'Thread Found?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [2000, 300],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [{
            id: 'c1',
            leftValue: '={{ $json.threadFound }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'equals' }
          }],
          combinator: 'and'
        },
        options: {}
      }
    },
    {
      id: 'n16', name: 'Reply to Thread',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [2220, 180],
      continueOnFail: true,
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'reply',
        messageId: '={{ $json.replyMessageId }}',
        emailType: 'text',
        message: '={{ $json.body }}',
        options: {}
      }
    },
    {
      id: 'n17', name: 'Send New Overdue Email',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [2220, 420],
      continueOnFail: true,
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'send',
        sendTo: '={{ $json.clientEmail }}',
        subject: '={{ $json.subject }}',
        emailType: 'text',
        message: '={{ $json.body }}',
        options: { ccList: '={{ $json.ccEmails }}' }
      }
    },
    {
      id: 'n7', name: 'Update Tracker Row',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [2440, 300],
      credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet', operation: 'appendOrUpdate',
        documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            'Invoice #':      "={{ $json.invoiceNum || $('Process Invoices').item.json.invoiceNum }}",
            'Status':         "={{ $json.newStatus || $('Process Invoices').item.json.newStatus }}",
            'Reminders Sent': "={{ $json.newReminders || $('Process Invoices').item.json.newReminders }}"
          },
          matchingColumns: ['Invoice #'],
          schema: []
        },
        options: {}
      }
    },
    {
      id: 'n8', name: 'Needs Slack Alert?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [2660, 300],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [{
            id: 'c1',
            leftValue: "={{ $json.needsSlack ?? $('Process Invoices').item.json.needsSlack }}",
            rightValue: true,
            operator: { type: 'boolean', operation: 'equals' }
          }],
          combinator: 'and'
        },
        options: {}
      }
    },
    {
      id: 'n9', name: 'Slack Overdue Alert',
      type: 'n8n-nodes-base.slack', typeVersion: 2.2,
      position: [2880, 180],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message', operation: 'post',
        select: 'channel',
        channelId: { __rl: true, value: SLACK_CHANNEL, mode: 'id' },
        text: "={{ $json.slackMessage || $('Process Invoices').item.json.slackMessage }}",
        otherOptions: {}
      }
    },
    {
      id: 'n10', name: 'Slack Missing Email Warning',
      type: 'n8n-nodes-base.slack', typeVersion: 2.2,
      position: [1120, 520],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message', operation: 'post',
        select: 'channel',
        channelId: { __rl: true, value: SLACK_CHANNEL, mode: 'id' },
        text: '={{ $json.slackMessage }}',
        otherOptions: {}
      }
    }
  ],
  connections: {
    'Schedule 10am ICT':   { main: [[{ node: 'Get Invoice Tracker', type: 'main', index: 0 }]] },
    'Webhook Trigger':     { main: [[{ node: 'Get Invoice Tracker', type: 'main', index: 0 }]] },
    'Get Invoice Tracker': { main: [[{ node: 'Process Invoices',    type: 'main', index: 0 }]] },
    'Process Invoices':    { main: [[{ node: 'Has Client Email?',   type: 'main', index: 0 }]] },
    'Has Client Email?': { main: [
      [{ node: 'Is Overdue Type?',            type: 'main', index: 0 }],  // TRUE — has email
      [{ node: 'Slack Missing Email Warning', type: 'main', index: 0 }]   // FALSE — no email
    ]},
    'Is Overdue Type?': { main: [
      // TRUE — overdue/late-fee/collections: fan out to both Merge (invoice data) and Gmail search
      [
        { node: 'Merge Overdue Data',  type: 'main', index: 0 },
        { node: 'Search Gmail Thread', type: 'main', index: 0 }
      ],
      // FALSE — pre-due (7d/5d/3d/1d/due-today): send new email directly
      [{ node: 'Send Reminder Email', type: 'main', index: 0 }]
    ]},
    'Search Gmail Thread': { main: [[{ node: 'Merge Overdue Data', type: 'main', index: 1 }]] },
    'Merge Overdue Data':  { main: [[{ node: 'Resolve Thread Result', type: 'main', index: 0 }]] },
    'Resolve Thread Result': { main: [[{ node: 'Thread Found?', type: 'main', index: 0 }]] },
    'Thread Found?': { main: [
      [{ node: 'Reply to Thread',        type: 'main', index: 0 }],  // TRUE — thread exists
      [{ node: 'Send New Overdue Email', type: 'main', index: 0 }]   // FALSE — compose new
    ]},
    'Reply to Thread':        { main: [[{ node: 'Update Tracker Row', type: 'main', index: 0 }]] },
    'Send New Overdue Email': { main: [[{ node: 'Update Tracker Row', type: 'main', index: 0 }]] },
    'Send Reminder Email':    { main: [[{ node: 'Update Tracker Row', type: 'main', index: 0 }]] },
    'Update Tracker Row':  { main: [[{ node: 'Needs Slack Alert?',  type: 'main', index: 0 }]] },
    'Needs Slack Alert?': { main: [
      [{ node: 'Slack Overdue Alert', type: 'main', index: 0 }],  // TRUE
      []                                                            // FALSE — silent
    ]}
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
  console.log('POST https://noatakhel.app.n8n.cloud/webhook/krave-invoice-reminder');
}

deploy().catch((e) => console.error('Deploy failed:', e.message));
