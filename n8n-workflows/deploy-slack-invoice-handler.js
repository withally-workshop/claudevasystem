const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiMTkwMWE5My02ZjJjLTRlNzEtOWI4ZC02ZjlhMzVhMjU4NzUiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiZjBlZjk1YTYtYzc2MS00Zjc2LWJkZTgtMWU1Y2FiN2UxMjcxIiwiaWF0IjoxNzc2NjY1NjMxfQ.uBo2H0dzui9S0_MktoRxdodKzzE58vcQtXSlu8VpcEY';
const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD';
const INTAKE_WEBHOOK_URL = 'https://noatakhel.app.n8n.cloud/webhook/krave-invoice-request-intake';

const PARSE_SLACK_PAYLOAD_CODE = `
const source = $json.body || $json;
const payloadRaw = source.payload || '';
let interactionPayload = null;

if (typeof payloadRaw === 'string' && payloadRaw.trim()) {
  interactionPayload = JSON.parse(payloadRaw);
} else if (payloadRaw && typeof payloadRaw === 'object') {
  interactionPayload = payloadRaw;
}

if (interactionPayload) {
  return [{
    json: {
      event_source: 'interaction',
      payload_type: interactionPayload.type || '',
      callback_id: interactionPayload.view?.callback_id || '',
      trigger_id: interactionPayload.trigger_id || '',
      submitted_by_slack_user_id: interactionPayload.user?.id || '',
      interaction_payload: interactionPayload,
    }
  }];
}

return [{
  json: {
    event_source: 'slash_command',
    trigger_id: source.trigger_id || '',
    submitted_by_slack_user_id: source.user_id || '',
    command: source.command || '',
    raw_command_payload: source,
  }
}];
`.trim();

const NORMALIZE_MODAL_SUBMISSION_CODE = `
const payload = $json.interaction_payload || {};
const values = payload.view?.state?.values || {};

function getValue(blockId) {
  return values[blockId]?.value?.value || '';
}

const lineItemsRaw = getValue('line_items_raw');
const line_items = lineItemsRaw
  .split('\\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [description, quantity, unit_price] = line.split('|').map((part) => part.trim());
    return {
      description: description || '',
      quantity: Number(quantity || 0),
      unit_price: Number(unit_price || 0),
    };
  });

return [{
  json: {
    submitted_by_slack_user_id: payload.user?.id || $json.submitted_by_slack_user_id || '',
    client_name: getValue('client_name'),
    company_name: getValue('company_name'),
    client_email: getValue('client_email'),
    currency: getValue('currency'),
    due_date: getValue('due_date'),
    memo: getValue('memo'),
    line_items_raw: lineItemsRaw,
    line_items,
  }
}];
`.trim();

const workflow = {
  name: 'Krave - Slack Invoice Handler',
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
      webhookId: 'slack-invoice-handler',
      parameters: {
        httpMethod: 'POST',
        path: 'slack-invoice-handler',
        responseMode: 'onReceived',
        options: {},
      },
    },
    {
      id: 'n2',
      name: 'Parse Slack Payload',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [500, 300],
      parameters: {
        mode: 'runOnceForEachItem',
        jsCode: PARSE_SLACK_PAYLOAD_CODE,
      },
    },
    {
      id: 'n3',
      name: 'Route Slack Event',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [760, 300],
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            typeValidation: 'strict',
            version: 2,
          },
          conditions: [
            {
              id: 'route-slash-command',
              leftValue: '={{ $json.event_source }}',
              rightValue: 'slash_command',
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
      id: 'n4',
      name: 'Open Invoice Modal',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1040, 220],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'POST',
        url: 'https://slack.com/api/views.open',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{
          {
            trigger_id: $json.trigger_id,
            view: {
              type: 'modal',
              callback_id: 'invoice_request_modal',
              title: { type: 'plain_text', text: 'Invoice Request' },
              submit: { type: 'plain_text', text: 'Submit' },
              close: { type: 'plain_text', text: 'Cancel' },
              blocks: [
                {
                  type: 'input',
                  block_id: 'client_name',
                  label: { type: 'plain_text', text: 'Client Name' },
                  element: { type: 'plain_text_input', action_id: 'value' }
                },
                {
                  type: 'input',
                  block_id: 'company_name',
                  optional: true,
                  label: { type: 'plain_text', text: 'Company Name' },
                  element: { type: 'plain_text_input', action_id: 'value' }
                },
                {
                  type: 'input',
                  block_id: 'client_email',
                  optional: true,
                  label: { type: 'plain_text', text: 'Client Email' },
                  element: { type: 'plain_text_input', action_id: 'value' }
                },
                {
                  type: 'input',
                  block_id: 'currency',
                  label: { type: 'plain_text', text: 'Currency' },
                  element: { type: 'plain_text_input', action_id: 'value', initial_value: 'USD' }
                },
                {
                  type: 'input',
                  block_id: 'due_date',
                  label: { type: 'plain_text', text: 'Due Date' },
                  element: {
                    type: 'plain_text_input',
                    action_id: 'value',
                    placeholder: { type: 'plain_text', text: 'YYYY-MM-DD' }
                  }
                },
                {
                  type: 'input',
                  block_id: 'memo',
                  optional: true,
                  label: { type: 'plain_text', text: 'Memo / Project Description' },
                  element: { type: 'plain_text_input', action_id: 'value', multiline: true }
                },
                {
                  type: 'input',
                  block_id: 'line_items_raw',
                  label: { type: 'plain_text', text: 'Line Items' },
                  element: {
                    type: 'plain_text_input',
                    action_id: 'value',
                    multiline: true,
                    placeholder: { type: 'plain_text', text: 'Description | Quantity | Unit Price' }
                  }
                }
              ]
            }
          }
        }}`,
      },
    },
    {
      id: 'n5',
      name: 'Route Interaction Type',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [1040, 380],
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            typeValidation: 'strict',
            version: 2,
          },
          conditions: [
            {
              id: 'route-view-submission',
              leftValue: '={{ $json.payload_type }}',
              rightValue: 'view_submission',
              operator: {
                type: 'string',
                operation: 'equals',
              },
            },
            {
              id: 'route-callback-id',
              leftValue: '={{ $json.callback_id }}',
              rightValue: 'invoice_request_modal',
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
      id: 'n6',
      name: 'Normalize Modal Submission',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1320, 380],
      parameters: {
        mode: 'runOnceForEachItem',
        jsCode: NORMALIZE_MODAL_SUBMISSION_CODE,
      },
    },
    {
      id: 'n7',
      name: 'Send To Invoice Intake',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1580, 380],
      parameters: {
        method: 'POST',
        url: INTAKE_WEBHOOK_URL,
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ $json }}',
      },
    },
  ],
  connections: {
    'Webhook Trigger': {
      main: [[{ node: 'Parse Slack Payload', type: 'main', index: 0 }]],
    },
    'Parse Slack Payload': {
      main: [[{ node: 'Route Slack Event', type: 'main', index: 0 }]],
    },
    'Route Slack Event': {
      main: [
        [{ node: 'Open Invoice Modal', type: 'main', index: 0 }],
        [{ node: 'Route Interaction Type', type: 'main', index: 0 }],
      ],
    },
    'Route Interaction Type': {
      main: [
        [{ node: 'Normalize Modal Submission', type: 'main', index: 0 }],
        [],
      ],
    },
    'Normalize Modal Submission': {
      main: [[{ node: 'Send To Invoice Intake', type: 'main', index: 0 }]],
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
          console.log('\nSlack Request URL:');
          console.log('https://noatakhel.app.n8n.cloud/webhook/slack-invoice-handler');
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
  INTAKE_WEBHOOK_URL,
  N8N_URL,
  SLACK_CRED_ID,
  body,
  https,
  options,
  url,
  workflow,
};
