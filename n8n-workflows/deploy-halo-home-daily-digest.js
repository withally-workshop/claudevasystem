const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const HALO_BOT_TOKEN = process.env.HALO_HOME_BOT_TOKEN; // Halo AI bot
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SHOPIFY_DOMAIN = 'homewithhalo.myshopify.com';

const WORKFLOW_ID = process.env.HALO_HOME_DAILY_DIGEST_WORKFLOW_ID || '047cSNvFvUGHaf3O';

// Get channel ID: right-click #halo-home in Slack → Copy link → extract C0XXXXXXXX
const HALO_HOME_CHANNEL_ID = process.env.HALO_HOME_SLACK_CHANNEL_ID || '';

const BUILD_DATE_CODE = `
function sgtOffset(d) { return new Date(d.getTime() + 8 * 60 * 60 * 1000); }
const now = sgtOffset(new Date());
const today = now.toISOString().split('T')[0];
// Yesterday in PHT
const yest = sgtOffset(new Date(Date.now() - 86400000));
const yesterday = yest.toISOString().split('T')[0];
return { json: { today, yesterday, todayFormatted: now.toLocaleDateString('en-SG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Singapore' }) } };
`.trim();

const FORMAT_DIGEST_PROMPT = `You are an ops assistant for Halo Home. Format the provided data into a concise daily digest for the team's Slack channel.

Format exactly like this:
*Halo Home — [Day, Date] Digest*
─────────────────────────────
Revenue:     *$X,XXX SGD*
Orders:      *XX*
AOV:         *$XXX SGD*

Top products:
  [product name] — XX units
  [product name] — XX units

Refunds:     X ($XXX SGD) [omit line if none]
Comped ($0): X orders [omit line if none]

*Unfulfilled — X pending*
  #XXXX  [email]  [items]  X days old
  #XXXX  [email]  [items]  ordered today
[If no unfulfilled orders]: Unfulfilled: none ✓

Keep it tight. No preamble. If zero orders yesterday, say "No orders yesterday." but still show unfulfilled section.`;

// Aggregator: combines yesterday orders + unfulfilled orders for Format Digest.
// $json = unfulfilled orders (from Fetch Unfulfilled Orders).
// $('Fetch Yesterday Orders').item.json = yesterday's revenue data.
// $('Build Date Range').item.json.todayFormatted = formatted date string.
const COMBINE_DIGEST_DATA_CODE = `
return [{ json: {
  yesterday_orders: $('Fetch Yesterday Orders').item.json.orders || [],
  unfulfilled_orders: $json.orders || [],
  date: $('Build Date Range').item.json.todayFormatted,
} }];
`.trim();

const workflow = {
  name: 'Halo Home - Daily Digest',
  settings: {
    executionOrder: 'v1',
    saveManualExecutions: true,
    timezone: 'Asia/Manila',
  },
  nodes: [
    {
      id: 'n1',
      name: 'Schedule Trigger',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [240, 300],
      parameters: {
        rule: {
          interval: [{ field: 'cronExpression', expression: '0 10 * * *' }], // 10 AM PHT (workflow tz Asia/Manila)
        },
      },
    },
    {
      id: 'n2',
      name: 'Build Date Range',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [460, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: BUILD_DATE_CODE },
    },
    {
      id: 'n3',
      name: 'Fetch Yesterday Orders',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [700, 300],
      onError: 'continueRegularOutput',
      parameters: {
        method: 'GET',
        url: `=https://${SHOPIFY_DOMAIN}/admin/api/2024-10/orders.json?status=any&limit=250&created_at_min={{ $json.yesterday }}T00:00:00+08:00&created_at_max={{ $json.today }}T00:00:00+08:00`,
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'X-Shopify-Access-Token', value: SHOPIFY_TOKEN },
          ],
        },
      },
    },
    // n3b: Fetch open unfulfilled orders (chained after Fetch Yesterday Orders)
    { id: 'n3b', name: 'Fetch Unfulfilled Orders', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [960, 300],
      onError: 'continueRegularOutput',
      parameters: { method: 'GET',
        url: `https://${SHOPIFY_DOMAIN}/admin/api/2024-10/orders.json?fulfillment_status=unfulfilled&status=open&limit=50`,
        sendHeaders: true, headerParameters: { parameters: [{ name: 'X-Shopify-Access-Token', value: SHOPIFY_TOKEN }] }, options: {} } },

    // n3c: Aggregator — combines yesterday orders + unfulfilled into single object for Format Digest.
    { id: 'n3c', name: 'Combine Digest Data', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1180, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: COMBINE_DIGEST_DATA_CODE } },

    {
      id: 'n4',
      name: 'Format Digest',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1400, 300],
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
            max_tokens: 768,
            system: ${JSON.stringify(FORMAT_DIGEST_PROMPT)},
            messages: [{
              role: 'user',
              content: 'Date: ' + $json.date + '\\n\\nYesterday orders:\\n' + JSON.stringify($json.yesterday_orders).slice(0, 5000) + '\\n\\nUnfulfilled orders:\\n' + JSON.stringify($json.unfulfilled_orders).slice(0, 3000)
            }]
          }
        }}`,
      },
    },
    {
      id: 'n5',
      name: 'Post to Slack',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1620, 300],
      parameters: {
        method: 'POST',
        url: 'https://slack.com/api/chat.postMessage',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Authorization', value: `=Bearer ${HALO_BOT_TOKEN}` },
            { name: 'Content-Type', value: 'application/json; charset=utf-8' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ {
          channel: '${HALO_HOME_CHANNEL_ID}',
          text: ($json.choices && $json.choices[0]?.message?.content) || $json.content?.[0]?.text || 'Digest generation failed.'
        } }}`,
        options: {},
      },
    },
  ],
  connections: {
    'Schedule Trigger':       { main: [[{ node: 'Build Date Range',        type: 'main', index: 0 }]] },
    'Build Date Range':       { main: [[{ node: 'Fetch Yesterday Orders',  type: 'main', index: 0 }]] },
    'Fetch Yesterday Orders': { main: [[{ node: 'Fetch Unfulfilled Orders', type: 'main', index: 0 }]] },
    'Fetch Unfulfilled Orders': { main: [[{ node: 'Combine Digest Data',   type: 'main', index: 0 }]] },
    'Combine Digest Data':    { main: [[{ node: 'Format Digest',           type: 'main', index: 0 }]] },
    'Format Digest':          { main: [[{ node: 'Post to Slack',           type: 'main', index: 0 }]] },
  },
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
  if (!SHOPIFY_TOKEN) { console.error('ERROR: SHOPIFY_ACCESS_TOKEN not set'); process.exit(1); }
  if (!ANTHROPIC_KEY) { console.error('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1); }
  if (!HALO_HOME_CHANNEL_ID) { console.warn('WARNING: HALO_HOME_SLACK_CHANNEL_ID not set — update Post to Slack node manually after deploy'); }

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
  console.log('URL: https://noatakhel.app.n8n.cloud/workflow/' + result.id);
  console.log('Schedule: daily at midnight UTC (8 AM PHT)');
  console.log('\nSet env: HALO_HOME_DAILY_DIGEST_WORKFLOW_ID=' + result.id);
}

if (require.main === module) {
  deploy().catch((e) => console.error('Deploy failed:', e.message));
}

module.exports = { workflow };
