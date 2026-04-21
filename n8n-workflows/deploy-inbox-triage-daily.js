const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiMTkwMWE5My02ZjJjLTRlNzEtOWI4ZC02ZjlhMzVhMjU4NzUiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiZjBlZjk1YTYtYzc2MS00Zjc2LWJkZTgtMWU1Y2FiN2UxMjcxIiwiaWF0IjoxNzc2NjY1NjMxfQ.uBo2H0dzui9S0_MktoRxdodKzzE58vcQtXSlu8VpcEY';
const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD';
const OPENAI_CRED_ID = 'UIREXIYn59JOH1zU';
const AIRWALLEX_DRAFTS = 'C0AQZGJDR38';
const NOA_USER_ID = 'U06TBGX9L93';
const TIMEZONE = 'Asia/Manila';

const workflow = {
  name: 'Krave - Inbox Triage Daily',
  settings: { executionOrder: 'v1', saveManualExecutions: true },
  nodes: [
    {
      id: 'n1',
      name: 'Schedule 9am ICT Weekdays',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [240, 220],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 1 * * 1-5' }] } },
    },
    {
      id: 'n2',
      name: 'Webhook Trigger',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [240, 420],
      webhookId: 'krave-inbox-triage-daily',
      parameters: { httpMethod: 'POST', path: 'krave-inbox-triage-daily', responseMode: 'onReceived', options: {} },
    },
    {
      id: 'n3',
      name: 'Search Inbox',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [480, 320],
      parameters: {},
    },
    {
      id: 'n4',
      name: 'Fetch Message Details',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [700, 320],
      parameters: {},
    },
    {
      id: 'n5',
      name: 'Build Slack Summary',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [920, 320],
      parameters: {
        jsCode: `return [{ json: { timezone: '${TIMEZONE}', openAiCredentialId: '${OPENAI_CRED_ID}' } }];`,
      },
    },
    {
      id: 'n6',
      name: 'Post to Airwallex Drafts',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [1140, 260],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: { channel: AIRWALLEX_DRAFTS },
    },
    {
      id: 'n7',
      name: 'DM Noa Summary',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [1140, 380],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: { channel: NOA_USER_ID },
    },
  ],
  connections: {
    'Schedule 9am ICT Weekdays': { main: [[{ node: 'Search Inbox', type: 'main', index: 0 }]] },
    'Webhook Trigger': { main: [[{ node: 'Search Inbox', type: 'main', index: 0 }]] },
  },
};

module.exports = { workflow };
