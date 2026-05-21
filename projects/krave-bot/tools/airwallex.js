'use strict';

const https = require('https');

const AW_BASE = 'api.airwallex.com';
let _awToken = { token: null, exp: 0 };

function awRequest(method, path, payload, token) {
  return new Promise((resolve, reject) => {
    const buf = payload ? Buffer.from(JSON.stringify(payload)) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (buf) headers['Content-Length'] = buf.length;
    const req = https.request({ hostname: AW_BASE, path, method, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve({ ok: res.statusCode < 400, status: res.statusCode, body: JSON.parse(body) }); } catch { resolve({ ok: false, body }); } });
    });
    req.on('error', reject);
    if (buf) req.write(buf);
    req.end();
  });
}

async function getToken() {
  if (_awToken.token && Date.now() < _awToken.exp - 60000) return _awToken.token;
  const res = await awRequest('POST', '/api/v1/authentication/login', null, null);
  // Airwallex uses API key auth via header — token approach depends on setup
  // Using client_id + api_key for now
  const loginRes = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: AW_BASE, path: '/api/v1/authentication/login', method: 'POST',
      headers: { 'x-client-id': process.env.AIRWALLEX_CLIENT_ID, 'x-api-key': process.env.AIRWALLEX_API_KEY, 'Content-Type': 'application/json' },
    }, (r) => {
      let body = '';
      r.on('data', (c) => { body += c; });
      r.on('end', () => { try { resolve({ ok: r.statusCode < 400, body: JSON.parse(body) }); } catch { resolve({ ok: false }); } });
    });
    req.on('error', reject);
    req.end();
  });
  if (!loginRes.ok) throw new Error('Airwallex auth failed');
  const token = loginRes.body.token;
  _awToken = { token, exp: Date.now() + (loginRes.body.expires_in || 3600) * 1000 };
  return token;
}

async function listInvoices({ status, limit = 20 }) {
  const token = await getToken();
  const q = status ? `?status=${status}&page_size=${limit}` : `?page_size=${limit}`;
  const res = await awRequest('GET', `/api/v1/ar/invoices${q}`, null, token);
  if (!res.ok) return { error: `Airwallex error ${res.status}` };
  return { invoices: (res.body.items || []).map((i) => ({ id: i.id, number: i.invoice_number, amount: i.amount, currency: i.currency, status: i.status, due_date: i.due_date })) };
}

async function getInvoice({ invoice_id }) {
  const token = await getToken();
  const res = await awRequest('GET', `/api/v1/ar/invoices/${invoice_id}`, null, token);
  return res.ok ? res.body : { error: 'Invoice not found' };
}

async function listBills({ limit = 20 }) {
  const token = await getToken();
  const res = await awRequest('GET', `/api/v1/ap/bills?page_size=${limit}`, null, token);
  if (!res.ok) return { error: `Airwallex error ${res.status}` };
  return { bills: (res.body.items || []).map((b) => ({ id: b.id, amount: b.amount, currency: b.currency, status: b.status, due_date: b.due_date })) };
}

module.exports = {
  definitions: [
    {
      name: 'airwallex_list_invoices',
      description: 'List Airwallex AR invoices. Optionally filter by status.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by status (e.g. PENDING, PAID, OVERDUE)' },
          limit: { type: 'number', description: 'Max results (default 20)' },
        },
      },
    },
    {
      name: 'airwallex_get_invoice',
      description: 'Get details of a specific Airwallex invoice.',
      input_schema: {
        type: 'object',
        properties: { invoice_id: { type: 'string' } },
        required: ['invoice_id'],
      },
    },
    {
      name: 'airwallex_list_bills',
      description: 'List Airwallex AP bills (creator payouts).',
      input_schema: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'Max results (default 20)' } },
      },
    },
  ],
  handlers: { airwallex_list_invoices: listInvoices, airwallex_get_invoice: getInvoice, airwallex_list_bills: listBills },
};
