'use strict';

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Default tracker = AR client-invoice sheet. The Creator & AP Bills Tracker is a
// DIFFERENT spreadsheet (14kiX9…) — callers MUST pass spreadsheet_id for bills.
const SHEET_ID = '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50';
const BILLS_SHEET_ID = '14kiX9MnWyel_4_OxvL2TlnOAqBqFwwECf7Dm24znuJc';
const BILLS_TAB = 'Krave — Creator & AP Bills Tracker';
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

// spreadsheet_id accepts the full ID, or the alias "bills" for the Creator & AP
// Bills Tracker. Defaults to the AR client-invoice sheet.
//
// GUARD (2026-06-16 incident): a creator-bill write that forgot spreadsheet_id
// used to silently default to the AR client tracker — a Stashworks prep row
// landed there, in bills column order, mismatched against the AR columns. The
// bills tab name is the unambiguous signal: any write targeting the Creator &
// AP Bills tab MUST route to the bills spreadsheet. Refuse the mismatch loudly
// instead of misfiling money owed to creators into the client AR ledger.
function resolveSheetId(spreadsheet_id, sheet) {
  const wantsBillsTab = String(sheet || '').trim() === BILLS_TAB;
  const routesToBills = spreadsheet_id === 'bills' || spreadsheet_id === BILLS_SHEET_ID;
  if (wantsBillsTab && !routesToBills) {
    throw new Error(`Refusing to write the "${BILLS_TAB}" tab to the client/AR tracker — pass spreadsheet_id "bills" for creator/AP bills.`);
  }
  if (!spreadsheet_id) return SHEET_ID;
  if (spreadsheet_id === 'bills') return BILLS_SHEET_ID;
  return spreadsheet_id;
}

async function getRows({ sheet = 'Invoices', range = 'A:Z', spreadsheet_id }) {
  const sid = resolveSheetId(spreadsheet_id, sheet);
  const token = await getToken();
  const r = encodeURIComponent(`${sheet}!${range}`);
  const res = await httpsGet(`https://sheets.googleapis.com/v4/spreadsheets/${sid}/values/${r}`, { Authorization: `Bearer ${token}` });
  if (!res.ok) return { error: `Sheets API error: ${JSON.stringify(res.body)}` };
  const [headers, ...rows] = res.body.values || [];
  return { rows: rows.map((r) => Object.fromEntries((headers || []).map((h, i) => [h, r[i] || '']))) };
}

async function appendRow({ sheet = 'Invoices', values, spreadsheet_id }) {
  const sid = resolveSheetId(spreadsheet_id, sheet);
  const token = await getToken();
  const r = encodeURIComponent(`${sheet}!A:A`);
  const buf = Buffer.from(JSON.stringify({ values: [values], majorDimension: 'ROWS' }));
  const res = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'sheets.googleapis.com',
      path: `/v4/spreadsheets/${sid}/values/${r}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      method: 'POST',
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
  return res.ok ? { ok: true, updated: res.body.updates } : { error: 'Failed to append row' };
}

async function updateRow({ sheet = 'Invoices', range, values, spreadsheet_id }) {
  const sid = resolveSheetId(spreadsheet_id, sheet);
  const token = await getToken();
  const r = encodeURIComponent(`${sheet}!${range}`);
  const buf = Buffer.from(JSON.stringify({ values }));
  const res = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'sheets.googleapis.com', path: `/v4/spreadsheets/${sid}/values/${r}?valueInputOption=USER_ENTERED`, method: 'PUT',
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
      description: 'Read rows from a Krave tracker Google Sheet. Default = AR client-invoice tracker. For the Creator & AP Bills Tracker pass spreadsheet_id "bills".',
      input_schema: {
        type: 'object',
        properties: {
          sheet: { type: 'string', description: 'Sheet tab name (default: Invoices)' },
          range: { type: 'string', description: 'A1 notation range (default: A:Z for all columns)' },
          spreadsheet_id: { type: 'string', description: 'Spreadsheet ID, or "bills" for the Creator & AP Bills Tracker. Omit for the default AR invoice tracker.' },
        },
      },
    },
    {
      name: 'sheets_append_row',
      description: 'Append a new row to a Krave tracker. For an AR client invoice, omit spreadsheet_id (default tab "Invoices"). For a creator/AP bill, pass spreadsheet_id "bills" and sheet "Krave — Creator & AP Bills Tracker".',
      input_schema: {
        type: 'object',
        properties: {
          sheet: { type: 'string', description: 'Sheet tab name (default: Invoices; for bills use "Krave — Creator & AP Bills Tracker")' },
          values: { type: 'array', description: 'Ordered cell values. AR invoice cols: [Date Created, Client Name, Email, Project, Invoice #, Amount, Currency, Due Date, Payment Status, Invoice URL, Requested By]. Bills cols: [Date Received, Creator/Vendor, Invoice #, Airwallex Bill ID, Amount, Currency, Due Date, Status, Slack Thread TS, Notes]', items: { type: 'string' } },
          spreadsheet_id: { type: 'string', description: 'Pass "bills" for the Creator & AP Bills Tracker. Omit for the default AR invoice tracker.' },
        },
        required: ['values'],
      },
    },
    {
      name: 'sheets_update_row',
      description: 'Update a cell range in a Krave tracker Google Sheet. Pass spreadsheet_id "bills" for the Creator & AP Bills Tracker; omit for the default AR invoice tracker.',
      input_schema: {
        type: 'object',
        properties: {
          sheet: { type: 'string', description: 'Sheet tab name (default: Invoices)' },
          range: { type: 'string', description: 'A1 notation range to update (e.g. B5:C5)' },
          values: { type: 'array', description: '2D array of values [[row1col1, row1col2], ...]' },
          spreadsheet_id: { type: 'string', description: 'Pass "bills" for the Creator & AP Bills Tracker. Omit for the default AR invoice tracker.' },
        },
        required: ['range', 'values'],
      },
    },
  ],
  handlers: { sheets_get_rows: getRows, sheets_append_row: appendRow, sheets_update_row: updateRow },
};
