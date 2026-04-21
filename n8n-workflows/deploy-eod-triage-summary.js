const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiMTkwMWE5My02ZjJjLTRlNzEtOWI4ZC02ZjlhMzVhMjU4NzUiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiZjBlZjk1YTYtYzc2MS00Zjc2LWJkZTgtMWU1Y2FiN2UxMjcxIiwiaWF0IjoxNzc2NjY1NjMxfQ.uBo2H0dzui9S0_MktoRxdodKzzE58vcQtXSlu8VpcEY';

const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD'; // Krave Slack Bot
const OPENAI_CRED_ID = 'UIREXIYn59JOH1zU'; // OpenAi account

const NOA_USER_ID = 'U06TBGX9L93';
const AIRWALLEX_DRAFTS = 'C0AQZGJDR38';
const AD_PRODUCTION = 'C0AGEM919QV';
const PAYMENTS_UPDATES = 'C09HN2EBPR7';

const BUILD_CONTEXT_CODE = `
const TIMEZONE = 'Asia/Manila';
const CHANNELS = [
  { node: 'Get Airwallex Drafts History', label: '#airwallexdrafts' },
  { node: 'Get Ad Production History', label: '#ad-production-internal' },
  { node: 'Get Payments History', label: '#payments-invoices-updates' },
];
const NOISE_SUBTYPES = new Set([
  'channel_join',
  'channel_leave',
  'channel_topic',
  'channel_purpose',
  'channel_name',
  'channel_archive',
  'channel_unarchive',
  'group_join',
  'group_leave',
]);

function getMidnightTimestamp() {
  const localNow = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
  localNow.setHours(0, 0, 0, 0);
  return Math.floor(localNow.getTime() / 1000);
}

function formatLocalTime(tsSeconds) {
  const date = new Date(tsSeconds * 1000);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function cleanText(value) {
  return (value || '')
    .replace(/<#[A-Z0-9]+\\|([^>]+)>/g, '#$1')
    .replace(/<@[A-Z0-9]+>/g, '@user')
    .replace(/<([^|>]+)\\|([^>]+)>/g, '$2')
    .replace(/<([^>]+)>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\s+/g, ' ')
    .trim();
}

function getSenderName(msg) {
  return msg.username || msg.user_profile?.real_name || msg.user_profile?.name || msg.user || msg.bot_id || 'unknown';
}

const oldestTs = getMidnightTimestamp();
const normalized = [];

for (const channel of CHANNELS) {
  const messages = $(channel.node).all();
  for (const item of messages) {
    const msg = item.json || {};
    const ts = Number(msg.ts || 0);
    if (!ts || ts < oldestTs) continue;
    if (NOISE_SUBTYPES.has(msg.subtype)) continue;

    const text = cleanText(msg.text);
    if (!text) continue;

    normalized.push({
      ts,
      channel: channel.label,
      time: formatLocalTime(ts),
      sender: getSenderName(msg),
      text,
    });
  }
}

normalized.sort((a, b) => a.ts - b.ts);

const activityLines = normalized.map((entry) =>
  '- [' + entry.channel + '] ' + entry.time + ' | ' + entry.sender + ' | ' + entry.text
);

const summaryPrompt = [
  'You are generating Noa Takhel\\'s daily EOD triage summary from Slack activity.',
  'Return Slack-ready markdown only.',
  'Use this exact section structure when there is content:',
  '### 🏁 Today\\'s Wrap-up',
  '',
  '**✅ Completed from Focus Goals**',
  '- [item]',
  '',
  '**🚧 Not Completed / Needs More Work / Planned Next Steps**',
  '- [item]',
  '',
  '**🔎 Blocker / Input Needed**',
  '- [item] — waiting on [who/what]',
  '',
  '**↔️ FYIs**',
  '- [item]',
  '',
  'Rules:',
  '- Bullets only. No paragraphs. No filler.',
  '- Use only the Slack activity provided below.',
  '- Omit any empty section.',
  '- Name blockers explicitly with who/what is blocking.',
  '- If the day is quiet or activity is minimal, still return a short summary.',
  '- If there are no meaningful updates, return exactly:',
  '### 🏁 Today\\'s Wrap-up',
  '',
  '**↔️ FYIs**',
  '- Quiet day across the source channels — no major updates captured today.',
  '',
  'Source channels: #airwallexdrafts, #ad-production-internal, #payments-invoices-updates.',
  'Same-day Slack activity (GMT+8 only):',
  activityLines.length ? activityLines.join('\\n') : '- No same-day Slack activity found.',
].join('\\n');

return [{
  json: {
    summaryPrompt,
    sourceMessageCount: normalized.length,
    todayCutoffTs: oldestTs,
  }
}];
`.trim();

const workflow = {
  name: 'Krave — EOD Triage Summary',
  settings: { executionOrder: 'v1', saveManualExecutions: true },
  nodes: [
    {
      id: 'n1', name: 'Schedule 6pm ICT Weekdays',
      type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
      position: [240, 260],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 10 * * 1-5' }] } }
    },
    {
      id: 'n2', name: 'Webhook Trigger',
      type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [240, 460],
      webhookId: 'krave-eod-triage-summary',
      parameters: { httpMethod: 'POST', path: 'krave-eod-triage-summary', responseMode: 'onReceived', options: {} }
    },
    {
      id: 'n3', name: 'Get Airwallex Drafts History',
      type: 'n8n-nodes-base.slack', typeVersion: 2.3,
      position: [480, 220],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'channel',
        operation: 'history',
        channel: AIRWALLEX_DRAFTS,
        returnAll: false,
        limit: 100,
        filters: {}
      }
    },
    {
      id: 'n4', name: 'Get Ad Production History',
      type: 'n8n-nodes-base.slack', typeVersion: 2.3,
      position: [700, 220],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'channel',
        operation: 'history',
        channel: AD_PRODUCTION,
        returnAll: false,
        limit: 100,
        filters: {}
      }
    },
    {
      id: 'n5', name: 'Get Payments History',
      type: 'n8n-nodes-base.slack', typeVersion: 2.3,
      position: [920, 220],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'channel',
        operation: 'history',
        channel: PAYMENTS_UPDATES,
        returnAll: false,
        limit: 100,
        filters: {}
      }
    },
    {
      id: 'n6', name: 'Build EOD Context',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1140, 220],
      parameters: { mode: 'runOnceForAllItems', jsCode: BUILD_CONTEXT_CODE }
    },
    {
      id: 'n7', name: 'Generate EOD Summary',
      type: '@n8n/n8n-nodes-langchain.openAi', typeVersion: 1.8,
      position: [1360, 220],
      credentials: { openAiApi: { id: OPENAI_CRED_ID, name: 'OpenAI account' } },
      parameters: {
        modelId: {
          __rl: true,
          mode: 'list',
          value: 'gpt-4o-mini',
          cachedResultName: 'GPT-4O-MINI'
        },
        options: {
          temperature: 0.2
        },
        messages: {
          values: [
            {
              role: 'system',
              content: "You are Noa Takhel's executive assistant. Write a concise, accurate Slack EOD summary using only the provided Slack activity."
            },
            {
              content: '={{ $json.summaryPrompt }}'
            }
          ]
        }
      }
    },
    {
      id: 'n8', name: 'Send EOD to Noa',
      type: 'n8n-nodes-base.slack', typeVersion: 2.3,
      position: [1580, 220],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        select: 'channel',
        channelId: { __rl: true, value: NOA_USER_ID, mode: 'id' },
        text: '={{ $json.message.content }}',
        otherOptions: {}
      }
    },
    {
      id: 'n9', name: 'Did Noa Send Fail?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [1800, 220],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 1 },
          conditions: [{
            id: 'c1',
            leftValue: '={{ !!$json.error }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'equals' }
          }],
          combinator: 'and'
        },
        options: {}
      }
    },
    {
      id: 'n10', name: 'Retry Send to Noa',
      type: 'n8n-nodes-base.slack', typeVersion: 2.3,
      position: [2020, 360],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        select: 'channel',
        channelId: { __rl: true, value: NOA_USER_ID, mode: 'id' },
        text: '={{ $("Generate EOD Summary").item.json.message.content }}',
        otherOptions: {}
      }
    },
    {
      id: 'n11', name: 'Did Retry Fail?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [2240, 360],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 1 },
          conditions: [{
            id: 'c1',
            leftValue: '={{ !!$json.error }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'equals' }
          }],
          combinator: 'and'
        },
        options: {}
      }
    },
    {
      id: 'n12', name: 'Post Archive Copy',
      type: 'n8n-nodes-base.slack', typeVersion: 2.3,
      position: [2240, 120],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        select: 'channel',
        channelId: { __rl: true, value: AIRWALLEX_DRAFTS, mode: 'id' },
        text: '={{ $("Generate EOD Summary").item.json.message.content }}',
        otherOptions: {}
      }
    },
    {
      id: 'n13', name: 'Post Failure Alert',
      type: 'n8n-nodes-base.slack', typeVersion: 2.3,
      position: [2460, 420],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        select: 'channel',
        channelId: { __rl: true, value: AIRWALLEX_DRAFTS, mode: 'id' },
        text: '={{ "⚠️ EOD triage summary could not be delivered to Noa after one retry.\\n\\nFormatted summary for manual send:\\n\\n" + $("Generate EOD Summary").item.json.message.content }}',
        otherOptions: {}
      }
    }
  ],
  connections: {
    'Schedule 6pm ICT Weekdays': { main: [[{ node: 'Get Airwallex Drafts History', type: 'main', index: 0 }]] },
    'Webhook Trigger': { main: [[{ node: 'Get Airwallex Drafts History', type: 'main', index: 0 }]] },
    'Get Airwallex Drafts History': { main: [[{ node: 'Get Ad Production History', type: 'main', index: 0 }]] },
    'Get Ad Production History': { main: [[{ node: 'Get Payments History', type: 'main', index: 0 }]] },
    'Get Payments History': { main: [[{ node: 'Build EOD Context', type: 'main', index: 0 }]] },
    'Build EOD Context': { main: [[{ node: 'Generate EOD Summary', type: 'main', index: 0 }]] },
    'Generate EOD Summary': { main: [[{ node: 'Send EOD to Noa', type: 'main', index: 0 }]] },
    'Send EOD to Noa': { main: [[{ node: 'Did Noa Send Fail?', type: 'main', index: 0 }]] },
    'Did Noa Send Fail?': { main: [
      [{ node: 'Retry Send to Noa', type: 'main', index: 0 }],
      [{ node: 'Post Archive Copy', type: 'main', index: 0 }]
    ]},
    'Retry Send to Noa': { main: [[{ node: 'Did Retry Fail?', type: 'main', index: 0 }]] },
    'Did Retry Fail?': { main: [
      [{ node: 'Post Failure Alert', type: 'main', index: 0 }],
      [{ node: 'Post Archive Copy', type: 'main', index: 0 }]
    ]}
  }
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
  const list = await n8nRequest('GET', `/api/v1/workflows?name=${encodeURIComponent(workflow.name)}&limit=250`);
  const existing = (list.data || []).find((w) => w.name === workflow.name && w.active !== null);
  let result;
  if (existing) {
    result = await n8nRequest('PUT', `/api/v1/workflows/${existing.id}`, workflow);
    if (!result.id) result = await n8nRequest('POST', '/api/v1/workflows', workflow);
  } else {
    result = await n8nRequest('POST', '/api/v1/workflows', workflow);
  }
  if (!result.id) {
    console.log('ERROR:', JSON.stringify(result, null, 2).substring(0, 2000));
    return;
  }
  await n8nRequest('POST', `/api/v1/workflows/${result.id}/activate`);
  console.log('SUCCESS');
  console.log('Workflow ID:', result.id);
  console.log('Name:', result.name);
  console.log('URL: https://noatakhel.app.n8n.cloud/workflow/' + result.id);
  console.log('\nManual test via:');
  console.log('POST https://noatakhel.app.n8n.cloud/webhook/krave-eod-triage-summary');
}

deploy().catch((e) => console.error('Deploy failed:', e.message));
