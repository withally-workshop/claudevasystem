'use strict';

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SHEET_ID = '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50';
let _tokenCache = { token: null, exp: 0 };

function loadServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
  if (raw) return JSON.parse(raw);
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  throw new Error('Google service account not configured');
}

function httpsPost(url, data, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const buf = Buffer.from(data);
    const req = https.request({ hostname: parsed.hostname, path: parsed.pathname, method: 'POST', headers: { 'Content-Length': buf.length, ...headers } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({ error: body }); } });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve({ ok: res.statusCode < 400, body: JSON.parse(body) }); } catch { resolve({ ok: false, body }); } });
    });
    req.on('error', reject);
  });
}

async function getToken() {
  if (_tokenCache.token && Date.now() < _tokenCache.exp - 60000) return _tokenCache.token;
  const sa = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now };
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sigInput = `${header}.${body}`;
  const sig = crypto.createSign('RSA-SHA256').update(sigInput).sign(sa.private_key, 'base64url');
  const jwt = `${sigInput}.${sig}`;
  const res = await httpsPost('https://oauth2.googleapis.com/token', `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`, { 'Content-Type': 'application/x-www-form-urlencoded' });
  _tokenCache = { token: res.access_token, exp: now + res.expires_in };
  return res.access_token;
}

async function getRows({ sheet = 'Invoices', range = 'A:Z' }) {
  const token = await getToken();
  const r = encodeURIComponent(`${sheet}!${range}`);
  const res = await httpsGet(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${r}`, { Authorization: `Bearer ${token}` });
  if (!res.ok) return { error: `Sheets API error: ${JSON.stringify(res.body)}` };
  const [headers, ...rows] = res.body.values || [];
  return { rows: rows.map((r) => Object.fromEntries((headers || []).map((h, i) => [h, r[i] || '']))) };
}

async function updateRow({ sheet = 'Invoices', range, values }) {
  const token = await getToken();
  const r = encodeURIComponent(`${sheet}!${range}`);
  const buf = Buffer.from(JSON.stringify({ values }));
  const res = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'sheets.googleapis.com', path: `/v4/spreadsheets/${SHEET_ID}/values/${r}?valueInputOption=USER_ENTERED`, method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': buf.length },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve({ ok: res.statusCode < 400, body: JSON.parse(body) }); } catch { resolve({ ok: false }); } });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
  return res.ok ? { ok: true } : { error: 'Failed to update row' };
}

module.exports = {
  definitions: [
    {
      name: 'sheets_get_rows',
      description: 'Read rows from the Krave invoice tracker Google Sheet.',
      input_schema: {
        type: 'object',
        properties: {
          sheet: { type: 'string', description: 'Sheet tab name (default: Invoices)' },
          range: { type: 'string', description: 'A1 notation range (default: A:Z for all columns)' },
        },
      },
    },
    {
      name: 'sheets_update_row',
      description: 'Update a cell range in the Krave invoice tracker Google Sheet.',
      input_schema: {
        type: 'object',
        properties: {
          sheet: { type: 'string', description: 'Sheet tab name (default: Invoices)' },
          range: { type: 'string', description: 'A1 notation range to update (e.g. B5:C5)' },
          values: { type: 'array', description: '2D array of values [[row1col1, row1col2], ...]' },
        },
        required: ['range', 'values'],
      },
    },
  ],
  handlers: { sheets_get_rows: getRows, sheets_update_row: updateRow },
};
