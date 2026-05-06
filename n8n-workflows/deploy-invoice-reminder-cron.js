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
  const j             = row.json;
  const status        = (j['Status']         || '').toString().trim(); // col N — formula display
  const paymentStatus = (j['Payment Status'] || '').toString().trim(); // col J — operational

  // Skip if paid or escalated/draft
  if (
    status === 'Paid'                    ||
    status === 'Payment Complete'        ||
    paymentStatus === 'Payment Complete' ||
    paymentStatus === 'Collections'      ||
    paymentStatus.startsWith('Draft')
  ) continue;
  if (!j['Invoice #'] || !j['Due Date']) continue;

  const dueDateStr = j['Due Date'].toString().trim();
  const dueDate    = new Date(dueDateStr);
  if (isNaN(dueDate.getTime())) continue;

  const daysDiff = Math.round((dueDate.getTime() - today.getTime()) / msDay);

  // Infer payout term from gap between invoice creation date and due date
  const creationDateRaw = j['Date Created'] ? j['Date Created'].toString().trim() : '';
  const creationDate = creationDateRaw ? new Date(creationDateRaw) : null;
  const gap = (creationDate && !isNaN(creationDate.getTime()))
    ? Math.round((dueDate.getTime() - creationDate.getTime()) / msDay)
    : 31; // fallback: treat as 30d terms if creation date is missing
  const payoutTerm = gap <= 10 ? '7d' : gap <= 20 ? '15d' : '30d';
  // Reminder cadence (May 2026 — tightened to reduce volume):
  //   7-day terms:  3d before due, due day
  //   15-day terms: 7d before due, 3d before due, due day
  //   30-day terms: 7d before due, 3d before due, due day
  const allowedPreDueTiers = {
    '7d':  new Set(['3d', 'due-today']),
    '15d': new Set(['7d', '3d', 'due-today']),
    '30d': new Set(['7d', '3d', 'due-today']),
  };

  const clientName   = (j['Client Name']   || '').toString().trim();
  const rawEmail     = (j['Email Address'] || '').toString().trim();
  const emailList    = rawEmail.split(/[,;\\s]+/).map(e => e.trim()).filter(e => /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(e));
  const clientEmail  = emailList.join(', ');
  const invoiceNum   = (j['Invoice #']     || '').toString().trim();
  const amount       = (j['Amount']        || '').toString().trim();
  const currency     = (j['Currency']      || '').toString().trim();
  const requestedBy  = (j['Requested By']  || '').toString().trim();
  const remindersLog = (j['Reminders Sent']|| '').toString().trim();
  const invoiceUrl   = (j['Invoice URL']   || '').toString().trim();

  const isPartialPayment = paymentStatus === 'Partial Payment';
  const amountPaidRaw    = isPartialPayment ? parseFloat((j['Amount Paid'] || '0').toString().replace(/,/g,'')) : 0;
  const invoiceAmountRaw = parseFloat((amount || '0').replace(/,/g,''));
  const remainingStr     = isPartialPayment ? Math.max(0, invoiceAmountRaw - amountPaidRaw).toFixed(2) : amount;
  const partialNote      = isPartialPayment
    ? '\\n\\nNote: We\\'ve received your partial payment of ' + amountPaidRaw.toFixed(2) + ' ' + currency + '. The remaining balance of ' + remainingStr + ' ' + currency + ' is outstanding.'
    : '';

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

  // Guard: skip pre-due tiers not allowed for this payout term
  const preDueTiers = new Set(['7d', '5d', '3d', '1d', 'due-today']);
  if (preDueTiers.has(reminderType) && !allowedPreDueTiers[payoutTerm].has(reminderType)) continue;

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
  const displayAmt  = isPartialPayment ? remainingStr : amount;
  const payLink     = invoiceUrl ? '\\n\\nYou can view and pay your invoice here: ' + invoiceUrl : '';
  const sig         = '\\n\\nWarm regards,\\nJohn\\nKrave Media';

  let subject = '', body = '';

  if (['7d','5d','3d','1d'].includes(reminderType)) {
    subject = 'Friendly Reminder — Invoice ' + invoiceNum + ' Due ' + dueDateStr;
    body    = 'Hi ' + clientName + ',' +
      '\\n\\nJust a quick heads-up that invoice ' + invoiceNum + ' for ' + displayAmt + ' ' + currency + ' is due on ' + dueDateStr + '.' +
      partialNote + payLink +
      '\\n\\nThank you so much for your continued partnership — we really appreciate it!' + sig;
  } else if (reminderType === 'due-today') {
    subject = 'Invoice ' + invoiceNum + ' Due Today — ' + clientName;
    body    = 'Hi ' + clientName + ',' +
      '\\n\\nA friendly reminder that invoice ' + invoiceNum + ' for ' + displayAmt + ' ' + currency + ' is due today.' +
      partialNote + payLink +
      '\\n\\nThank you so much for your prompt attention — we truly appreciate it!' + sig;
  } else if (reminderType === 'overdue') {
    subject = 'Following Up — Invoice ' + invoiceNum + ' — ' + clientName;
    body    = 'Hi ' + clientName + ',' +
      '\\n\\nI\\'m following up on invoice ' + invoiceNum + ' for ' + displayAmt + ' ' + currency + ', which was due on ' + dueDateStr + ' and hasn\\'t come through yet.' +
      partialNote + payLink +
      '\\n\\nPlease don\\'t hesitate to reach out if you have any questions or if there\\'s anything we can help with on our end. As a reminder, our payment terms are outlined in our agreement.' +
      '\\n\\nThank you for your attention to this — we appreciate it!' + sig;
  } else if (reminderType === 'late-fee' || reminderType === 'late-fee-followup') {
    subject = 'Following Up — Invoice ' + invoiceNum + ' — ' + clientName;
    body    = 'Hi ' + clientName + ',' +
      '\\n\\nI wanted to follow up again on invoice ' + invoiceNum + ' for ' + displayAmt + ' ' + currency + ', which has been outstanding since ' + dueDateStr + '.' +
      partialNote + payLink +
      '\\n\\nWe\\'d love to resolve this as soon as possible. As a reminder, our agreement includes provisions for overdue accounts, and we appreciate your understanding as we work through this together.' +
      '\\n\\nThank you for your attention to this!' + sig;
  } else if (reminderType === 'collections') {
    subject = 'Urgent Follow-Up — Invoice ' + invoiceNum + ' — ' + clientName;
    body    = 'Hi ' + clientName + ',' +
      '\\n\\nI\\'m reaching out regarding invoice ' + invoiceNum + ' for ' + displayAmt + ' ' + currency + ', which has now been outstanding for more than 60 days.' +
      partialNote + payLink +
      '\\n\\nWe truly value our relationship with you and would appreciate your prompt attention to settling this balance in accordance with our payment terms.' +
      '\\n\\nThank you for your immediate attention to this matter.' + sig;
  }

  let newStatus = paymentStatus;
  if (reminderType === 'late-fee')    newStatus = 'Late Fee Applied — ' + todayStr;
  if (reminderType === 'collections') newStatus = 'Collections';

  const newReminders = remindersLog
    ? remindersLog + ' | ' + reminderType + ' ' + todayStr
    : reminderType + ' ' + todayStr;
  const lastFollowUpSent = todayStr;
  const lastFollowUpType = reminderType;
  const lastFollowUpThreadId = '';

  const needsSlack = ['due-today','overdue','late-fee','late-fee-followup','collections'].includes(reminderType);
  let slackMessage = '';
  if (needsSlack || emailList.length === 0) {
    const stratMention  = stratSlackId ? '<@' + stratSlackId + '>' : (requestedBy || 'Unknown');
    const amandaMention = '<@' + AMANDA_ID + '>';
    if (emailList.length === 0) {
      slackMessage = '⚠️ No client email on file for ' + clientName + ' (' + invoiceNum + ') — reminder not sent. Add to Col C in tracker.';
    } else if (reminderType === 'collections') {
      slackMessage = '⛔ *Collections Flagged — ' + clientName + '*\\n• Invoice: ' + invoiceNum + '\\n• Amount: ' + amount + ' ' + currency + '\\n• Due: ' + dueDateStr + ' (' + daysOverdue + ' days overdue)\\n• ' + stratMention + ' ' + amandaMention + ' <@' + NOA_ID + '>';
    } else if (reminderType === 'late-fee' || reminderType === 'late-fee-followup') {
      slackMessage = '⚠️ *Overdue Follow-Up — ' + clientName + '*\\n• Invoice: ' + invoiceNum + '\\n• Amount: ' + amount + ' ' + currency + (isPartialPayment ? '\\n• Partial paid: ' + amountPaidRaw.toFixed(2) + ' — Remaining: ' + remainingStr + ' ' + currency : '') + '\\n• ' + daysOverdue + ' days overdue\\n• ' + stratMention + ' ' + amandaMention;
    } else {
      slackMessage = '🔔 *Overdue Invoice — ' + clientName + '*\\n• Invoice: ' + invoiceNum + '\\n• Amount: ' + amount + ' ' + currency + (isPartialPayment ? '\\n• Partial paid: ' + amountPaidRaw.toFixed(2) + ' — Remaining: ' + remainingStr + ' ' + currency : '') + '\\n• Due: ' + dueDateStr + ' (' + daysOverdue + ' days overdue)\\n• ' + stratMention + ' ' + amandaMention;
    }
    if (unknownStrat) slackMessage += '\\n• ⚠️ Unknown strategist "' + requestedBy + '" on record — CC not sent';
  }

  actions.push({
    isDigest: false,
    skipEmail: emailList.length === 0,
    clientEmail, ccEmails, invoiceNum, clientName,
    amount, currency, dueDateStr, daysDiff, reminderType,
    subject, body, newStatus, newReminders,
    lastFollowUpSent, lastFollowUpType, lastFollowUpThreadId,
    needsSlack: needsSlack || emailList.length === 0,
    slackMessage
  });
}

// Build daily digest
const byType = {};
for (const a of actions) {
  if (!byType[a.reminderType]) byType[a.reminderType] = [];
  byType[a.reminderType].push(a);
}
const preDue     = ['7d','5d','3d','1d'].flatMap(t => byType[t] || []);
const dueToday   = byType['due-today']        || [];
const overdueAct = byType['overdue']          || [];
const lateFeeAct = byType['late-fee']         || [];
const lfFollowup = byType['late-fee-followup']|| [];
const collectAct = byType['collections']      || [];
const allReminders = [...preDue, ...dueToday];
const allOverdue   = [...overdueAct, ...lfFollowup];

const digestLines = ['*📋 Invoice Reminder Digest — ' + todayStr + '*'];
if (allReminders.length) {
  digestLines.push('\\n*Reminders sent:* ' + allReminders.length);
  for (const a of allReminders) {
    const label = a.reminderType === 'due-today' ? 'due today' : a.reminderType + ' reminder';
    digestLines.push('• ' + a.clientName + ' — ' + a.invoiceNum + ' — ' + label + ' — Due ' + a.dueDateStr);
  }
}
if (allOverdue.length) {
  digestLines.push('\\n*Overdue (action needed):* ' + allOverdue.length);
  for (const a of allOverdue) {
    const daysOver = Math.abs(a.daysDiff);
    digestLines.push('• ' + a.clientName + ' — ' + a.invoiceNum + ' — ' + daysOver + ' day' + (daysOver !== 1 ? 's' : '') + ' overdue');
  }
}
if (lateFeeAct.length) {
  digestLines.push('\\n*Late fees triggered:* ' + lateFeeAct.length);
  for (const a of lateFeeAct) {
    digestLines.push('• ' + a.clientName + ' — ' + a.invoiceNum + ' — $200 USD late fee flagged');
  }
}
if (collectAct.length) {
  digestLines.push('\\n*Collections (escalated):* ' + collectAct.length);
  for (const a of collectAct) {
    const daysOver = Math.abs(a.daysDiff);
    digestLines.push('• ' + a.clientName + ' — ' + a.invoiceNum + ' — ' + daysOver + ' days overdue');
  }
}
const digestTotal = allReminders.length + allOverdue.length + lateFeeAct.length + collectAct.length;
const digestText  = digestTotal === 0
  ? '✅ Invoice check complete — no outstanding items.'
  : digestLines.join('\\n');

const output = actions.map(a => ({ json: a }));
output.push({ json: { isDigest: true, digestText } });
return output;
`.trim();

const workflow = {
  name: 'Krave — Invoice Reminder Cron',
  settings: { executionOrder: 'v1', saveManualExecutions: true },
  nodes: [
    {
      id: 'n1', name: 'Schedule 10am PHT',
      type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
      position: [240, 300],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 10 * * 1-5' }] } }
    },
    {
      id: 'n2', name: 'Webhook Trigger',
      type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [240, 480],
      webhookId: 'krave-invoice-reminder',
      parameters: { httpMethod: 'POST', path: 'krave-invoice-reminder', responseMode: 'onReceived', options: {} }
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
      id: 'n4', name: 'Process Invoices',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [680, 390],
      parameters: { mode: 'runOnceForAllItems', jsCode: PROCESS_CODE }
    },
    {
      id: 'n5', name: 'Has Client Email?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [900, 390],
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
      id: 'n6', name: 'Send Email',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [1120, 280],
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
      position: [1340, 280],
      credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet', operation: 'appendOrUpdate',
        documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            'Invoice #':      "={{ $json.invoiceNum || $('Process Invoices').item.json.invoiceNum }}",
            'Payment Status': "={{ $json.newStatus || $('Process Invoices').item.json.newStatus }}",
            'Reminders Sent': "={{ $json.newReminders || $('Process Invoices').item.json.newReminders }}",
            'Last Follow-Up Sent': "={{ $json.lastFollowUpSent || $('Process Invoices').item.json.lastFollowUpSent }}",
            'Last Follow-Up Type': "={{ $json.lastFollowUpType || $('Process Invoices').item.json.lastFollowUpType }}",
            'Last Follow-Up Thread ID': "={{ $json.threadId || '' }}"
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
      position: [1560, 280],
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
      position: [1780, 160],
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
      position: [1340, 580],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message', operation: 'post',
        select: 'channel',
        channelId: { __rl: true, value: SLACK_CHANNEL, mode: 'id' },
        text: '={{ $json.slackMessage }}',
        otherOptions: {}
      }
    },
    {
      id: 'n11', name: 'Is Digest Item?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [900, 390],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [{
            id: 'c1',
            leftValue: '={{ $json.isDigest }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'equals' }
          }],
          combinator: 'and'
        },
        options: {}
      }
    },
    {
      id: 'n12', name: 'Post Digest',
      type: 'n8n-nodes-base.slack', typeVersion: 2.2,
      position: [1120, 220],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message', operation: 'post',
        select: 'channel',
        channelId: { __rl: true, value: SLACK_CHANNEL, mode: 'id' },
        text: '={{ $json.digestText }}',
        otherOptions: {}
      }
    }
  ],
  connections: {
    'Schedule 10am PHT':        { main: [[{ node: 'Get Invoice Tracker', type: 'main', index: 0 }]] },
    'Webhook Trigger':          { main: [[{ node: 'Get Invoice Tracker', type: 'main', index: 0 }]] },
    'Get Invoice Tracker':      { main: [[{ node: 'Process Invoices',    type: 'main', index: 0 }]] },
    'Process Invoices':         { main: [[{ node: 'Is Digest Item?',     type: 'main', index: 0 }]] },
    'Is Digest Item?': { main: [
      [{ node: 'Post Digest',   type: 'main', index: 0 }],  // TRUE — digest item
      [{ node: 'Has Client Email?', type: 'main', index: 0 }]  // FALSE — action item
    ]},
    'Has Client Email?': { main: [
      [{ node: 'Send Email',                type: 'main', index: 0 }],  // TRUE — has email
      [{ node: 'Slack Missing Email Warning', type: 'main', index: 0 }]  // FALSE — no email
    ]},
    'Send Email':               { main: [[{ node: 'Update Tracker Row',  type: 'main', index: 0 }]] },
    'Update Tracker Row':       { main: [[{ node: 'Needs Slack Alert?',  type: 'main', index: 0 }]] },
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

if (require.main === module) {
  deploy().catch((e) => console.error('Deploy failed:', e.message));
}

module.exports = { workflow };
