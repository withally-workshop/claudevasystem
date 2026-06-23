const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = '5XHxhQ7wB2rxE3qz';
const FALLBACK_STATUS = 'fallback_manual_required';
const DRAFT_SUCCESS_NOTE = 'draft invoice created';
const DRAFT_REVIEW_STATUS = 'Draft - Pending John Review';
const AIRWALLEX_AUTH_URL = 'https://api.airwallex.com/api/v1/authentication/login';
const AIRWALLEX_CUSTOMER_CREATE_URL = 'https://api.airwallex.com/api/v1/billing_customers/create';
const AIRWALLEX_PRODUCT_CREATE_URL = 'https://api.airwallex.com/api/v1/products/create';
const AIRWALLEX_PRICE_CREATE_URL = 'https://api.airwallex.com/api/v1/prices/create';
const AIRWALLEX_INVOICE_CREATE_URL = 'https://api.airwallex.com/api/v1/invoices/create';
const SUCCESS_TRACKER_COLUMNS = {
  'Date Created': '={{ $json.submitted_at }}',
  'Client Name': '={{ $json.client_name }}',
  'Email Address': '={{ $json.client_email || "" }}',
  'Project Description':
    '={{ ($json.line_items || []).map(i => i.description).filter(Boolean).join(" | ").slice(0, 500) }}',
  'Invoice #': '={{ $json.airwallex_invoice_number || $json.airwallex_invoice_id || $json.request_id }}',
  'Airwallex Customer ID': '={{ $json.airwallex_customer_id }}',
  'Airwallex Invoice ID': '={{ $json.airwallex_invoice_id }}',
  Amount: '={{ $json.subtotal }}',
  Currency: '={{ $json.currency }}',
  'Due Date': '={{ $json.due_date }}',
  'Payment Status': DRAFT_REVIEW_STATUS,
  'Requested By': '={{ $json.submitted_by_slack_user_name || $json.submitted_by_slack_user_id }}',
  'Origin Thread TS': "={{ $json.origin_thread_ts ? \"'\" + $json.origin_thread_ts : \"\" }}",
};
const REQUESTER_SUCCESS_TEXT =
  "={{ 'Invoice request received. Airwallex draft invoice was created for ' + $('Mark Draft Success').item.json.client_name + ' (' + $('Mark Draft Success').item.json.currency + ' ' + $('Mark Draft Success').item.json.subtotal + '). Invoice Date: ' + $('Mark Draft Success').item.json.invoice_date + '. Payout: ' + ($('Mark Draft Success').item.json.payout_raw || '7 day payout') + '. Due Date: ' + $('Mark Draft Success').item.json.due_date + '. Request ID: ' + $('Mark Draft Success').item.json.request_id }}";
const FALLBACK_TRACKER_COLUMNS = {
  'Date Created': '={{ $json.submitted_at }}',
  'Client Name': '={{ $json.client_name }}',
  'Email Address': '={{ $json.client_email || "" }}',
  'Project Description':
    '={{ ($json.line_items || []).map(i => i.description).filter(Boolean).join(" | ").slice(0, 500) }}',
  'Invoice #': '={{ $json.request_id }}',
  'Airwallex Customer ID': '={{ $json.airwallex_customer_id || "" }}',
  'Airwallex Invoice ID': '={{ $json.airwallex_invoice_id || "" }}',
  Amount: '={{ $json.subtotal }}',
  Currency: '={{ $json.currency }}',
  'Due Date': '={{ $json.due_date }}',
  'Payment Status': FALLBACK_STATUS,
  'Requested By': '={{ $json.submitted_by_slack_user_name || $json.submitted_by_slack_user_id }}',
  'Origin Thread TS': "={{ $json.origin_thread_ts ? \"'\" + $json.origin_thread_ts : \"\" }}",
};
const ORIGIN_CHANNEL_SUCCESS_TEXT =
  "={{ '✅ Invoice draft created for *' + $('Mark Draft Success').item.json.client_name + '*\\n• Amount: ' + $('Mark Draft Success').item.json.currency + ' ' + $('Mark Draft Success').item.json.subtotal + '\\n• Invoice #: ' + ($('Mark Draft Success').item.json.airwallex_invoice_number || $('Mark Draft Success').item.json.airwallex_invoice_id) + '\\n• Due: ' + $('Mark Draft Success').item.json.due_date + '\\n• Status: Draft - pending John review in Airwallex\\n• Requested by: <@' + $('Mark Draft Success').item.json.submitted_by_slack_user_id + '>' }}";

const REQUESTER_FALLBACK_TEXT =
  "={{ 'Invoice request received for ' + $json.client_name + '. Manual Airwallex creation required. Invoice Date: ' + ($json.invoice_date || 'needs review') + '. Payout: ' + ($json.payout_raw || '7 day payout') + '. Due Date: ' + ($json.due_date || 'needs review') + '. Request ID: ' + $json.request_id }}";
const LINE_ITEMS_PAYLOAD_LABEL = 'Line Items Payload';
const JOHN_DM_TEXT =
  "={{ 'Invoice intake fallback\\nRequest ID: ' + $json.request_id + '\\nClient: ' + $json.client_name + '\\nRequester: ' + ($json.submitted_by_slack_user_name || $json.submitted_by_slack_user_id) + '\\nInvoice Date: ' + ($json.invoice_date || 'needs review') + '\\nPayout: ' + ($json.payout_raw || '7 day payout') + '\\nDue Date: ' + ($json.due_date || 'needs review') + '\\nSubtotal: ' + $json.currency + ' ' + $json.subtotal + '\\nFailure stage: ' + $json.failure_stage + '\\nFailure reason: ' + $json.failure_reason + '\\n' + '" + LINE_ITEMS_PAYLOAD_LABEL + ": ' + JSON.stringify($json.line_items) }}";
const AIRWALLEX_CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID;
const AIRWALLEX_API_KEY = process.env.AIRWALLEX_API_KEY;
const SHEETS_CRED_ID = '83MQOm78gYDvziTO';
const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD';
const SHEET_ID = '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50';
const REQUESTER_SLACK_FALLBACK_CHANNEL = '={{ $json.submitted_by_slack_user_id || "" }}';
const JOHN_DM_CHANNEL = 'U0AM5EGRVTP';
const JOHN_APPROVAL_CHANNEL = 'C0AQZGJDR38';

const JOHN_APPROVAL_TEXT =
  "={{ '📋 *New Invoice Draft — ' + $('Mark Draft Success').item.json.client_name + '*\\n• Amount: ' + $('Mark Draft Success').item.json.currency + ' ' + $('Mark Draft Success').item.json.subtotal + '\\n• Client email: ' + $('Mark Draft Success').item.json.client_email + '\\n• Due: ' + $('Mark Draft Success').item.json.due_date + '\\n• Invoice ID: ' + $('Mark Draft Success').item.json.airwallex_invoice_id + '\\n• Airwallex Invoice #: ' + ($('Mark Draft Success').item.json.airwallex_invoice_number || $('Mark Draft Success').item.json.airwallex_invoice_id) + '\\n• Requested by: <@' + $('Mark Draft Success').item.json.submitted_by_slack_user_id + '>\\n\\nReply *approve* in this thread to finalize and send payment link to client.\\nIf there\\'s a ClickUp task for this project, include the URL: `approve https://app.clickup.com/t/..`' }}";

const PROMPT_REQUESTER_PRICE_BODY = `={{ { channel: $json.origin_channel_id || $json.submitted_by_slack_user_id, thread_ts: $json.origin_thread_ts || undefined, text: 'Hey <@' + ($json.submitted_by_slack_user_id || '') + '>, the invoice for *' + ($json.client_name || 'the client') + '* failed to create — price is missing from line item: *' + (($json.line_items || []).map(i => i.description || '').join(', ') || 'unnamed') + '*. Reply here with the amount (e.g. 5000 USD) and resubmit.' } }}`;

const NORMALIZE_CODE = `
const payload = $json.body || $json;
const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
const requestId = 'invreq_' + Date.now();
const todayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function formatTodayIso() {
  const parts = todayFormatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year + '-' + month + '-' + day;
}

function isoFromDate(date) {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(iso, days) {
  const date = parseIsoDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return isoFromDate(date);
}

function diffDays(fromIso, toIso) {
  const fromDate = parseIsoDate(fromIso);
  const toDate = parseIsoDate(toIso);
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
}

function parseExplicitDate(input, todayIso) {
  const raw = String(input || '').trim();
  if (!raw) return { ok: true, value: todayIso, normalized_input: '' };

  const lower = raw.toLowerCase();
  if (lower === 'today') {
    return { ok: true, value: todayIso, normalized_input: 'today' };
  }
  if (lower === 'tomorrow') {
    return { ok: true, value: addDays(todayIso, 1), normalized_input: 'tomorrow' };
  }
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(raw)) {
    const parsed = parseIsoDate(raw);
    if (!Number.isNaN(parsed.getTime()) && isoFromDate(parsed) === raw) {
      return { ok: true, value: raw, normalized_input: raw };
    }
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return {
      ok: true,
      value: isoFromDate(new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()))),
      normalized_input: raw,
    };
  }

  return { ok: false, reason: 'unparseable invoice_date', normalized_input: raw };
}

function parsePayout(rawValue, invoiceDateIso, todayIso) {
  const raw = String(rawValue || '').trim();
  const normalized = (raw || '7 day payout').toLowerCase().replace(/\s+/g, ' ');

  // Handles: "7", "30", "7days", "30days", "7 days", "30 days", "7 day payout", "30 day payout", "30day payout"
  const daysMatch = normalized.match(/^(\\d+)\\s*(days?(\\s+payout)?)?$/);
  if (daysMatch) {
    const days = parseInt(daysMatch[1], 10);
    return { ok: true, payout_raw: days + ' day payout', due_date: addDays(invoiceDateIso, days) };
  }

  if (normalized === 'due now') {
    return { ok: true, payout_raw: raw, due_date: invoiceDateIso };
  }

  const dueOnMatch = normalized.match(/^due on\\s+(.+)$/);
  if (dueOnMatch) {
    const dueOnDate = parseExplicitDate(dueOnMatch[1], todayIso);
    if (dueOnDate.ok) {
      return { ok: true, payout_raw: raw, due_date: dueOnDate.value };
    }
  }

  return { ok: false, payout_raw: raw || '7 day payout', reason: 'unparseable payout' };
}

const todayIso = formatTodayIso();
const invoiceDateInput = payload.invoice_date_input || payload.invoice_date || '';
const invoiceDateResult = parseExplicitDate(invoiceDateInput, todayIso);
const payoutResult = invoiceDateResult.ok
  ? parsePayout(payload.payout_raw, invoiceDateResult.value, todayIso)
  : { ok: false, payout_raw: payload.payout_raw || '7 day payout', reason: 'unparseable invoice_date' };
const computedDueDate = invoiceDateResult.ok && payoutResult.ok ? payoutResult.due_date : '';
const daysUntilDue = computedDueDate ? diffDays(invoiceDateResult.value, computedDueDate) : 0;
// The Slack modal has a single "Currency" field. Requesters frequently type the
// amount there too (e.g. "SGD 1300"), so the figure never reaches a line item and the
// old validation hard-failed on "missing unit_price". Split that field into a clean
// 3-letter currency code and any embedded total, then feed the total into the
// line-item fallback below so the amount no longer has to live inside a line item.
const rawCurrency = String(payload.currency || '').trim();
const currencyCodeMatch = rawCurrency.match(/[A-Za-z]{3}/);
const cleanCurrency = currencyCodeMatch
  ? currencyCodeMatch[0].toUpperCase()
  : (rawCurrency.replace(/[^A-Za-z]/g, '').toUpperCase() || rawCurrency.toUpperCase());
const currencyEmbeddedAmount = Number((rawCurrency.match(/[0-9][0-9,.]*/g) || []).join('').replace(/,/g, '')) || 0;

// If all items have null prices but a total is available (payload field or embedded in
// the currency field), consolidate into one line item instead of failing.
const nullPriceItems = lineItems.filter(i => i.unit_price === null || i.unit_price === undefined);
let resolvedLineItems = lineItems;
if (nullPriceItems.length === lineItems.length && lineItems.length > 0) {
  const rawAmount = payload.amount || payload.total || payload.subtotal_amount || currencyEmbeddedAmount || 0;
  const payloadTotal = Number(String(rawAmount).replace(/[^0-9.]/g, '')) || 0;
  if (payloadTotal > 0) {
    resolvedLineItems = [{
      description: lineItems.map(i => i.raw_text || i.description || '').filter(Boolean).join(' — '),
      quantity: 1,
      unit_price: payloadTotal,
      raw_text: lineItems.map(i => i.raw_text || i.description || '').join('; '),
    }];
  }
}

const subtotal = resolvedLineItems.reduce((sum, item) => {
  const quantity = Number(item.quantity || 1);
  const unitPrice = Number(item.unit_price || 0);
  return sum + (quantity * unitPrice);
}, 0);

const missing = [];
if (!payload.client_name && !payload.client_name_or_company_name) missing.push('client_name_or_company_name');
if (!cleanCurrency) missing.push('currency');
if (!resolvedLineItems.length) missing.push('line_items');
const stillNullPriceItems = resolvedLineItems.filter(i => i.unit_price === null || i.unit_price === undefined);
if (stillNullPriceItems.length) missing.push('unit_price for: ' + stillNullPriceItems.map(i => i.description || 'unnamed').join(', '));

const resolvedClientName = payload.client_name_or_company_name || payload.client_name || payload.company_name || '';

const baseRequest = {
  request_id: requestId,
  submitted_at: new Date().toISOString(),
  origin_channel_id: payload.origin_channel_id || '',
  origin_thread_ts: payload.origin_thread_ts || '',
  submitted_by_slack_user_id: payload.submitted_by_slack_user_id || '',
  submitted_by_slack_user_name: payload.submitted_by_slack_user_name || '',
  client_name_or_company_name: resolvedClientName,
  company_name: resolvedClientName,
  client_name: resolvedClientName,
  billing_address: payload.billing_address || '',
  client_email: payload.client_email || '',
  currency: cleanCurrency || '',
  payout_raw: payoutResult.payout_raw || '7 day payout',
  invoice_date_input: invoiceDateInput,
  invoice_date: invoiceDateResult.ok ? invoiceDateResult.value : '',
  date_parse_status: invoiceDateResult.ok && payoutResult.ok ? 'parsed' : 'failed',
  due_date: computedDueDate,
  days_until_due: daysUntilDue,
  memo: payload.memo || '',
  line_items: resolvedLineItems,
  subtotal,
};

if (missing.length) {
  return [{
    json: {
      ...baseRequest,
      status: 'failed_validation',
      failure_stage: 'validation',
      failure_reason: 'Missing required fields: ' + missing.join(', '),
    }
  }];
}

if (!invoiceDateResult.ok || !payoutResult.ok) {
  return [{
    json: {
      ...baseRequest,
      status: 'failed_validation',
      failure_stage: 'validation',
      failure_reason: !invoiceDateResult.ok ? 'unparseable invoice_date' : 'unparseable payout',
    }
  }];
}

return [{
  json: {
    ...baseRequest,
    status: 'intake_received',
  }
}];
`.trim();

const PREPARE_PRODUCT_REQUEST_CODE = `
const customerId = $json.airwallex_customer_id || '';
const ctx = $('Merge Auth Token').first().json;
const lineItems = Array.isArray(ctx.line_items) ? ctx.line_items : [];

return lineItems.map((item, index) => ({
  json: {
    ...ctx,
    airwallex_customer_id: customerId,
    line_item_index: index,
    line_item: item,
    product_payload: {
      active: true,
      name: item.description || ('Item ' + (index + 1)),
      description: item.description || 'Invoice line item',
      request_id: (ctx.request_id || '') + '_prod_' + index,
    }
  }
}));
`.trim();

const PREPARE_PRICE_CODE = `
const ctx = $('Merge Auth Token').item.json;
const productId = $json.id || '';
const prepProduct = $('Prepare Product Payload').item.json;
const lineItem = prepProduct.line_item || {};

return {
  json: {
    ...ctx,
    airwallex_customer_id: prepProduct.airwallex_customer_id || '',
    line_item_index: prepProduct.line_item_index || 0,
    line_item: lineItem,
    airwallex_product_id: productId,
    price_payload: {
      currency: ctx.currency,
      product_id: productId,
      pricing_model: 'PER_UNIT',
      billing_type: 'IN_ADVANCE',
      unit_amount: lineItem.unit_price || 0,
      recurring: null,
      request_id: (ctx.request_id || '') + '_price_' + (prepProduct.line_item_index || 0),
    }
  }
};
`.trim();

const RESOLVE_CUSTOMER_CODE = `
const ctx = $('Merge Auth Token').item.json;
const items = Array.isArray($json.customer_lookup_items) ? $json.customer_lookup_items : [];
const clientName = (ctx.client_name || '').toLowerCase().trim();
const clientEmail = (ctx.client_email || '').toLowerCase().trim();

// ── Test/internal customer guard (added 2026-06-17 after a mis-billing incident) ──
// A Dojocare invoice was billed to "Krave Test" 4x: the request carried
// john@kravemedia.co (4 internal test customers share that email) and the resolver
// returned the first match. Never resolve a real invoice to an internal test record;
// fail safe to the manual fallback (DM John) instead of creating/billing.
const SENTINEL_EMAILS = ['john@kravemedia.co'];
const TEST_CUSTOMER_IDS = [
  'bcus_sgpdgmqz9hic0zyo485',
  'bcus_sgpdp7xdxhi30oyhmri',
  'bcus_sgpdb6h5zhi2uty4o1o',
  'bcus_sgpdn67v7hhopoh228m',
];

function emailsFor(customer) {
  return [
    customer.email,
    customer.email_address,
    customer.primary_email,
    customer.contact && customer.contact.email,
  ].filter(Boolean).map(e => String(e).toLowerCase().trim());
}

function isTestCustomer(customer) {
  if (!customer) return false;
  if (TEST_CUSTOMER_IDS.includes(customer.id)) return true;
  if ((customer.name || '').toLowerCase().includes('test')) return true;
  if (emailsFor(customer).some(e => SENTINEL_EMAILS.includes(e))) return true;
  return false;
}

function block(reason, message) {
  return { json: { ...ctx, airwallex_customer_id: '', customer_block_reason: reason,
    status: 'fallback_manual_required', failure_stage: 'customer_safety_block', failure_reason: message } };
}

// 1. Sentinel email on the request itself → never proceed.
if (SENTINEL_EMAILS.includes(clientEmail)) {
  return block('sentinel_email', 'billing email is an internal/test address (' + clientEmail + ') — confirm the correct client email');
}

// 2. Exact email match within the returned items (the API name filter does NOT narrow
//    the list, so never take first-of-list blindly).
const emailMatches = clientEmail ? items.filter(c => emailsFor(c).includes(clientEmail)) : [];
if (emailMatches.length > 1) {
  return block('ambiguous_email', 'billing email ' + clientEmail + ' matches ' + emailMatches.length + ' customers — ambiguous, confirm which client');
}
let found = emailMatches.length === 1 ? emailMatches[0] : null;

// 3. Name fallback: exact unique name match within results only (no fuzzy, no first-of-list).
if (!found && clientName) {
  const nameMatches = items.filter(c => (c.name || '').toLowerCase().trim() === clientName);
  found = nameMatches.length === 1 ? nameMatches[0] : null;
}

// 4. If we resolved to a test/internal customer → block.
if (found && isTestCustomer(found)) {
  return block('test_customer_match', 'resolved to internal test customer "' + (found.name || found.id) + '" — confirm the correct client');
}

return { json: { ...ctx, airwallex_customer_id: found ? found.id : '', customer_block_reason: '' } };
`.trim();

const LOOKUP_CUSTOMER_CODE = `
const ctx = $json;
const token = ctx.token || '';
const clientEmail = (ctx.client_email || '').trim();
const clientName = (ctx.client_name || '').trim();
const headers = {
  Authorization: 'Bearer ' + token,
  'x-api-version': '2025-06-16',
};

async function listCustomers(baseQuery) {
  let allItems = [];
  let pageNum = 0;
  let hasMore = true;
  while (hasMore) {
    const sep = baseQuery.includes('?') ? '&' : '?';
    const resp = await $helpers.httpRequest({
      method: 'GET',
      url: 'https://api.airwallex.com/api/v1/billing_customers' + baseQuery + sep + 'page_num=' + pageNum + '&page_size=50',
      headers,
    });
    const items = Array.isArray(resp.items) ? resp.items : Array.isArray(resp.data) ? resp.data : Array.isArray(resp) ? resp : [];
    allItems = allItems.concat(items);
    hasMore = resp.has_more === true && items.length > 0;
    pageNum++;
  }
  return allItems;
}

// email-first: reuse an existing billing customer by exact email before trying name.
let customer_lookup_items = [];
if (clientEmail) {
  customer_lookup_items = await listCustomers('?email=' + encodeURIComponent(ctx.client_email));
}

const normalizedEmail = clientEmail.toLowerCase();
const emailMatch = customer_lookup_items.find(customer => {
  const emails = [
    customer.email,
    customer.email_address,
    customer.primary_email,
    customer.contact && customer.contact.email,
  ].filter(Boolean).map(e => String(e).toLowerCase().trim());
  return emails.includes(normalizedEmail);
});

if (!emailMatch && clientName) {
  customer_lookup_items = await listCustomers('?name=' + encodeURIComponent(ctx.client_name));
}

return { json: { ...ctx, customer_lookup_items } };
`.trim();

const SET_CUSTOMER_ID_CODE = `
const ctx = $('Merge Auth Token').item.json;
return { json: { ...ctx, airwallex_customer_id: $json.id || '' } };
`.trim();

const AGGREGATE_PRICE_IDS_CODE = `
const allPriceResults = $input.all();
const ctx = $('Merge Auth Token').first().json;
const prepProductCtx = $('Prepare Product Payload').first().json;
const customerId = prepProductCtx.airwallex_customer_id || '';
let prepPriceItems = [];
try { prepPriceItems = $items('Prepare Price Payload', 0, 0) || []; } catch(e) {}

const collectedPrices = allPriceResults.map((item, i) => ({
  price_id: item.json.id,
  quantity: (prepPriceItems[i] && prepPriceItems[i].json.line_item && prepPriceItems[i].json.line_item.quantity) || 1,
}));

return [{ json: { ...ctx, airwallex_customer_id: customerId, collected_prices: collectedPrices } }];
`.trim();

const STANDARD_MEMO = `Kindly make payment by the due date to
Bank Name: DBS Bank Ltd
Bank Address: DBS Asia Central, Marina Bay Financial Centre Tower 3, 12 Marina Boulevard, Singapore 018982
Account Name: Eclipse Ventures Pte Ltd
Account Number: 8853795725
BIC/SWIFT: DBSSSGSG
or by paying via the invoice link directly.

Please note that a US$200 per month late fee applies to invoices not paid on time.`;

const PREPARE_INVOICE_CODE = `
const ctx = $('Merge Auth Token').item.json;
const customerId = $json.airwallex_customer_id || ctx.airwallex_customer_id || '';
const collectedPrices = $json.collected_prices || [];

const STANDARD_MEMO = ${JSON.stringify(STANDARD_MEMO)};
const projectMemo = (ctx.memo || '').trim();
const fullMemo = projectMemo ? STANDARD_MEMO + '\\n\\n' + projectMemo : STANDARD_MEMO;

return {
  json: {
    ...ctx,
    airwallex_customer_id: customerId,
    collected_prices: collectedPrices,
    invoice_payload: {
      billing_customer_id: customerId,
      currency: ctx.currency,
      collection_method: 'CHARGE_ON_CHECKOUT',
      linked_payment_account_id: 'acct_dcI6a3RSMbeCKZy9X-v7Mg',
      days_until_due: ctx.days_until_due,
      memo: fullMemo,
      request_id: ctx.request_id,
    }
  }
};
`.trim();

const PREPARE_LINE_ITEMS_CODE = `
const ctx = $('Merge Auth Token').item.json;
const invoiceId = $json.id || '';
const invoiceNumber = $json.number || $json.invoice_number || '';
const aggregated = $('Aggregate Price IDs').item.json;
const collectedPrices = aggregated.collected_prices || [];

return {
  json: {
    ...ctx,
    airwallex_invoice_id: invoiceId,
    airwallex_invoice_number: invoiceNumber,
    collected_prices: collectedPrices,
    add_line_items_payload: {
      request_id: (ctx.request_id || '') + '_items',
      line_items: collectedPrices.map((price, index) => ({
        price_id: price.price_id,
        quantity: price.quantity || 1,
        sequence: index + 1,
      }))
    }
  }
};
`.trim();

const DRAFT_SUCCESS_CODE = `
const ctx = $('Prepare Invoice Line Items').item.json;
return {
  json: {
    ...ctx,
    airwallex_invoice_id: ctx.airwallex_invoice_id || $json.id || '',
    airwallex_invoice_number: ctx.airwallex_invoice_number || $json.number || $json.invoice_number || '',
    status: 'airwallex_created',
    success_note: '${DRAFT_SUCCESS_NOTE}',
  }
};
`.trim();

const HYDRATE_FALLBACK_CODE = `
const baseline = ($items('Merge Requester Name', 0, 0)[0] || $items('Normalize Slack Submission', 0, 0)[0] || {}).json || {};
const current = $json || {};
const errorMessage = current.error?.message || current.failure_reason || '';

function inferFailureStage(message) {
  const lower = String(message || '').toLowerCase();
  if (lower.includes('billing_customers')) return 'create_billing_customer';
  if (lower.includes('/products/')) return 'create_products';
  if (lower.includes('/prices/')) return 'create_prices';
  if (lower.includes('add_line_items')) return 'attach_invoice_line_items';
  if (lower.includes('/invoices/create')) return 'create_draft_invoice';
  if (lower.includes('authentication')) return 'airwallex_auth';
  return 'airwallex';
}

return {
  json: {
    ...baseline,
    ...current,
    status: 'fallback_manual_required',
    failure_stage: current.failure_stage || inferFailureStage(errorMessage),
    failure_reason: current.failure_reason || errorMessage || 'manual Airwallex creation required',
    request_id: current.request_id || baseline.request_id || '',
    client_name: current.client_name || baseline.client_name || '',
    submitted_by_slack_user_id: current.submitted_by_slack_user_id || baseline.submitted_by_slack_user_id || '',
    submitted_by_slack_user_name: current.submitted_by_slack_user_name || baseline.submitted_by_slack_user_name || '',
    invoice_date: current.invoice_date || baseline.invoice_date || '',
    payout_raw: current.payout_raw || baseline.payout_raw || '7 day payout',
    due_date: current.due_date || baseline.due_date || '',
    subtotal: current.subtotal || baseline.subtotal || 0,
    currency: current.currency || baseline.currency || '',
    line_items: current.line_items || baseline.line_items || [],
  }
};
`.trim();

const workflow = {
  name: 'Krave - Invoice Request Intake',
  settings: {
    executionOrder: 'v1',
    saveManualExecutions: true,
  },
  nodes: [
    {
      id: 'n1',
      name: 'Webhook Trigger',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [240, 300],
      webhookId: 'krave-invoice-request-intake',
      parameters: {
        httpMethod: 'POST',
        path: 'krave-invoice-request-intake',
        responseMode: 'onReceived',
        options: {},
      },
    },
    {
      id: 'n2',
      name: 'Normalize Slack Submission',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [480, 300],
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: NORMALIZE_CODE,
      },
    },
    {
      id: 'n_lookup_requester',
      name: 'Lookup Requester Name',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [480, 160],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'GET',
        url: 'https://slack.com/api/users.info',
        sendQuery: true,
        queryParameters: { parameters: [
          { name: 'user', value: '={{ $json.submitted_by_slack_user_id }}' },
        ]},
        options: {},
      },
    },
    {
      id: 'n_merge_requester_name',
      name: 'Merge Requester Name',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [590, 160],
      parameters: {
        mode: 'runOnceForEachItem',
        jsCode: `const normalized = $('Normalize Slack Submission').item.json;\nconst profile = ($json.user || {}).profile || {};\nconst displayName = profile.display_name_normalized || profile.display_name || profile.real_name || normalized.submitted_by_slack_user_name || normalized.submitted_by_slack_user_id || '';\nreturn { json: { ...normalized, submitted_by_slack_user_name: displayName } };`,
      },
    },
    {
      id: 'n3',
      name: 'Airwallex Auth',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [700, 300],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: AIRWALLEX_AUTH_URL,
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'x-client-id', value: AIRWALLEX_CLIENT_ID },
            { name: 'x-api-key', value: AIRWALLEX_API_KEY },
          ],
        },
      },
    },
    {
      id: 'n_merge_auth',
      name: 'Merge Auth Token',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1030, 260],
      parameters: {
        mode: 'runOnceForEachItem',
        jsCode: `const normalized = $('Merge Requester Name').item.json;\nreturn { json: { ...normalized, token: $json.token } };`,
      },
    },
    {
      id: 'n_lookup_customer',
      name: 'Lookup Billing Customer',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1150, 260],
      continueOnFail: true,
      parameters: {
        mode: 'runOnceForEachItem',
        jsCode: LOOKUP_CUSTOMER_CODE,
      },
    },
    {
      id: 'n_resolve_customer',
      name: 'Resolve Customer',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1280, 260],
      parameters: { mode: 'runOnceForEachItem', jsCode: RESOLVE_CUSTOMER_CODE },
    },
    {
      // Test/internal customer guard (2026-06-17). If Resolve Customer set a
      // customer_block_reason, route to the manual fallback (DM John) — never create or bill.
      id: 'n_customer_safety_gate',
      name: 'Customer Safety Gate',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [1345, 160],
      parameters: {
        conditions: {
          options: { caseSensitive: true, typeValidation: 'strict', version: 2 },
          conditions: [{
            id: 'customer-block-check',
            leftValue: '={{ $json.customer_block_reason || "" }}',
            rightValue: '',
            operator: { type: 'string', operation: 'notEquals' },
          }],
          combinator: 'and',
        },
      },
    },
    {
      id: 'n_route_customer_exists',
      name: 'Route Customer Exists',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [1410, 260],
      parameters: {
        conditions: {
          options: { caseSensitive: true, typeValidation: 'strict', version: 2 },
          conditions: [{
            id: 'customer-id-empty-check',
            leftValue: '={{ $json.airwallex_customer_id }}',
            rightValue: '',
            operator: { type: 'string', operation: 'equals' },
          }],
          combinator: 'and',
        },
      },
    },
    {
      id: 'n6',
      name: 'Create Billing Customer',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1560, 180],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: AIRWALLEX_CUSTOMER_CREATE_URL,
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Authorization', value: '={{ "Bearer " + $("Merge Auth Token").item.json.token }}' },
            { name: 'Content-Type', value: 'application/json' },
            { name: 'x-api-version', value: '2025-06-16' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
          '={{ { name: $json.company_name || $json.client_name, email: $json.client_email || undefined, default_billing_currency: $json.currency, request_id: ($json.request_id || "") + "_cust" } }}',
      },
    },
    {
      id: 'n_set_customer_id',
      name: 'Set Customer ID',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1700, 180],
      parameters: { mode: 'runOnceForEachItem', jsCode: SET_CUSTOMER_ID_CODE },
    },
    {
      id: 'n7',
      name: 'Create Products',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1580, 260],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: AIRWALLEX_PRODUCT_CREATE_URL,
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Authorization', value: '={{ "Bearer " + $("Merge Auth Token").item.json.token }}' },
            { name: 'Content-Type', value: 'application/json' },
            { name: 'x-api-version', value: '2025-06-16' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ $json.product_payload || {} }}',
      },
    },
    {
      id: 'n8',
      name: 'Prepare Price Payload',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1700, 260],
      parameters: {
        mode: 'runOnceForEachItem',
        jsCode: PREPARE_PRICE_CODE,
      },
    },
    {
      id: 'n9',
      name: 'Create Prices',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1800, 260],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: AIRWALLEX_PRICE_CREATE_URL,
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Authorization', value: '={{ "Bearer " + $("Merge Auth Token").item.json.token }}' },
            { name: 'Content-Type', value: 'application/json' },
            { name: 'x-api-version', value: '2025-06-16' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ $json.price_payload || {} }}',
      },
    },
    {
      id: 'n10',
      name: 'Create Draft Invoice',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [2020, 260],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: AIRWALLEX_INVOICE_CREATE_URL,
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Authorization', value: '={{ "Bearer " + $("Merge Auth Token").item.json.token }}' },
            { name: 'Content-Type', value: 'application/json' },
            { name: 'x-api-version', value: '2025-06-16' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ $json.invoice_payload || { status: "draft" } }}',
      },
    },
    {
      id: 'n11',
      name: 'Attach Invoice Line Items',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [2240, 260],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: '={{ "https://api.airwallex.com/api/v1/invoices/" + $json.airwallex_invoice_id + "/add_line_items" }}',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Authorization', value: '={{ "Bearer " + $("Merge Auth Token").item.json.token }}' },
            { name: 'Content-Type', value: 'application/json' },
            { name: 'x-api-version', value: '2025-06-16' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ $json.add_line_items_payload || {} }}',
      },
    },
    {
      id: 'n12',
      name: 'Write Tracker Success',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [2680, 220],
      credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet',
        operation: 'append',
        documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        columns: {
          mappingMode: 'defineBelow',
          value: SUCCESS_TRACKER_COLUMNS,
          schema: [],
        },
        options: {},
      },
    },
    {
      id: 'n13',
      name: 'Write Tracker Fallback',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [920, 420],
      credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet',
        operation: 'append',
        documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        columns: {
          mappingMode: 'defineBelow',
          value: FALLBACK_TRACKER_COLUMNS,
          schema: [],
        },
        options: {},
      },
    },
    {
      id: 'n15',
      name: 'DM John Failure Alert',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [1140, 420],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message',
        operation: 'post',
        select: 'channel',
        channelId: { __rl: true, value: JOHN_DM_CHANNEL, mode: 'id' },
        text: JOHN_DM_TEXT,
        otherOptions: {},
      },
    },
    {
      id: 'n16',
      name: 'Prepare Product Payload',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1470, 260],
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: PREPARE_PRODUCT_REQUEST_CODE,
      },
    },
    {
      id: 'n_aggregate_prices',
      name: 'Aggregate Price IDs',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [2020, 380],
      parameters: { mode: 'runOnceForAllItems', jsCode: AGGREGATE_PRICE_IDS_CODE },
    },
    {
      id: 'n17',
      name: 'Prepare Draft Invoice Payload',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1920, 260],
      parameters: {
        mode: 'runOnceForEachItem',
        jsCode: PREPARE_INVOICE_CODE,
      },
    },
    {
      id: 'n18',
      name: 'Prepare Invoice Line Items',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [2140, 260],
      parameters: {
        mode: 'runOnceForEachItem',
        jsCode: PREPARE_LINE_ITEMS_CODE,
      },
    },
    {
      id: 'n19',
      name: 'Mark Draft Success',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [2460, 260],
      parameters: {
        mode: 'runOnceForEachItem',
        jsCode: DRAFT_SUCCESS_CODE,
      },
    },
    {
      id: 'n20',
      name: 'Route Validation Outcome',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [700, 420],
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            typeValidation: 'strict',
            version: 2,
          },
          conditions: [
            {
              id: 'validation-status-check',
              leftValue: '={{ $json.status }}',
              rightValue: 'failed_validation',
              operator: {
                type: 'string',
                operation: 'equals',
              },
            },
          ],
          combinator: 'and',
        },
      },
    },
    {
      id: 'n21',
      name: 'Route Fallback Outcome',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [2680, 360],
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            typeValidation: 'strict',
            version: 2,
          },
          conditions: [
            {
              id: 'fallback-status-check',
              leftValue: '={{ $json.status }}',
              rightValue: FALLBACK_STATUS,
              operator: {
                type: 'string',
                operation: 'equals',
              },
            },
            {
              id: 'validation-status-check',
              leftValue: '={{ $json.status }}',
              rightValue: 'error',
              operator: {
                type: 'string',
                operation: 'equals',
              },
            },
          ],
          combinator: 'or',
        },
      },
    },
    {
      id: 'n22',
      name: 'Route Airwallex Outcome',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [920, 380],
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            typeValidation: 'strict',
            version: 2,
          },
          conditions: [
            {
              id: 'auth-fallback-status-check',
              leftValue: '={{ $json.status }}',
              rightValue: FALLBACK_STATUS,
              operator: {
                type: 'string',
                operation: 'equals',
              },
            },
            {
              id: 'auth-token-check',
              leftValue: '={{ $json.token || "" }}',
              rightValue: '',
              operator: {
                type: 'string',
                operation: 'equals',
              },
            },
          ],
          combinator: 'or',
        },
      },
    },
    {
      id: 'n23',
      name: 'Route Invoice Chain Outcome',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [2140, 380],
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            typeValidation: 'strict',
            version: 2,
          },
          conditions: [
            {
              id: 'invoice-fallback-status-check',
              leftValue: '={{ $json.status }}',
              rightValue: FALLBACK_STATUS,
              operator: {
                type: 'string',
                operation: 'equals',
              },
            },
            {
              id: 'invoice-id-check',
              leftValue: '={{ $json.error ? "error" : "" }}',
              rightValue: 'error',
              operator: {
                type: 'string',
                operation: 'equals',
              },
            },
          ],
          combinator: 'or',
        },
      },
    },
    {
      id: 'n24',
      name: 'Route Customer Create Outcome',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [1260, 380],
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            typeValidation: 'strict',
            version: 2,
          },
          conditions: [
            {
              id: 'customer-create-error-check',
              leftValue: '={{ $json.error ? "error" : "" }}',
              rightValue: 'error',
              operator: {
                type: 'string',
                operation: 'equals',
              },
            },
          ],
          combinator: 'and',
        },
      },
    },
    {
      id: 'n25',
      name: 'Route Product Create Outcome',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [1700, 380],
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            typeValidation: 'strict',
            version: 2,
          },
          conditions: [
            {
              id: 'product-create-error-check',
              leftValue: '={{ $json.error ? "error" : "" }}',
              rightValue: 'error',
              operator: {
                type: 'string',
                operation: 'equals',
              },
            },
          ],
          combinator: 'and',
        },
      },
    },
    {
      id: 'n26',
      name: 'Route Price Create Outcome',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [1920, 380],
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            typeValidation: 'strict',
            version: 2,
          },
          conditions: [
            {
              id: 'price-create-error-check',
              leftValue: '={{ $json.error ? "error" : "" }}',
              rightValue: 'error',
              operator: {
                type: 'string',
                operation: 'equals',
              },
            },
          ],
          combinator: 'and',
        },
      },
    },
    {
      id: 'n27',
      name: 'Route Line Item Outcome',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [2360, 380],
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            typeValidation: 'strict',
            version: 2,
          },
          conditions: [
            {
              id: 'line-item-error-check',
              leftValue: '={{ $json.error ? "error" : "" }}',
              rightValue: 'error',
              operator: {
                type: 'string',
                operation: 'equals',
              },
            },
          ],
          combinator: 'and',
        },
      },
    },
    {
      id: 'n29',
      name: 'Requester Success Confirmation',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [3120, 220],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'POST',
        url: 'https://slack.com/api/chat.postMessage',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ { channel: $('Mark Draft Success').item.json.origin_channel_id || $('Mark Draft Success').item.json.submitted_by_slack_user_id, thread_ts: $('Mark Draft Success').item.json.origin_thread_ts || undefined, text: '✅ Invoice draft created for *' + $('Mark Draft Success').item.json.client_name + '*\\n• Amount: ' + $('Mark Draft Success').item.json.currency + ' ' + $('Mark Draft Success').item.json.subtotal + '\\n• Invoice #: ' + ($('Mark Draft Success').item.json.airwallex_invoice_number || $('Mark Draft Success').item.json.airwallex_invoice_id) + '\\n• Due: ' + $('Mark Draft Success').item.json.due_date + '\\n• Status: Draft - pending John review in Airwallex\\n• Requested by: <@' + $('Mark Draft Success').item.json.submitted_by_slack_user_id + '>' } }}`,
        options: {},
      },
    },
    {
      id: 'n30',
      name: 'Notify John for Approval',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [2900, 420],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message',
        operation: 'post',
        select: 'channel',
        channelId: { __rl: true, value: JOHN_APPROVAL_CHANNEL, mode: 'id' },
        text: JOHN_APPROVAL_TEXT,
        otherOptions: {},
      },
    },
    {
      id: 'n28',
      name: 'Hydrate Fallback Context',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [3120, 520],
      parameters: {
        mode: 'runOnceForEachItem',
        jsCode: HYDRATE_FALLBACK_CODE,
      },
    },
    {
      id: 'n_route_missing_price',
      name: 'Route Missing Price Failure',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [700, 620],
      parameters: {
        conditions: {
          options: { caseSensitive: false, typeValidation: 'strict', version: 2 },
          conditions: [{
            id: 'missing-price-check',
            leftValue: '={{ $json.failure_reason }}',
            rightValue: 'unit_price',
            operator: { type: 'string', operation: 'contains' },
          }],
          combinator: 'and',
        },
      },
    },
    {
      id: 'n_slack_prompt_price',
      name: 'Slack Prompt Requester for Price',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [920, 620],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'POST',
        url: 'https://slack.com/api/chat.postMessage',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: PROMPT_REQUESTER_PRICE_BODY,
        options: {},
      },
    },
  ],
  connections: {
    'Webhook Trigger': { main: [[{ node: 'Normalize Slack Submission', type: 'main', index: 0 }]] },
    'Normalize Slack Submission': { main: [[{ node: 'Lookup Requester Name', type: 'main', index: 0 }]] },
    'Lookup Requester Name': { main: [[{ node: 'Merge Requester Name', type: 'main', index: 0 }]] },
    'Merge Requester Name': { main: [[{ node: 'Route Validation Outcome', type: 'main', index: 0 }]] },
    'Route Validation Outcome': { main: [
      [{ node: 'Hydrate Fallback Context', type: 'main', index: 0 }],
      [{ node: 'Airwallex Auth', type: 'main', index: 0 }],
    ]},
    'Airwallex Auth': { main: [[{ node: 'Route Airwallex Outcome', type: 'main', index: 0 }]] },
    'Route Airwallex Outcome': { main: [
      [{ node: 'Hydrate Fallback Context', type: 'main', index: 0 }],
      [{ node: 'Merge Auth Token', type: 'main', index: 0 }],
    ]},
    'Merge Auth Token': { main: [[{ node: 'Lookup Billing Customer', type: 'main', index: 0 }]] },
    'Lookup Billing Customer': { main: [[{ node: 'Resolve Customer', type: 'main', index: 0 }]] },
    'Resolve Customer': { main: [[{ node: 'Customer Safety Gate', type: 'main', index: 0 }]] },
    'Customer Safety Gate': { main: [
      [{ node: 'Hydrate Fallback Context', type: 'main', index: 0 }],   // TRUE — blocked: DM John, do not create
      [{ node: 'Route Customer Exists', type: 'main', index: 0 }],      // FALSE — safe: proceed
    ]},
    'Route Customer Exists': { main: [
      [{ node: 'Create Billing Customer', type: 'main', index: 0 }],
      [{ node: 'Prepare Product Payload', type: 'main', index: 0 }],
    ]},
    'Create Billing Customer': { main: [[{ node: 'Route Customer Create Outcome', type: 'main', index: 0 }]] },
    'Route Customer Create Outcome': { main: [
      [{ node: 'Hydrate Fallback Context', type: 'main', index: 0 }],
      [{ node: 'Set Customer ID', type: 'main', index: 0 }],
    ]},
    'Set Customer ID': { main: [[{ node: 'Prepare Product Payload', type: 'main', index: 0 }]] },
    'Prepare Product Payload': { main: [[{ node: 'Create Products', type: 'main', index: 0 }]] },
    'Create Products': { main: [[{ node: 'Route Product Create Outcome', type: 'main', index: 0 }]] },
    'Route Product Create Outcome': { main: [
      [{ node: 'Hydrate Fallback Context', type: 'main', index: 0 }],
      [{ node: 'Prepare Price Payload', type: 'main', index: 0 }],
    ]},
    'Prepare Price Payload': { main: [[{ node: 'Create Prices', type: 'main', index: 0 }]] },
    'Create Prices': { main: [[{ node: 'Route Price Create Outcome', type: 'main', index: 0 }]] },
    'Route Price Create Outcome': { main: [
      [{ node: 'Hydrate Fallback Context', type: 'main', index: 0 }],
      [{ node: 'Aggregate Price IDs', type: 'main', index: 0 }],
    ]},
    'Aggregate Price IDs': { main: [[{ node: 'Prepare Draft Invoice Payload', type: 'main', index: 0 }]] },
    'Prepare Draft Invoice Payload': { main: [[{ node: 'Create Draft Invoice', type: 'main', index: 0 }]] },
    'Create Draft Invoice': { main: [[{ node: 'Route Invoice Chain Outcome', type: 'main', index: 0 }]] },
    'Route Invoice Chain Outcome': { main: [
      [{ node: 'Hydrate Fallback Context', type: 'main', index: 0 }],
      [{ node: 'Prepare Invoice Line Items', type: 'main', index: 0 }],
    ]},
    'Prepare Invoice Line Items': { main: [[{ node: 'Attach Invoice Line Items', type: 'main', index: 0 }]] },
    'Attach Invoice Line Items': { main: [[{ node: 'Route Line Item Outcome', type: 'main', index: 0 }]] },
    'Route Line Item Outcome': { main: [
      [{ node: 'Hydrate Fallback Context', type: 'main', index: 0 }],
      [{ node: 'Mark Draft Success', type: 'main', index: 0 }],
    ]},
    'Mark Draft Success': { main: [[{ node: 'Route Fallback Outcome', type: 'main', index: 0 }]] },
    'Route Fallback Outcome': { main: [
      [{ node: 'Hydrate Fallback Context', type: 'main', index: 0 }],
      [{ node: 'Write Tracker Success', type: 'main', index: 0 }],
    ]},
    'Hydrate Fallback Context': { main: [[{ node: 'Route Missing Price Failure', type: 'main', index: 0 }]] },
    'Route Missing Price Failure': { main: [
      [  // TRUE — missing unit_price: prompt requester + log tracker
        { node: 'Slack Prompt Requester for Price', type: 'main', index: 0 },
        { node: 'Write Tracker Fallback', type: 'main', index: 0 },
      ],
      [  // FALSE — other failure: log tracker + DM John
        { node: 'Write Tracker Fallback', type: 'main', index: 0 },
        { node: 'DM John Failure Alert', type: 'main', index: 0 },
      ],
    ]},
    'Write Tracker Success': { main: [[
      { node: 'Requester Success Confirmation', type: 'main', index: 0 },
      { node: 'Notify John for Approval', type: 'main', index: 0 },
    ]] },
  },
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
  const result = await n8nRequest('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, workflow);
  if (!result.id) {
    console.log('ERROR:', JSON.stringify(result, null, 2).substring(0, 2000));
    return;
  }
  await n8nRequest('POST', `/api/v1/workflows/${WORKFLOW_ID}/activate`);
  console.log('SUCCESS');
  console.log('Workflow ID:', result.id);
  console.log('Name:', result.name);
  console.log('URL: https://noatakhel.app.n8n.cloud/workflow/' + result.id);
  console.log('\nNext: Activate the workflow in n8n, then test via:');
  console.log('POST https://noatakhel.app.n8n.cloud/webhook/krave-invoice-request-intake');
}

if (require.main === module) {
  deploy().catch((e) => console.error('Deploy failed:', e.message));
}

module.exports = {
  API_KEY,
  DRAFT_SUCCESS_NOTE,
  DRAFT_REVIEW_STATUS,
  FALLBACK_STATUS,
  LINE_ITEMS_PAYLOAD_LABEL,
  N8N_URL,
  workflow,
};
