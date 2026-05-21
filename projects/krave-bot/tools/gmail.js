'use strict';

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Service account JWT + Gmail REST API (no googleapis dep needed)
// ---------------------------------------------------------------------------

let _tokenCache = { noa: null, john: null };

function loadServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
  if (raw) return JSON.parse(raw);
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  throw new Error('Google service account not configured');
}

async function getToken(impersonate) {
  const key = impersonate.includes('noa') ? 'noa' : 'john';
  const cached = _tokenCache[key];
  if (cached && Date.now() < cached.exp - 60000) return cached.token;

  const sa = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    sub: impersonate,
    scope: 'https://www.googleapis.com/auth/gmail.modify',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sigInput = `${header}.${body}`;
  const sig = crypto.createSign('RSA-SHA256').update(sigInput).sign(sa.private_key, 'base64url');
  const jwt = `${sigInput}.${sig}`;

  const res = await gmailPost('https://oauth2.googleapis.com/token',
    `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    { 'Content-Type': 'application/x-www-form-urlencoded' });
  _tokenCache[key] = { token: res.access_token, exp: now + res.expires_in };
  return res.access_token;
}

function gmailGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({ error: body }); } });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

function gmailPost(url, data, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const buf = Buffer.from(data);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: { 'Content-Length': buf.length, ...extraHeaders },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({ error: body }); } });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

function decodeBase64(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function extractText(parts) {
  if (!parts) return '';
  let text = '';
  for (const p of parts) {
    if (p.mimeType === 'text/plain' && p.body && p.body.data) text += decodeBase64(p.body.data) + '\n';
    else if (p.parts) text += extractText(p.parts);
  }
  return text.trim();
}

function extractAttachments(parts) {
  if (!parts) return [];
  const out = [];
  for (const p of parts) {
    if (p.filename && p.filename.length > 0) out.push({ filename: p.filename, mimeType: p.mimeType, attachment_id: p.body && p.body.attachmentId });
    if (p.parts) out.push(...extractAttachments(p.parts));
  }
  return out;
}

function getHeader(headers, name) {
  return (headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function searchMessages({ account = 'noa', query, max_results = 20 }) {
  const email = account === 'john' ? 'john@kravemedia.co' : 'noa@kravemedia.co';
  const token = await getToken(email);
  const limit = Math.min(max_results, 50);
  const list = await gmailGet(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${limit}`,
    { Authorization: `Bearer ${token}` }
  );
  const messages = list.messages || [];
  if (!messages.length) return { messages: [], total: 0 };
  const details = await Promise.all(messages.map((m) =>
    gmailGet(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
      { Authorization: `Bearer ${token}` })
  ));
  return {
    messages: details.map((d) => ({
      id: d.id,
      subject: getHeader(d.payload && d.payload.headers, 'Subject'),
      from: getHeader(d.payload && d.payload.headers, 'From'),
      date: getHeader(d.payload && d.payload.headers, 'Date'),
      snippet: d.snippet || '',
    })),
    total: messages.length,
  };
}

async function getMessage({ account = 'noa', message_id }) {
  const email = account === 'john' ? 'john@kravemedia.co' : 'noa@kravemedia.co';
  const token = await getToken(email);
  const d = await gmailGet(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${message_id}?format=full`,
    { Authorization: `Bearer ${token}` });
  const payload = d.payload || {};
  const headers = payload.headers || [];
  let bodyText = payload.body && payload.body.data ? decodeBase64(payload.body.data) : extractText(payload.parts);
  return {
    id: d.id, thread_id: d.threadId,
    subject: getHeader(headers, 'Subject'),
    from: getHeader(headers, 'From'),
    to: getHeader(headers, 'To'),
    date: getHeader(headers, 'Date'),
    body: bodyText.slice(0, 3000),
    attachments: extractAttachments(payload.parts || []),
  };
}

async function sendEmail({ account = 'noa', to, subject, body, thread_id }) {
  const email = account === 'john' ? 'john@kravemedia.co' : 'noa@kravemedia.co';
  const token = await getToken(email);
  const mime = [`From: ${email}`, `To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=UTF-8', '', body].join('\r\n');
  const raw = Buffer.from(mime).toString('base64url');
  const requestBody = { raw };
  if (thread_id) requestBody.threadId = thread_id;
  const res = await gmailPost(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    JSON.stringify(requestBody),
    { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  );
  return res.error ? { error: res.error } : { message_id: res.id, thread_id: res.threadId, status: 'sent' };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  definitions: [
    {
      name: 'gmail_search',
      description: 'Search Gmail messages. account = "noa" or "john".',
      input_schema: {
        type: 'object',
        properties: {
          account: { type: 'string', description: '"noa" or "john" (default: noa)' },
          query: { type: 'string', description: 'Gmail search query e.g. "subject:invoice newer_than:7d"' },
          max_results: { type: 'number', description: 'Max results (default 20, max 50)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'gmail_get_message',
      description: 'Get full content of a Gmail message including body and attachments.',
      input_schema: {
        type: 'object',
        properties: {
          account: { type: 'string', description: '"noa" or "john" (default: noa)' },
          message_id: { type: 'string', description: 'Gmail message ID' },
        },
        required: ['message_id'],
      },
    },
    {
      name: 'gmail_send',
      description: 'Send an email from Noa or John\'s Gmail account.',
      input_schema: {
        type: 'object',
        properties: {
          account: { type: 'string', description: '"noa" or "john" (default: noa)' },
          to: { type: 'string', description: 'Recipient email address' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Plain text email body' },
          thread_id: { type: 'string', description: 'Thread ID to reply into (optional)' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  ],
  handlers: {
    gmail_search: searchMessages,
    gmail_get_message: getMessage,
    gmail_send: sendEmail,
  },
};
