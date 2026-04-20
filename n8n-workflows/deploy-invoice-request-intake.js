const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiMTkwMWE5My02ZjJjLTRlNzEtOWI4ZC02ZjlhMzVhMjU4NzUiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiZjBlZjk1YTYtYzc2MS00Zjc2LWJkZTgtMWU1Y2FiN2UxMjcxIiwiaWF0IjoxNzc2NjY1NjMxfQ.uBo2H0dzui9S0_MktoRxdodKzzE58vcQtXSlu8VpcEY';
const FALLBACK_STATUS = 'fallback_manual_required';
const DRAFT_SUCCESS_NOTE = 'draft invoice created';
const DRAFT_REVIEW_STATUS = 'Draft - Pending John Review';
const AIRWALLEX_AUTH_URL = 'https://api.airwallex.com/api/v1/authentication/login';
const AIRWALLEX_CUSTOMER_LIST_URL = 'https://api.airwallex.com/api/v1/billing_customers';
const AIRWALLEX_CUSTOMER_CREATE_URL = 'https://api.airwallex.com/api/v1/billing_customers/create';
const AIRWALLEX_PRODUCT_CREATE_URL = 'https://api.airwallex.com/api/v1/products/create';
const AIRWALLEX_PRICE_CREATE_URL = 'https://api.airwallex.com/api/v1/prices/create';
const AIRWALLEX_INVOICE_CREATE_URL = 'https://api.airwallex.com/api/v1/invoices/create';
const SUCCESS_TRACKER_COLUMNS = {
  'Date Created': '={{ $json.submitted_at }}',
  'Client Name': '={{ $json.client_name }}',
  'Email Address': '={{ $json.client_email || "" }}',
  'Project Description':
    '={{ ($json.memo || "Structured Slack modal intake") + " | Structured Slack modal" }}',
  'Invoice #': '={{ $json.airwallex_invoice_id || $json.request_id }}',
  'Airwallex Customer ID': '={{ $json.airwallex_customer_id }}',
  'Airwallex Invoice ID': '={{ $json.airwallex_invoice_id }}',
  Amount: '={{ $json.subtotal }}',
  Currency: '={{ $json.currency }}',
  'Due Date': '={{ $json.due_date }}',
  Status: DRAFT_REVIEW_STATUS,
  'Requested By': '={{ $json.submitted_by_slack_user_id }}',
};
const REQUESTER_SUCCESS_TEXT =
  "={{ 'Invoice request received. Airwallex draft invoice was created for ' + $json.client_name + ' (' + $json.currency + ' ' + $json.subtotal + '). Request ID: ' + $json.request_id }}";
const FALLBACK_TRACKER_COLUMNS = {
  'Date Created': '={{ $json.submitted_at }}',
  'Client Name': '={{ $json.client_name }}',
  'Email Address': '={{ $json.client_email || "" }}',
  'Project Description':
    '={{ (($json.memo || "Structured Slack modal intake") + " | Structured Slack modal | " + ($json.failure_stage || "intake") + ": " + ($json.failure_reason || "manual Airwallex creation required")).slice(0, 500) }}',
  'Invoice #': '={{ $json.request_id }}',
  'Airwallex Customer ID': '={{ $json.airwallex_customer_id || "" }}',
  'Airwallex Invoice ID': '={{ $json.airwallex_invoice_id || "" }}',
  Amount: '={{ $json.subtotal }}',
  Currency: '={{ $json.currency }}',
  'Due Date': '={{ $json.due_date }}',
  Status: FALLBACK_STATUS,
  'Requested By': '={{ $json.submitted_by_slack_user_id }}',
};
const REQUESTER_FALLBACK_TEXT =
  "={{ 'Invoice request received for ' + $json.client_name + '. Manual Airwallex creation required. Request ID: ' + $json.request_id }}";
const LINE_ITEMS_PAYLOAD_LABEL = 'Line Items Payload';
const JOHN_DM_TEXT =
  "={{ 'Invoice intake fallback\\nRequest ID: ' + $json.request_id + '\\nClient: ' + $json.client_name + '\\nRequester: ' + $json.submitted_by_slack_user_id + '\\nSubtotal: ' + $json.currency + ' ' + $json.subtotal + '\\nFailure stage: ' + $json.failure_stage + '\\nFailure reason: ' + $json.failure_reason + '\\n' + '" + LINE_ITEMS_PAYLOAD_LABEL + ": ' + JSON.stringify($json.line_items) }}";
const AIRWALLEX_CLIENT_ID = 'JaQA4uJ1SDSBkTdFigT9sw';
const AIRWALLEX_API_KEY = '5611f8e189ef357e5b3493916208efb80413595b50e7201b8fc98af5c91666f50b10ee64fd87fa3db7435e8dc5c07721';
const SHEETS_CRED_ID = '83MQOm78gYDvziTO';
const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD';
const SHEET_ID = '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50';
const REQUESTER_SLACK_FALLBACK_CHANNEL = '={{ $json.submitted_by_slack_user_id || "" }}';
const JOHN_DM_CHANNEL = 'U0AM5EGRVTP';

const NORMALIZE_CODE = `
const payload = $json.body || $json;
const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
const requestId = 'invreq_' + Date.now();
const subtotal = lineItems.reduce((sum, item) => {
  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unit_price || 0);
  return sum + (quantity * unitPrice);
}, 0);

const missing = [];
if (!payload.client_name) missing.push('client_name');
if (!payload.currency) missing.push('currency');
if (!payload.due_date) missing.push('due_date');
if (!lineItems.length) missing.push('line_items');

const baseRequest = {
  request_id: requestId,
  submitted_at: new Date().toISOString(),
  submitted_by_slack_user_id: payload.submitted_by_slack_user_id || '',
  company_name: payload.company_name || payload.client_name || '',
  client_name: payload.client_name || '',
  client_email: payload.client_email || '',
  currency: payload.currency || '',
  due_date: payload.due_date || '',
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

return [{
  json: {
    ...baseRequest,
    status: 'intake_received',
  }
}];
`.trim();

const CUSTOMER_RESOLUTION_CODE = `
const request = $json;
const candidates = Array.isArray($json.customer_candidates) ? $json.customer_candidates : [];

// Airwallex customer resolution should prefer company name or client name, not email.
if (candidates.length > 1) {
  return [{
    json: {
      ...request,
      status: '${FALLBACK_STATUS}',
      failure_stage: 'customer_resolution',
      failure_reason: 'ambiguous customer match',
    }
  }];
}

return [{
  json: {
    ...request,
    customer_lookup_name: request.company_name || request.client_name || '',
    customer_candidates: candidates,
    customer_resolution_status: candidates.length === 1 ? 'matched_existing_customer' : 'create_customer_required',
  }
}];
`.trim();

const PREPARE_PRODUCT_CODE = `
const request = $json;

// Products are request-specific because invoice line items vary per submission.
const lineItems = Array.isArray(request.line_items) ? request.line_items : [];

return [{
  json: {
    ...request,
    current_line_item: lineItems[0] || {},
    line_item_count: lineItems.length,
    request_specific_products: lineItems.map((item, index) => ({
      request_id: request.request_id,
      line_index: index,
      description: item.description || 'Invoice line item',
      quantity: Number(item.quantity || 0),
      unit_price: Number(item.unit_price || 0),
      currency: request.currency,
      product_name: (request.client_name || request.company_name || 'Client') + ' item ' + (index + 1),
      memo: request.memo || '',
    })),
  }
}];
`.trim();

const PREPARE_PRODUCT_REQUEST_CODE = `
const preparedProducts = Array.isArray($json.request_specific_products) ? $json.request_specific_products : [];
const firstProduct = preparedProducts[0] || {};

return [{
  json: {
    ...$json,
    product_payloads: preparedProducts.map((product) => ({
      active: true,
      name: product.product_name || 'Invoice line item',
      description: product.description || 'Invoice line item',
      request_id: $json.request_id,
      metadata: {
        line_index: product.line_index,
        quantity: product.quantity,
        unit_price: product.unit_price,
        currency: product.currency,
      },
    })),
    product_payload: {
      active: true,
      name: firstProduct.product_name || 'Invoice line item',
      description: firstProduct.description || 'Invoice line item',
      request_id: $json.request_id,
    }
  }
}];
`.trim();

const PREPARE_PRICE_CODE = `
const preparedProducts = Array.isArray($json.request_specific_products) ? $json.request_specific_products : [];
const firstProduct = preparedProducts[0] || {};
const productBody = $json.body && $json.body.id ? $json.body : {};
const productIds = Array.isArray($json.airwallex_product_ids) ? $json.airwallex_product_ids : [];

return [{
  json: {
    ...$json,
    active_product: firstProduct,
    requested_price_payloads: preparedProducts.map((product, index) => ({
      currency: $json.currency,
      product_id: productIds[index] || $json.airwallex_product_id || productBody.id || '',
      pricing_model: 'PER_UNIT',
      billing_type: 'IN_ADVANCE',
      unit_amount: product.unit_price || 0,
      recurring: null,
      resolved_price_id_hint: '',
      metadata: {
        line_index: product.line_index,
        quantity: product.quantity,
        description: product.description || 'Invoice line item',
      },
    })),
    price_payload: {
      currency: $json.currency,
      product_id: $json.airwallex_product_id || productBody.id || '',
      pricing_model: 'PER_UNIT',
      billing_type: 'IN_ADVANCE',
      unit_amount: firstProduct.unit_price || 0,
      recurring: null,
    }
  }
}];
`.trim();

const PREPARE_INVOICE_CODE = `
const candidates = Array.isArray($json.customer_candidates) ? $json.customer_candidates : [];
const existingCustomer = candidates.length === 1 ? candidates[0] : null;
const createdCustomer = $json.body && $json.body.id ? $json.body : $json;
const resolvedCustomerId =
  $json.airwallex_customer_id ||
  existingCustomer?.id ||
  createdCustomer.id ||
  '';

return [{
  json: {
    ...$json,
    airwallex_customer_id: resolvedCustomerId,
    invoice_payload: {
      billing_customer_id: resolvedCustomerId,
      currency: $json.currency,
      collection_method: 'OUT_OF_BAND',
      days_until_due: 14,
      memo: $json.memo || '',
      request_id: $json.request_id,
    }
  }
}];
`.trim();

const PREPARE_LINE_ITEMS_CODE = `
const request = $json;
const invoiceBody = request.body && request.body.id ? request.body : {};
const invoiceId = request.airwallex_invoice_id || invoiceBody.id || request.invoice_payload?.invoice_id || '';
const lineItems = Array.isArray(request.line_items) ? request.line_items : [];
const priceBody = request.price_body && request.price_body.id ? request.price_body : {};
const priceId = request.airwallex_price_id || priceBody.id || '';
const priceIds = Array.isArray(request.airwallex_price_ids)
  ? request.airwallex_price_ids
  : Array.isArray(request.requested_price_payloads)
    ? request.requested_price_payloads.map((item) => item.resolved_price_id_hint || '')
    : [];
const preparedLineItems = lineItems.map((item, index) => ({
  source_line_index: index,
  description: item.description || 'Invoice line item',
  quantity: Number(item.quantity || 0),
  unit_price: Number(item.unit_price || 0),
  resolved_price_id: priceIds[index] || priceId,
}));

return [{
  json: {
    ...request,
    airwallex_invoice_id: invoiceId,
    prepared_line_items: preparedLineItems,
    add_line_items_payload: {
      line_items: preparedLineItems.map((item, index) => ({
        price_id: item.resolved_price_id,
        quantity: item.quantity,
        sequence: index + 1,
      }))
    }
  }
}];
`.trim();

const DRAFT_SUCCESS_CODE = `
return [{
  json: {
    ...$json,
    airwallex_customer_id: $json.airwallex_customer_id || ($json.invoice_payload && $json.invoice_payload.billing_customer_id) || '',
    airwallex_product_id: $json.airwallex_product_id || (($json.body && $json.body.id) || ''),
    airwallex_invoice_id: $json.airwallex_invoice_id || ($json.body && $json.body.id) || '',
    status: 'airwallex_created',
    success_note: '${DRAFT_SUCCESS_NOTE}',
  }
}];
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
      id: 'n4',
      name: 'Find Billing Customer',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [920, 260],
      parameters: {
        method: 'GET',
        url: AIRWALLEX_CUSTOMER_LIST_URL,
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Authorization', value: '={{ "Bearer " + $json.token }}' },
          ],
        },
        sendQuery: true,
        queryParameters: {
          parameters: [
            {
              name: 'name',
              value: '={{ $json.company_name || $json.client_name }}',
            },
          ],
        },
      },
    },
    {
      id: 'n5',
      name: 'Resolve Billing Customer',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1140, 260],
      parameters: {
        mode: 'runOnceForEachItem',
        jsCode: CUSTOMER_RESOLUTION_CODE,
      },
    },
    {
      id: 'n6',
      name: 'Create Billing Customer',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1360, 260],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: AIRWALLEX_CUSTOMER_CREATE_URL,
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Authorization', value: '={{ "Bearer " + $json.token }}' },
            { name: 'Content-Type', value: 'application/json' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
          '={{ { name: $json.company_name || $json.client_name, default_billing_currency: $json.currency, email: $json.client_email || undefined, request_id: $json.request_id } }}',
      },
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
            { name: 'Authorization', value: '={{ "Bearer " + $json.token }}' },
            { name: 'Content-Type', value: 'application/json' },
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
            { name: 'Authorization', value: '={{ "Bearer " + $json.token }}' },
            { name: 'Content-Type', value: 'application/json' },
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
            { name: 'Authorization', value: '={{ "Bearer " + $json.token }}' },
            { name: 'Content-Type', value: 'application/json' },
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
            { name: 'Authorization', value: '={{ "Bearer " + $json.token }}' },
            { name: 'Content-Type', value: 'application/json' },
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
      id: 'n14',
      name: 'Requester Success Confirmation',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [2900, 220],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message',
        operation: 'post',
        channel: REQUESTER_SLACK_FALLBACK_CHANNEL,
        text: REQUESTER_SUCCESS_TEXT,
        otherOptions: {},
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
        channel: JOHN_DM_CHANNEL,
        text: JOHN_DM_TEXT,
        fallbackText: REQUESTER_FALLBACK_TEXT,
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
        mode: 'runOnceForEachItem',
        jsCode: PREPARE_PRODUCT_REQUEST_CODE,
      },
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
              leftValue: '={{ ($json.body && $json.body.id) || $json.airwallex_invoice_id || "" }}',
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
      id: 'n24',
      name: 'Route Customer Resolution Outcome',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [1360, 380],
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            typeValidation: 'strict',
            version: 2,
          },
          conditions: [
            {
              id: 'customer-resolution-fallback-status-check',
              leftValue: '={{ $json.status }}',
              rightValue: FALLBACK_STATUS,
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
      name: 'Route Customer Match Outcome',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [1580, 380],
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            typeValidation: 'strict',
            version: 2,
          },
          conditions: [
            {
              id: 'customer-resolution-match-check',
              leftValue: '={{ $json.customer_resolution_status }}',
              rightValue: 'matched_existing_customer',
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
  ],
  connections: {
    'Webhook Trigger': {
      main: [[{ node: 'Normalize Slack Submission', type: 'main', index: 0 }]],
    },
    'Normalize Slack Submission': {
      main: [[{ node: 'Route Validation Outcome', type: 'main', index: 0 }]],
    },
    'Route Validation Outcome': {
      main: [
        [
          { node: 'Write Tracker Fallback', type: 'main', index: 0 },
          { node: 'DM John Failure Alert', type: 'main', index: 0 },
        ],
        [{ node: 'Airwallex Auth', type: 'main', index: 0 }],
      ],
    },
    'Airwallex Auth': {
      main: [[{ node: 'Route Airwallex Outcome', type: 'main', index: 0 }]],
    },
    'Route Airwallex Outcome': {
      main: [
        [
          { node: 'Write Tracker Fallback', type: 'main', index: 0 },
          { node: 'DM John Failure Alert', type: 'main', index: 0 },
        ],
        [{ node: 'Find Billing Customer', type: 'main', index: 0 }],
      ],
    },
    'Find Billing Customer': {
      main: [[{ node: 'Resolve Billing Customer', type: 'main', index: 0 }]],
    },
    'Resolve Billing Customer': {
      main: [[{ node: 'Route Customer Resolution Outcome', type: 'main', index: 0 }]],
    },
    'Route Customer Resolution Outcome': {
      main: [
        [
          { node: 'Write Tracker Fallback', type: 'main', index: 0 },
          { node: 'DM John Failure Alert', type: 'main', index: 0 },
        ],
        [{ node: 'Route Customer Match Outcome', type: 'main', index: 0 }],
      ],
    },
    'Route Customer Match Outcome': {
      main: [
        [{ node: 'Prepare Product Payload', type: 'main', index: 0 }],
        [{ node: 'Create Billing Customer', type: 'main', index: 0 }],
      ],
    },
    'Create Billing Customer': {
      main: [[{ node: 'Prepare Product Payload', type: 'main', index: 0 }]],
    },
    'Prepare Product Payload': {
      main: [[{ node: 'Create Products', type: 'main', index: 0 }]],
    },
    'Create Products': {
      main: [[{ node: 'Prepare Price Payload', type: 'main', index: 0 }]],
    },
    'Prepare Price Payload': {
      main: [[{ node: 'Create Prices', type: 'main', index: 0 }]],
    },
    'Create Prices': {
      main: [[{ node: 'Prepare Draft Invoice Payload', type: 'main', index: 0 }]],
    },
    'Prepare Draft Invoice Payload': {
      main: [[{ node: 'Create Draft Invoice', type: 'main', index: 0 }]],
    },
    'Create Draft Invoice': {
      main: [[{ node: 'Route Invoice Chain Outcome', type: 'main', index: 0 }]],
    },
    'Route Invoice Chain Outcome': {
      main: [
        [
          { node: 'Write Tracker Fallback', type: 'main', index: 0 },
          { node: 'DM John Failure Alert', type: 'main', index: 0 },
        ],
        [{ node: 'Prepare Invoice Line Items', type: 'main', index: 0 }],
      ],
    },
    'Prepare Invoice Line Items': {
      main: [[{ node: 'Attach Invoice Line Items', type: 'main', index: 0 }]],
    },
    'Attach Invoice Line Items': {
      main: [[{ node: 'Mark Draft Success', type: 'main', index: 0 }]],
    },
    'Mark Draft Success': {
      main: [[{ node: 'Route Fallback Outcome', type: 'main', index: 0 }]],
    },
    'Route Fallback Outcome': {
      main: [
        [
          { node: 'Write Tracker Fallback', type: 'main', index: 0 },
          { node: 'DM John Failure Alert', type: 'main', index: 0 },
        ],
        [{ node: 'Write Tracker Success', type: 'main', index: 0 }],
      ],
    },
    'Write Tracker Success': {
      main: [[{ node: 'Requester Success Confirmation', type: 'main', index: 0 }]],
    },
  },
};

const body = JSON.stringify(workflow);
const url = new URL(N8N_URL + '/api/v1/workflows');

const options = {
  hostname: url.hostname,
  path: url.pathname,
  method: 'POST',
  headers: {
    'X-N8N-API-KEY': API_KEY,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
};

if (require.main === module) {
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      try {
        const result = JSON.parse(data);
        if (result.id) {
          console.log('SUCCESS');
          console.log('Workflow ID:', result.id);
          console.log('Name:', result.name);
          console.log('URL: https://noatakhel.app.n8n.cloud/workflow/' + result.id);
          console.log('\nNext: Activate the workflow in n8n, then test via:');
          console.log('POST https://noatakhel.app.n8n.cloud/webhook/krave-invoice-request-intake');
        } else {
          console.log('ERROR response:');
          console.log(JSON.stringify(result, null, 2).substring(0, 2000));
        }
      } catch (error) {
        console.log('Parse error. Raw response:');
        console.log(data.substring(0, 1000));
      }
    });
  });

  req.on('error', (error) => console.error('Request error:', error.message));
  req.write(body);
  req.end();
}

module.exports = {
  API_KEY,
  DRAFT_SUCCESS_NOTE,
  DRAFT_REVIEW_STATUS,
  FALLBACK_STATUS,
  LINE_ITEMS_PAYLOAD_LABEL,
  N8N_URL,
  body,
  https,
  options,
  url,
  workflow,
};
