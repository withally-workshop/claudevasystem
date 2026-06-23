'use strict';

const https = require('https');
const { randomUUID } = require('crypto');

const AW_BASE = 'api.airwallex.com';
const SPEND_PREFIX = '/api/v1/spend/';
const LEGAL_ENTITY_ID = process.env.AIRWALLEX_LEGAL_ENTITY_ID || 'le_Zxw2-ECjOaKKebIGraD1AA';

// Per-key token caches. Spend endpoints (/api/v1/spend/*) need the org-scoped
// key; everything else uses the main account key. Spend falls back to main if
// the spend env vars are unset.
const _tokens = { main: { token: null, exp: 0 }, spend: { token: null, exp: 0 } };

function keyFor(which) {
  if (which === 'spend') {
    return {
      clientId: process.env.AIRWALLEX_SPEND_CLIENT_ID || process.env.AIRWALLEX_CLIENT_ID,
      apiKey: process.env.AIRWALLEX_SPEND_API_KEY || process.env.AIRWALLEX_API_KEY,
    };
  }
  return { clientId: process.env.AIRWALLEX_CLIENT_ID, apiKey: process.env.AIRWALLEX_API_KEY };
}

// Endpoints that require an x-api-version header.
const VERSIONED_PATHS = ['/api/v1/invoices', '/api/v1/billing_customers', '/api/v1/products', '/api/v1/prices', '/api/v1/fx/'];

// Internal/test billing customers — never create or finalize a real invoice
// against these. 2026-06-17 incident: a Dojocare invoice was billed to "Krave
// Test" 4x because john@kravemedia.co maps to these records and the resolver
// took the first. The system prompt tells the model to avoid them; this is the
// deterministic backstop — if the model ever tries, the tool refuses.
const TEST_CUSTOMER_IDS = new Set([
  'bcus_sgpdgmqz9hic0zyo485', // Krave Test (USD)
  'bcus_sgpdp7xdxhi30oyhmri', // Krave Test (SGD)
  'bcus_sgpdb6h5zhi2uty4o1o', // Krave Internal Test
  'bcus_sgpdn67v7hhopoh228m', // Test Address Corp
]);

function assertNotTestCustomer(billing_customer_id) {
  if (billing_customer_id && TEST_CUSTOMER_IDS.has(billing_customer_id)) {
    throw new Error(
      'Refusing to bill internal test customer ' + billing_customer_id +
      ' — confirm the correct client. The billing email must not be john@kravemedia.co.'
    );
  }
}

async function getToken(which) {
  const cache = _tokens[which];
  if (cache.token && Date.now() < cache.exp - 60000) return cache.token;
  const { clientId, apiKey } = keyFor(which);
  const res = await awRequest('POST', '/api/v1/authentication/login', null, null, { clientId, apiKey });
  if (!res.ok) throw new Error(`Airwallex auth failed (${which})`);
  cache.token = res.body.token;
  cache.exp = Date.now() + 25 * 60 * 1000;
  return cache.token;
}

function awRequest(method, path, payload, token, authKeys = null) {
  return new Promise((resolve, reject) => {
    const buf = payload ? Buffer.from(JSON.stringify(payload)) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (authKeys) {
      headers['x-client-id'] = authKeys.clientId;
      headers['x-api-key'] = authKeys.apiKey;
    } else {
      headers['Authorization'] = `Bearer ${token}`;
      if (VERSIONED_PATHS.some((p) => path.startsWith(p))) headers['x-api-version'] = '2025-06-16';
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
  const which = path.startsWith(SPEND_PREFIX) ? 'spend' : 'main';
  const token = await getToken(which);
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
  assertNotTestCustomer(billing_customer_id);
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
  // Backstop: never finalize (which makes the invoice live + emails it) against a test customer.
  const inv = await aw('GET', `/api/v1/invoices/${invoice_id}`);
  assertNotTestCustomer(inv && inv.billing_customer_id);
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
  // Email-dedup backstop (2026-06-23 incident: a price reply made the bot create a
  // second "Get Customers" customer + invoice because the only lookup was prompt-driven
  // by name and missed on casing — "Get Customers Pte Ltd" vs stored "Get Customers PTE
  // LTD"). Before creating, reuse any existing customer with the exact same email so we
  // never spawn a duplicate of a real client. Mirrors assertNotTestCustomer: a
  // deterministic code guard, not a prompt rule.
  if (email) {
    const wanted = String(email).toLowerCase().trim();
    const { customers } = await listCustomers({ email, page_size: 100 });
    const match = (customers || []).find(
      (c) => c.email && String(c.email).toLowerCase().trim() === wanted
    );
    if (match) return { ...match, reused_existing: true };
  }
  const body = { request_id: randomUUID(), name, type: 'BUSINESS' };
  if (email) body.email = email;
  const addr = {};
  if (country_code) addr.country_code = country_code;
  if (address) addr.line1 = address;
  if (city) addr.city = city;
  if (Object.keys(addr).length) body.address = addr;
  return aw('POST', '/api/v1/billing_customers/create', body);
}

async function listBills({ status, vendor_id, page_num = 0, page_size = 20 }) {
  const p = new URLSearchParams({ page_num, page_size });
  if (status) p.set('status', status);
  if (vendor_id) p.set('vendor_id', vendor_id);
  const data = await aw('GET', `/api/v1/spend/bills?${p}`);
  return { bills: (data.items || []).map((b) => ({ id: b.id, vendor_id: b.vendor_id, invoice_number: b.invoice_number, amount: b.billing_amount, currency: b.billing_currency, status: b.status, due_date: b.due_date })) };
}

async function getBill({ bill_id }) {
  return aw('GET', `/api/v1/spend/bills/${bill_id}`);
}

async function listVendors({ name, page_num = 0, page_size = 50 }) {
  const p = new URLSearchParams({ page_num, page_size });
  if (name) p.set('name', name);
  const data = await aw('GET', `/api/v1/spend/vendors?${p}`);
  return { vendors: (data.items || []).map((v) => ({ id: v.id, name: v.name, country: v.address && v.address.country_code })) };
}

// Profile only — NEVER write bank details into a vendor. The invoice PDF stays
// the payment source of truth (Noa reads bank details from the uploaded PDF).
async function createVendor({ name, email, country_code }) {
  const body = { request_id: randomUUID(), name };
  if (email) body.email = email;
  if (country_code) body.country_code = country_code;
  return aw('POST', '/api/v1/spend/vendors/create', body);
}

async function createBill({ external_id, vendor_id, invoice_number, issued_date, due_date, currency, tax_status, description, line_items, legal_entity_id }) {
  const body = {
    request_id: randomUUID(),
    external_id,
    legal_entity_id: legal_entity_id || LEGAL_ENTITY_ID,
    vendor_id,
    invoice_number,
    issued_date,
    due_date,
    billing_currency: currency,
    tax_status: tax_status || 'TAX_EXCLUSIVE',
    sync_status: 'NOT_SYNCED',
    line_items: (line_items || []).map((i) => ({ description: i.description, quantity: String(i.quantity), unit_price: String(i.unit_price) })),
  };
  if (description) body.description = description;
  // No `attachments` field — Airwallex removed it from this endpoint 2026-06-11;
  // native bill attachments arrive ~Aug 2026. The PDF is uploaded manually in
  // the webapp (an #ops-command flag prompts John per bill).
  return aw('POST', '/api/v1/spend/bills/create', body);
}

async function markBillPaid({ bill_id }) {
  return aw('POST', `/api/v1/spend/bills/${bill_id}/mark_as_paid`, null);
}

// Live indicative FX rate (main key). For USD invoice → PHP payout, call with
// buy_currency=PHP, sell_currency=USD: returns USDPHP rate. Bill amount =
// invoice_amount × rate × 0.97.
async function fxRate({ buy_currency, sell_currency, buy_amount }) {
  const p = new URLSearchParams({ buy_currency, sell_currency });
  if (buy_amount) p.set('buy_amount', buy_amount);
  const data = await aw('GET', `/api/v1/fx/rates/current?${p}`);
  return { currency_pair: data.currency_pair, rate: data.rate, conversion_date: data.conversion_date };
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
      description: 'List Airwallex Spend AP bills (outgoing payments to creators/vendors). Filter by status (DRAFT, AWAITING_APPROVAL, AWAITING_PAYMENT, PAID, REJECTED) or vendor_id.',
      input_schema: { type: 'object', properties: { status: { type: 'string' }, vendor_id: { type: 'string' }, page_num: { type: 'number' }, page_size: { type: 'number' } } },
    },
    {
      name: 'airwallex_get_bill',
      description: 'Get details of a specific Airwallex Spend bill by ID. Use for the post-create guard (verify amount/currency/vendor).',
      input_schema: { type: 'object', properties: { bill_id: { type: 'string' } }, required: ['bill_id'] },
    },
    {
      name: 'airwallex_list_vendors',
      description: 'List Airwallex Spend vendors (the payees for AP bills). Search by name to resolve a vendor_id before creating a bill.',
      input_schema: { type: 'object', properties: { name: { type: 'string' }, page_num: { type: 'number' }, page_size: { type: 'number' } } },
    },
    {
      name: 'airwallex_create_vendor',
      description: 'Create a Spend vendor (profile only). Pass name (+ country_code if known). NEVER pass bank details — the invoice PDF is the payment source of truth. Use only when no existing vendor matches the invoice payee.',
      input_schema: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' }, country_code: { type: 'string' } }, required: ['name'] },
    },
    {
      name: 'airwallex_create_bill',
      description: 'Create an Airwallex Spend AP bill (draft creator/vendor payable). Requires vendor_id (from airwallex_list_vendors/create_vendor). The PDF cannot be attached via API until ~Aug 2026 — upload it manually in the webapp afterward. external_id should be the source Slack ts / Gmail id (idempotency).',
      input_schema: {
        type: 'object',
        properties: {
          external_id: { type: 'string' },
          vendor_id: { type: 'string' },
          invoice_number: { type: 'string' },
          issued_date: { type: 'string', description: 'ISO8601 e.g. 2026-06-12' },
          due_date: { type: 'string', description: 'ISO8601' },
          currency: { type: 'string', description: 'Payout currency (sent as billing_currency)' },
          tax_status: { type: 'string', description: 'TAX_EXCLUSIVE (default) or TAX_INCLUSIVE' },
          description: { type: 'string', description: 'Source + conversion note if any' },
          line_items: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' }, quantity: { type: 'number' }, unit_price: { type: 'number' } }, required: ['quantity', 'unit_price'] } },
        },
        required: ['external_id', 'vendor_id', 'invoice_number', 'issued_date', 'due_date', 'currency', 'line_items'],
      },
    },
    {
      name: 'airwallex_mark_bill_paid',
      description: 'Mark a Spend AP bill as paid outside Airwallex. (Distinct from airwallex_mark_paid, which is for AR invoices.)',
      input_schema: { type: 'object', properties: { bill_id: { type: 'string' } }, required: ['bill_id'] },
    },
    {
      name: 'airwallex_fx_rate',
      description: 'Get the live Airwallex FX rate. For a USD invoice paid in PHP, call buy_currency=PHP, sell_currency=USD → returns the USDPHP rate. Bill amount = invoice_amount × rate × 0.97.',
      input_schema: { type: 'object', properties: { buy_currency: { type: 'string' }, sell_currency: { type: 'string' }, buy_amount: { type: 'number' } }, required: ['buy_currency', 'sell_currency'] },
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
    airwallex_list_vendors: listVendors,
    airwallex_create_vendor: createVendor,
    airwallex_create_bill: createBill,
    airwallex_mark_bill_paid: markBillPaid,
    airwallex_fx_rate: fxRate,
    airwallex_mark_paid: markPaid,
    airwallex_void_invoice: voidInvoice,
  },
};
