'use strict';

const https = require('https');
const { randomUUID } = require('crypto');

const AW_BASE = 'api.airwallex.com';
let _awToken = { token: null, exp: 0 };

const BILLING_PATHS = ['/api/v1/invoices', '/api/v1/billing_customers', '/api/v1/products', '/api/v1/prices'];

async function getToken() {
  if (_awToken.token && Date.now() < _awToken.exp - 60000) return _awToken.token;
  const res = await awRequest('POST', '/api/v1/authentication/login', null, null, true);
  if (!res.ok) throw new Error('Airwallex auth failed');
  _awToken = { token: res.body.token, exp: Date.now() + 25 * 60 * 1000 };
  return _awToken.token;
}

function awRequest(method, path, payload, token, isAuth = false) {
  return new Promise((resolve, reject) => {
    const buf = payload ? Buffer.from(JSON.stringify(payload)) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (isAuth) {
      headers['x-client-id'] = process.env.AIRWALLEX_CLIENT_ID;
      headers['x-api-key'] = process.env.AIRWALLEX_API_KEY;
    } else {
      headers['Authorization'] = `Bearer ${token}`;
      if (BILLING_PATHS.some((p) => path.startsWith(p))) headers['x-api-version'] = '2025-06-16';
    }
    if (buf) headers['Content-Length'] = buf.length;
    const req = https.request({ hostname: AW_BASE, path, method, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 400, status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ ok: false, status: res.statusCode, body }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    if (buf) req.write(buf);
    req.end();
  });
}

async function aw(method, path, payload) {
  const token = await getToken();
  const res = await awRequest(method, path, payload, token);
  if (!res.ok) throw new Error(`Airwallex ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function listInvoices({ status, page_num = 0, page_size = 20 }) {
  const p = new URLSearchParams({ page_num, page_size });
  if (status) p.set('status', status);
  const data = await aw('GET', `/api/v1/invoices?${p}`);
  return { invoices: (data.items || []).map((i) => ({ id: i.id, number: i.invoice_number, amount: i.amount, currency: i.currency, status: i.status, due_date: i.due_date, customer: i.billing_customer_id })) };
}

async function getInvoice({ invoice_id }) {
  return aw('GET', `/api/v1/invoices/${invoice_id}`);
}

async function getBillingInvoice({ invoice_id }) {
  const data = await aw('GET', `/api/v1/invoices/${invoice_id}`);
  return {
    id: data.id,
    invoice_number: data.invoice_number,
    status: data.status,
    amount: data.amount,
    currency: data.currency,
    due_date: data.due_date,
    hosted_invoice_url: data.hosted_invoice_url,
    pdf_download_url: data.pdf_download_url || data.invoice_pdf || data.pdf_url || null,
  };
}

async function createInvoice({ billing_customer_id, currency, days_until_due = 7, collection_method = 'CHARGE_ON_CHECKOUT', linked_payment_account_id, legal_entity_id, memo }) {
  const body = { request_id: randomUUID(), billing_customer_id, currency, collection_method, days_until_due };
  if (linked_payment_account_id) body.linked_payment_account_id = linked_payment_account_id;
  if (legal_entity_id) body.legal_entity_id = legal_entity_id;
  if (memo) body.memo = memo;
  return aw('POST', '/api/v1/invoices/create', body);
}

async function createProduct({ name, description }) {
  const body = { request_id: randomUUID(), name };
  if (description) body.description = description;
  return aw('POST', '/api/v1/products/create', body);
}

async function createPrice({ product_id, currency, unit_amount, nickname }) {
  const body = { request_id: randomUUID(), product_id, currency, unit_amount };
  if (nickname) body.nickname = nickname;
  return aw('POST', '/api/v1/prices/create', body);
}

async function addLineItems({ invoice_id, line_items }) {
  const body = {
    request_id: randomUUID(),
    line_items: line_items.map((item) => ({ price_id: item.price_id, quantity: item.quantity || 1 })),
  };
  return aw('POST', `/api/v1/invoices/${invoice_id}/add_line_items`, body);
}

async function finalizeInvoice({ invoice_id }) {
  return aw('POST', `/api/v1/invoices/${invoice_id}/finalize`, { request_id: randomUUID() });
}

async function listCustomers({ name, email, page_size = 20 }) {
  const p = new URLSearchParams({ page_size });
  if (name) p.set('name', name);
  if (email) p.set('email', email);
  const data = await aw('GET', `/api/v1/billing_customers?${p}`);
  return { customers: (data.items || []).map((c) => ({ id: c.id, name: c.name, email: c.email, country: c.address && c.address.country_code })) };
}

async function createCustomer({ name, email, country_code, address, city }) {
  const body = { request_id: randomUUID(), name, type: 'BUSINESS' };
  if (email) body.email = email;
  const addr = {};
  if (country_code) addr.country_code = country_code;
  if (address) addr.line1 = address;
  if (city) addr.city = city;
  if (Object.keys(addr).length) body.address = addr;
  return aw('POST', '/api/v1/billing_customers/create', body);
}

async function listBills({ status, page_num = 0, page_size = 20 }) {
  const p = new URLSearchParams({ page_num, page_size });
  if (status) p.set('status', status);
  const data = await aw('GET', `/api/v1/bills?${p}`);
  return { bills: (data.items || []).map((b) => ({ id: b.id, amount: b.amount, currency: b.currency, status: b.status, due_date: b.due_date })) };
}

async function getBill({ bill_id }) {
  return aw('GET', `/api/v1/bills/${bill_id}`);
}

async function markPaid({ invoice_id }) {
  return aw('POST', `/api/v1/invoices/${invoice_id}/mark_as_paid`, {});
}

async function voidInvoice({ invoice_id }) {
  return aw('POST', `/api/v1/invoices/${invoice_id}/void`, { request_id: randomUUID() });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  definitions: [
    {
      name: 'airwallex_list_invoices',
      description: 'List Airwallex AR invoices. Filter by status: DRAFT, OPEN, PAID, OVERDUE, VOID.',
      input_schema: { type: 'object', properties: { status: { type: 'string' }, page_num: { type: 'number' }, page_size: { type: 'number' } } },
    },
    {
      name: 'airwallex_get_invoice',
      description: 'Get details of a specific Airwallex invoice by ID.',
      input_schema: { type: 'object', properties: { invoice_id: { type: 'string' } }, required: ['invoice_id'] },
    },
    {
      name: 'airwallex_get_billing_invoice',
      description: 'Get full billing invoice details including the payment link (hosted_invoice_url). Use after finalizing to get the URL to send to clients.',
      input_schema: { type: 'object', properties: { invoice_id: { type: 'string' } }, required: ['invoice_id'] },
    },
    {
      name: 'airwallex_create_invoice',
      description: 'Create a new DRAFT invoice in Airwallex. Add line items separately with airwallex_add_invoice_line_items, then finalize.',
      input_schema: {
        type: 'object',
        properties: {
          billing_customer_id: { type: 'string', description: 'From airwallex_list_customers' },
          currency: { type: 'string', description: 'e.g. USD, SGD' },
          days_until_due: { type: 'number', description: 'Default 7' },
          collection_method: { type: 'string', description: 'CHARGE_ON_CHECKOUT or OUT_OF_BAND' },
          linked_payment_account_id: { type: 'string' },
          legal_entity_id: { type: 'string' },
          memo: { type: 'string' },
        },
        required: ['billing_customer_id', 'currency'],
      },
    },
    {
      name: 'airwallex_create_product',
      description: 'Create a billing product in Airwallex (e.g. "Krave Media Starter Pack"). Required before creating a price.',
      input_schema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } }, required: ['name'] },
    },
    {
      name: 'airwallex_create_price',
      description: 'Create a one-time price for a product. Returns price_id used in add_invoice_line_items.',
      input_schema: {
        type: 'object',
        properties: {
          product_id: { type: 'string' },
          currency: { type: 'string' },
          unit_amount: { type: 'number', description: 'Amount e.g. 500 for $500' },
          nickname: { type: 'string' },
        },
        required: ['product_id', 'currency', 'unit_amount'],
      },
    },
    {
      name: 'airwallex_add_invoice_line_items',
      description: 'Add line items to a DRAFT invoice using price_id from airwallex_create_price.',
      input_schema: {
        type: 'object',
        properties: {
          invoice_id: { type: 'string' },
          line_items: { type: 'array', items: { type: 'object', properties: { price_id: { type: 'string' }, quantity: { type: 'number' } }, required: ['price_id'] } },
        },
        required: ['invoice_id', 'line_items'],
      },
    },
    {
      name: 'airwallex_finalize_invoice',
      description: 'Finalize a draft invoice — makes it OPEN and ready to send to the client.',
      input_schema: { type: 'object', properties: { invoice_id: { type: 'string' } }, required: ['invoice_id'] },
    },
    {
      name: 'airwallex_list_customers',
      description: 'List Airwallex billing customers. Search by name or email to find billing_customer_id.',
      input_schema: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' }, page_size: { type: 'number' } } },
    },
    {
      name: 'airwallex_create_customer',
      description: 'Create a new billing customer in Airwallex. Only name is required — never ask the user for email or country, just use the name and proceed.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          email: { type: 'string', description: 'Optional — only include if already known' },
          country_code: { type: 'string', description: 'Optional — only include if already known' },
        },
        required: ['name'],
      },
    },
    {
      name: 'airwallex_list_bills',
      description: 'List Airwallex AP bills (outgoing payments to creators/vendors).',
      input_schema: { type: 'object', properties: { status: { type: 'string' }, page_num: { type: 'number' }, page_size: { type: 'number' } } },
    },
    {
      name: 'airwallex_get_bill',
      description: 'Get details of a specific Airwallex bill.',
      input_schema: { type: 'object', properties: { bill_id: { type: 'string' } }, required: ['bill_id'] },
    },
    {
      name: 'airwallex_mark_paid',
      description: 'Mark an Airwallex invoice as paid manually.',
      input_schema: { type: 'object', properties: { invoice_id: { type: 'string' } }, required: ['invoice_id'] },
    },
    {
      name: 'airwallex_void_invoice',
      description: 'Void an Airwallex invoice. Use when replacing an invoice with a corrected one.',
      input_schema: { type: 'object', properties: { invoice_id: { type: 'string' } }, required: ['invoice_id'] },
    },
  ],
  handlers: {
    airwallex_list_invoices: listInvoices,
    airwallex_get_invoice: getInvoice,
    airwallex_get_billing_invoice: getBillingInvoice,
    airwallex_create_invoice: createInvoice,
    airwallex_create_product: createProduct,
    airwallex_create_price: createPrice,
    airwallex_add_invoice_line_items: addLineItems,
    airwallex_finalize_invoice: finalizeInvoice,
    airwallex_list_customers: listCustomers,
    airwallex_create_customer: createCustomer,
    airwallex_list_bills: listBills,
    airwallex_get_bill: getBill,
    airwallex_mark_paid: markPaid,
    airwallex_void_invoice: voidInvoice,
  },
};
