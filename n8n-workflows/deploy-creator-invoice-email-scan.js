'use strict';

/**
 * Krave — Creator Invoice Email Scan
 *
 * Scans john@kravemedia.co every 3 hours (Mon–Fri) for unread emails with PDF
 * attachments. Parses each PDF with Claude, validates bank details, creates
 * draft bills in Airwallex Spend, replies to the sender, and logs to the Bills
 * tab of the Client Invoice Tracker.
 *
 * Deploy:
 *   node deploy-creator-invoice-email-scan.js
 *
 * Credentials required (set in n8n):
 *   Gmail account     → vsDW3WpKXqS9HUs3  (john@kravemedia.co)
 *   Google Sheets     → 83MQOm78gYDvziTO
 *   Krave Slack Bot   → Bn2U6Cwe1wdiCXzD
 *
 * Environment variables required:
 *   N8N_API_KEY
 *   ANTHROPIC_API_KEY
 */

const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set in env');

const GMAIL_CRED_ID  = 'vsDW3WpKXqS9HUs3';   // Gmail (john@kravemedia.co)
const SHEETS_CRED_ID = '83MQOm78gYDvziTO';   // Google Sheets
const SLACK_CRED_ID  = 'Bn2U6Cwe1wdiCXzD';   // Krave Slack Bot

const BILLS_SHEET_ID  = '14kiX9MnWyel_4_OxvL2TlnOAqBqFwwECf7Dm24znuJc';
const BILLS_SHEET_TAB = 'Krave — Creator & AP Bills Tracker';
const OPS_CHANNEL     = 'C0AQZGJDR38';         // John's private channel (#ops-command)
const AW_CLIENT_ID    = 'JaQA4uJ1SDSBkTdFigT9sw';
const AW_API_KEY      = '5611f8e189ef357e5b3493916208efb80413595b50e7201b8fc98af5c91666f50b10ee64fd87fa3db7435e8dc5c07721';

// ─── Code node contents ───────────────────────────────────────────────────────

const EXTRACT_PDF_ATTACHMENTS = `
// Runs once across all input items.
// Accepts PDF and image (PNG/JPG) invoice attachments.

// ── Sender blocklist (HARD GUARD) ──────────────────────────────────────────
// Creator invoices come from real people — strategists/team forwarding on behalf
// of creators, or creators directly — never from the payment platform itself.
// Do NOT block kravemedia.co: strategists manage the creators and send/forward
// invoices, sometimes from that domain. Any email from a blocked sender is
// dropped here: NOT downloaded, parsed, replied to, forwarded, logged, or marked
// read — it stays untouched in the inbox. Backstop for the -from: query
// exclusion. NEVER reply to Airwallex.
function isBlockedSender(email) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) return true; // no parseable sender → don't auto-reply into the void
  const patterns = [
    /(^|@)([a-z0-9-]+\\.)*airwallex\\.com$/,  // airwallex.com + any subdomain (bills., notifications., etc.)
    /no-?reply@/,                              // automated no-reply senders
    /notifications?@/,                         // automated notification senders
    /^(mailer-daemon|postmaster)@/,            // bounce / delivery-failure notices
  ];
  return patterns.some(re => re.test(e));
}

function findAttachments(parts, found) {
  if (!parts) return found;
  for (const p of parts) {
    if (p.body && p.body.attachmentId) {
      const name = (p.filename || p.name || '').toLowerCase();
      const mime = (p.mimeType || '').toLowerCase();
      const isInvoiceFile = name.endsWith('.pdf') || name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg')
        || mime === 'application/pdf' || mime.startsWith('image/');
      if (isInvoiceFile && (p.filename || p.name)) {
        found.push({ attachmentId: p.body.attachmentId, attachmentName: p.filename || p.name, mimeType: p.mimeType || 'application/octet-stream' });
      }
    }
    if (p.parts) findAttachments(p.parts, found);
  }
  return found;
}

function getHeader(msg, name) {
  const payload = msg.payload || {};
  const arr = Array.isArray(payload.headers) ? payload.headers : [];
  const fromArr = arr.find(h => String(h.name || '').toLowerCase() === name.toLowerCase());
  if (fromArr) return fromArr.value;
  const flat = msg.headers && typeof msg.headers === 'object' ? msg.headers : {};
  const raw = flat[name.toLowerCase()] || flat[name] || '';
  if (!raw) return '';
  const colon = raw.indexOf(':');
  if (colon > 0 && colon < 20) return raw.slice(colon + 1).trim();
  return raw;
}

const output = [];
for (const item of $input.all()) {
  const msg = item.json;
  const payload = msg.payload || {};
  const attachments = findAttachments(payload.parts || [], []);
  if (!attachments.length) continue;

  const rawFrom = getHeader(msg, 'from');
  const mf = rawFrom.match(/^([^<]*?)<([^>]+)>/);
  const fromName  = mf ? mf[1].trim().replace(/^["']|["']$/g, '') : rawFrom.trim();
  const fromEmail = (mf ? mf[2] : rawFrom).trim().toLowerCase();
  const subject   = getHeader(msg, 'subject') || '(no subject)';

  // HARD GUARD: never process or reply to Airwallex / automated senders.
  // Skip the whole message — leaves it untouched (unread) in the inbox.
  if (isBlockedSender(fromEmail)) continue;

  for (const att of attachments) {
    output.push({ json: {
      messageId:      String(msg.id || ''),
      threadId:       String(msg.threadId || ''),
      subject:        String(subject),
      fromName:       String(fromName),
      fromEmail:      String(fromEmail),
      attachmentId:   String(att.attachmentId),
      attachmentName: String(att.attachmentName),
      mimeType:       String(att.mimeType),
    }});
  }
}
return output;
`.trim();

const MERGE_ATTACHMENT_DATA = `
const contexts = $('Extract PDF Attachments').all();
const output = [];
$input.all().forEach((item, i) => {
  const ctx = (contexts[i] || { json: {} }).json;
  const raw64 = (item.json.data || '').replace(/-/g, '+').replace(/_/g, '/');
  output.push({ json: { ...ctx, pdfBase64: raw64 } });
});
return output;
`.trim();

const PREPARE_CLAUDE_REQUEST = `
const output = [];
for (const item of $input.all()) {
  const ctx = item.json;
  const mime = (ctx.mimeType || '').toLowerCase();
  const isPdf = mime === 'application/pdf' || ctx.attachmentName.toLowerCase().endsWith('.pdf');
  const isImage = mime.startsWith('image/') || /\\.(png|jpg|jpeg|gif|webp)$/i.test(ctx.attachmentName);

  let contentBlock;
  if (isPdf) {
    contentBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: ctx.pdfBase64 } };
  } else if (isImage) {
    const imgMime = mime.startsWith('image/') ? mime : 'image/png';
    contentBlock = { type: 'image', source: { type: 'base64', media_type: imgMime, data: ctx.pdfBase64 } };
  } else {
    contentBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: ctx.pdfBase64 } };
  }

  const system = 'You are an invoice parser. Extract invoice data from the attached file and return ONLY valid JSON with these exact fields: { "creator_name": "string", "email": "string or null", "invoice_number": "string or null", "issued_date": "YYYY-MM-DD or null", "due_date": "YYYY-MM-DD or null", "amount": number, "currency": "ISO currency code e.g. USD SGD AUD", "line_items": [{"description":"string","quantity":number,"unit_price":number}], "bank_details": { "bank_name": "string or null", "account_name": "string or null", "account_number": "string or null", "swift": "string or null", "iban": "string or null", "bsb": "string or null", "routing_number": "string or null" }, "has_bank_details": boolean }';

  output.push({ json: {
    ...ctx,
    claudeSystem: system,
    claudeMessages: [{
      role: 'user',
      content: [
        contentBlock,
        { type: 'text', text: 'Extract the invoice data from this file and return the JSON as specified.' }
      ]
    }]
  }});
}
return output;
`.trim();

const PARSE_VALIDATE = `
const contexts = $('Prepare Claude Request').all();

function genInvoiceNumber(name, date) {
  const d = date ? new Date(date) : new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  const parts = (name || '').trim().split(/\\s+/).filter(Boolean);
  const first = parts[0] || 'X';
  const last = parts[parts.length - 1] || 'X';
  return mm + dd + yyyy + '-' + first.charAt(0).toUpperCase() + last;
}

function getFriday() {
  const utc = Date.now() + (new Date().getTimezoneOffset() * 60000);
  const pht = new Date(utc + 8 * 3600000);
  const day = pht.getDay();
  pht.setDate(pht.getDate() + (day <= 5 ? 5 - day : 6));
  return pht.toISOString().split('T')[0];
}

const output = [];
$input.all().forEach((item, i) => {
  const claudeText = (item.json.content || []).map(c => c.text || '').join('');
  const ctx = (contexts[i] || { json: {} }).json;
  let inv = {};
  try { const m = claudeText.match(/\\{[\\s\\S]*\\}/); inv = m ? JSON.parse(m[0]) : {}; } catch(_) {}

  const creatorName = inv.creator_name || inv.vendor_name || ctx.fromName || '';
  const creatorEmail = inv.email || ctx.fromEmail || '';
  const invoiceNumber = inv.invoice_number || genInvoiceNumber(creatorName, inv.issued_date);
  const dueDate = inv.due_date || getFriday();
  const issuedDate = inv.issued_date || new Date().toISOString().split('T')[0];
  const amount = Number(inv.amount) || 0;
  const currency = (inv.currency || 'USD').toUpperCase();
  const lineItems = (inv.line_items && inv.line_items.length) ? inv.line_items : [{ description: 'Services', quantity: 1, unit_price: amount }];
  const bd = inv.bank_details || {};
  const hasBankDetails = inv.has_bank_details === true || !!(bd.account_number || bd.iban || bd.swift || bd.bsb || bd.routing_number);
  const isInvoice = !!(creatorName && amount > 0);

  output.push({ json: { ...ctx, creatorName, creatorEmail, invoiceNumber, dueDate, issuedDate, amount, currency, lineItems, bankDetails: bd, hasBankDetails, isInvoice } });
});
return output;
`.trim();


const BUILD_FORWARD_CONTEXT = `
const contexts = $('Parse & Validate').all();
const output = [];
$input.all().forEach((item, i) => {
  const ctx = (contexts[i] || { json: {} }).json;

  // Slack notification text
  const lines = [
    '*Invoice received & forwarded to Airwallex* :white_check_mark:',
    '- Creator: ' + (ctx.creatorName || 'Unknown'),
    '- Email: ' + (ctx.creatorEmail || 'Unknown'),
    '- Invoice #: ' + (ctx.invoiceNumber || 'Unknown'),
    '- Amount: ' + (ctx.currency || '') + ' ' + (ctx.amount || ''),
    '- Due: ' + (ctx.dueDate || 'Unknown'),
    '- Source: ' + (ctx.fromEmail || '') + ' — ' + (ctx.subject || ''),
  ];

  // Build RFC822 MIME email here to avoid n8n expression size limits on pdfBase64
  const boundary = 'boundary_aw_' + Date.now();
  const subject = 'Creator Invoice - ' + (ctx.creatorName || 'Unknown') + ' | ' + (ctx.invoiceNumber || 'Unknown') + ' | ' + (ctx.currency || '') + ' ' + (ctx.amount || '');
  const bodyText = [
    'Please process the attached creator invoice.',
    '',
    'Creator: ' + (ctx.creatorName || ''),
    'Invoice #: ' + (ctx.invoiceNumber || ''),
    'Amount: ' + (ctx.currency || '') + ' ' + (ctx.amount || ''),
    'Line Items: ' + (ctx.lineItems || []).map(li => li.description).join(', '),
    'Bank: ' + JSON.stringify(ctx.bankDetails || {}),
    'Issued: ' + (ctx.issuedDate || ''),
    'Due: ' + (ctx.dueDate || ''),
  ].join('\\n');

  const mimeParts = [
    'From: john@kravemedia.co',
    'To: kravemedia@bills.airwallex.com',
    'Subject: ' + subject,
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="' + boundary + '"',
    '',
    '--' + boundary,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    bodyText,
    '',
    '--' + boundary,
    'Content-Type: application/pdf',
    'Content-Transfer-Encoding: base64',
    'Content-Disposition: attachment; filename="' + (ctx.invoiceNumber || 'invoice') + '.pdf"',
    '',
    ctx.pdfBase64 || '',
    '',
    '--' + boundary + '--',
  ];
  const rawMessage = Buffer.from(mimeParts.join('\\r\\n')).toString('base64url');

  output.push({ json: { ...ctx, slackText: lines.join('\\n'), rawMessage } });
});
return output;
`.trim();

const DEDUP_FILTER = `
// Tracker dedup BACKSTOP. Primary dedup is still the is:unread search + mark-as-read
// at the end of each path. This catches the gap: a run that forwarded/logged a bill
// but failed before marking the email read, or a schedule + manual webhook overlap.
//
// Key = Gmail messageId, matched against column I ("Slack Thread TS") of the Bills
// tracker, which the Log node writes for every email-sourced bill.
//
// FAIL-OPEN: if the tracker read errored (continueOnFail), process everything — we
// never drop a real invoice because of a transient read failure. Worst case the
// is:unread/mark-as-read layer still prevents most repeats.
const keys = new Set();
try {
  const fetched = $('Fetch Existing Bills').first();
  const rows = (fetched && fetched.json && fetched.json.values) || [];
  for (const r of rows) {
    const v = String((r && r[0]) || '').trim();
    if (v) keys.add(v);
  }
} catch (_) { /* fail-open */ }

const output = [];
for (const item of $input.all()) {
  const mid = String(item.json.messageId || '').trim();
  if (mid && keys.has(mid)) continue; // already in tracker → skip, do not reprocess
  output.push(item);
}
return output;
`.trim();

// ─── Workflow definition ──────────────────────────────────────────────────────

const workflow = {
  name: 'Krave — Creator Invoice Email Scan',
  settings: { executionOrder: 'v1', saveManualExecutions: true, timezone: 'Asia/Manila' },
  nodes: [
    // ── Triggers ──────────────────────────────────────────────────────────────
    {
      id: 'n1', name: 'Schedule Trigger',
      type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
      position: [240, 200],
      parameters: {
        rule: { interval: [{ field: 'cronExpression', expression: '0 9,12,15,18 * * 1-5' }] },
      },
    },
    {
      id: 'n2', name: 'Webhook Trigger',
      type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [240, 400],
      parameters: {
        httpMethod: 'POST',
        path: 'krave-creator-invoice-email-scan',
        responseMode: 'onReceived',
        options: {},
      },
    },

    // ── Dedup: load existing tracker keys (one item out, so it does NOT multiply
    //    the Gmail search the way a native Sheets-read node would) ───────────────
    {
      id: 'n30', name: 'Fetch Existing Bills',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [360, 300],
      continueOnFail: true,
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'googleSheetsOAuth2Api',
        method: 'GET',
        url: 'https://sheets.googleapis.com/v4/spreadsheets/' + BILLS_SHEET_ID + '/values/' + encodeURIComponent(BILLS_SHEET_TAB + '!I:I'),
        options: {},
      },
      credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
    },

    // ── Email intake ──────────────────────────────────────────────────────────
    {
      id: 'n3', name: 'Search Inbox',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [500, 300],
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'getAll',
        returnAll: false,
        limit: 20,
        simple: true,
        // Sender exclusion is the FIRST line of defense — keep Airwallex platform
        // mail (receipts/statements/notices) out of the pipeline entirely, so
        // Claude is never even called on them. We do NOT exclude kravemedia.co:
        // strategists (the team managing creators) send/forward invoices and may
        // use that domain. See the BLOCKED_SENDER backstop in Extract PDF
        // Attachments for the hard guard.
        filters: { q: 'is:unread has:attachment in:inbox (invoice OR bill OR creator OR payment) (filename:pdf OR filename:png OR filename:jpg OR filename:jpeg) -from:airwallex.com' },
      },
    },
    {
      id: 'n4', name: 'Get Message Details',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [740, 300],
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'gmailOAuth2',
        method: 'GET',
        url: '={{ "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + $json.id + "?format=full" }}',
        options: {},
      },
    },
    {
      id: 'n5', name: 'Extract PDF Attachments',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [980, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: EXTRACT_PDF_ATTACHMENTS },
    },
    {
      id: 'n31', name: 'Dedup Filter',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1100, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: DEDUP_FILTER },
    },

    // ── Download & parse ──────────────────────────────────────────────────────
    {
      id: 'n6', name: 'Download Attachment',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [1220, 300],
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'gmailOAuth2',
        method: 'GET',
        url: '={{ "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + $json.messageId + "/attachments/" + $json.attachmentId }}',
        options: {},
      },
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
    },
    {
      id: 'n7', name: 'Merge Attachment Data',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1460, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: MERGE_ATTACHMENT_DATA },
    },
    {
      id: 'n8', name: 'Prepare Claude Request',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1700, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: PREPARE_CLAUDE_REQUEST },
    },
    {
      id: 'n9', name: 'Call Claude API',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [1940, 300],
      parameters: {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'x-api-key',          value: ANTHROPIC_API_KEY },
          { name: 'anthropic-version',   value: '2023-06-01' },
          { name: 'anthropic-beta',      value: 'pdfs-2024-09-25' },
          { name: 'Content-Type',        value: 'application/json' },
        ]},
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ { model: "claude-sonnet-4-6", max_tokens: 2000, system: $json.claudeSystem, messages: $json.claudeMessages } }}',
        options: {},
      },
    },
    {
      id: 'n10', name: 'Parse & Validate',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [2180, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: PARSE_VALIDATE },
    },

    // ── Guard: is this actually an invoice? ───────────────────────────────────
    {
      id: 'n11a', name: 'Is Invoice?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [2420, 300],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [{ id: 'c1', leftValue: '={{ $json.isInvoice }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
          combinator: 'and',
        },
        options: {},
      },
    },
    {
      id: 'n11b', name: 'Mark Read (not invoice)',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [2660, 500],
      continueOnFail: true,
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'markAsRead',
        messageId: '={{ $json.messageId }}',
      },
    },

    // ── Validate: bank details ─────────────────────────────────────────────────
    {
      id: 'n11', name: 'Has Bank Details?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [2660, 200],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [{ id: 'c1', leftValue: '={{ $json.hasBankDetails }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
          combinator: 'and',
        },
        options: {},
      },
    },

    // ── [false] Missing bank details path ─────────────────────────────────────
    {
      id: 'n12', name: 'Reply Missing Bank Details',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [2660, 500],
      continueOnFail: true,
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'reply',
        messageId: '={{ $json.messageId }}',
        emailType: 'text',
        message: '={{ "Hi " + ($json.fromName || "there").split(" ")[0] + ",\\n\\nThe invoice doesn\'t include bank details (account number, SWIFT/BIC, or IBAN). Could you ask them to reissue with bank info? We can\'t process payment without it.\\n\\nCheers,\\nJohn\\nKrave Media" }}',
        options: {},
      },
    },
    {
      id: 'n13', name: 'Mark Read (missing bank details)',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [2900, 500],
      continueOnFail: true,
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'markAsRead',
        messageId: '={{ $json.messageId }}',
      },
    },

    // ── [true] Email forward path ─────────────────────────────────────────────
    {
      id: 'n25', name: 'Build Forward Context',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [2900, 200],
      parameters: { mode: 'runOnceForAllItems', jsCode: BUILD_FORWARD_CONTEXT },
    },
    {
      id: 'n25b', name: 'Forward PDF to Airwallex Email',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [4580, 500],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart',
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'gmailOAuth2',
        sendBody: true,
        contentType: 'raw',
        rawContentType: 'message/rfc822',
        body: '={{ $json.rawMessage }}',
        options: {},
      },
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
    },
    {
      id: 'n26', name: 'Post Slack Prep Report',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [4820, 340],
      continueOnFail: true,
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'POST',
        url: 'https://slack.com/api/chat.postMessage',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ { channel: "' + OPS_CHANNEL + '", text: $json.slackText } }}',
        options: {},
      },
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
    },
    {
      id: 'n27', name: 'Reply Fallback',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [5060, 340],
      continueOnFail: true,
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'reply',
        messageId: '={{ $("Parse & Validate").item.json.messageId }}',
        emailType: 'text',
        message: '={{ "Hi " + ($("Parse & Validate").item.json.fromName || "there").split(" ")[0] + ",\\n\\nReceived. Staged for payment.\\n\\nCheers,\\nJohn\\nKrave Media" }}',
        options: {},
      },
    },
    {
      id: 'n28', name: 'Log to Bills Tab (pending)',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [5300, 340],
      continueOnFail: true,
      credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet',
        operation: 'append',
        documentId: { __rl: true, value: BILLS_SHEET_ID, mode: 'id' },
        sheetName:  { __rl: true, value: BILLS_SHEET_TAB, mode: 'name' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            'Date Received':     '={{ new Date().toISOString().split("T")[0] }}',
            'Creator / Vendor':  '={{ $("Parse & Validate").item.json.creatorName }}',
            'Invoice #':         '={{ $("Parse & Validate").item.json.invoiceNumber }}',
            'Airwallex Bill ID': '',
            'Amount':            '={{ $("Parse & Validate").item.json.amount }}',
            'Currency':          '={{ $("Parse & Validate").item.json.currency }}',
            'Due Date':          '={{ $("Parse & Validate").item.json.dueDate }}',
            'Status':            'Forwarded via Email',
            'Slack Thread TS':   '={{ $("Parse & Validate").item.json.messageId }}',
            'Notes':             'Source: Email — forwarded to kravemedia@bills.airwallex.com',
          },
          schema: [],
        },
        options: {},
      },
    },
    {
      id: 'n29', name: 'Mark Read (fallback)',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [5540, 340],
      continueOnFail: true,
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'markAsRead',
        messageId: '={{ $("Parse & Validate").item.json.messageId }}',
      },
    },
  ],

  connections: {
    // Triggers → Fetch existing tracker keys → Search (Fetch runs once, upstream of
    // everything, so Dedup Filter can reference it and ordering is guaranteed)
    'Schedule Trigger': { main: [[{ node: 'Fetch Existing Bills', type: 'main', index: 0 }]] },
    'Webhook Trigger':  { main: [[{ node: 'Fetch Existing Bills', type: 'main', index: 0 }]] },
    'Fetch Existing Bills': { main: [[{ node: 'Search Inbox',     type: 'main', index: 0 }]] },
    // Email intake chain
    'Search Inbox':               { main: [[{ node: 'Get Message Details',     type: 'main', index: 0 }]] },
    'Get Message Details':        { main: [[{ node: 'Extract PDF Attachments', type: 'main', index: 0 }]] },
    'Extract PDF Attachments':    { main: [[{ node: 'Dedup Filter',           type: 'main', index: 0 }]] },
    'Dedup Filter':               { main: [[{ node: 'Download Attachment',     type: 'main', index: 0 }]] },
    'Download Attachment':        { main: [[{ node: 'Merge Attachment Data',   type: 'main', index: 0 }]] },
    'Download Attachment':        { main: [[{ node: 'Merge Attachment Data',   type: 'main', index: 0 }]] },
    'Merge Attachment Data':      { main: [[{ node: 'Prepare Claude Request',  type: 'main', index: 0 }]] },
    'Prepare Claude Request':     { main: [[{ node: 'Call Claude API',         type: 'main', index: 0 }]] },
    'Call Claude API':            { main: [[{ node: 'Parse & Validate',        type: 'main', index: 0 }]] },
    'Parse & Validate':  { main: [[{ node: 'Is Invoice?', type: 'main', index: 0 }]] },
    // Guard: not an invoice → mark read silently
    'Is Invoice?': { main: [
      [{ node: 'Has Bank Details?',       type: 'main', index: 0 }],  // true — is an invoice
      [{ node: 'Mark Read (not invoice)', type: 'main', index: 0 }],  // false — skip
    ]},
    // Validation branch
    'Has Bank Details?': { main: [
      [{ node: 'Build Forward Context',      type: 'main', index: 0 }],  // true
      [{ node: 'Reply Missing Bank Details', type: 'main', index: 0 }],  // false
    ]},
    // Missing bank details path
    'Reply Missing Bank Details': { main: [[{ node: 'Mark Read (missing bank details)', type: 'main', index: 0 }]] },
    // Email forward path
    'Build Forward Context':           { main: [[{ node: 'Forward PDF to Airwallex Email', type: 'main', index: 0 }]] },
    'Forward PDF to Airwallex Email':  { main: [[{ node: 'Post Slack Prep Report',         type: 'main', index: 0 }]] },
    'Post Slack Prep Report':          { main: [[{ node: 'Reply Fallback',                  type: 'main', index: 0 }]] },
    'Reply Fallback':                  { main: [[{ node: 'Log to Bills Tab (pending)',       type: 'main', index: 0 }]] },
    'Log to Bills Tab (pending)':      { main: [[{ node: 'Mark Read (fallback)',             type: 'main', index: 0 }]] },
  },
};

// ─── Deploy ───────────────────────────────────────────────────────────────────

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
  console.log('POST https://noatakhel.app.n8n.cloud/webhook/krave-creator-invoice-email-scan');
}

if (require.main === module) {
  deploy().catch((e) => console.error('Deploy failed:', e.message));
}

module.exports = { workflow };
