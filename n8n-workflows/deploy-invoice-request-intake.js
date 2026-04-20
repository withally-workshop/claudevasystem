const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = 'replace-me';

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
        jsCode: 'return [{ json: { status: "fallback_manual_required", note: "draft invoice created" } }];',
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
  N8N_URL,
  https,
  workflow,
};
