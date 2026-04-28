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
  Status: DRAFT_REVIEW_STATUS,
  'Requested By': '={{ $json.submitted_by_slack_user_id }}',
  'Origin Thread TS': '={{ $json.origin_thread_ts || "" }}',
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
  Status: FALLBACK_STATUS,
  'Requested By': '={{ $json.submitted_by_slack_user_id }}',
  'Origin Thread TS': '={{ $json.origin_thread_ts || "" }}',
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
  "={{ '📋 *New Invoice Draft — ' + $('Mark Draft Success').item.json.client_name + '*\\n• Amount: ' + $('Mark Draft Success').item.json.currency + ' ' + $('Mark Draft Success').item.json.subtotal + '\\n• Client email: ' + $('Mark Draft Success').item.json.client_email + '\\n• Due: ' + $('Mark Draft Success').item.json.due_date + '\\n• Invoice ID: ' + $('Mark Draft Success').item.json.airwallex_invoice_id + '\\n• Airwallex Invoice #: ' + ($('Mark Draft Success').item.json.airwallex_invoice_number || $('Mark Draft Success').item.json.airwallex_invoice_id) + '\\n• Requested by: <@' + $('Mark Draft Success').item.json.submitted_by_slack_user_id + '>\\n\\nReply *approve* in this thread to finalize and send payment link to client.' }}";

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

  // Handles: "7", "30", "7 days", "30 days", "7 day payout", "30 day payout"
  const daysMatch = normalized.match(/^(\\d+)(\\s+days?(\\s+payout)?)?$/);
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
const subtotal = lineItems.reduce((sum, item) => {
  const quantity = Number(item.quantity || 1);
  const unitPrice = Number(item.unit_price || 0);
  return sum + (quantity * unitPrice);
}, 0);

const missing = [];
if (!payload.client_name && !payload.client_name_or_company_name) missing.push('client_name_or_company_name');
if (!payload.currency) missing.push('currency');
if (!lineItems.length) missing.push('line_items');

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
  currency: payload.currency || '',
  payout_raw: payoutResult.payout_raw || '7 day payout',
  invoice_date_input: invoiceDateInput,
  invoice_date: invoiceDateResult.ok ? invoiceDateResult.value : '',
  date_parse_status: invoiceDateResult.ok && payoutResult.ok ? 'parsed' : 'failed',
  due_date: computedDueDate,
  days_until_due: daysUntilDue,
  memo: payload.memo || '',
  line_items: lineItems,
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
const items = Array.isArray($json.items) ? $json.items : [];
const clientName = (ctx.client_name || '').toLowerCase().trim();
const found = items.find(c => (c.name || '').toLowerCase().trim() === clientName);
return { json: { ...ctx, airwallex_customer_id: found ? found.id : '' } };
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

const PREPARE_INVOICE_CODE = `
const ctx = $('Merge Auth Token').item.json;
const customerId = $json.airwallex_customer_id || ctx.airwallex_customer_id || '';
const collectedPrices = $json.collected_prices || [];

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
      memo: ctx.memo || '',
      request_id: ctx.request_id,
    }
  }
};
`.trim();

const PREPARE_LINE_ITEMS_CODE = `
const ctx = $('Merge Auth Token').item.json;
const invoiceId = $json.id || '';
const invoiceNumber = $json.invoice_number || '';
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
    airwallex_invoice_number: ctx.airwallex_invoice_number || $json.invoice_number || '',
    status: 'airwallex_created',
    success_note: '${DRAFT_SUCCESS_NOTE}',
  }
};
`.trim();

const HYDRATE_FALLBACK_CODE = `
const baseline = ($items('Normalize Slack Submission', 0, 0)[0] || {}).json || {};
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
        jsCode: `const normalized = $('Normalize Slack Submission').item.json;\nreturn { json: { ...normalized, token: $json.token } };`,
      },
    },
    {
      id: 'n_lookup_customer',
      name: 'Lookup Billing Customer',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1150, 260],
      continueOnFail: true,
      parameters: {
        method: 'GET',
        url: 'https://api.airwallex.com/api/v1/billing_customers',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Authorization', value: '={{ "Bearer " + $json.token }}' },
            { name: 'x-api-version', value: '2025-06-16' },
          ],
        },
        sendQuery: true,
        queryParameters: {
          parameters: [{ name: 'name', value: '={{ $json.client_name }}' }],
        },
        options: {},
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
      name: 'Post Origin Channel Success',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [3120, 220],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message',
        operation: 'post',
        select: 'channel',
        channelId: { __rl: true, value: '={{ $("Mark Draft Success").item.json.origin_channel_id || $("Mark Draft Success").item.json.submitted_by_slack_user_id }}', mode: 'id' },
        text: ORIGIN_CHANNEL_SUCCESS_TEXT,
        otherOptions: {
          thread_ts: '={{ $("Mark Draft Success").item.json.origin_thread_ts || "" }}',
        },
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
  ],
  connections: {
    'Webhook Trigger': { main: [[{ node: 'Normalize Slack Submission', type: 'main', index: 0 }]] },
    'Normalize Slack Submission': { main: [[{ node: 'Route Validation Outcome', type: 'main', index: 0 }]] },
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
    'Resolve Customer': { main: [[{ node: 'Route Customer Exists', type: 'main', index: 0 }]] },
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
    'Hydrate Fallback Context': { main: [[
      { node: 'Write Tracker Fallback', type: 'main', index: 0 },
      { node: 'DM John Failure Alert', type: 'main', index: 0 },
    ]]},
    'Write Tracker Success': { main: [[
      { node: 'Post Origin Channel Success', type: 'main', index: 0 },
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
