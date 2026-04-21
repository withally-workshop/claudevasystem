const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiMTkwMWE5My02ZjJjLTRlNzEtOWI4ZC02ZjlhMzVhMjU4NzUiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiZjBlZjk1YTYtYzc2MS00Zjc2LWJkZTgtMWU1Y2FiN2UxMjcxIiwiaWF0IjoxNzc2NjY1NjMxfQ.uBo2H0dzui9S0_MktoRxdodKzzE58vcQtXSlu8VpcEY';
const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD';
const OPENAI_CRED_ID = 'UIREXIYn59JOH1zU';
const AIRWALLEX_DRAFTS = 'C0AQZGJDR38';
const NOA_USER_ID = 'U06TBGX9L93';
const TIMEZONE = 'Asia/Manila';

const BUILD_QUERY_CODE = `
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
const todayIso = year + '-' + month + '-' + day;

const todayUtc = new Date(todayIso + 'T00:00:00Z');
todayUtc.setUTCDate(todayUtc.getUTCDate() - 1);
const y = todayUtc.getUTCFullYear();
const m = String(todayUtc.getUTCMonth() + 1).padStart(2, '0');
const d = String(todayUtc.getUTCDate()).padStart(2, '0');

return [{
  json: {
    query: 'in:inbox after:' + y + '/' + m + '/' + d,
    today_iso: todayIso,
    after_date: y + '/' + m + '/' + d
  }
}];
`.trim();

const NORMALIZE_EMAIL_CODE = `
function headerValue(headers, name) {
  return (headers || []).find((header) => String(header.name || '').toLowerCase() === name.toLowerCase())?.value || '';
}

function parseSender(raw) {
  const match = String(raw || '').match(/^(.*?)(?:\\s*<([^>]+)>)?$/);
  return {
    from_name: (match?.[1] || raw || '').replace(/["']/g, '').trim(),
    from_email: (match?.[2] || raw || '').trim()
  };
}

const payload = $json.payload || {};
const sender = parseSender(headerValue(payload.headers, 'From'));

return {
  json: {
    message_id: $json.id || 'gmail-message-id',
    thread_id: $json.threadId || '',
    from_name: sender.from_name,
    from_email: sender.from_email,
    subject: headerValue(payload.headers, 'Subject'),
    snippet: $json.snippet || '',
    body_preview: ($json.textPlain || $json.textHtml || '').replace(/\\s+/g, ' ').trim().slice(0, 800),
    received_at: headerValue(payload.headers, 'Date') || ''
  }
};
`.trim();

const workflow = {
  name: 'Krave - Inbox Triage Daily',
  settings: { executionOrder: 'v1', saveManualExecutions: true },
  nodes: [
    {
      id: 'n1',
      name: 'Schedule 9am ICT Weekdays',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [240, 180],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 1 * * 1-5' }] } },
    },
    {
      id: 'n2',
      name: 'Webhook Trigger',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [240, 340],
      webhookId: 'krave-inbox-triage-daily',
      parameters: { httpMethod: 'POST', path: 'krave-inbox-triage-daily', responseMode: 'onReceived', options: {} },
    },
    {
      id: 'n3',
      name: 'Build Gmail Query',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [460, 260],
      parameters: { mode: 'runOnceForAllItems', jsCode: BUILD_QUERY_CODE },
    },
    {
      id: 'n4',
      name: 'Search Inbox',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [680, 260],
      parameters: {
        operation: 'getAll',
        limit: 50,
        filters: {
          q: '={{ $json.query || "in:inbox after:1970/01/01" }}',
        },
      },
    },
    {
      id: 'n5',
      name: 'Fetch Message Details',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [900, 260],
      parameters: {
        operation: 'get',
        messageId: '={{ $json.id }}',
        simple: false,
      },
    },
    {
      id: 'n6',
      name: 'Normalize Email',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1120, 260],
      parameters: { mode: 'runOnceForEachItem', jsCode: NORMALIZE_EMAIL_CODE },
    },
    {
      id: 'n7',
      name: 'Build Slack Summary',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1340, 260],
      parameters: {
        jsCode: `return [{ json: { timezone: '${TIMEZONE}', openAiCredentialId: '${OPENAI_CRED_ID}' } }];`,
      },
    },
    {
      id: 'n8',
      name: 'Post to Airwallex Drafts',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [1560, 200],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: { channel: AIRWALLEX_DRAFTS },
    },
    {
      id: 'n9',
      name: 'DM Noa Summary',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [1560, 320],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: { channel: NOA_USER_ID },
    },
  ],
  connections: {
    'Schedule 9am ICT Weekdays': { main: [[{ node: 'Build Gmail Query', type: 'main', index: 0 }]] },
    'Webhook Trigger': { main: [[{ node: 'Build Gmail Query', type: 'main', index: 0 }]] },
    'Build Gmail Query': { main: [[{ node: 'Search Inbox', type: 'main', index: 0 }]] },
    'Search Inbox': { main: [[{ node: 'Fetch Message Details', type: 'main', index: 0 }]] },
    'Fetch Message Details': { main: [[{ node: 'Normalize Email', type: 'main', index: 0 }]] },
    'Normalize Email': { main: [[{ node: 'Build Slack Summary', type: 'main', index: 0 }]] },
  },
};

module.exports = { workflow };
