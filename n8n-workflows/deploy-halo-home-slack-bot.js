const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD'; // Krave Slack Bot
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SHOPIFY_DOMAIN = 'homewithhalo.myshopify.com';

// After first deploy, set this env var so redeployment updates in place.
// Get it from the Slack channel: right-click #halo-home → Copy link → extract C0XXXXXXXX
const HALO_HOME_CHANNEL_ID = process.env.HALO_HOME_SLACK_CHANNEL_ID || '';
const WORKFLOW_ID = process.env.HALO_HOME_SLACK_BOT_WORKFLOW_ID || null;

// ─── Code node strings ────────────────────────────────────────────────────────

const PARSE_EVENT_CODE = `
const body = $json.body || $json;
const event = body.event || {};
// Strip @mention tags from message text
const text = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
const userId = event.user || '';
const channel = event.channel || '';
const ts = event.ts || '';
const threadTs = event.thread_ts || ts;
const type = event.type || body.type || '';
return { json: { text, userId, channel, ts, threadTs, type, rawBody: body } };
`.trim();

const INTENT_SYSTEM_PROMPT = `You are an intent classifier for Halo Home, a Shopify store selling filtered showerheads and pillowcases in Singapore.
Given a message from a VA or team member, determine what store data they need.
Return ONLY valid JSON — no markdown fences, no explanation:
{
  "action": "orders_today" | "orders_week" | "orders_month" | "order_lookup_email" | "order_lookup_number" | "inventory" | "refunds" | "customer_history" | "subscriptions" | "comped_orders" | "revenue_report" | "product_catalog" | "unknown",
  "params": {
    "email": "customer email if mentioned",
    "order_number": "order number digits only if mentioned",
    "period": "today|week|month",
    "date_from": "YYYY-MM-DD if explicit range mentioned",
    "date_to": "YYYY-MM-DD if explicit range mentioned"
  },
  "original_question": "the user question verbatim"
}
Actions: orders_today=today's orders, orders_week=this week, orders_month=this month, order_lookup_email=find by email, order_lookup_number=find by order#, inventory=stock check, refunds=refunded orders, customer_history=purchase history by email, subscriptions=smart refill plan customers, comped_orders=$0 orders, revenue_report=revenue summary, product_catalog=list products, unknown=unclear intent.`;

const BUILD_SHOPIFY_URL_CODE = `
const raw = ($json.choices && $json.choices[0]?.message?.content) || $json.content?.[0]?.text || '{}';
let intent;
try { intent = JSON.parse(raw.trim()); } catch { intent = { action: 'unknown', params: {}, original_question: '' }; }

const action = intent.action || 'unknown';
const params = intent.params || {};

function sgtOffset(d) {
  return new Date(d.getTime() + 8 * 60 * 60 * 1000);
}
function sgtDateStr(daysAgo = 0) {
  const d = sgtOffset(new Date());
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().split('T')[0];
}
function startOfWeekStr() {
  const d = sgtOffset(new Date());
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().split('T')[0];
}
function startOfMonthStr() {
  return sgtDateStr().slice(0, 7) + '-01';
}

const BASE = 'https://${SHOPIFY_DOMAIN}/admin/api/2024-10';
let url;

switch (action) {
  case 'orders_today':
    url = BASE + '/orders.json?status=any&limit=100&created_at_min=' + sgtDateStr() + 'T00:00:00+08:00';
    break;
  case 'orders_week':
  case 'revenue_report':
    const from = params.date_from || (params.period === 'month' ? startOfMonthStr() : startOfWeekStr());
    url = BASE + '/orders.json?status=any&limit=250&created_at_min=' + from + 'T00:00:00+08:00';
    break;
  case 'orders_month':
    url = BASE + '/orders.json?status=any&limit=250&created_at_min=' + startOfMonthStr() + 'T00:00:00+08:00';
    break;
  case 'order_lookup_email':
  case 'customer_history':
    url = BASE + '/orders.json?status=any&limit=20&email=' + encodeURIComponent(params.email || '');
    break;
  case 'order_lookup_number':
    url = BASE + '/orders.json?status=any&name=%23' + (params.order_number || '') + '&limit=5';
    break;
  case 'inventory':
  case 'product_catalog':
    url = BASE + '/products.json?limit=50';
    break;
  case 'refunds':
    url = BASE + '/orders.json?financial_status=refunded&limit=50&created_at_min=' + startOfWeekStr() + 'T00:00:00+08:00';
    break;
  case 'subscriptions':
    url = BASE + '/orders.json?status=any&limit=250&created_at_min=2024-01-01T00:00:00+08:00';
    break;
  case 'comped_orders':
    url = BASE + '/orders.json?status=any&limit=50&created_at_min=' + startOfWeekStr() + 'T00:00:00+08:00';
    break;
  default:
    url = BASE + '/orders.json?status=any&limit=10';
}

return { json: { url, action, params, originalQuestion: intent.original_question || '', userId: $json.userId, channel: $json.channel, threadTs: $json.threadTs } };
`.trim();

const FORMAT_SYSTEM_PROMPT = `You are a Slack ops assistant for Halo Home. Format Shopify data as a concise, scannable Slack message.
Rules:
- Currency is SGD. Timezone is Asia/Manila (UTC+8).
- Use plain text with minimal formatting. Bold with *asterisks* for key numbers only.
- Be direct — no preamble, no "Here is the data", just the answer.
- For inventory: list in-stock items with ✓ and out-of-stock with ✗.
- For orders/revenue: show totals first, then breakdown.
- For subscriptions: filter to only orders containing SKU SH-HR-FILTERPLAN-0015.
- For comped orders: filter to only orders with total_price = "0.00".
- If no data matches: say so clearly in one line.
- Max 40 lines. Truncate if needed with "... and X more."`;

const PARSE_FINAL_CODE = `
const raw = ($json.choices && $json.choices[0]?.message?.content) || $json.content?.[0]?.text || 'No response generated.';
return { json: { responseText: raw.trim(), channel: $json.channel, threadTs: $json.threadTs } };
`.trim();

// ─── Workflow definition ───────────────────────────────────────────────────────

const workflow = {
  name: 'Halo Home - Slack Bot',
  settings: {
    executionOrder: 'v1',
    saveManualExecutions: true,
    timezone: 'Asia/Manila',
  },
  nodes: [
    {
      id: 'n1',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [240, 300],
      webhookId: 'halo-home-bot',
      parameters: {
        httpMethod: 'POST',
        path: 'halo-home-bot',
        responseMode: 'onReceived',
        responseData: 'noData',
        options: {},
      },
    },
    {
      id: 'n2',
      name: 'Parse Slack Event',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [460, 300],
      parameters: { mode: 'runOnceForEachItem', jsCode: PARSE_EVENT_CODE },
    },
    {
      id: 'n3',
      name: 'Is App Mention',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [680, 300],
      parameters: {
        conditions: {
          options: { caseSensitive: true, typeValidation: 'strict', version: 2 },
          conditions: [
            {
              id: 'is-mention',
              leftValue: '={{ $json.type }}',
              rightValue: 'app_mention',
              operator: { type: 'string', operation: 'equals' },
            },
          ],
          combinator: 'and',
        },
      },
    },
    {
      id: 'n4',
      name: 'Classify Intent',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [920, 220],
      parameters: {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'x-api-key', value: ANTHROPIC_KEY },
            { name: 'anthropic-version', value: '2023-06-01' },
            { name: 'content-type', value: 'application/json' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{
          {
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 256,
            system: ${JSON.stringify(INTENT_SYSTEM_PROMPT)},
            messages: [{ role: 'user', content: $json.text }]
          }
        }}`,
      },
    },
    {
      id: 'n5',
      name: 'Merge Event Context',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [920, 340],
      parameters: {
        mode: 'runOnceForEachItem',
        jsCode: `return { json: { ...$json } };`,
      },
    },
    {
      id: 'n6',
      name: 'Build Shopify URL',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1160, 220],
      parameters: { mode: 'runOnceForEachItem', jsCode: BUILD_SHOPIFY_URL_CODE },
    },
    {
      id: 'n7',
      name: 'Fetch Shopify Data',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1400, 220],
      onError: 'continueRegularOutput',
      parameters: {
        method: 'GET',
        url: '={{ $json.url }}',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'X-Shopify-Access-Token', value: SHOPIFY_TOKEN },
            { name: 'Content-Type', value: 'application/json' },
          ],
        },
        options: {},
      },
    },
    {
      id: 'n8',
      name: 'Format Response',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1640, 220],
      parameters: {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'x-api-key', value: ANTHROPIC_KEY },
            { name: 'anthropic-version', value: '2023-06-01' },
            { name: 'content-type', value: 'application/json' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{
          {
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            system: ${JSON.stringify(FORMAT_SYSTEM_PROMPT)},
            messages: [{
              role: 'user',
              content: 'Question: ' + $('Build Shopify URL').item.json.originalQuestion + '\\n\\nShopify data (JSON):\\n' + JSON.stringify($json).slice(0, 8000)
            }]
          }
        }}`,
      },
    },
    {
      id: 'n9',
      name: 'Parse Response',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1880, 220],
      parameters: {
        mode: 'runOnceForEachItem',
        jsCode: PARSE_FINAL_CODE,
      },
    },
    {
      id: 'n10',
      name: 'Post Slack Reply',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [2120, 220],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message',
        operation: 'post',
        select: 'channel',
        channelId: { __rl: true, value: '={{ $json.channel }}', mode: 'id' },
        text: '={{ $json.responseText }}',
        otherOptions: {
          thread_ts: '={{ $json.threadTs }}',
        },
      },
    },
  ],
  connections: {
    'Webhook': {
      main: [[{ node: 'Parse Slack Event', type: 'main', index: 0 }]],
    },
    'Parse Slack Event': {
      main: [[{ node: 'Is App Mention', type: 'main', index: 0 }]],
    },
    'Is App Mention': {
      main: [
        [{ node: 'Classify Intent', type: 'main', index: 0 }],
        [],
      ],
    },
    'Classify Intent': {
      main: [[{ node: 'Build Shopify URL', type: 'main', index: 0 }]],
    },
    'Build Shopify URL': {
      main: [[{ node: 'Fetch Shopify Data', type: 'main', index: 0 }]],
    },
    'Fetch Shopify Data': {
      main: [[{ node: 'Format Response', type: 'main', index: 0 }]],
    },
    'Format Response': {
      main: [[{ node: 'Parse Response', type: 'main', index: 0 }]],
    },
    'Parse Response': {
      main: [[{ node: 'Post Slack Reply', type: 'main', index: 0 }]],
    },
  },
};

// ─── Deploy helpers ────────────────────────────────────────────────────────────

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
  if (!SHOPIFY_TOKEN) { console.error('ERROR: SHOPIFY_ACCESS_TOKEN not set'); process.exit(1); }
  if (!ANTHROPIC_KEY) { console.error('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1); }

  let result;
  if (WORKFLOW_ID) {
    result = await n8nRequest('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, workflow);
  } else {
    result = await n8nRequest('POST', '/api/v1/workflows', workflow);
  }

  if (!result.id) {
    console.error('ERROR:', JSON.stringify(result, null, 2).substring(0, 2000));
    process.exit(1);
  }

  await n8nRequest('POST', `/api/v1/workflows/${result.id}/activate`);

  console.log('SUCCESS');
  console.log('Workflow ID:', result.id);
  console.log('Name:', result.name);
  console.log('URL: https://noatakhel.app.n8n.cloud/workflow/' + result.id);
  console.log('\nWebhook URL (use as Slack Event Subscriptions Request URL):');
  console.log('https://noatakhel.app.n8n.cloud/webhook/halo-home-bot');
  console.log('\nNext steps:');
  console.log('1. Set HALO_HOME_SLACK_BOT_WORKFLOW_ID=' + result.id + ' in your env');
  console.log('2. Go to api.slack.com/apps → your Krave app → Event Subscriptions');
  console.log('3. Enable Events, set Request URL to the webhook URL above');
  console.log('4. Subscribe to bot event: app_mention');
  console.log('5. Make sure the bot is invited to #halo-home');
}

if (require.main === module) {
  deploy().catch((e) => console.error('Deploy failed:', e.message));
}

module.exports = { workflow, N8N_URL, SLACK_CRED_ID };
