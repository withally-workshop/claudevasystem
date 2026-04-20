const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = 'replace-me';
const FALLBACK_STATUS = 'fallback_manual_required';
const DRAFT_SUCCESS_NOTE = 'draft invoice created';

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
        url: 'https://api.airwallex.com/api/v1/authentication/login',
      },
    },
    {
      id: 'n4',
      name: 'Write Tracker Success',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [920, 220],
      parameters: {},
    },
    {
      id: 'n5',
      name: 'Write Tracker Fallback',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [920, 420],
      parameters: {},
    },
    {
      id: 'n6',
      name: 'Requester Success Confirmation',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [1140, 220],
      parameters: {},
    },
    {
      id: 'n7',
      name: 'DM John Failure Alert',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [1140, 420],
      parameters: {},
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
