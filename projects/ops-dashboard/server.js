'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Auto-load .env from repo root (two levels up from projects/ops-dashboard/)
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^([^#=\s][^=]*)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
}

const PORT = process.env.PORT || 3000;
const N8N_BASE = 'https://noatakhel.app.n8n.cloud';
// Background image for the parallax dive. Swap this URL for any landscape photo.
const BG_IMAGE_URL = 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=2400&q=85&auto=format&fit=crop';
const SHEET_ID = '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50';
const PAYMENTS_CHANNEL = 'C09HN2EBPR7';
const DRAFTS_CHANNEL = 'C0AQZGJDR38';
const CACHE_TTL_MS = 5 * 60 * 1000;

const ALLOWLIST = new Set([
  'noa@kravemedia.co',
  'john@kravemedia.co',
  'amanda@kravemedia.co',
  'jeneena@kravemedia.co',
  'sybil@kravemedia.co',
  'shin@kravemedia.co',
  'sha@withally.com',
]);

const RANGE_DAYS = { '24h': 1, '7d': 7, '30d': 30 };
let cache = {}; // keyed by range

// Canonical Krave/Claude EA workflow IDs from n8n-workflows/WORKFLOWS.md.
// All other workflows in the n8n workspace are filtered out of dashboard stats.
const KRAVE_WORKFLOW_IDS = new Set([
  'NurOLZkg3J6rur5Q', // Payment Detection
  'Q3IqqLvmX9H49NdE', // Invoice Reminder Cron
  'omNFmRcDeiByLOzS', // Invoice Reminder Reply Detection
  'EuT6REDs5PUaoycE', // Inbox Triage Daily v2
  't7MMhlUo5H4HQmgL', // Slack Invoice Handler
  '5XHxhQ7wB2rxE3qz', // Invoice Request Intake
  'uCS9lzHtVKWlqYlk', // Invoice Approval Polling
  'WX1hHek0cNTyZXkS', // Weekly Invoice Summary
]);

// ---------------------------------------------------------------------------
// Service account loader — supports JSON-in-env (Render) or file path (local)
// ---------------------------------------------------------------------------

function hasServiceAccount() {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE);
}

function loadServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
  if (raw) return JSON.parse(raw);
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  throw new Error('Google service account not configured');
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 400, status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ ok: false, status: res.statusCode, body }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('timeout')); });
  });
}

function post(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const buf = Buffer.from(data);
    const options = {
      hostname: parsed.hostname, path: parsed.pathname, method: 'POST',
      headers: { 'Content-Length': buf.length, ...headers },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 400, status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ ok: false, status: res.statusCode, body }); }
      });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Data sources
// ---------------------------------------------------------------------------

async function fetchN8n() {
  const key = process.env.N8N_API_KEY;
  if (!key) return { ok: false, reason: 'N8N_API_KEY not set', executions: [], workflows: [] };
  try {
    const [exRes, wfRes] = await Promise.all([
      get(`${N8N_BASE}/api/v1/executions?limit=200`, { 'X-N8N-API-KEY': key }),
      get(`${N8N_BASE}/api/v1/workflows?limit=100`, { 'X-N8N-API-KEY': key }),
    ]);
    const allExecutions = exRes.ok ? (exRes.body.data || []) : [];
    const allWorkflows = wfRes.ok ? (wfRes.body.data || []) : [];
    return {
      ok: exRes.ok && wfRes.ok,
      executions: allExecutions.filter((e) => KRAVE_WORKFLOW_IDS.has(e.workflowId)),
      workflows: allWorkflows.filter((w) => KRAVE_WORKFLOW_IDS.has(w.id)),
      reason: (!exRes.ok || !wfRes.ok) ? `n8n API returned ${exRes.status}/${wfRes.status}` : null,
    };
  } catch (e) {
    return { ok: false, reason: e.message, executions: [], workflows: [] };
  }
}

// Build a signed JWT and exchange it for a Google OAuth2 access token
// using the same service account JSON file the MCP servers use.
let _sheetsTokenCache = { token: null, exp: 0 };

async function getServiceAccountToken() {
  if (_sheetsTokenCache.token && Date.now() < _sheetsTokenCache.exp - 60000) {
    return _sheetsTokenCache.token;
  }

  const sa = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sigInput = `${header}.${body}`;
  const sig = crypto.createSign('RSA-SHA256').update(sigInput).sign(sa.private_key, 'base64url');
  const jwt = `${sigInput}.${sig}`;

  const tokenRes = await post('https://oauth2.googleapis.com/token',
    `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    { 'Content-Type': 'application/x-www-form-urlencoded' });

  if (!tokenRes.ok) throw new Error(`Token exchange failed: ${JSON.stringify(tokenRes.body)}`);
  _sheetsTokenCache = { token: tokenRes.body.access_token, exp: now + tokenRes.body.expires_in };
  return _sheetsTokenCache.token;
}

// ---------------------------------------------------------------------------
// Gmail — service account token with domain-wide delegation (john@kravemedia.co)
// ---------------------------------------------------------------------------

let _gmailTokenCache = { token: null, exp: 0 };

async function getGmailToken() {
  if (_gmailTokenCache.token && Date.now() < _gmailTokenCache.exp - 60000) {
    return _gmailTokenCache.token;
  }
  const sa = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    sub: 'john@kravemedia.co',
    scope: 'https://www.googleapis.com/auth/gmail.send',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sigInput = `${header}.${body}`;
  const sig = crypto.createSign('RSA-SHA256').update(sigInput).sign(sa.private_key, 'base64url');
  const jwt = `${sigInput}.${sig}`;
  const tokenRes = await post(
    'https://oauth2.googleapis.com/token',
    `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    { 'Content-Type': 'application/x-www-form-urlencoded' },
  );
  if (!tokenRes.ok) throw new Error(`Gmail token failed: ${JSON.stringify(tokenRes.body)}`);
  _gmailTokenCache = { token: tokenRes.body.access_token, exp: now + 3600 };
  return _gmailTokenCache.token;
}

function getBinary(url, authHeader) {
  return new Promise((resolve, reject) => {
    const follow = (targetUrl, hops) => {
      if (hops > 5) return reject(new Error('Too many redirects'));
      const parsed = new URL(targetUrl);
      const opts = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: authHeader ? { Authorization: authHeader } : {},
      };
      https.get(opts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Drop auth on redirect to avoid leaking credentials to different hosts
          authHeader = null;
          return follow(res.headers.location, hops + 1);
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject).setTimeout(30000, function () { this.destroy(new Error('timeout')); });
    };
    follow(url, 0);
  });
}

function buildEmailMime({ from, to, cc, subject, bodyText, pdfBuffer, pdfFilename }) {
  const encSubject = /^[\x00-\x7F]*$/.test(subject)
    ? subject
    : `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`;
  const boundary = `b_${crypto.randomBytes(8).toString('hex')}`;
  const parts = [
    [
      `From: ${from}`,
      `To: ${to}`,
      ...(cc ? [`Cc: ${cc}`] : []),
      `Subject: ${encSubject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ].join('\r\n'),
    `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${bodyText}`,
    `--${boundary}\r\nContent-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${pdfFilename}"\r\n\r\n${pdfBuffer.toString('base64')}`,
    `--${boundary}--`,
  ];
  return parts.join('\r\n\r\n');
}

async function sendGmailWithPdf({ to, cc, subject, bodyText, pdfBuffer, pdfFilename }) {
  const token = await getGmailToken();
  const mime = buildEmailMime({ from: 'john@kravemedia.co', to, cc, subject, bodyText, pdfBuffer, pdfFilename });
  const raw = Buffer.from(mime).toString('base64url');
  const body = JSON.stringify({ raw });
  const parsed = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  const res = await new Promise((resolve, reject) => {
    const buf = Buffer.from(body);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': buf.length,
      },
    };
    const req = https.request(opts, (r) => {
      let data = '';
      r.on('data', (c) => { data += c; });
      r.on('end', () => {
        try { resolve({ ok: r.statusCode < 400, status: r.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ ok: false, status: r.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
  if (!res.ok) throw new Error(`Gmail send failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function handleRunTriage(req, res) {
  const TRIAGE_WEBHOOK = 'https://noatakhel.app.n8n.cloud/webhook/krave-inbox-triage-v2';
  try {
    const result = await post(TRIAGE_WEBHOOK, '{}', { 'Content-Type': 'application/json' });
    res.writeHead(result.ok ? 200 : 502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: result.ok, status: result.status }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

async function handleRunEmailScan(req, res) {
  const EMAIL_SCAN_WEBHOOK = 'https://noatakhel.app.n8n.cloud/webhook/krave-creator-invoice-email-scan';
  try {
    const result = await post(EMAIL_SCAN_WEBHOOK, '{}', { 'Content-Type': 'application/json' });
    res.writeHead(result.ok ? 200 : 502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: result.ok, status: result.status }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: e.message }));
  }
}

async function composeInvoiceEmailBody({ client_name, invoice_number, amount, currency, due_date, project_description, payment_link }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const firstName = (client_name || '').split(/[\s,]/)[0] || client_name;
  const prompt = `You are John from Krave Media writing a short, warm invoice email to a client.

Invoice details:
- Client: ${client_name}
- Invoice: ${invoice_number}
- Amount: ${amount} ${currency}
- Due date: ${due_date}
- Project / description: ${project_description || '(not specified)'}
- Payment link: ${payment_link || '(not available)'}

Write the email body only (no subject line). Follow these rules exactly:
- Greeting: "Hey ${firstName}!"
- DEFAULT — broad, stage-agnostic body. You do not know where the engagement stands (many clients are months in), so never assume this is the first or last invoice. No "kicking things off", "excited to start", "can't wait to get started", "that's a wrap", or any other phrase implying the engagement is just beginning or ending. Briefly reference the project/description, state the invoice number and amount, and thank them for the continued partnership.
- ONLY if the description explicitly contains the word "deposit" or "kickoff": express excitement about starting the project together and state this is the deposit/kickoff invoice. (A retainer, starter pack, or onboarding-sounding package name is NOT a kickoff signal.)
- ONLY if the description explicitly contains "final", "completion", or "balance": celebrate the milestone, reference deliverables if mentioned.
- Include the payment link prominently: "${firstName} — here is the link for easier payment: [payment_link]"
- Mention the due date.
- Sign off: "Cheers,\\nJohn\\nKrave Media"
- Tone: warm, professional, concise. Friendly but not overly casual. No fluff.
- Do NOT include the subject line. Do NOT include Drive file links. Do NOT mention the PDF attachment explicitly.`;

  const payload = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });
  const res = await new Promise((resolve, reject) => {
    const buf = Buffer.from(payload);
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': buf.length,
      },
    }, (r) => {
      let data = '';
      r.on('data', (c) => { data += c; });
      r.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ error: data }); } });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
  if (res.error || !res.content) throw new Error(`Claude compose failed: ${JSON.stringify(res)}`);
  return (res.content[0] && res.content[0].text) || '';
}

async function handleSendInvoiceEmail(req, res) {
  const secret = process.env.SEND_INVOICE_EMAIL_SECRET;
  const auth = req.headers['authorization'] || '';
  if (!secret || auth !== `Bearer ${secret}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
  }
  let rawBody = '';
  req.on('data', (c) => { rawBody += c; });
  req.on('end', async () => {
    try {
      const {
        to, cc, subject, body: emailBody, pdf_url, pdf_auth_token, filename,
        compose_body, client_name, invoice_number, amount, currency, due_date,
        project_description, payment_link,
      } = JSON.parse(rawBody);
      if (!to || !subject || !pdf_url) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Missing required fields: to, subject, pdf_url' }));
      }
      let bodyText = emailBody || '';
      if (compose_body) {
        bodyText = await composeInvoiceEmailBody({ client_name, invoice_number, amount, currency, due_date, project_description, payment_link });
      }
      const pdfBuffer = await getBinary(pdf_url, pdf_auth_token || null);
      const msgId = await sendGmailWithPdf({
        to, cc: cc || null,
        subject,
        bodyText,
        pdfBuffer,
        pdfFilename: filename || 'invoice.pdf',
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message_id: msgId }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  });
}

let _invoicesGid = null;

async function fetchInvoicesGid() {
  if (_invoicesGid !== null) return _invoicesGid;
  try {
    const token = await getServiceAccountToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`;
    const res = await get(url, { Authorization: `Bearer ${token}` });
    if (!res.ok) return 0;
    const sheets = res.body.sheets || [];
    const inv = sheets.find((s) => s.properties && s.properties.title === 'Invoices');
    _invoicesGid = inv ? inv.properties.sheetId : 0;
    return _invoicesGid;
  } catch {
    return 0;
  }
}

async function fetchSheets() {
  if (!hasServiceAccount()) return { ok: false, reason: 'Google service account not configured (set GOOGLE_SERVICE_ACCOUNT_KEY_JSON or GOOGLE_SERVICE_ACCOUNT_KEY_FILE)', rows: [], gid: 0 };
  try {
    const token = await getServiceAccountToken();
    const range = encodeURIComponent('Invoices!A:Z');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`;
    const [valuesRes, gid] = await Promise.all([
      get(url, { Authorization: `Bearer ${token}` }),
      fetchInvoicesGid(),
    ]);
    if (!valuesRes.ok) return { ok: false, reason: `Sheets API ${valuesRes.status}: ${JSON.stringify(valuesRes.body)}`, rows: [], gid };
    const [headers, ...rows] = valuesRes.body.values || [];
    const mapped = rows.map((r, i) => {
      const obj = { _rowIndex: i + 2 }; // +1 for 1-based, +1 for header row
      (headers || []).forEach((h, j) => { obj[h] = r[j] || ''; });
      return obj;
    });
    return { ok: true, rows: mapped, gid };
  } catch (e) {
    return { ok: false, reason: e.message, rows: [], gid: 0 };
  }
}

async function fetchSlack(channel) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { ok: false, reason: 'SLACK_BOT_TOKEN not set', messages: [] };
  try {
    const url = `https://slack.com/api/conversations.history?channel=${channel}&limit=100`;
    const res = await get(url, { Authorization: `Bearer ${token}` });
    if (!res.ok || !res.body.ok) return { ok: false, reason: res.body.error || 'Slack error', messages: [] };
    return { ok: true, messages: res.body.messages || [] };
  } catch (e) {
    return { ok: false, reason: e.message, messages: [] };
  }
}

// ---------------------------------------------------------------------------
// Data computation
// ---------------------------------------------------------------------------

function computeTrackerStats(rows) {
  const stats = {
    draftPendingJohn: 0,
    sentAwaiting: 0,
    partialPayment: 0,
    paymentComplete: 0,
    overdue: 0,
    dueToday: 0,
    collections: 0,
    missingEmail: 0,
    missingInvoiceUrl: 0,
    totalAR: {},
    remindersTotal: 0,
    repliesConfirmed: 0,
    paidAfterFollowUp: 0,
    actionItems: [],
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const row of rows) {
    const status = (row['Status'] || '').trim();
    const payStatus = (row['Payment Status'] || '').trim();
    const invoiceNum = (row['Invoice #'] || '').trim();
    const amount = parseFloat((row['Amount'] || '0').replace(/[^0-9.]/g, '')) || 0;
    const currency = (row['Currency'] || 'USD').trim();
    const dueStr = (row['Due Date'] || '').trim();
    const email = (row['Email Address'] || '').trim();
    const invoiceUrl = (row['Invoice URL'] || '').trim();
    const remindersLog = (row['Reminders Sent'] || '').trim();
    const replyStatus = (row['Client Reply Status'] || '').trim();
    const lastFollowUp = (row['Last Follow-Up Sent'] || '').trim();
    const payConfirmed = (row['Payment Confirmed Date'] || '').trim();

    if (!invoiceNum) continue;

    // Categorize by status
    if (payStatus === 'Payment Complete' || status === 'Paid' || status === 'Payment Complete') {
      stats.paymentComplete++;
      if (lastFollowUp && payConfirmed) {
        const followDate = new Date(lastFollowUp);
        const payDate = new Date(payConfirmed);
        if (!isNaN(followDate) && !isNaN(payDate)) {
          const diffDays = (payDate - followDate) / 86400000;
          if (diffDays >= 0 && diffDays <= 14) stats.paidAfterFollowUp++;
        }
      }
    } else if (payStatus === 'Collections') {
      stats.collections++;
    } else if (payStatus === 'Partial Payment') {
      stats.partialPayment++;
    } else if (payStatus.startsWith('Draft')) {
      stats.draftPendingJohn++;
    } else if (payStatus === 'Sent' || payStatus === 'Awaiting Payment' || payStatus === 'Invoice Sent'
        || payStatus === 'Overdue' || payStatus.startsWith('Late Fee Applied')) {
      stats.sentAwaiting++;
      if (amount > 0) {
        stats.totalAR[currency] = (stats.totalAR[currency] || 0) + amount;
      }
      // Statuses the n8n automation explicitly marks as overdue
      if (payStatus === 'Overdue' || payStatus.startsWith('Late Fee Applied')) {
        stats.overdue++;
      } else if (dueStr) {
        const due = new Date(dueStr);
        due.setHours(0, 0, 0, 0);
        if (!isNaN(due)) {
          if (due < today) stats.overdue++;
          else if (due.getTime() === today.getTime()) stats.dueToday++;
        }
      }
    }

    // Reminders count
    if (remindersLog) {
      const count = (remindersLog.match(/\|/g) || []).length + 1;
      stats.remindersTotal += count;
    }

    // Replies
    if (replyStatus && replyStatus !== 'No Reply Found' && replyStatus !== '') {
      stats.repliesConfirmed++;
    }

    // Missing data risks
    if (!email && payStatus !== 'Payment Complete') stats.missingEmail++;
    if (!invoiceUrl && (payStatus === 'Sent' || payStatus === 'Invoice Sent')) stats.missingInvoiceUrl++;

    // Action items — categories ordered by priority
    const client = (row['Client Name'] || '').trim();
    const dueDate = dueStr ? new Date(dueStr) : null;
    const overdueDays = (dueDate && !isNaN(dueDate)) ? Math.floor((today - dueDate) / 86400000) : null;
    const dateCreatedStr = (row['Date Created'] || '').trim();
    const dateCreated = dateCreatedStr ? new Date(dateCreatedStr) : null;
    const draftAgeDays = (dateCreated && !isNaN(dateCreated)) ? Math.floor((today - dateCreated) / 86400000) : null;

    const rowIndex = row._rowIndex;
    if (payStatus === 'Collections') {
      stats.actionItems.push({ invoice: invoiceNum, client, rowIndex, action: 'Collections — manual escalation needed' });
    } else if (replyStatus === 'Needs Human' || replyStatus === 'Question/Dispute') {
      stats.actionItems.push({ invoice: invoiceNum, client, rowIndex, action: `Client reply needs human review (${replyStatus})` });
    } else if (overdueDays !== null && overdueDays > 60 && ['Sent', 'Awaiting Payment', 'Invoice Sent'].includes(payStatus)) {
      stats.actionItems.push({ invoice: invoiceNum, client, rowIndex, action: `${overdueDays}d overdue — past late-fee window, consider escalation` });
    } else if (payStatus === 'Partial Payment' && overdueDays !== null && overdueDays > 14) {
      stats.actionItems.push({ invoice: invoiceNum, client, rowIndex, action: `Partial payment, ${overdueDays}d overdue — chase remaining balance` });
    } else if (payStatus.startsWith('Draft') && draftAgeDays !== null && draftAgeDays > 3) {
      stats.actionItems.push({ invoice: invoiceNum, client, rowIndex, action: `Draft pending John for ${draftAgeDays} days` });
    } else if (!email && payStatus !== 'Payment Complete' && payStatus !== '') {
      stats.actionItems.push({ invoice: invoiceNum, client: row['Client Name'] || '', rowIndex, action: 'Missing client email — reminders blocked' });
    }
  }

  return stats;
}

function computeN8nStats(executions, workflows, rangeMs) {
  const cutoff = Date.now() - rangeMs;
  const recent = executions.filter((e) => new Date(e.startedAt || e.stoppedAt || 0).getTime() > cutoff);
  const total = recent.length;
  const success = recent.filter((e) => e.status === 'success').length;
  const failed = recent.filter((e) => e.status === 'error' || e.status === 'crashed').length;
  const failedNames = [...new Set(
    recent.filter((e) => e.status === 'error' || e.status === 'crashed')
      .map((e) => e.workflowData?.name || e.workflowId || 'unknown')
  )];
  const activeIds = new Set(workflows.filter((w) => w.active).map((w) => w.id));
  const executedIds = new Set(recent.map((e) => e.workflowId));
  const stale = [...activeIds].filter((id) => !executedIds.has(id))
    .map((id) => workflows.find((w) => w.id === id)?.name || id);
  return { total, success, failed, failedNames, stale };
}

function computeNextFollowUps(rows) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const msDay = 86400000;
  const TIERS = [7, 5, 3, 1, 0, -1, -6, -7, -59];
  const results = [];

  for (const row of rows) {
    const payStatus = (row['Payment Status'] || '').trim();
    const invoiceNum = (row['Invoice #'] || '').trim();
    if (!invoiceNum) continue;
    if (['Payment Complete', 'Collections', 'Paid'].includes(payStatus) || payStatus.startsWith('Draft')) continue;

    const dueStr = (row['Due Date'] || '').trim();
    if (!dueStr) continue;
    const due = new Date(dueStr);
    if (isNaN(due.getTime())) continue;

    const daysDiff = Math.round((due.getTime() - today.getTime()) / msDay);
    const lastSent = (row['Last Follow-Up Sent'] || '').trim();
    const owner = (row['Requested By'] || '').trim() || 'Unassigned';
    const client = (row['Client Name'] || '').trim();
    const email = (row['Email Address'] || '').trim();

    let nextDays = null;
    for (const t of TIERS) {
      if (daysDiff <= t + 1 && daysDiff >= t) { nextDays = t; break; }
    }
    if (nextDays === null) nextDays = daysDiff > 7 ? 7 : daysDiff;

    const nextDate = new Date(today.getTime() + nextDays * msDay);
    const lateFeeDate = new Date(due.getTime() - 7 * msDay);
    const collectionsDate = new Date(due.getTime() - 60 * msDay);
    const blocked = !email;

    results.push({
      invoice: invoiceNum,
      client,
      owner,
      rowIndex: row._rowIndex,
      daysUntilDue: daysDiff,
      nextFollowUp: nextDate.toISOString().split('T')[0],
      lateFeeDate: lateFeeDate.toISOString().split('T')[0],
      collectionsDate: collectionsDate.toISOString().split('T')[0],
      lastSent,
      blocked,
    });
  }

  results.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  return results.slice(0, 10);
}

function computeAgingBuckets(rows) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const buckets = [
    { label: 'Current', amount: 0, count: 0 },
    { label: '1–30d overdue', amount: 0, count: 0 },
    { label: '31–60d overdue', amount: 0, count: 0 },
    { label: '61–90d overdue', amount: 0, count: 0 },
    { label: '90+d overdue', amount: 0, count: 0 },
  ];
  for (const row of rows) {
    const payStatus = (row['Payment Status'] || '').trim();
    if (!['Sent', 'Awaiting Payment', 'Invoice Sent', 'Partial Payment', 'Overdue'].includes(payStatus) && !payStatus.startsWith('Late Fee Applied')) continue;
    const amount = parseFloat((row['Amount'] || '0').replace(/[^0-9.]/g, '')) || 0;
    const paid = parseFloat((row['Amount Paid'] || '0').replace(/[^0-9.]/g, '')) || 0;
    const remaining = Math.max(0, amount - paid);
    if (remaining <= 0) continue;
    const dueStr = (row['Due Date'] || '').trim();
    if (!dueStr) continue;
    const due = new Date(dueStr);
    if (isNaN(due)) continue;
    const overdueDays = Math.floor((today - due) / 86400000);
    let i;
    if (overdueDays <= 0) i = 0;
    else if (overdueDays <= 30) i = 1;
    else if (overdueDays <= 60) i = 2;
    else if (overdueDays <= 90) i = 3;
    else i = 4;
    buckets[i].amount += remaining;
    buckets[i].count += 1;
  }
  const total = buckets.reduce((s, b) => s + b.amount, 0);
  return { buckets, total };
}

function computeStatusDonut(rows) {
  const counts = { Draft: 0, Sent: 0, Partial: 0, Paid: 0, Overdue: 0, Collections: 0 };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (const row of rows) {
    if (!(row['Invoice #'] || '').trim()) continue;
    const payStatus = (row['Payment Status'] || '').trim();
    if (payStatus === 'Collections') counts.Collections++;
    else if (payStatus === 'Partial Payment') counts.Partial++;
    else if (payStatus.startsWith('Draft')) counts.Draft++;
    else if (payStatus === 'Payment Complete' || payStatus === 'Paid') counts.Paid++;
    else if (payStatus === 'Overdue' || payStatus.startsWith('Late Fee Applied')) counts.Overdue++;
    else if (['Sent', 'Awaiting Payment', 'Invoice Sent'].includes(payStatus)) {
      const dueStr = (row['Due Date'] || '').trim();
      const due = dueStr ? new Date(dueStr) : null;
      if (due && !isNaN(due) && due < today) counts.Overdue++;
      else counts.Sent++;
    }
  }
  return counts;
}

function computeWorkflowSparklines(executions, workflows, days) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ms = 86400000;
  const dayKeys = [];
  for (let i = days - 1; i >= 0; i--) {
    dayKeys.push(new Date(today.getTime() - i * ms).toISOString().slice(0, 10));
  }
  const dayIndex = new Map(dayKeys.map((k, i) => [k, i]));
  const byWorkflow = {};
  const nameById = {};
  for (const wf of workflows) nameById[wf.id] = wf.name;
  for (const e of executions) {
    const startedAt = e.startedAt || e.stoppedAt;
    if (!startedAt) continue;
    const k = new Date(startedAt).toISOString().slice(0, 10);
    if (!dayIndex.has(k)) continue;
    const name = e.workflowData?.name || nameById[e.workflowId] || 'unknown';
    if (!byWorkflow[name]) {
      byWorkflow[name] = { name, runs: dayKeys.map(() => 0), fails: dayKeys.map(() => 0), total: 0, failed: 0 };
    }
    const idx = dayIndex.get(k);
    byWorkflow[name].runs[idx]++;
    byWorkflow[name].total++;
    if (e.status === 'error' || e.status === 'crashed') {
      byWorkflow[name].fails[idx]++;
      byWorkflow[name].failed++;
    }
  }
  return Object.values(byWorkflow).sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------------------
// Gather all data
// ---------------------------------------------------------------------------

function computeInsenseStats() {
  // Read the in-repo cache (committed). Run JSONs are gitignored so we don't
  // depend on them at runtime — cache is the source of truth on Render.
  const cachePath = path.resolve(__dirname, '../../data/insense/cache.json');
  if (!fs.existsSync(cachePath)) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch (_) {
    return null;
  }
  const creators = raw && raw.creators && typeof raw.creators === 'object' ? raw.creators : {};
  const entries = Object.entries(creators);
  const dayMs = 86400000;
  const now = Date.now();
  const stats = {
    totalCreators: entries.length,
    messaged: 0,
    blocked: 0,
    triagedFailed: 0,
    sentLast24h: 0,
    sentLast7d: 0,
    byCampaign: {}, // name -> { messaged, blocked, failed }
    lastMessagedAt: null,
  };
  for (const [, v] of entries) {
    const status = v && v.status;
    const campaign = (v && v.lastCampaign) || 'unknown';
    if (!stats.byCampaign[campaign]) stats.byCampaign[campaign] = { messaged: 0, blocked: 0, failed: 0 };
    if (status === 'messaged') {
      stats.messaged++;
      stats.byCampaign[campaign].messaged++;
      const sentAt = v.lastMessagedAt ? Date.parse(v.lastMessagedAt) : null;
      if (sentAt) {
        if (now - sentAt <= dayMs) stats.sentLast24h++;
        if (now - sentAt <= 7 * dayMs) stats.sentLast7d++;
        if (!stats.lastMessagedAt || sentAt > Date.parse(stats.lastMessagedAt)) {
          stats.lastMessagedAt = v.lastMessagedAt;
        }
      }
    } else if (status === 'blocked') {
      stats.blocked++;
      stats.byCampaign[campaign].blocked++;
    } else if (status === 'triaged') {
      stats.triagedFailed++;
      stats.byCampaign[campaign].failed++;
    }
  }
  // Sort campaigns by messaged count desc, top 5
  stats.topCampaigns = Object.entries(stats.byCampaign)
    .map(([name, c]) => ({ name, ...c }))
    .sort((a, b) => b.messaged - a.messaged)
    .slice(0, 5);
  return stats;
}

async function fetchClickUp() {
  const apiKey = process.env.CLICKUP_API_KEY;
  const listId = process.env.CLICKUP_LIST_ID;
  if (!apiKey || !listId) return { ok: false, reason: 'CLICKUP_API_KEY or CLICKUP_LIST_ID not set' };
  try {
    // Fetch active tasks (exclude closed/payment complete) — page 0, up to 100
    const url = `https://api.clickup.com/api/v2/list/${listId}/task?include_closed=false&subtasks=false&page=0`;
    const res = await get(url, { Authorization: apiKey });
    if (!res.ok) return { ok: false, reason: `ClickUp API ${res.status}` };
    const tasks = res.body.tasks || [];
    return { ok: true, tasks };
  } catch (e) {
    return { ok: false, reason: String(e.message || e) };
  }
}

function computeClickUpStats(tasks) {
  const byStatus = {};
  const creatorPaid = { paidInFull: 0, notPaid: 0, other: 0 };
  const byAssignee = {};
  const active = [];

  for (const t of tasks) {
    // Status counts
    const status = (t.status && t.status.status) ? t.status.status : 'unknown';
    byStatus[status] = (byStatus[status] || 0) + 1;

    // Custom fields
    const fields = {};
    for (const f of (t.custom_fields || [])) {
      const name = (f.name || '').toLowerCase().replace(/\s+/g, '_');
      // dropdown fields have value as option index, use type_config to resolve
      if (f.type === 'drop_down' && f.type_config && f.type_config.options && f.value != null) {
        const opt = f.type_config.options.find(o => o.orderindex === f.value);
        fields[name] = opt ? opt.name : null;
      } else {
        fields[name] = f.value != null ? f.value : null;
      }
    }

    // Creator paid breakdown
    const paid = (fields['creator_paid'] || '').toLowerCase();
    if (paid.includes('paid in full')) creatorPaid.paidInFull++;
    else if (paid.includes('not paid')) creatorPaid.notPaid++;
    else creatorPaid.other++;

    // Assignee breakdown
    for (const a of (t.assignees || [])) {
      const name = a.username || a.email || 'unknown';
      byAssignee[name] = (byAssignee[name] || 0) + 1;
    }

    // Active project list (top 10 most recent by date_updated)
    active.push({
      name: t.name,
      status,
      assignee: (t.assignees || []).map(a => a.initials || a.username).join(', ') || '—',
      service: fields['service'] || '—',
      creatorPaid: fields['creator_paid'] || '—',
      kickOff: fields['kick_off_date'] || null,
      url: `https://app.clickup.com/t/${t.id}`,
      dateUpdated: t.date_updated ? Number(t.date_updated) : 0,
    });
  }

  active.sort((a, b) => b.dateUpdated - a.dateUpdated);

  return {
    totalActive: tasks.length,
    byStatus,
    creatorPaid,
    byAssignee,
    activeProjects: active.slice(0, 10),
  };
}

const CRAVE_SHEET_ID = '1eLQrDP3IX9ec9dtFN0UyRdlTplzkLfRG9Asyqj1gLrI';
const SMARTLEAD_CAMPAIGN_ID = 3375376;

async function fetchSmartleadStats() {
  const apiKey = process.env.SMARTLEAD_API_KEY;
  if (!apiKey) return { ok: false, reason: 'SMARTLEAD_API_KEY not set' };
  try {
    const res = await get(`https://server.smartlead.ai/api/v1/campaigns/${SMARTLEAD_CAMPAIGN_ID}/analytics?api_key=${apiKey}`);
    if (!res.ok) return { ok: false, reason: `Smartlead ${res.status}` };
    const d = res.body;
    const sent = d.sent_count || 0;
    const opened = d.open_count || d.unique_open_count || 0;
    const replied = d.reply_count || 0;
    const bounced = d.bounce_count || 0;
    return {
      ok: true,
      sent, opened, replied, bounced,
      openRate: sent ? `${(opened / sent * 100).toFixed(1)}%` : '—',
      replyRate: sent ? `${(replied / sent * 100).toFixed(1)}%` : '—',
      bounceRate: sent ? `${(bounced / sent * 100).toFixed(1)}%` : '—',
      warn: sent > 0 && (opened / sent) < 0.2,
    };
  } catch (e) { return { ok: false, reason: e.message }; }
}

async function fetchCreatorSheet() {
  if (!hasServiceAccount()) return { ok: false, reason: 'No service account' };
  try {
    const token = await getServiceAccountToken();
    const range = encodeURIComponent('Sheet1!A:P');
    const res = await get(`https://sheets.googleapis.com/v4/spreadsheets/${CRAVE_SHEET_ID}/values/${range}`, { Authorization: `Bearer ${token}` });
    if (!res.ok) return { ok: false, reason: `Sheets ${res.status}` };
    const [, ...rows] = res.body.values || [];
    const counts = { total: rows.length, new: 0, approved: 0, queued: 0, opened: 0, replied: 0, bounced: 0 };
    rows.forEach((r) => {
      const status = (r[14] || '').trim().toLowerCase();
      if (status === 'new') counts.new++;
      else if (status === 'approved') counts.approved++;
      else if (status === 'outreach_queued') counts.queued++;
      else if (status === 'opened') counts.opened++;
      else if (status === 'replied') counts.replied++;
      else if (status === 'bounced') counts.bounced++;
    });
    return { ok: true, ...counts };
  } catch (e) { return { ok: false, reason: e.message }; }
}

async function gatherData(range = '7d', forceRefresh = false) {
  const days = RANGE_DAYS[range] || 7;
  const cached = cache[range];
  if (!forceRefresh && cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { ...cached.data, cached: true, cacheAge: Math.round((Date.now() - cached.ts) / 1000) };
  }

  const rangeMs = days * 86400000;
  const [n8nRaw, sheetsRaw, paymentsRaw, draftsRaw, clickupRaw, smartleadRaw, creatorSheetRaw] = await Promise.all([
    fetchN8n(),
    fetchSheets(),
    fetchSlack(PAYMENTS_CHANNEL),
    fetchSlack(DRAFTS_CHANNEL),
    fetchClickUp(),
    fetchSmartleadStats(),
    fetchCreatorSheet(),
  ]);

  const trackerStats = sheetsRaw.ok ? computeTrackerStats(sheetsRaw.rows) : null;
  const n8nStats = n8nRaw.ok ? computeN8nStats(n8nRaw.executions, n8nRaw.workflows, rangeMs) : null;
  const nextFollowUps = sheetsRaw.ok ? computeNextFollowUps(sheetsRaw.rows) : [];
  const aging = sheetsRaw.ok ? computeAgingBuckets(sheetsRaw.rows) : null;
  const donut = sheetsRaw.ok ? computeStatusDonut(sheetsRaw.rows) : null;
  const sparklines = n8nRaw.ok ? computeWorkflowSparklines(n8nRaw.executions, n8nRaw.workflows, Math.min(days, 14)) : [];
  const insense = computeInsenseStats();
  const clickup = clickupRaw.ok ? computeClickUpStats(clickupRaw.tasks) : null;

  const caveats = [];
  if (!n8nRaw.ok) caveats.push(`n8n execution history unavailable: ${n8nRaw.reason}`);
  if (!sheetsRaw.ok) caveats.push(`Invoice tracker unavailable: ${sheetsRaw.reason}`);
  if (!paymentsRaw.ok) caveats.push(`#payments-invoices-updates unavailable: ${paymentsRaw.reason}`);
  if (!draftsRaw.ok) caveats.push(`#ops-command unavailable: ${draftsRaw.reason}`);
  if (!clickupRaw.ok) caveats.push(`ClickUp unavailable: ${clickupRaw.reason}`);

  const data = {
    generatedAt: new Date().toISOString(),
    range, days,
    caveats,
    trackerStats,
    n8nStats,
    nextFollowUps,
    aging,
    donut,
    sparklines,
    insense,
    clickup,
    smartlead: smartleadRaw.ok ? smartleadRaw : null,
    creatorSheet: creatorSheetRaw.ok ? creatorSheetRaw : null,
    invoicesGid: sheetsRaw.gid || 0,
    slackPaymentsCount: paymentsRaw.ok ? paymentsRaw.messages.length : null,
    slackDraftsCount: draftsRaw.ok ? draftsRaw.messages.length : null,
    cached: false,
    cacheAge: 0,
  };

  cache[range] = { data, ts: Date.now() };
  return data;
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

function scorecard(label, value, sub = '') {
  const display = value === null ? '<span class="unavailable">–</span>' : `<strong>${value}</strong>`;
  return `
    <div class="card">
      <div class="card-label">${label}</div>
      <div class="card-value">${display}</div>
      ${sub ? `<div class="card-sub">${sub}</div>` : ''}
    </div>`;
}

function statusDot(ok) {
  return ok ? '<span class="dot dot-ok">●</span>' : '<span class="dot dot-fail">●</span>';
}

function buildSlackSummary(d) {
  const ts = d.trackerStats;
  const n8n = d.n8nStats;
  const aging = d.aging;
  const generated = new Date(d.generatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Manila', hour12: false });
  const rangeLabel = { '24h': 'last 24 hours', '7d': 'last 7 days', '30d': 'last 30 days' }[d.range || '7d'];
  const lines = [];
  lines.push(`*Krave Ops — ${generated} PHT (${rangeLabel})*`, '');
  if (ts) {
    lines.push('*Funnel*');
    lines.push(`• Reminders sent: ${ts.remindersTotal}`);
    lines.push(`• Replies confirmed: ${ts.repliesConfirmed}`);
    lines.push(`• Paid after follow-up: ${ts.paidAfterFollowUp}`);
    lines.push('');
    lines.push('*Current state*');
    lines.push(`• Drafts pending John: ${ts.draftPendingJohn}`);
    lines.push(`• Sent / awaiting payment: ${ts.sentAwaiting}`);
    lines.push(`• Partial payment: ${ts.partialPayment}`);
    lines.push(`• Payment complete: ${ts.paymentComplete}`);
    lines.push(`• Overdue: ${ts.overdue}`);
    lines.push(`• Collections: ${ts.collections}`);
    lines.push('');
  }
  if (aging && aging.total > 0) {
    lines.push('*AR aging*');
    aging.buckets.forEach((b) => { if (b.amount > 0) lines.push(`• ${b.label}: $${Math.round(b.amount).toLocaleString()} (${b.count})`); });
    lines.push('');
  }
  if (ts && ts.actionItems.length) {
    lines.push(`*Action queue (${ts.actionItems.length})*`);
    ts.actionItems.slice(0, 8).forEach((a) => lines.push(`• ${a.invoice} ${a.client} — ${a.action}`));
    if (ts.actionItems.length > 8) lines.push(`• …and ${ts.actionItems.length - 8} more`);
    lines.push('');
  }
  if (n8n) {
    lines.push('*Workflow health*');
    lines.push(`• ${n8n.total} runs · ${n8n.success} success · ${n8n.failed} failed`);
    if (n8n.failedNames.length) lines.push(`• Failed: ${n8n.failedNames.join(', ')}`);
    if (n8n.stale.length) lines.push(`• Quiet: ${n8n.stale.join(', ')}`);
    lines.push('');
  }
  if (d.caveats && d.caveats.length) {
    lines.push('*Caveats*');
    d.caveats.forEach((c) => lines.push(`• ${c}`));
    lines.push('');
  }
  lines.push(`→ Tracker: https://docs.google.com/spreadsheets/d/${SHEET_ID}`);
  return lines.join('\n');
}

function renderFunnelSvg(sent, replies, paid) {
  const items = [
    { label: 'Reminders sent', value: sent, color: '#60a5fa' },
    { label: 'Replies confirmed', value: replies, color: '#fbbf24' },
    { label: 'Paid after follow-up', value: paid, color: '#34d399' },
  ];
  const max = Math.max(sent, replies, paid, 1);
  const w = 600, barH = 36, gap = 16, labelW = 180;
  const h = items.length * (barH + gap);
  let svg = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMinYMin meet" style="width:100%;height:auto;max-width:${w}px;">`;
  items.forEach((it, i) => {
    const y = i * (barH + gap);
    const barW = ((w - labelW - 60) * it.value) / max;
    svg += `<text x="0" y="${y + 22}" fill="#94a3b8" font-size="13">${it.label}</text>`;
    svg += `<rect x="${labelW}" y="${y}" width="${Math.max(2, barW)}" height="${barH}" rx="4" fill="${it.color}" opacity="0.85"/>`;
    svg += `<text x="${labelW + Math.max(2, barW) + 10}" y="${y + 22}" fill="#f1f5f9" font-size="14" font-weight="600">${it.value}</text>`;
  });
  return svg + '</svg>';
}

function renderAgingSvg(aging) {
  if (!aging || aging.total === 0) return '<div class="empty" style="padding:20px">No outstanding amounts</div>';
  const colors = ['#34d399', '#fbbf24', '#fb923c', '#f87171', '#dc2626'];
  const w = 600, barH = 28;
  let svg = `<svg viewBox="0 0 ${w} ${barH + 90}" style="width:100%;height:auto;">`;
  let x = 0;
  aging.buckets.forEach((b, i) => {
    const segW = (b.amount / aging.total) * w;
    if (segW > 0) {
      svg += `<rect x="${x}" y="0" width="${segW}" height="${barH}" fill="${colors[i]}" opacity="0.9"/>`;
      if (segW > 60) svg += `<text x="${x + segW / 2}" y="${barH / 2 + 4}" fill="#0f1117" font-size="12" font-weight="600" text-anchor="middle">$${Math.round(b.amount).toLocaleString()}</text>`;
    }
    x += segW;
  });
  aging.buckets.forEach((b, i) => {
    const col = i % 3;
    const rowI = Math.floor(i / 3);
    const cx = col * (w / 3);
    const cy = barH + 24 + rowI * 22;
    svg += `<rect x="${cx}" y="${cy - 10}" width="10" height="10" fill="${colors[i]}"/>`;
    svg += `<text x="${cx + 16}" y="${cy}" fill="#94a3b8" font-size="11">${b.label}: $${Math.round(b.amount).toLocaleString()} (${b.count})</text>`;
  });
  return svg + '</svg>';
}

function renderDonutSvg(counts) {
  const items = [
    { label: 'Draft', value: counts.Draft, color: '#94a3b8' },
    { label: 'Sent', value: counts.Sent, color: '#60a5fa' },
    { label: 'Partial', value: counts.Partial, color: '#a78bfa' },
    { label: 'Paid', value: counts.Paid, color: '#34d399' },
    { label: 'Overdue', value: counts.Overdue, color: '#fb923c' },
    { label: 'Collections', value: counts.Collections, color: '#dc2626' },
  ];
  const total = items.reduce((s, it) => s + it.value, 0);
  if (total === 0) return '<div class="empty" style="padding:20px">No invoices</div>';
  const cx = 100, cy = 100, r = 80, ri = 50;
  let angle = -Math.PI / 2;
  let svg = `<svg viewBox="0 0 400 200" style="width:100%;max-width:400px;height:auto;">`;
  items.forEach((it) => {
    if (it.value === 0) return;
    const slice = (it.value / total) * Math.PI * 2;
    const a2 = angle + slice;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    const xi1 = cx + ri * Math.cos(angle), yi1 = cy + ri * Math.sin(angle);
    const xi2 = cx + ri * Math.cos(a2), yi2 = cy + ri * Math.sin(a2);
    const large = slice > Math.PI ? 1 : 0;
    svg += `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${ri} ${ri} 0 ${large} 0 ${xi1} ${yi1} Z" fill="${it.color}" opacity="0.9"/>`;
    angle = a2;
  });
  svg += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="#f1f5f9" font-size="22" font-weight="700">${total}</text>`;
  svg += `<text x="${cx}" y="${cy + 14}" text-anchor="middle" fill="#64748b" font-size="11">invoices</text>`;
  let ly = 16;
  items.forEach((it) => {
    if (it.value === 0) return;
    svg += `<rect x="220" y="${ly}" width="10" height="10" fill="${it.color}"/>`;
    svg += `<text x="236" y="${ly + 9}" fill="#cbd5e1" font-size="12">${it.label} (${it.value})</text>`;
    ly += 20;
  });
  return svg + '</svg>';
}

function renderSparklineSvg(runs, fails) {
  const w = 120, h = 32;
  const max = Math.max(...runs, 1);
  const stepX = runs.length > 1 ? w / (runs.length - 1) : 0;
  let svg = `<svg viewBox="0 0 ${w} ${h}" style="width:${w}px;height:${h}px;">`;
  let path = '';
  runs.forEach((v, i) => {
    const x = i * stepX;
    const y = h - (v / max) * (h - 4) - 2;
    path += (i === 0 ? 'M' : 'L') + ` ${x} ${y} `;
  });
  svg += `<path d="${path}" fill="none" stroke="#60a5fa" stroke-width="1.5"/>`;
  fails.forEach((f, i) => {
    if (f === 0) return;
    const x = i * stepX;
    const y = h - (runs[i] / max) * (h - 4) - 2;
    svg += `<circle cx="${x}" cy="${y}" r="2.5" fill="#f87171"/>`;
  });
  return svg + '</svg>';
}

function renderDashboard(d) {
  const ts = d.trackerStats;
  const n8n = d.n8nStats;
  const arStr = ts ? Object.entries(ts.totalAR).map(([c, v]) => `${c} ${v.toLocaleString()}`).join(' · ') || '—' : '—';
  const generatedTime = new Date(d.generatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Manila', hour12: false });
  const cacheNote = d.cached ? `<span class="cache-note">Cached · ${Math.round(d.cacheAge / 60)}m old</span>` : '<span class="cache-note fresh">Live</span>';

  const caveatHtml = d.caveats.length
    ? `<div class="caveats"><strong>Source caveats:</strong><ul>${d.caveats.map((c) => `<li>${c}</li>`).join('')}</ul></div>`
    : '';

  const trackerUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;
  const invoicesGid = d.invoicesGid || 0;
  const invoiceLink = (num, rowIdx) => {
    const target = rowIdx
      ? `${trackerUrl}/edit#gid=${invoicesGid}&range=A${rowIdx}`
      : trackerUrl;
    return `<a class="invoice-link" href="${target}" target="_blank" rel="noopener">${num}</a>`;
  };

  const actionRows = ts && ts.actionItems.length
    ? ts.actionItems.map((a) => `<tr><td>${invoiceLink(a.invoice, a.rowIndex)}</td><td>${a.client}</td><td>${a.action}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty">No action items</td></tr>';

  const followUpRows = d.nextFollowUps.length
    ? d.nextFollowUps.map((f) => `
        <tr class="${f.blocked ? 'blocked-row' : ''}">
          <td>${invoiceLink(f.invoice, f.rowIndex)}</td>
          <td>${f.client}</td>
          <td>${f.daysUntilDue > 0 ? `+${f.daysUntilDue}d` : `${f.daysUntilDue}d`}</td>
          <td>${f.nextFollowUp}</td>
          <td>${f.lateFeeDate}</td>
          <td>${f.owner}</td>
          <td>${f.blocked ? '⚠ Missing email' : f.lastSent || '—'}</td>
        </tr>`).join('')
    : '<tr><td colspan="7" class="empty">No open invoices</td></tr>';

  const failedWfHtml = n8n && n8n.failedNames.length
    ? n8n.failedNames.map((n) => `<li>${n}</li>`).join('')
    : '<li class="empty">None</li>';

  const staleWfHtml = n8n && n8n.stale.length
    ? n8n.stale.map((n) => `<li>${n}</li>`).join('')
    : '<li class="empty">None</li>';

  const sparkRows = (d.sparklines || []).length
    ? d.sparklines.map((wf) => `
        <tr>
          <td>${wf.name}</td>
          <td style="text-align:right">${wf.total}</td>
          <td style="text-align:right;color:${wf.failed ? '#f87171' : '#475569'}">${wf.failed}</td>
          <td>${renderSparklineSvg(wf.runs, wf.fails)}</td>
        </tr>`).join('')
    : '<tr><td colspan="4" class="empty">No executions in range</td></tr>';

  const range = d.range || '7d';
  const rangeLabel = { '24h': 'last 24 hours', '7d': 'last 7 days', '30d': 'last 30 days' }[range];
  const rangeToggle = ['24h', '7d', '30d'].map((r) => {
    const active = r === range ? ' active' : '';
    return `<a class="range-btn${active}" href="?range=${r}">${r}</a>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Krave Ops Dashboard</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #f5f5f7;
    --surface: #ffffff;
    --surface-2: #f5f5f7;
    --surface-3: #e8e8ed;
    --border: rgba(0,0,0,0.08);
    --border-med: rgba(0,0,0,0.14);
    --text: #1d1d1f;
    --text-2: #424245;
    --text-3: #6e6e73;
    --text-4: #aeaeb2;
    --accent: #0071e3;
    --accent-hover: #0077ed;
    --green: #1a8a34;
    --red: #d93025;
    --orange: #b96a00;
    --green-bg: rgba(52,199,89,0.1);
    --red-bg: rgba(255,59,48,0.08);
    --orange-bg: rgba(255,149,0,0.1);
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.07), 0 0 0 0.5px rgba(0,0,0,0.05);
    --shadow-md: 0 4px 18px rgba(0,0,0,0.1), 0 0 0 0.5px rgba(0,0,0,0.06);
    --radius: 12px;
    --radius-sm: 8px;
    --radius-xs: 6px;
    --dur: 200ms;
    --ease: cubic-bezier(0.4,0,0.2,1);
  }
  [data-theme="dark"] {
    --bg: #000000;
    --surface: #1c1c1e;
    --surface-2: #2c2c2e;
    --surface-3: #3a3a3c;
    --border: rgba(255,255,255,0.08);
    --border-med: rgba(255,255,255,0.14);
    --text: #f5f5f7;
    --text-2: #d1d1d6;
    --text-3: #8e8e93;
    --text-4: #48484a;
    --accent: #0a84ff;
    --accent-hover: #409cff;
    --green: #30d158;
    --red: #ff453a;
    --orange: #ff9f0a;
    --green-bg: rgba(48,209,88,0.12);
    --red-bg: rgba(255,69,58,0.12);
    --orange-bg: rgba(255,159,10,0.12);
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.35), 0 0 0 0.5px rgba(255,255,255,0.06);
    --shadow-md: 0 4px 18px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,255,255,0.06);
  }

  html, body { background: var(--bg); min-height: 100vh; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif;
    color: var(--text); font-size: 14px; line-height: 1.5;
    -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
    transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* ── Header ── */
  .header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 40px; height: 52px;
    background: var(--bg); border-bottom: 0.5px solid var(--border-med);
    position: sticky; top: 0; z-index: 100;
    transition: background var(--dur) var(--ease);
  }
  @supports (backdrop-filter: blur(20px)) {
    .header { background: color-mix(in srgb, var(--bg) 80%, transparent); backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px); }
  }
  .header-left { display: flex; align-items: center; gap: 20px; }
  .header h1 { font-size: 15px; font-weight: 600; color: var(--text); letter-spacing: -0.01em; }
  .header-right { display: flex; align-items: center; gap: 10px; }
  .header-meta { font-size: 12px; color: var(--text-3); }

  /* ── Buttons ── */
  .btn {
    background: var(--accent); color: #fff; border: none; padding: 5px 14px;
    border-radius: var(--radius-xs); cursor: pointer; font-size: 13px;
    font-weight: 500; transition: background var(--dur) var(--ease); font-family: inherit;
  }
  .btn:hover { background: var(--accent-hover); }
  .btn-ghost {
    background: var(--surface); color: var(--text-3); border: 0.5px solid var(--border-med);
    padding: 5px 12px; border-radius: var(--radius-xs); cursor: pointer; font-size: 13px;
    font-weight: 500; transition: all var(--dur) var(--ease); font-family: inherit;
    box-shadow: var(--shadow-sm);
  }
  .btn-ghost:hover { color: var(--text); }
  .theme-toggle {
    display: flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; border-radius: 50%;
    background: var(--surface-2); border: 0.5px solid var(--border-med);
    cursor: pointer; font-size: 13px; transition: background var(--dur) var(--ease);
    box-shadow: var(--shadow-sm);
  }
  .theme-toggle:hover { background: var(--surface-3); }
  .tracker-btn {
    background: var(--accent); color: #fff; padding: 5px 14px;
    border-radius: var(--radius-xs); font-size: 13px; font-weight: 500;
    border: none; display: inline-block; text-decoration: none;
    transition: opacity var(--dur) var(--ease);
  }
  .tracker-btn:hover { opacity: 0.85; text-decoration: none; color: #fff; }

  /* ── Cache / status ── */
  .cache-note {
    font-size: 11px; padding: 3px 9px; border-radius: 100px;
    background: var(--surface-2); color: var(--text-3);
    border: 0.5px solid var(--border); white-space: nowrap;
  }
  .cache-note.fresh { color: var(--green); }
  .cache-note.fresh::before {
    content: ''; display: inline-block; width: 5px; height: 5px;
    border-radius: 50%; background: var(--green); margin-right: 5px;
    vertical-align: middle; animation: pulse 1.8s ease-in-out infinite;
  }

  /* ── Range toggle ── */
  .range-toggle { display: inline-flex; border-radius: var(--radius-xs); background: var(--surface-2); padding: 2px; gap: 1px; border: 0.5px solid var(--border); }
  .range-btn {
    font-size: 12px; padding: 4px 11px; color: var(--text-3);
    border-radius: calc(var(--radius-xs) - 2px); background: transparent;
    border: none; cursor: pointer; font-weight: 500; font-family: inherit;
    transition: all var(--dur) var(--ease);
  }
  .range-btn:hover { color: var(--text); text-decoration: none; }
  .range-btn.active { background: var(--surface); color: var(--text); box-shadow: var(--shadow-sm); }

  /* ── Scope line ── */
  .scope-line { font-size: 12px; color: var(--text-3); padding: 9px 40px; border-bottom: 0.5px solid var(--border); }
  .scope-line strong { color: var(--text-2); font-weight: 500; }

  /* ── Forecast strip ── */
  .forecast-strip { display: flex; gap: 10px; padding: 16px 40px; border-bottom: 0.5px solid var(--border); flex-wrap: wrap; }
  .forecast-tile {
    display: flex; align-items: center; gap: 14px; background: var(--surface);
    border: 0.5px solid var(--border); border-radius: var(--radius);
    padding: 14px 20px; min-width: 168px; flex: 1; box-shadow: var(--shadow-sm);
    transition: box-shadow var(--dur) var(--ease);
  }
  .forecast-tile:hover { box-shadow: var(--shadow-md); }
  .forecast-tile.alert { border-color: var(--red); background: var(--red-bg); }
  .forecast-tile.warn { border-color: var(--orange); background: var(--orange-bg); }
  .forecast-tile-icon { font-size: 18px; flex-shrink: 0; opacity: 0.75; }
  .forecast-tile-value { font-size: 28px; font-weight: 700; color: var(--text); line-height: 1; letter-spacing: -0.025em; }
  .forecast-tile-label { font-size: 11px; color: var(--text-3); margin-top: 3px; font-weight: 500; }
  .forecast-tile.alert .forecast-tile-value { color: var(--red); }
  .forecast-tile.warn .forecast-tile-value { color: var(--orange); }

  /* ── Tools hub ── */
  .tools-hub { padding: 12px 40px; border-bottom: 0.5px solid var(--border); }
  .tools-hub-grid { display: flex; gap: 8px; flex-wrap: wrap; }
  .tool-card {
    position: relative; display: flex; flex-direction: column; align-items: center;
    gap: 5px; padding: 10px 14px; background: var(--surface);
    border: 0.5px solid var(--border); border-radius: var(--radius);
    cursor: pointer; min-width: 78px; transition: all var(--dur) var(--ease);
    user-select: none; box-shadow: var(--shadow-sm); text-decoration: none;
  }
  .tool-card:hover { box-shadow: var(--shadow-md); border-color: var(--border-med); transform: translateY(-1px); text-decoration: none; }
  .tool-card .tool-icon { font-size: 17px; line-height: 1; }
  .tool-card .tool-name { font-size: 10px; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.05em; }
  .tool-popup {
    display: none; position: absolute; top: calc(100% + 6px); left: 50%;
    transform: translateX(-50%); background: var(--surface);
    border: 0.5px solid var(--border-med); border-radius: var(--radius);
    padding: 5px; min-width: 155px; z-index: 99; box-shadow: var(--shadow-md);
  }
  .tool-popup.open { display: block; }
  .tool-popup a { display: block; padding: 7px 10px; color: var(--text); text-decoration: none; border-radius: var(--radius-xs); font-size: 13px; }
  .tool-popup a:hover { background: var(--surface-2); text-decoration: none; }
  .tool-popup a.secondary { color: var(--text-3); }

  /* ── Main ── */
  main { padding: 28px 40px; max-width: 1400px; margin: 0 auto; }

  /* ── Sections ── */
  .section { margin-bottom: 36px; opacity: 0; transform: translateY(14px); transition: opacity 480ms ease, transform 480ms cubic-bezier(0.22,1,0.36,1); }
  .section.in-view { opacity: 1; transform: translateY(0); }
  .section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-3); margin-bottom: 14px; }

  /* ── Stat cards ── */
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(158px, 1fr)); gap: 10px; }
  .card {
    background: var(--surface); border-radius: var(--radius); padding: 18px;
    border: 0.5px solid var(--border); box-shadow: var(--shadow-sm);
    transition: box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease), border-color var(--dur) var(--ease);
  }
  .card:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); border-color: var(--border-med); }
  .card-label { font-size: 11px; color: var(--text-3); margin-bottom: 8px; font-weight: 500; }
  .card-value { font-size: 30px; font-weight: 700; color: var(--text); letter-spacing: -0.025em; line-height: 1; }
  .card-sub { font-size: 11px; color: var(--text-4); margin-top: 6px; }
  .unavailable { font-size: 24px; color: var(--text-4); }

  /* ── Tables ── */
  table { width: 100%; border-collapse: collapse; background: var(--surface); border-radius: var(--radius); overflow: hidden; border: 0.5px solid var(--border); box-shadow: var(--shadow-sm); }
  th { text-align: left; padding: 10px 16px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); border-bottom: 0.5px solid var(--border); background: var(--surface-2); }
  td { padding: 11px 16px; border-bottom: 0.5px solid var(--border); font-size: 13px; color: var(--text-2); }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--surface-2); }
  .blocked-row td { color: var(--red); }
  .empty { color: var(--text-4); font-style: italic; }
  td a.invoice-link { color: var(--accent); font-weight: 500; }

  /* ── Status dots ── */
  .dot { font-size: 9px; margin-right: 4px; }
  .dot-ok { color: var(--green); }
  .dot-fail { color: var(--red); }

  /* ── Health row ── */
  .health-row { display: flex; gap: 10px; align-items: flex-start; }
  .health-col { flex: 1; background: var(--surface); border: 0.5px solid var(--border); border-radius: var(--radius); padding: 18px; box-shadow: var(--shadow-sm); }
  .health-col h4 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-3); margin-bottom: 12px; }
  .health-col ul { list-style: none; }
  .health-col li { padding: 5px 0; font-size: 13px; color: var(--text-2); border-bottom: 0.5px solid var(--border); }
  .health-col li:last-child { border-bottom: none; }

  /* ── Chart cards ── */
  .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .chart-row { display: grid; grid-template-columns: 2fr 1fr; gap: 10px; }
  .chart-card { background: var(--surface); border: 0.5px solid var(--border); border-radius: var(--radius); padding: 22px; box-shadow: var(--shadow-sm); transition: box-shadow var(--dur) var(--ease); }
  .chart-card:hover { box-shadow: var(--shadow-md); }
  .chart-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-3); margin-bottom: 16px; }

  /* SVG text adapts to theme via CSS (CSS beats SVG presentational attrs) */
  .chart-card svg text { fill: var(--text-3); }
  .chart-card svg text[font-weight="600"] { fill: var(--text-2); }
  .chart-card svg text[font-weight="700"] { fill: var(--text); }

  /* ── Links section ── */
  .links { display: flex; gap: 8px; flex-wrap: wrap; }
  .links a { font-size: 12px; padding: 6px 14px; border: 0.5px solid var(--border-med); border-radius: 100px; color: var(--text-3); background: var(--surface); box-shadow: var(--shadow-sm); transition: all var(--dur) var(--ease); }
  .links a:hover { border-color: var(--accent); color: var(--accent); text-decoration: none; box-shadow: var(--shadow-md); }

  /* ── Caveats ── */
  .caveats { background: var(--orange-bg); border: 0.5px solid var(--orange); border-radius: var(--radius-sm); padding: 14px 18px; margin-bottom: 24px; }
  .caveats strong { color: var(--orange); font-size: 12px; }
  .caveats ul { margin-top: 6px; padding-left: 18px; }
  .caveats li { font-size: 12px; color: var(--orange); }

  /* ── AI panel ── */
  #ai-fab { position: fixed; bottom: 28px; right: 28px; width: 50px; height: 50px; border-radius: 50%; background: var(--accent); color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 16px rgba(0,113,227,0.45); z-index: 1000; transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease); border: none; }
  #ai-fab:hover { transform: scale(1.06); box-shadow: 0 6px 24px rgba(0,113,227,0.6); }
  #ai-fab.hidden { display: none; }
  #ai-panel { position: fixed; bottom: 28px; right: 28px; width: 380px; height: 520px; background: var(--surface); border: 0.5px solid var(--border-med); border-radius: 18px; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(0,0,0,0.18); z-index: 1000; transform: scale(0.92) translateY(20px); opacity: 0; pointer-events: none; transition: transform 220ms cubic-bezier(0.34,1.56,0.64,1), opacity 180ms ease; }
  [data-theme="dark"] #ai-panel { box-shadow: 0 20px 60px rgba(0,0,0,0.65); }
  #ai-panel.open { transform: scale(1) translateY(0); opacity: 1; pointer-events: all; }
  #ai-panel-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 0.5px solid var(--border); font-size: 14px; font-weight: 600; color: var(--text); flex-shrink: 0; }
  #ai-panel-header span::before { content: ''; display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--green); margin-right: 8px; }
  #ai-close-btn { background: var(--surface-2); border: none; color: var(--text-3); cursor: pointer; font-size: 12px; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
  #ai-close-btn:hover { color: var(--text); background: var(--surface-3); }
  #ai-messages { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  #ai-messages::-webkit-scrollbar { width: 4px; }
  #ai-messages::-webkit-scrollbar-thumb { background: var(--border-med); border-radius: 2px; }
  .ai-msg { max-width: 88%; padding: 10px 14px; border-radius: 14px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .ai-msg-user { background: var(--accent); color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }
  .ai-msg-assistant { background: var(--surface-2); color: var(--text-2); align-self: flex-start; border-bottom-left-radius: 4px; border: 0.5px solid var(--border); }
  #ai-input-area { display: flex; flex-direction: column; border-top: 0.5px solid var(--border); flex-shrink: 0; }
  #ai-file-badge { display: none; align-items: center; gap: 6px; padding: 6px 14px 0; font-size: 11px; color: var(--text-3); }
  #ai-file-badge.visible { display: flex; }
  #ai-file-badge-name { background: var(--surface-3); border: 0.5px solid var(--border-med); border-radius: 6px; padding: 2px 8px; color: var(--text-2); font-size: 11px; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #ai-file-clear { background: none; border: none; color: var(--text-4); cursor: pointer; font-size: 12px; padding: 0 2px; line-height: 1; }
  #ai-file-clear:hover { color: var(--text); }
  #ai-input-row { display: flex; gap: 8px; padding: 10px 14px 12px; }
  #ai-attach-btn { background: var(--surface-2); border: 0.5px solid var(--border-med); color: var(--text-3); border-radius: 50%; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; transition: background var(--dur) var(--ease), color var(--dur) var(--ease); }
  #ai-attach-btn:hover { background: var(--surface-3); color: var(--text); }
  #ai-attach-btn.has-file { background: var(--accent); color: #fff; border-color: var(--accent); }
  #ai-file-input { display: none; }
  #ai-input { flex: 1; background: var(--surface-2); border: 0.5px solid var(--border-med); border-radius: 20px; color: var(--text); font-size: 13px; padding: 9px 14px; outline: none; transition: border-color var(--dur) var(--ease); font-family: inherit; }
  #ai-input:focus { border-color: var(--accent); }
  #ai-input::placeholder { color: var(--text-4); }
  #ai-send-btn { background: var(--accent); color: #fff; border: none; border-radius: 20px; padding: 9px 16px; font-size: 13px; font-weight: 500; cursor: pointer; transition: opacity var(--dur) var(--ease); font-family: inherit; flex-shrink: 0; }
  #ai-send-btn:hover { opacity: 0.85; }
  #ai-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  #ai-quick-actions { display: flex; gap: 6px; padding: 8px 14px 0; flex-wrap: wrap; }
  .ai-quick-btn { background: var(--surface-2); border: 0.5px solid var(--border-med); color: var(--text-3); border-radius: 100px; padding: 4px 11px; font-size: 11px; font-weight: 500; cursor: pointer; white-space: nowrap; transition: all var(--dur) var(--ease); font-family: inherit; }
  .ai-quick-btn:hover { background: var(--accent); color: #fff; border-color: var(--accent); }

  /* ── Animations ── */
  @keyframes pulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.5; transform:scale(1.4); } }
  @keyframes countIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
  @keyframes barGrow { from { transform:scaleX(0); } to { transform:scaleX(1); } }
  .card-value strong { display:inline-block; animation:countIn 400ms ease 150ms both; }
  .section svg rect { transform-origin:left center; transform:scaleX(0); }
  .section.in-view svg rect { animation:barGrow 600ms cubic-bezier(0.22,1,0.36,1) 100ms both; }
  .section svg path { opacity:0; }
  .section.in-view svg path { animation:countIn 500ms ease 200ms both; }
  .section svg circle { opacity:0; }
  .section.in-view svg circle { animation:countIn 500ms ease 450ms both; }
  .section svg text { opacity:0; }
  .section.in-view svg text { animation:countIn 400ms ease 350ms both; }

  /* ── Responsive ── */
  @media (max-width: 768px) {
    .header { padding: 0 20px; }
    main { padding: 20px; }
    .forecast-strip, .tools-hub, .scope-line { padding-left: 20px; padding-right: 20px; }
    .cards { grid-template-columns: 1fr 1fr; }
    .health-row { flex-direction: column; }
    .stat-grid { grid-template-columns: 1fr; }
    .chart-row { grid-template-columns: 1fr; }
    #ai-panel { width: calc(100vw - 32px); right: 16px; bottom: 16px; }
    #ai-fab { right: 16px; bottom: 16px; }
  }
</style>
</head>
<body data-theme="dark">
<div class="header">
  <div class="header-left">
    <h1>Krave Ops</h1>
    <span class="range-toggle">${rangeToggle}</span>
  </div>
  <div class="header-right">
    <span class="header-meta">${generatedTime} PHT</span>
    ${cacheNote}
    <button class="theme-toggle" id="theme-toggle-btn" title="Toggle light/dark mode" onclick="toggleTheme()">☀</button>
    <form method="get" style="display:inline;margin:0">
      <input type="hidden" name="range" value="${range}">
      <button class="btn-ghost" name="refresh" value="1" type="submit">↻</button>
    </form>
  </div>
</div>

<div class="tools-hub">
  <div class="tools-hub-grid">
    <div class="tool-card" onclick="toggleToolPopup('slack-popup')">
      <span class="tool-icon">💬</span>
      <span class="tool-name">Slack</span>
      <div class="tool-popup" id="slack-popup">
        <a href="slack://open?team=T06U38A4NV6">Open app</a>
        <a href="https://app.slack.com/client/T06U38A4NV6" target="_blank" rel="noopener" class="secondary">Open web</a>
      </div>
    </div>
    <div class="tool-card" onclick="toggleToolPopup('clickup-popup')">
      <span class="tool-icon">✅</span>
      <span class="tool-name">ClickUp</span>
      <div class="tool-popup" id="clickup-popup">
        <a href="clickup://open?team=9018123501">Open app</a>
        <a href="https://app.clickup.com/9018123501/v/l/8crb97d-378" target="_blank" rel="noopener" class="secondary">Open web</a>
      </div>
    </div>
    <a class="tool-card" href="https://docs.google.com/spreadsheets/d/${SHEET_ID}" target="_blank" rel="noopener" style="text-decoration:none">
      <span class="tool-icon">📊</span>
      <span class="tool-name">Invoices</span>
    </a>
    <a class="tool-card" href="https://docs.google.com/spreadsheets/d/${CRAVE_SHEET_ID}" target="_blank" rel="noopener" style="text-decoration:none">
      <span class="tool-icon">🎯</span>
      <span class="tool-name">Outreach</span>
    </a>
    <a class="tool-card" href="https://noatakhel.app.n8n.cloud" target="_blank" rel="noopener" style="text-decoration:none">
      <span class="tool-icon">⚙️</span>
      <span class="tool-name">n8n</span>
    </a>
    <a class="tool-card" href="https://www.airwallex.com" target="_blank" rel="noopener" style="text-decoration:none">
      <span class="tool-icon">💳</span>
      <span class="tool-name">Airwallex</span>
    </a>
    <div class="tool-card" onclick="runTriage(this)">
      <span class="tool-icon">📥</span>
      <span class="tool-name">Triage</span>
    </div>
    <a class="tool-card" href="https://mail.google.com" target="_blank" rel="noopener" style="text-decoration:none">
      <span class="tool-icon">📧</span>
      <span class="tool-name">Gmail</span>
    </a>
    <a class="tool-card" href="https://app.insense.pro/dashboard" target="_blank" rel="noopener" style="text-decoration:none">
      <span class="tool-icon">🎬</span>
      <span class="tool-name">Insense</span>
    </a>
  </div>
</div>

<div class="scope-line">
  <strong>Snapshot</strong> &nbsp;·&nbsp; invoice state at ${generatedTime} PHT &nbsp;&nbsp;
  <strong>Range</strong> &nbsp;·&nbsp; workflow stats over the ${rangeLabel}
</div>

<div class="forecast-strip">
  ${(() => {
    const dueToday = ts ? ts.dueToday : null;
    const overdue = ts ? ts.overdue : null;
    const drafts = ts ? ts.draftPendingJohn : null;
    const n8nFailed = d.n8nStats ? d.n8nStats.failed : null;
    const fmt = (v) => v === null ? '—' : v;
    const dueTodayClass = dueToday > 0 ? 'warn' : 'ok';
    const overdueClass = overdue > 0 ? 'alert' : 'ok';
    const draftsClass = drafts > 0 ? 'warn' : 'ok';
    const n8nClass = n8nFailed > 0 ? 'alert' : 'ok';
    return `
      <div class="forecast-tile ${dueTodayClass}">
        <div class="forecast-tile-icon">📅</div>
        <div class="forecast-tile-body">
          <div class="forecast-tile-value">${fmt(dueToday)}</div>
          <div class="forecast-tile-label">Due Today</div>
        </div>
      </div>
      <div class="forecast-tile ${overdueClass}">
        <div class="forecast-tile-icon">🔴</div>
        <div class="forecast-tile-body">
          <div class="forecast-tile-value">${fmt(overdue)}</div>
          <div class="forecast-tile-label">Overdue</div>
        </div>
      </div>
      <div class="forecast-tile ${draftsClass}">
        <div class="forecast-tile-icon">✏️</div>
        <div class="forecast-tile-body">
          <div class="forecast-tile-value">${fmt(drafts)}</div>
          <div class="forecast-tile-label">Drafts Pending</div>
        </div>
      </div>
      <div class="forecast-tile ${n8nClass}">
        <div class="forecast-tile-icon">⚡</div>
        <div class="forecast-tile-body">
          <div class="forecast-tile-value">${fmt(n8nFailed)}</div>
          <div class="forecast-tile-label">n8n Failures (${rangeLabel})</div>
        </div>
      </div>
    `;
  })()}
</div>

<main>
  ${caveatHtml}

  <div class="section">
    <div class="chart-row">
      <div class="chart-card">
        <div class="chart-title">Reminder → Reply → Payment funnel (lifetime)</div>
        ${ts ? renderFunnelSvg(ts.remindersTotal, ts.repliesConfirmed, ts.paidAfterFollowUp) : '<div class="empty">Tracker unavailable</div>'}
      </div>
      <div class="chart-card">
        <div class="chart-title">Invoice status breakdown (current)</div>
        ${d.donut ? renderDonutSvg(d.donut) : '<div class="empty">Tracker unavailable</div>'}
      </div>
    </div>
  </div>

  <div class="section">
    <div class="chart-card">
      <div class="chart-title">AR aging — outstanding amounts by overdue bucket</div>
      ${renderAgingSvg(d.aging)}
    </div>
  </div>

  <div class="section">
    <div class="section-title">At a Glance — current state &amp; ${rangeLabel}</div>
    <div class="cards">
      ${scorecard('Drafts Pending', ts ? ts.draftPendingJohn : null, 'Awaiting John')}
      ${scorecard('Sent / Awaiting', ts ? ts.sentAwaiting : null, arStr)}
      ${scorecard('Reminders Sent', ts ? ts.remindersTotal : null)}
      ${scorecard('Replies Confirmed', ts ? ts.repliesConfirmed : null, 'John inbox only')}
      ${scorecard('Paid After Follow-Up', ts ? ts.paidAfterFollowUp : null, '14-day window')}
      ${scorecard('Payment Complete', ts ? ts.paymentComplete : null)}
      ${scorecard('Overdue', ts ? ts.overdue : null)}
      ${scorecard('Collections', ts ? ts.collections : null)}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Next Follow-Ups Queue</div>
    <table>
      <thead><tr>
        <th>Invoice</th><th>Client</th><th>Days to Due</th>
        <th>Next Follow-Up</th><th>Late Fee Date</th><th>Owner</th><th>Last Sent / Note</th>
      </tr></thead>
      <tbody>${followUpRows}</tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Workflow Health</div>
    <div class="health-row">
      <div class="health-col">
        <h4>Executions (WTD)</h4>
        ${n8n ? `
          <div style="margin-bottom:10px">
            ${statusDot(n8n.failed === 0)} ${n8n.total} total &nbsp;·&nbsp; ${n8n.success} ok &nbsp;·&nbsp; ${n8n.failed} failed
          </div>` : '<div class="empty" style="font-size:12px">Unavailable</div>'}
      </div>
      <div class="health-col">
        <h4>Failed Workflows</h4>
        <ul>${failedWfHtml}</ul>
      </div>
      <div class="health-col">
        <h4>Stale (Active, No Runs)</h4>
        <ul>${staleWfHtml}</ul>
      </div>
    </div>
  </div>

  ${d.insense ? `
  <div class="section">
    <div class="section-title">Creator Outreach — Insense</div>
    <div class="cards">
      ${scorecard('Sent (last 24h)', d.insense.sentLast24h)}
      ${scorecard('Sent (last 7d)', d.insense.sentLast7d)}
      ${scorecard('Messaged (lifetime)', d.insense.messaged)}
      ${scorecard('Tracked creators', d.insense.totalCreators, `${d.insense.blocked} blocked · ${d.insense.triagedFailed} failed filter`)}
    </div>
    ${d.insense.topCampaigns && d.insense.topCampaigns.length ? `
    <div class="stat-grid" style="margin-top:14px">
      <table>
        <thead><tr><th>Campaign</th><th style="text-align:right">Messaged</th><th style="text-align:right">Blocked</th><th style="text-align:right">Failed filter</th></tr></thead>
        <tbody>
          ${d.insense.topCampaigns.map(c => `
            <tr>
              <td>${c.name}</td>
              <td style="text-align:right">${c.messaged}</td>
              <td style="text-align:right">${c.blocked}</td>
              <td style="text-align:right">${c.failed}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}
    ${d.insense.lastMessagedAt ? `<div class="card-sub" style="margin-top:8px">Last invite sent: ${new Date(d.insense.lastMessagedAt).toLocaleString('en-GB', { timeZone: 'Asia/Manila', hour12: false })} PHT</div>` : ''}
  </div>` : ''}

  ${(d.smartlead || d.creatorSheet) ? `
  <div class="section">
    <div class="section-title">TikTok UGC Outreach — Crave</div>
    <div class="cards">
      ${d.creatorSheet ? scorecard('Total Scraped', d.creatorSheet.total) : ''}
      ${d.creatorSheet ? scorecard('Approved', d.creatorSheet.approved, 'Pending push') : ''}
      ${d.creatorSheet ? scorecard('Queued', d.creatorSheet.queued, 'Sent to Smartlead') : ''}
      ${d.creatorSheet ? scorecard('Replied', d.creatorSheet.replied) : ''}
      ${d.creatorSheet ? scorecard('Bounced', d.creatorSheet.bounced) : ''}
    </div>
    ${d.smartlead ? `
    <div class="cards" style="margin-top:12px">
      ${scorecard('Emails Sent', d.smartlead.sent)}
      ${scorecard('Open Rate', d.smartlead.openRate, d.smartlead.warn ? '⚠ Below 20%' : 'Healthy')}
      ${scorecard('Reply Rate', d.smartlead.replyRate)}
      ${scorecard('Bounce Rate', d.smartlead.bounceRate)}
    </div>` : ''}
    <div class="card-sub" style="margin-top:8px">
      <a href="https://docs.google.com/spreadsheets/d/${CRAVE_SHEET_ID}" target="_blank" rel="noopener">Creator Sheet</a>
      &nbsp;·&nbsp;
      <a href="https://app.smartlead.ai/app/email-campaigns/${SMARTLEAD_CAMPAIGN_ID}" target="_blank" rel="noopener">Smartlead Campaign</a>
    </div>
  </div>` : ''}

  ${d.clickup ? (() => {
    const cu = d.clickup;
    const assignees = Object.entries(cu.byAssignee).sort((a, b) => b[1] - a[1]);
    const maxCount = assignees.length ? assignees[0][1] : 1;
    const barColors = ['#7dd3fc','#6ee7b7','#fbbf24','#f472b6','#a78bfa','#fb923c'];
    const assigneeBars = assignees.map(([name, n], i) => {
      const pct = Math.round((n / maxCount) * 100);
      const color = barColors[i % barColors.length];
      return `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <div style="width:110px;font-size:12px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</div>
          <div style="flex:1;background:var(--surface-2);border-radius:4px;height:8px;overflow:hidden">
            <div style="width:${pct}%;height:100%;background:${color};border-radius:4px;transition:width 0.6s ease"></div>
          </div>
          <div style="width:20px;text-align:right;font-size:12px;font-weight:600;color:${color}">${n}</div>
        </div>`;
    }).join('');
    const projectRows = cu.activeProjects.map(p => `
      <tr>
        <td><a href="${p.url}" target="_blank" rel="noopener">${p.name}</a></td>
        <td style="text-transform:capitalize">${p.status}</td>
        <td>${p.assignee}</td>
        <td>${p.service}</td>
      </tr>`).join('');
    return `
  <div class="section">
    <div class="section-title">UGC Projects — ClickUp <a href="https://app.clickup.com/9018123501/v/l/8crb97d-378" target="_blank" rel="noopener" style="font-size:11px;margin-left:8px;text-decoration:none">↗ Open</a></div>

    <div style="background:var(--surface);border:0.5px solid var(--border);border-radius:var(--radius);padding:20px 24px;margin-bottom:20px;display:inline-flex;align-items:center;gap:16px;box-shadow:var(--shadow-sm)">
      <div style="font-size:42px;font-weight:700;color:var(--text);line-height:1;letter-spacing:-0.025em">${cu.totalActive}</div>
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text-2)">Active Projects</div>
        <div style="font-size:11px;color:var(--text-3);margin-top:2px">UGC list · live from ClickUp</div>
      </div>
    </div>

    <div style="margin-bottom:20px">
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-3);margin-bottom:12px">By Assignee</div>
      <div style="max-width:480px">${assigneeBars}</div>
    </div>

    ${projectRows ? `
    <div>
      <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-3);margin-bottom:12px">Active Projects — Most Recent 10</div>
      <table>
        <thead><tr><th>Project</th><th>Status</th><th>Assignee</th><th>Service</th></tr></thead>
        <tbody>${projectRows}</tbody>
      </table>
    </div>` : ''}
  </div>`;
  })() : ''}

  <div class="section">
    <div class="section-title">Workflow runs — last ${Math.min(d.days || 7, 14)} days</div>
    <table>
      <thead><tr><th>Workflow</th><th style="text-align:right">Runs</th><th style="text-align:right">Failed</th><th>Trend (red dot = failure)</th></tr></thead>
      <tbody>${sparkRows}</tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Action Queue</div>
    <table>
      <thead><tr><th>Invoice</th><th>Client</th><th>Action Required</th></tr></thead>
      <tbody>${actionRows}</tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Tracker Status Breakdown</div>
    <div class="stat-grid">
      <table>
        <thead><tr><th>Status</th><th>Count</th></tr></thead>
        <tbody>
          <tr><td>Draft (Pending John)</td><td>${ts ? ts.draftPendingJohn : '—'}</td></tr>
          <tr><td>Sent / Awaiting Payment</td><td>${ts ? ts.sentAwaiting : '—'}</td></tr>
          <tr><td>Partial Payment</td><td>${ts ? ts.partialPayment : '—'}</td></tr>
          <tr><td>Payment Complete</td><td>${ts ? ts.paymentComplete : '—'}</td></tr>
          <tr><td>Overdue</td><td>${ts ? ts.overdue : '—'}</td></tr>
          <tr><td>Collections</td><td>${ts ? ts.collections : '—'}</td></tr>
        </tbody>
      </table>
      <table>
        <thead><tr><th>Data Quality</th><th>Count</th></tr></thead>
        <tbody>
          <tr><td>Missing Client Email</td><td>${ts ? ts.missingEmail : '—'}</td></tr>
          <tr><td>Missing Invoice URL</td><td>${ts ? ts.missingInvoiceUrl : '—'}</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Source Links</div>
    <div class="links">
      <a href="https://docs.google.com/spreadsheets/d/${SHEET_ID}" target="_blank">📊 Invoice Tracker</a>
      <a href="${N8N_BASE}/workflows" target="_blank">⚙️ n8n Workflows</a>
      <a href="https://slack.com/app_redirect?channel=${PAYMENTS_CHANNEL}" target="_blank">💬 #payments-invoices-updates</a>
      <a href="https://slack.com/app_redirect?channel=${DRAFTS_CHANNEL}" target="_blank">💬 #ops-command</a>
    </div>
  </div>
</main>

<!-- AI Assistant floating panel -->
<div id="ai-fab" onclick="toggleAiPanel()" title="Ask AI">
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
</div>

<div id="ai-panel">
  <div id="ai-panel-header">
    <span>Krave AI</span>
    <button onclick="toggleAiPanel()" id="ai-close-btn">✕</button>
  </div>
  <div id="ai-messages"></div>
  <div id="ai-input-area">
    <div id="ai-quick-actions">
      <button class="ai-quick-btn" id="scan-email-btn" onclick="triggerEmailScan()">Scan Email</button>
    </div>
    <div id="ai-file-badge">
      <span>📎</span>
      <span id="ai-file-badge-name"></span>
      <button id="ai-file-clear" onclick="aiClearFile()" title="Remove file">✕</button>
    </div>
    <div id="ai-input-row">
      <input id="ai-file-input" type="file" accept=".pdf,image/*" onchange="aiFileSelected(this)" />
      <button id="ai-attach-btn" onclick="document.getElementById('ai-file-input').click()" title="Attach PDF or image">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
      </button>
      <input id="ai-input" type="text" placeholder="Ask anything..." autocomplete="off" />
      <button id="ai-send-btn" onclick="aiSend()">Send</button>
    </div>
  </div>
</div>

<script>
(function () {
  // Theme toggle
  const THEME_KEY = 'krave-dash-theme';
  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.textContent = theme === 'dark' ? '☀' : '◗';
  }
  window.toggleTheme = function() {
    const current = document.body.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  };
  applyTheme(localStorage.getItem(THEME_KEY) || 'dark');

  // Tools Hub popup toggle
  window.toggleToolPopup = function(id) {
    const popup = document.getElementById(id);
    if (!popup) return;
    const isOpen = popup.classList.contains('open');
    document.querySelectorAll('.tool-popup.open').forEach(p => p.classList.remove('open'));
    if (!isOpen) popup.classList.add('open');
  };
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.tool-card')) {
      document.querySelectorAll('.tool-popup.open').forEach(p => p.classList.remove('open'));
    }
  });

  // Inbox triage trigger
  window.runTriage = async function(card) {
    const icon = card.querySelector('.tool-icon');
    const name = card.querySelector('.tool-name');
    const origIcon = icon.textContent;
    icon.textContent = '⏳';
    name.textContent = 'Running…';
    card.style.pointerEvents = 'none';
    try {
      const res = await fetch('/api/run-triage', { method: 'POST' });
      if (res.ok) {
        icon.textContent = '✅';
        name.textContent = 'Triggered';
        setTimeout(() => { icon.textContent = origIcon; name.textContent = 'Triage'; card.style.pointerEvents = ''; }, 4000);
      } else {
        icon.textContent = '❌';
        name.textContent = 'Failed';
        setTimeout(() => { icon.textContent = origIcon; name.textContent = 'Triage'; card.style.pointerEvents = ''; }, 4000);
      }
    } catch {
      icon.textContent = '❌';
      name.textContent = 'Error';
      setTimeout(() => { icon.textContent = origIcon; name.textContent = 'Triage'; card.style.pointerEvents = ''; }, 4000);
    }
  };


  // Scroll-triggered section reveal
  const sections = document.querySelectorAll('.section');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in-view');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    sections.forEach((s) => io.observe(s));
  } else {
    sections.forEach((s) => s.classList.add('in-view'));
  }

  // Auto-refresh every 5 minutes (matches server cache TTL).
  // Preserves the current ?range= selection. Does not refresh if the user
  // has an unsaved form interaction in progress (focus inside a form element).
  (function autoRefresh() {
    const INTERVAL_MS = 5 * 60 * 1000;
    setTimeout(function tick() {
      if (document.activeElement && document.activeElement.closest('form')) {
        setTimeout(tick, 30000);
        return;
      }
      if (document.getElementById('ai-panel') && document.getElementById('ai-panel').classList.contains('open')) {
        setTimeout(tick, 30000);
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.delete('refresh');
      window.location.replace(url.toString());
    }, INTERVAL_MS);
  })();

  // AI Assistant panel
  const AI_ENDPOINT = 'https://krave-ai.onrender.com/api/chat';
  const aiSessionKey = 'dash-' + Math.random().toString(36).slice(2, 9);
  let aiOpen = false;
  let aiPendingFile = null; // { name, mimetype, data_base64 }

  window.toggleAiPanel = function() {
    aiOpen = !aiOpen;
    const panel = document.getElementById('ai-panel');
    const fab = document.getElementById('ai-fab');
    panel.classList.toggle('open', aiOpen);
    fab.classList.toggle('hidden', aiOpen);
    if (aiOpen) {
      document.getElementById('ai-input').focus();
      if (document.getElementById('ai-messages').children.length === 0) {
        appendMsg('assistant', "Hey — what do you need?");
      }
    }
  };

  window.aiFileSelected = function(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      const b64 = e.target.result.split(',')[1];
      aiPendingFile = { name: file.name, mimetype: file.type, data_base64: b64 };
      document.getElementById('ai-file-badge-name').textContent = file.name;
      document.getElementById('ai-file-badge').classList.add('visible');
      document.getElementById('ai-attach-btn').classList.add('has-file');
    };
    reader.readAsDataURL(file);
  };

  window.aiClearFile = function() {
    aiPendingFile = null;
    document.getElementById('ai-file-input').value = '';
    document.getElementById('ai-file-badge').classList.remove('visible');
    document.getElementById('ai-attach-btn').classList.remove('has-file');
  };

  window.aiSend = async function() {
    const input = document.getElementById('ai-input');
    const msg = input.value.trim();
    if (!msg && !aiPendingFile) return;
    const displayMsg = msg + (aiPendingFile ? '\\n📎 ' + aiPendingFile.name : '');
    input.value = '';
    appendMsg('user', displayMsg);
    const thinking = appendMsg('assistant', '…');
    const sendBtn = document.getElementById('ai-send-btn');
    sendBtn.disabled = true;
    input.disabled = true;
    const payload = { message: msg || '(see attached file)', session_key: aiSessionKey };
    if (aiPendingFile) payload.files = [aiPendingFile];
    aiClearFile();
    try {
      const res = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.reply) {
        thinking.textContent = data.reply;
      } else if (data.error) {
        const err = String(data.error);
        if (err.includes('429') || err.includes('rate_limit')) {
          thinking.textContent = 'Rate limit hit — too many requests this minute. Wait 30 seconds and try again.';
        } else if (err.includes('529') || err.includes('overloaded')) {
          thinking.textContent = 'Claude is overloaded right now. Try again in a few seconds.';
        } else {
          thinking.textContent = 'Something went wrong. Try again.';
        }
      } else {
        thinking.textContent = '(no response)';
      }
    } catch (e) {
      thinking.textContent = 'Could not reach the AI — check that krave-bot is running.';
    } finally {
      sendBtn.disabled = false;
      input.disabled = false;
      input.focus();
    }
  };

  window.triggerEmailScan = async function() {
    const btn = document.getElementById('scan-email-btn');
    const orig = btn.textContent;
    btn.textContent = 'Triggering…';
    btn.disabled = true;
    try {
      const res = await fetch('/api/run-email-scan', { method: 'POST' });
      if (res.ok) {
        btn.textContent = 'Triggered ✓';
        if (!aiOpen) toggleAiPanel();
        appendMsg('assistant', 'Email scan triggered — scanning john@kravemedia.co for unread invoice PDFs. Any bills found will be staged in Airwallex and logged to the tracker within a few minutes.');
      } else {
        btn.textContent = 'Failed';
        if (!aiOpen) toggleAiPanel();
        appendMsg('assistant', 'Email scan failed to trigger — n8n may be unreachable. Try again or check the n8n dashboard.');
      }
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 4000);
    } catch (e) {
      btn.textContent = 'Error';
      if (!aiOpen) toggleAiPanel();
      appendMsg('assistant', 'Could not reach the email scan webhook. Check your connection.');
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
    }
  };

  window.aiQuickSend = function(message) {
    const input = document.getElementById('ai-input');
    input.value = message;
    window.aiSend();
  };

  document.getElementById('ai-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.aiSend(); }
  });

  function appendMsg(role, text) {
    const msgs = document.getElementById('ai-messages');
    const el = document.createElement('div');
    el.className = 'ai-msg ai-msg-' + role;
    el.textContent = text;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
  }

})();
</script>

</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Auth — Google OAuth + signed cookie session, no external deps
// ---------------------------------------------------------------------------

const SESSION_COOKIE = 'kos_sess';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const AUTH_DISABLED = process.env.DISABLE_AUTH === '1';

function baseUrl(req) {
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL;
  if (process.env.BASE_URL) return process.env.BASE_URL;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function sign(value) {
  const secret = process.env.SESSION_SECRET || 'dev-only-not-for-prod';
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function makeSessionCookie(email) {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${email}|${exp}`;
  const token = `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}

function readSession(req) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!match) return null;
  const token = match.slice(SESSION_COOKIE.length + 1);
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  let payload;
  try { payload = Buffer.from(b64, 'base64url').toString('utf8'); } catch { return null; }
  if (sign(payload) !== sig) return null;
  const [email, expStr] = payload.split('|');
  const exp = parseInt(expStr, 10);
  if (!email || !exp || Date.now() > exp) return null;
  if (!ALLOWLIST.has(email.toLowerCase())) return null;
  return { email, exp };
}

function redirect(res, location, setCookie) {
  const headers = { Location: location };
  if (setCookie) headers['Set-Cookie'] = setCookie;
  res.writeHead(302, headers);
  res.end();
}

function htmlResponse(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

async function handleAuthLogin(req, res) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) return htmlResponse(res, 500, 'GOOGLE_OAUTH_CLIENT_ID not set');
  const url = new URL(req.url, baseUrl(req));
  const next = url.searchParams.get('next') || '/';
  const state = `${crypto.randomBytes(16).toString('hex')}|${Buffer.from(next).toString('base64url')}`;
  const stateCookie = `kos_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${baseUrl(req)}/auth/callback`,
    response_type: 'code',
    scope: 'openid email',
    state,
    prompt: 'select_account',
  });
  redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${params}`, stateCookie);
}

async function handleAuthCallback(req, res) {
  const url = new URL(req.url, baseUrl(req));
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieHeader = req.headers.cookie || '';
  const stateCookie = cookieHeader.split(';').map((c) => c.trim()).find((c) => c.startsWith('kos_state='));
  if (!code || !state || !stateCookie || stateCookie.slice(10) !== state) {
    return htmlResponse(res, 400, 'Invalid auth state. <a href="/auth/login">Try again</a>');
  }

  const tokenRes = await post('https://oauth2.googleapis.com/token', new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirect_uri: `${baseUrl(req)}/auth/callback`,
    grant_type: 'authorization_code',
  }).toString(), { 'Content-Type': 'application/x-www-form-urlencoded' });

  if (!tokenRes.ok || !tokenRes.body.id_token) {
    return htmlResponse(res, 502, 'Token exchange failed.');
  }
  const idPayload = JSON.parse(Buffer.from(tokenRes.body.id_token.split('.')[1], 'base64url').toString('utf8'));
  const email = (idPayload.email || '').toLowerCase();
  if (!email || !ALLOWLIST.has(email)) {
    return htmlResponse(res, 403, `<p>Access denied for <code>${email || 'unknown'}</code>.</p><p>This dashboard is restricted to the Krave team. <a href="/auth/login">Try a different account</a>.</p>`);
  }

  const next = state.split('|')[1] ? Buffer.from(state.split('|')[1], 'base64url').toString('utf8') : '/';
  redirect(res, next, makeSessionCookie(email));
}

function handleAuthLogout(_req, res) {
  res.writeHead(302, {
    Location: '/auth/login',
    'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  });
  res.end();
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }

  if (req.url.startsWith('/auth/login')) return handleAuthLogin(req, res);
  if (req.url.startsWith('/auth/callback')) return handleAuthCallback(req, res);
  if (req.url.startsWith('/auth/logout')) return handleAuthLogout(req, res);
  if (req.method === 'POST' && req.url === '/api/run-triage') return handleRunTriage(req, res);
  if (req.method === 'POST' && req.url === '/api/run-email-scan') return handleRunEmailScan(req, res);
  if (req.method === 'POST' && req.url === '/api/send-invoice-email') return handleSendInvoiceEmail(req, res);

  if (!AUTH_DISABLED) {
    const session = readSession(req);
    if (!session) {
      const next = encodeURIComponent(req.url || '/');
      return redirect(res, `/auth/login?next=${next}`);
    }
  }

  const url = new URL(req.url, baseUrl(req));
  const forceRefresh = url.searchParams.get('refresh') === '1';
  const range = RANGE_DAYS[url.searchParams.get('range')] ? url.searchParams.get('range') : '7d';
  try {
    const data = await gatherData(range, forceRefresh);
    const html = renderDashboard(data);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Dashboard error: ${e.message}`);
  }
});

const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`Krave Ops Dashboard → http://${HOST}:${PORT}`);
  console.log(`Env: N8N_API_KEY=${process.env.N8N_API_KEY ? 'set' : 'MISSING'} | GoogleSA=${hasServiceAccount() ? 'set' : 'MISSING'} | SLACK_BOT_TOKEN=${process.env.SLACK_BOT_TOKEN ? 'set' : 'MISSING'} | OAUTH=${process.env.GOOGLE_OAUTH_CLIENT_ID ? 'set' : 'MISSING'} | AUTH=${AUTH_DISABLED ? 'DISABLED' : 'enabled'}`);
});
