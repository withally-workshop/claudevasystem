const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiMTkwMWE5My02ZjJjLTRlNzEtOWI4ZC02ZjlhMzVhMjU4NzUiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiZjBlZjk1YTYtYzc2MS00Zjc2LWJkZTgtMWU1Y2FiN2UxMjcxIiwiaWF0IjoxNzc2NjY1NjMxfQ.uBo2H0dzui9S0_MktoRxdodKzzE58vcQtXSlu8VpcEY';
const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD';
const PAYMENTS_UPDATES_CHANNEL = 'C09HN2EBPR7';
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
  return {
    json: {
      event_source: 'interaction',
      payload_type: interactionPayload.type || '',
      callback_id: interactionPayload.view?.callback_id || '',
      trigger_id: interactionPayload.trigger_id || '',
      submitted_by_slack_user_id: interactionPayload.user?.id || '',
      submitted_by_slack_user_name: interactionPayload.user?.name || interactionPayload.user?.username || '',
      interaction_payload: interactionPayload,
    }
  };
}

return {
  json: {
    event_source: 'slash_command',
    trigger_id: source.trigger_id || '',
    submitted_by_slack_user_id: source.user_id || '',
    submitted_by_slack_user_name: source.user_name || '',
    command: source.command || '',
    raw_command_payload: source,
  }
};
`.trim();

const NORMALIZE_MODAL_SUBMISSION_CODE = `
const payload = $json.interaction_payload || {};
const values = payload.view?.state?.values || {};

function getValue(blockId) {
  return values[blockId]?.value?.value || '';
}

function isoFromParts(date) {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(iso, days) {
  const date = parseIsoDate(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return isoFromParts(date);
}

function manilaTodayIso() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year + '-' + month + '-' + day;
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
    if (!Number.isNaN(parsed.getTime()) && isoFromParts(parsed) === raw) {
      return { ok: true, value: raw, normalized_input: raw };
    }
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return {
      ok: true,
      value: isoFromParts(new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()))),
      normalized_input: raw,
    };
  }

  return { ok: false, reason: 'unparseable invoice_date', normalized_input: raw };
}

function parsePayout(rawValue, invoiceDateIso, todayIso) {
  const raw = String(rawValue || '').trim();
  const normalized = (raw || '7 day payout').toLowerCase();

  if (normalized === '7 day payout') {
    return { ok: true, payout_raw: raw || '7 day payout', due_date: addDays(invoiceDateIso, 7) };
  }
  if (normalized === '14 day payout') {
    return { ok: true, payout_raw: raw, due_date: addDays(invoiceDateIso, 14) };
  }
  if (normalized === '30 day payout') {
    return { ok: true, payout_raw: raw, due_date: addDays(invoiceDateIso, 30) };
  }
  if (normalized === 'due now') {
    return { ok: true, payout_raw: raw, due_date: invoiceDateIso };
  }

  const dueOnMatch = normalized.match(/^due on\\s+(.+)$/);
  if (dueOnMatch) {
    const parsedDue = parseExplicitDate(dueOnMatch[1], todayIso);
    if (parsedDue.ok) {
      return { ok: true, payout_raw: raw, due_date: parsedDue.value };
    }
  }

  return { ok: false, payout_raw: raw || '7 day payout', reason: 'unparseable payout' };
}

const lineItemsRaw = getValue('line_items_raw');
const payoutInput = getValue('payout');
const invoiceDateInput = getValue('invoice_date');
const todayIso = manilaTodayIso();
const invoiceDateResult = parseExplicitDate(invoiceDateInput, todayIso);
const payoutResult = invoiceDateResult.ok
  ? parsePayout(payoutInput, invoiceDateResult.value, todayIso)
  : { ok: false, payout_raw: payoutInput || '7 day payout', reason: 'unparseable invoice_date' };

function parseLineItem(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (trimmed.includes('|')) {
    const [descriptionPart, quantityPart, unitPricePart] = trimmed.split('|').map((part) => part.trim());
    const quantity = Number(quantityPart || 1) || 1;
    const unitPrice = unitPricePart ? Number(String(unitPricePart).replace(/[$,]/g, '')) : null;
    return {
      description: descriptionPart || trimmed,
      quantity,
      unit_price: Number.isFinite(unitPrice) ? unitPrice : null,
      raw_text: trimmed,
    };
  }

  const quantityPriceMatch = trimmed.match(/^(.*?)(?:\\s+x\\s*(\\d+))?(?:\\s*@\\s*\\$?([\\d,]+(?:\\.\\d+)?))?$/i);
  if (quantityPriceMatch && (quantityPriceMatch[2] || quantityPriceMatch[3])) {
    const description = (quantityPriceMatch[1] || '').trim() || trimmed;
    const quantity = Number(quantityPriceMatch[2] || 1) || 1;
    const unitPrice = quantityPriceMatch[3] ? Number(quantityPriceMatch[3].replace(/[$,]/g, '')) : null;
    return {
      description,
      quantity,
      unit_price: Number.isFinite(unitPrice) ? unitPrice : null,
      raw_text: trimmed,
    };
  }

  const trailingAmountMatch = trimmed.match(/^(.*?)(?:\\s+)(\\$?[\\d,]+(?:\\.\\d+)?)$/);
  if (trailingAmountMatch) {
    const unitPrice = Number(trailingAmountMatch[2].replace(/[$,]/g, ''));
    return {
      description: trailingAmountMatch[1].trim() || trimmed,
      quantity: 1,
      unit_price: Number.isFinite(unitPrice) ? unitPrice : null,
      raw_text: trimmed,
    };
  }

  return {
    description: trimmed,
    quantity: 1,
    unit_price: null,
    raw_text: trimmed,
  };
}

const line_items = lineItemsRaw
  .split('\\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map(parseLineItem)
  .filter(Boolean);

return {
  json: {
    submitted_by_slack_user_id: payload.user?.id || $json.submitted_by_slack_user_id || '',
    submitted_by_slack_user_name: payload.user?.name || payload.user?.username || $json.submitted_by_slack_user_name || '',
    client_name_or_company_name: getValue('client_name_or_company_name'),
    client_name: getValue('client_name_or_company_name'),
    company_name: getValue('client_name_or_company_name'),
    billing_address: getValue('billing_address'),
    currency: getValue('currency'),
    payout_raw: payoutResult.payout_raw || '7 day payout',
    invoice_date_input: invoiceDateInput,
    invoice_date: invoiceDateResult.ok ? invoiceDateResult.value : '',
    date_parse_status: invoiceDateResult.ok && payoutResult.ok ? 'parsed' : 'failed',
    due_date: invoiceDateResult.ok && payoutResult.ok ? payoutResult.due_date : '',
    failure_reason: !invoiceDateResult.ok ? invoiceDateResult.reason : (!payoutResult.ok ? payoutResult.reason : ''),
    memo: getValue('memo'),
    line_items_raw: lineItemsRaw,
    line_items,
  }
};
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
        responseMode: 'responseNode',
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
                  block_id: 'client_name_or_company_name',
                  label: { type: 'plain_text', text: 'Client Name or Company Name' },
                  element: { type: 'plain_text_input', action_id: 'value' }
                },
                {
                  type: 'input',
                  block_id: 'billing_address',
                  optional: true,
                  label: { type: 'plain_text', text: 'Billing Address' },
                  element: { type: 'plain_text_input', action_id: 'value', multiline: true }
                },
                {
                  type: 'input',
                  block_id: 'currency',
                  label: { type: 'plain_text', text: 'Currency' },
                  element: { type: 'plain_text_input', action_id: 'value', initial_value: 'USD' }
                },
                {
                  type: 'input',
                  block_id: 'payout',
                  optional: true,
                  label: { type: 'plain_text', text: 'Payout' },
                  element: {
                    type: 'plain_text_input',
                    action_id: 'value',
                    placeholder: { type: 'plain_text', text: '7 day payout\\n14 day payout\\n30 day payout' }
                  },
                  hint: {
                    type: 'plain_text',
                    text: 'Leave blank to default to 7 day payout.'
                  }
                },
                {
                  type: 'input',
                  block_id: 'invoice_date',
                  optional: true,
                  label: { type: 'plain_text', text: 'Invoice Date' },
                  element: {
                    type: 'plain_text_input',
                    action_id: 'value',
                    placeholder: { type: 'plain_text', text: 'today\\n2026-04-21\\nMay 1, 2026' }
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
                    placeholder: { type: 'plain_text', text: 'Krave Media x1 @ 1300\\nUGC package x2 @ 500\\nApril retainer 2500' }
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
    {
      id: 'n10',
      name: 'Post Channel Receipt',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [1580, 520],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message',
        operation: 'post',
        channel: PAYMENTS_UPDATES_CHANNEL,
        text: `={{
          ':white_check_mark: Invoice request received' +
          '\\n- Requester: ' + ($json.submitted_by_slack_user_name || $json.submitted_by_slack_user_id) +
          '\\n- Client: ' + $json.client_name_or_company_name +
          '\\n- Billing Address: ' + ($json.billing_address || '-') +
          '\\n- Amount: ' + $json.currency + ' ' + $json.line_items.reduce((sum, item) => sum + ((Number(item.quantity || 1)) * (Number(item.unit_price || 0))), 0) +
          '\\n- Invoice Date: ' + ($json.invoice_date || 'Needs review') +
          '\\n- Payout: ' + ($json.payout_raw || '7 day payout') +
          '\\n- Due Date: ' + ($json.due_date || 'Needs review') +
          '\\n- Memo: ' + ($json.memo || '-') +
          '\\n- Line Items: ' + $json.line_items.map((item) => item.raw_text || (item.description + ' x' + (item.quantity || 1) + (item.unit_price == null ? '' : ' @ ' + item.unit_price))).join('; ') +
          '\\n- Status: ' + ($json.date_parse_status === 'parsed' ? 'Received and processing' : 'Received, needs date review')
        }}`,
        otherOptions: {},
      },
    },
    {
      id: 'n8',
      name: 'Acknowledge Slash Command',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: [1300, 220],
      parameters: {
        respondWith: 'noData',
        options: {},
      },
    },
    {
      id: 'n9',
      name: 'Acknowledge Modal Submission',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: [1840, 380],
      parameters: {
        respondWith: 'json',
        responseBody: `={{
          {
            response_action: 'update',
            view: {
              type: 'modal',
              callback_id: 'invoice_request_modal_confirmation',
              title: { type: 'plain_text', text: 'Submitted' },
              close: { type: 'plain_text', text: 'Close' },
              clear_on_close: true,
              blocks: [
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: ':white_check_mark: *Invoice request received*'
                  }
                },
                {
                  type: 'section',
                  fields: [
                    { type: 'mrkdwn', text: '*Client*\\n' + $json.client_name_or_company_name },
                    { type: 'mrkdwn', text: '*Invoice Date*\\n' + ($json.invoice_date || 'Needs review') },
                    { type: 'mrkdwn', text: '*Payout*\\n' + ($json.payout_raw || '7 day payout') },
                    { type: 'mrkdwn', text: '*Due Date*\\n' + ($json.due_date || 'Needs review') }
                  ]
                },
                {
                  type: 'section',
                  text: {
                    type: 'mrkdwn',
                    text: 'A receipt has been posted to #payments-invoices-updates.'
                  }
                }
              ]
            }
          }
        }}`,
        options: {},
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
      main: [[
        { node: 'Send To Invoice Intake', type: 'main', index: 0 },
        { node: 'Post Channel Receipt', type: 'main', index: 0 },
        { node: 'Acknowledge Modal Submission', type: 'main', index: 0 }
      ]],
    },
    'Open Invoice Modal': {
      main: [[{ node: 'Acknowledge Slash Command', type: 'main', index: 0 }]],
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
