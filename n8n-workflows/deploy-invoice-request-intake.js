const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = 'replace-me';
const FALLBACK_STATUS = 'fallback_manual_required';
const DRAFT_SUCCESS_NOTE = 'draft invoice created';
const AIRWALLEX_AUTH_URL = 'https://api.airwallex.com/api/v1/authentication/login';
const SUCCESS_TRACKER_COLUMNS = {
  'Request ID': '={{ $json.request_id }}',
  Source: 'Slack Modal',
  'Creation Status': '={{ $json.status }}',
  'Airwallex Customer ID': '={{ $json.airwallex_customer_id }}',
  'Airwallex Invoice ID': '={{ $json.airwallex_invoice_id }}',
  'Failure Stage': '',
  'Failure Reason': '',
  'Line Items Payload': '={{ JSON.stringify($json.line_items) }}',
};
const REQUESTER_SUCCESS_TEXT =
  "={{ 'Invoice request received. Airwallex draft invoice was created for ' + $json.client_name + ' (' + $json.currency + ' ' + $json.subtotal + '). Request ID: ' + $json.request_id }}";
const FALLBACK_TRACKER_COLUMNS = {
  'Request ID': '={{ $json.request_id }}',
  Source: 'Slack Modal',
  'Creation Status': FALLBACK_STATUS,
  'Failure Stage': '={{ $json.failure_stage }}',
  'Failure Reason': '={{ $json.failure_reason }}',
  'Airwallex Customer ID': '={{ $json.airwallex_customer_id || "" }}',
  'Airwallex Invoice ID': '={{ $json.airwallex_invoice_id || "" }}',
  'Line Items Payload': '={{ JSON.stringify($json.line_items) }}',
};
const REQUESTER_FALLBACK_TEXT =
  "={{ 'Invoice request received for ' + $json.client_name + '. Manual Airwallex creation required. Request ID: ' + $json.request_id }}";
const JOHN_DM_TEXT =
  "={{ 'Invoice intake fallback\\nRequest ID: ' + $json.request_id + '\\nClient: ' + $json.client_name + '\\nRequester: ' + $json.submitted_by_slack_user_id + '\\nSubtotal: ' + $json.currency + ' ' + $json.subtotal + '\\nFailure stage: ' + $json.failure_stage + '\\nFailure reason: ' + $json.failure_reason + '\\nLine items: ' + JSON.stringify($json.line_items) }}";

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
    customer_resolution_status: candidates.length === 1 ? 'matched_existing_customer' : 'create_customer_required',
  }
}];
`.trim();

const PRODUCT_PAYLOAD_CODE = `
const request = $json;

// Products are request-specific because invoice line items vary per submission.
return (Array.isArray(request.line_items) ? request.line_items : []).map((item, index) => ({
  json: {
    request_id: request.request_id,
    airwallex_customer_id: request.airwallex_customer_id || '',
    line_index: index,
    description: item.description || 'Invoice line item',
    quantity: Number(item.quantity || 0),
    unit_price: Number(item.unit_price || 0),
    currency: request.currency,
    product_name: (request.client_name || request.company_name || 'Client') + ' item ' + (index + 1),
    memo: request.memo || '',
  }
}));
`.trim();

const DRAFT_SUCCESS_CODE = `
return [{
  json: {
    ...$json,
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
      parameters: {
        method: 'POST',
        url: AIRWALLEX_AUTH_URL,
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
        url: 'https://api.airwallex.com/api/v1/billing/customers',
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
      parameters: {
        method: 'POST',
        url: 'https://api.airwallex.com/api/v1/billing/customers/create',
      },
    },
    {
      id: 'n7',
      name: 'Create Products',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1580, 260],
      parameters: {
        mode: 'runOnceForEachItem',
        jsCode: PRODUCT_PAYLOAD_CODE,
      },
    },
    {
      id: 'n8',
      name: 'Create Prices',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1800, 260],
      parameters: {
        method: 'POST',
        url: 'https://api.airwallex.com/api/v1/billing/prices/create',
      },
    },
    {
      id: 'n9',
      name: 'Create Draft Invoice',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [2020, 260],
      parameters: {
        method: 'POST',
        url: 'https://api.airwallex.com/api/v1/billing/invoices/create',
        bodyParameters: {
          parameters: [
            {
              name: 'status',
              value: 'draft',
            },
          ],
        },
      },
    },
    {
      id: 'n10',
      name: 'Attach Invoice Line Items',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [2240, 260],
      parameters: {
        mode: 'runOnceForEachItem',
        jsCode: DRAFT_SUCCESS_CODE,
      },
    },
    {
      id: 'n11',
      name: 'Write Tracker Success',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [920, 220],
      parameters: {
        columns: SUCCESS_TRACKER_COLUMNS,
      },
    },
    {
      id: 'n12',
      name: 'Write Tracker Fallback',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [920, 420],
      parameters: {
        columns: FALLBACK_TRACKER_COLUMNS,
      },
    },
    {
      id: 'n13',
      name: 'Requester Success Confirmation',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [1140, 220],
      parameters: {
        text: REQUESTER_SUCCESS_TEXT,
      },
    },
    {
      id: 'n14',
      name: 'DM John Failure Alert',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [1140, 420],
      parameters: {
        text: JOHN_DM_TEXT,
        fallbackText: REQUESTER_FALLBACK_TEXT,
      },
    },
  ],
  connections: {
    'Webhook Trigger': {
      main: [[{ node: 'Normalize Slack Submission', type: 'main', index: 0 }]],
    },
  },
};

module.exports = {
  API_KEY,
  DRAFT_SUCCESS_NOTE,
  FALLBACK_STATUS,
  N8N_URL,
  https,
  workflow,
};
