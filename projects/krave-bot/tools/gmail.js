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

function downloadUrl(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : require('http');
    const req = mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadUrl(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ data: Buffer.concat(chunks), contentType: res.headers['content-type'] || 'application/octet-stream' }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
  });
}

async function sendEmail({ account = 'noa', to, cc, subject, body, thread_id, attachment_url, attachment_filename, attachment_base64, attachment_mime_type }) {
  const email = account === 'john' ? 'john@kravemedia.co' : 'noa@kravemedia.co';
  const token = await getToken(email);

  let raw;
  if (attachment_url || attachment_base64) {
    let attachData, attachContentType;
    if (attachment_base64) {
      attachData = attachment_base64;
      attachContentType = attachment_mime_type || 'application/octet-stream';
    } else {
      const { data, contentType } = await downloadUrl(attachment_url);
      attachData = data.toString('base64');
      attachContentType = contentType;
    }
    const boundary = `boundary_${Date.now()}`;
    const parts = [
      `From: ${email}`,
      `To: ${to}`,
      ...(cc ? [`Cc: ${cc}`] : []),
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      body,
      '',
      `--${boundary}`,
      `Content-Type: ${attachContentType}`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${attachment_filename || 'invoice.pdf'}"`,
      '',
      attachData,
      '',
      `--${boundary}--`,
    ];
    raw = Buffer.from(parts.join('\r\n')).toString('base64url');
  } else {
    const headers = [`From: ${email}`, `To: ${to}`];
    if (cc) headers.push(`Cc: ${cc}`);
    headers.push(`Subject: ${subject}`, 'Content-Type: text/plain; charset=UTF-8', '', body);
    raw = Buffer.from(headers.join('\r\n')).toString('base64url');
  }

  const requestBody = { raw };
  if (thread_id) requestBody.threadId = thread_id;
  const res = await gmailPost(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    JSON.stringify(requestBody),
    { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  );
  return res.error ? { error: res.error } : { message_id: res.id, thread_id: res.threadId, status: 'sent' };
}

async function downloadAttachment({ account = 'noa', message_id, attachment_id }) {
  const email = account === 'john' ? 'john@kravemedia.co' : 'noa@kravemedia.co';
  const token = await getToken(email);
  const d = await gmailGet(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message_id}/attachments/${attachment_id}`,
    { Authorization: `Bearer ${token}` }
  );
  return { base64: d.data || '' };
}

async function markRead({ account = 'noa', message_id }) {
  const email = account === 'john' ? 'john@kravemedia.co' : 'noa@kravemedia.co';
  const token = await getToken(email);
  await gmailPost(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message_id}/modify`,
    JSON.stringify({ removeLabelIds: ['UNREAD'] }),
    { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  );
  return { success: true, message_id };
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
      name: 'gmail_download_attachment',
      description: 'Download a Gmail attachment as base64. Get message_id and attachment_id from gmail_get_message first.',
      input_schema: {
        type: 'object',
        properties: {
          account: { type: 'string', description: '"noa" or "john" (default: noa)' },
          message_id: { type: 'string', description: 'Gmail message ID' },
          attachment_id: { type: 'string', description: 'Attachment ID from the attachments array in gmail_get_message' },
        },
        required: ['message_id', 'attachment_id'],
      },
    },
    {
      name: 'gmail_mark_read',
      description: 'Mark a Gmail message as read (removes UNREAD label). Use after processing an email to prevent reprocessing.',
      input_schema: {
        type: 'object',
        properties: {
          account: { type: 'string', description: '"noa" or "john" (default: noa)' },
          message_id: { type: 'string', description: 'Gmail message ID to mark as read' },
        },
        required: ['message_id'],
      },
    },
    {
      name: 'gmail_send',
      description: 'Send an email from Noa or John\'s Gmail account. Supports CC and PDF attachments via URL.',
      input_schema: {
        type: 'object',
        properties: {
          account: { type: 'string', description: '"noa" or "john" (default: noa)' },
          to: { type: 'string', description: 'Recipient email address(es), comma-separated' },
          cc: { type: 'string', description: 'CC email address(es), comma-separated (optional)' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Plain text email body' },
          thread_id: { type: 'string', description: 'Thread ID to reply into (optional)' },
          attachment_url: { type: 'string', description: 'URL to download and attach as a file (e.g. Airwallex PDF URL)' },
          attachment_base64: { type: 'string', description: 'Base64-encoded file data to attach directly (use instead of attachment_url when file is already in memory)' },
          attachment_mime_type: { type: 'string', description: 'MIME type for attachment_base64 e.g. application/pdf, image/jpeg (default: application/octet-stream)' },
          attachment_filename: { type: 'string', description: 'Filename for the attachment (e.g. INV-00012.pdf)' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  ],
  handlers: {
    gmail_search: searchMessages,
    gmail_get_message: getMessage,
    gmail_send: sendEmail,
    gmail_download_attachment: downloadAttachment,
    gmail_mark_read: markRead,
  },
};
