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

// Emit the yesterday window as absolute UTC instants (…Z), NOT a "+08:00" string.
// A "+08:00" offset placed in the query string is decoded as a SPACE by the server, so
// Shopify dropped the offset and used a UTC-midnight day — pulling orders from 00:00–08:00 PHT
// of the wrong day into the digest. UTC bounds derived from the true PHT day boundary avoid that.
const BUILD_DATE_CODE = `
function sgtOffset(d) { return new Date(d.getTime() + 8 * 60 * 60 * 1000); }
const now = sgtOffset(new Date());
const today = now.toISOString().split('T')[0];
// Yesterday in PHT
const yest = sgtOffset(new Date(Date.now() - 86400000));
const yesterday = yest.toISOString().split('T')[0];
// True PHT day boundaries expressed in UTC: today 00:00 PHT = (today 00:00 UTC) − 8h.
const todayStartUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0) - 8 * 60 * 60 * 1000);
const yesterdayStartUTC = new Date(todayStartUTC.getTime() - 86400000);
return { json: {
  today,
  yesterday,
  createdMin: yesterdayStartUTC.toISOString(),
  createdMax: todayStartUTC.toISOString(),
  todayFormatted: now.toLocaleDateString('en-SG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Singapore' }),
} };
`.trim();

const FORMAT_DIGEST_PROMPT = `You are an ops assistant for Halo Home. You are given PRE-COMPUTED metrics. Format them into a concise daily digest for the team's Slack channel. Use every number EXACTLY as provided — do NOT recompute, re-add, round, or infer any figure. Revenue is already net of refunds, in SGD.

Format exactly like this:
*Halo Home — [Day, Date] Digest*
─────────────────────────────
Revenue:     *$X,XXX SGD*  (net of refunds)
Orders:      *XX*
AOV:         *$XXX SGD*

Top products:
  [product name] — XX units
  [product name] — XX units

Refunds:     X ($XXX SGD) [omit line if refunds_count is 0]
Comped ($0): X orders [omit line if comped_count is 0]

*Unfulfilled — X pending*
  #XXXX  [email]  [items]  X days old
  #XXXX  [email]  [items]  ordered today
[If no unfulfilled orders]: Unfulfilled: none ✓

Use thousands separators on money. Keep it tight. No preamble. If orders is 0, say "No orders yesterday." but still show the unfulfilled section.`;

// Compute digest metrics DETERMINISTICALLY in code — the LLM only formats, it never does math.
// (Previously Claude summed a 5,000-char truncation of the raw orders, so any day with more than
//  ~1 order under-reported revenue/orders. This is the fix for Shin's "totals look incorrect".)
//
// Revenue is NET: gross total_price minus refund transactions, over real sales only —
// cancelled and test orders are excluded; $0 comped orders are counted separately.
// $json = unfulfilled orders (from Fetch Unfulfilled Orders).
// $('Fetch Yesterday Orders').item.json = yesterday's orders.
// $('Build Date Range').item.json.todayFormatted = formatted date string.
const COMBINE_DIGEST_DATA_CODE = `
function num(x) { return parseFloat(x || 0) || 0; }
function refundValue(o) {
  return (o.refunds || []).reduce((s, r) =>
    s + (r.transactions || []).reduce((a, t) => a + num(t.amount), 0), 0);
}

const rawOrders = $('Fetch Yesterday Orders').item.json.orders || [];
const orders = rawOrders.filter(o => !o.cancelled_at && o.test !== true);

const gross = orders.reduce((s, o) => s + num(o.total_price), 0);
const refundsValue = orders.reduce((s, o) => s + refundValue(o), 0);
const revenueNet = Math.round((gross - refundsValue) * 100) / 100;
const orderCount = orders.length;
const comped = orders.filter(o => num(o.total_price) === 0).length;
const refunds = orders.filter(o =>
  (o.refunds || []).length > 0 ||
  o.financial_status === 'refunded' ||
  o.financial_status === 'partially_refunded').length;
const aov = orderCount > 0 ? Math.round((revenueNet / orderCount) * 100) / 100 : 0;

const productMap = {};
for (const o of orders) {
  for (const li of (o.line_items || [])) {
    productMap[li.title] = (productMap[li.title] || 0) + (li.quantity || 0);
  }
}
const topProducts = Object.entries(productMap)
  .sort((a, b) => b[1] - a[1]).slice(0, 5)
  .map(([title, units]) => ({ title, units }));

const unfulfilled = ($json.orders || []).map(o => ({
  name: o.name,
  email: o.email || 'no email',
  items: (o.line_items || []).map(li => li.title + ' x' + li.quantity).join(', '),
  days_old: Math.floor((Date.now() - new Date(o.created_at).getTime()) / 86400000),
}));

return [{ json: {
  date: $('Build Date Range').item.json.todayFormatted,
  metrics: {
    currency: 'SGD',
    revenue_net: revenueNet,
    orders: orderCount,
    aov,
    refunds_count: refunds,
    refunds_value: Math.round(refundsValue * 100) / 100,
    comped_count: comped,
    top_products: topProducts,
  },
  unfulfilled,
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
        url: `=https://${SHOPIFY_DOMAIN}/admin/api/2024-10/orders.json?status=any&limit=250&created_at_min={{ $json.createdMin }}&created_at_max={{ $json.createdMax }}`,
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
              content: 'Date: ' + $json.date + '\\n\\nMetrics (use these EXACT numbers, do not recompute):\\n' + JSON.stringify($json.metrics) + '\\n\\nUnfulfilled orders:\\n' + JSON.stringify($json.unfulfilled).slice(0, 3000)
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
