const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const HALO_BOT_TOKEN = process.env.HALO_HOME_BOT_TOKEN;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SHOPIFY_DOMAIN = 'homewithhalo.myshopify.com';
const HALO_HOME_CHANNEL_ID = process.env.HALO_HOME_SLACK_CHANNEL_ID || '';
const WORKFLOW_ID = process.env.HALO_HOME_WEEKLY_REPORT_WORKFLOW_ID || '';

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN RULE: Code nodes = data transformation only. HTTP calls = HTTP Request nodes.
// ─────────────────────────────────────────────────────────────────────────────

const FILTER_SKUS = ['SH-HR-HEADCALCIUM-NA-0013', 'SH-HR-HANDLEPP-NA-0011', 'SH-HR-HEADVITA-LAVENDER-0014', 'SH-HR-FILTERPLAN-0015'];
const SHOWERHEAD_SKUS = ['SH-HH-BrushedChrome-0009', 'SH-HH-MATTEBLACK-0010'];

// n2: Build date ranges for all queries.
// Each boundary is an absolute UTC instant (…Z) at PHT midnight N days ago — NOT a
// "YYYY-MM-DD" + "+08:00" string. A "+08:00" offset in the query string decodes to a
// space and gets dropped, which silently turns the window into a UTC day (8h off PHT).
const BUILD_DATE_RANGES_CODE = `
const now = new Date(Date.now() + 8 * 3600 * 1000); // shift to PHT wall clock for date parts
function phtMidnightUTC(daysAgo) {
  // PHT midnight today as a UTC instant = (today 00:00 UTC) − 8h; then step back daysAgo days.
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)
    - 8 * 3600 * 1000 - daysAgo * 86400000).toISOString();
}
return [{ json: {
  refillMin: phtMidnightUTC(105),
  refillMax: phtMidnightUTC(75),
  upsellMin: phtMidnightUTC(120),
  upsellMax: phtMidnightUTC(14),
  thisWeekStart: phtMidnightUTC(7),   // rolling last 7 days
  lastWeekStart: phtMidnightUTC(14),  // 7-14 days ago
  lastWeekEnd: phtMidnightUTC(7),     // same as thisWeekStart
  weekOf: now.toLocaleDateString('en-SG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Singapore' }),
} }];
`.trim();

// n4: Combine all Shopify responses — refill due, upsell gap, and week-over-week analytics.
// $json = last week orders (from Fetch Last Week Orders).
// Cross-node refs: Fetch Refill Due, Fetch Showerhead Orders, Fetch This Week Orders, Build Date Ranges.
const BUILD_REPORT_DATA_CODE = `
const FILTER_SKUS = new Set(${JSON.stringify(FILTER_SKUS)});
const SHOWERHEAD_SKUS = new Set(${JSON.stringify(SHOWERHEAD_SKUS)});

const refillOrders = ($('Fetch Refill Due Orders').item.json.orders || []);
const upsellOrders = ($('Fetch Showerhead Orders').item.json.orders || []);
const thisWeekOrders = ($('Fetch This Week Orders').item.json.orders || []);
const lastWeekOrders = ($json.orders || []);
const dates = $('Build Date Ranges').item.json;

// Refill due: orders containing at least one filter SKU
const refillDue = refillOrders
  .filter(o => (o.line_items || []).some(li => FILTER_SKUS.has(li.sku)))
  .map(o => {
    const filterItems = (o.line_items || []).filter(li => FILTER_SKUS.has(li.sku));
    const daysSince = Math.floor((Date.now() - new Date(o.created_at).getTime()) / 86400000);
    return { order: o.name, email: o.email || 'no email', items: filterItems.map(li => li.title + ' x' + li.quantity).join(', '), days_ago: daysSince };
  })
  .sort((a, b) => b.days_ago - a.days_ago);

// Upsell gap: showerhead orders with no filter in the same order
const upsellGap = upsellOrders
  .filter(o => {
    const items = o.line_items || [];
    return items.some(li => SHOWERHEAD_SKUS.has(li.sku)) && !items.some(li => FILTER_SKUS.has(li.sku));
  })
  .map(o => {
    const shItem = (o.line_items || []).find(li => SHOWERHEAD_SKUS.has(li.sku));
    const daysSince = Math.floor((Date.now() - new Date(o.created_at).getTime()) / 86400000);
    return { order: o.name, email: o.email || 'no email', product: shItem ? shItem.title : 'Showerhead', days_ago: daysSince };
  })
  .sort((a, b) => a.days_ago - b.days_ago);

// Analytics: week-over-week comparison.
// Revenue is NET (gross total_price minus refund transactions) over real sales only —
// cancelled and test orders are excluded; partial refunds are captured, not just fully-refunded.
function num(x) { return parseFloat(x || 0) || 0; }
function refundValue(o) {
  return (o.refunds || []).reduce((s, r) =>
    s + (r.transactions || []).reduce((a, t) => a + num(t.amount), 0), 0);
}
function calcMetrics(allOrders) {
  const orders = (allOrders || []).filter(o => !o.cancelled_at && o.test !== true);
  const gross = orders.reduce((s, o) => s + num(o.total_price), 0);
  const refundsValue = orders.reduce((s, o) => s + refundValue(o), 0);
  const revenue = gross - refundsValue;
  const count = orders.length;
  const aov = count > 0 ? revenue / count : 0;
  const refunds = orders.filter(o =>
    (o.refunds || []).length > 0 ||
    o.financial_status === 'refunded' ||
    o.financial_status === 'partially_refunded').length;
  const productMap = {};
  for (const o of orders) {
    for (const li of (o.line_items || [])) {
      productMap[li.title] = (productMap[li.title] || 0) + li.quantity;
    }
  }
  const topProducts = Object.entries(productMap).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([title, qty]) => title + ' x' + qty);
  return { revenue: revenue.toFixed(2), count, aov: aov.toFixed(2), refunds, refundValue: refundsValue.toFixed(2), topProducts };
}

function pct(curr, prev) {
  if (!prev || prev === 0) return curr > 0 ? '+100%' : '0%';
  const change = ((curr - prev) / prev * 100).toFixed(0);
  return (change >= 0 ? '+' : '') + change + '%';
}

const tw = calcMetrics(thisWeekOrders);
const lw = calcMetrics(lastWeekOrders);
const analytics = {
  revenue:      { this_week: tw.revenue,      last_week: lw.revenue,      change: pct(parseFloat(tw.revenue), parseFloat(lw.revenue)) },
  orders:       { this_week: tw.count,         last_week: lw.count,         change: pct(tw.count, lw.count) },
  aov:          { this_week: tw.aov,           last_week: lw.aov,           change: pct(parseFloat(tw.aov), parseFloat(lw.aov)) },
  refunds:      { this_week: tw.refunds,       last_week: lw.refunds,       refund_value: tw.refundValue },
  top_products: tw.topProducts,
};

return [{ json: { refill_due: refillDue, upsell_gap: upsellGap, analytics, week_of: dates.weekOf } }];
`.trim();

const FORMAT_REPORT_PROMPT = `You are an ops assistant for Halo Home. Format the provided data into a weekly ops report for the team's Slack channel.

Format exactly like this:
*Halo Home — Weekly Ops Report (w/o [date])*
─────────────────────────────────────────

*📊 This Week vs Last Week*  _(revenue net of refunds, excl. cancelled/test orders)_
Revenue:   *$X,XXX SGD* [↑X% or ↓X%]  (was $X,XXX)
Orders:    *XX* [↑X% or ↓X%]  (was XX)
AOV:       *$XXX SGD* [↑X% or ↓X%]  (was $XXX)
Refunds:   X orders ($XXX SGD)  [show 0 if none]

Top products this week:
  [product] x[units]
  [product] x[units]

*🔄 Filter Refill Due — X customers*
  [email]  [items]  [X] days since order  #XXXX
[If none]: Refill due: none this week ✓

*🛁 Upsell Gap — X showerhead buyers without filters*
  [email]  Bought [product]  [X] days ago  #XXXX
[If none]: Upsell gap: none identified ✓

Keep it tight. No preamble. Use ↑ for positive change, ↓ for negative.`;

const workflow = {
  name: 'Halo Home - Weekly Report',
  settings: { executionOrder: 'v1', saveManualExecutions: true, timezone: 'Asia/Manila' },
  nodes: [
    // n1: Every Monday at 9 AM PHT (1 AM UTC)
    { id: 'n1', name: 'Schedule Trigger', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [240, 300],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 9 * * 1' }] } } },

    // n2: Build date ranges for both Shopify queries
    { id: 'n2', name: 'Build Date Ranges', type: 'n8n-nodes-base.code', typeVersion: 2, position: [460, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: BUILD_DATE_RANGES_CODE } },

    // n3: Fetch filter orders from 75-105 days ago (refill due window)
    { id: 'n3', name: 'Fetch Refill Due Orders', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [700, 300],
      onError: 'continueRegularOutput',
      parameters: { method: 'GET',
        url: `=https://${SHOPIFY_DOMAIN}/admin/api/2024-10/orders.json?status=any&limit=100&created_at_min={{ $json.refillMin }}&created_at_max={{ $json.refillMax }}`,
        sendHeaders: true, headerParameters: { parameters: [{ name: 'X-Shopify-Access-Token', value: SHOPIFY_TOKEN }] }, options: {} } },

    // n3b: Fetch showerhead orders from 14-120 days ago (upsell gap window)
    { id: 'n3b', name: 'Fetch Showerhead Orders', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [940, 300],
      onError: 'continueRegularOutput',
      parameters: { method: 'GET',
        url: `=https://${SHOPIFY_DOMAIN}/admin/api/2024-10/orders.json?status=any&limit=100&created_at_min={{ $('Build Date Ranges').item.json.upsellMin }}&created_at_max={{ $('Build Date Ranges').item.json.upsellMax }}`,
        sendHeaders: true, headerParameters: { parameters: [{ name: 'X-Shopify-Access-Token', value: SHOPIFY_TOKEN }] }, options: {} } },

    // n3c: Fetch this week's orders (last 7 days) for analytics comparison
    { id: 'n3c', name: 'Fetch This Week Orders', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1180, 300],
      onError: 'continueRegularOutput',
      parameters: { method: 'GET',
        url: `=https://${SHOPIFY_DOMAIN}/admin/api/2024-10/orders.json?status=any&limit=250&created_at_min={{ $('Build Date Ranges').item.json.thisWeekStart }}`,
        sendHeaders: true, headerParameters: { parameters: [{ name: 'X-Shopify-Access-Token', value: SHOPIFY_TOKEN }] }, options: {} } },

    // n3d: Fetch last week's orders (7-14 days ago) for analytics comparison
    { id: 'n3d', name: 'Fetch Last Week Orders', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1420, 300],
      onError: 'continueRegularOutput',
      parameters: { method: 'GET',
        url: `=https://${SHOPIFY_DOMAIN}/admin/api/2024-10/orders.json?status=any&limit=250&created_at_min={{ $('Build Date Ranges').item.json.lastWeekStart }}&created_at_max={{ $('Build Date Ranges').item.json.lastWeekEnd }}`,
        sendHeaders: true, headerParameters: { parameters: [{ name: 'X-Shopify-Access-Token', value: SHOPIFY_TOKEN }] }, options: {} } },

    // n4: Combine all responses — refill due, upsell gap, week-over-week analytics
    { id: 'n4', name: 'Build Report Data', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1660, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: BUILD_REPORT_DATA_CODE } },

    // n5: Claude formats the report
    { id: 'n5', name: 'Format Report', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1900, 300],
      parameters: { method: 'POST', url: 'https://api.anthropic.com/v1/messages',
        sendHeaders: true, headerParameters: { parameters: [
          { name: 'x-api-key', value: ANTHROPIC_KEY },
          { name: 'anthropic-version', value: '2023-06-01' },
          { name: 'content-type', value: 'application/json' },
        ] },
        sendBody: true, specifyBody: 'json',
        jsonBody: `={{ {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          system: ${JSON.stringify(FORMAT_REPORT_PROMPT)},
          messages: [{ role: 'user', content: 'Week of: ' + $json.week_of + '\\n\\nAnalytics:\\n' + JSON.stringify($json.analytics) + '\\n\\nRefill due:\\n' + JSON.stringify($json.refill_due) + '\\n\\nUpsell gap:\\n' + JSON.stringify($json.upsell_gap) }]
        } }}` } },

    // n6: Post to #halo-home-shopify
    { id: 'n6', name: 'Post to Slack', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [2140, 300],
      parameters: { method: 'POST', url: 'https://slack.com/api/chat.postMessage',
        sendHeaders: true, headerParameters: { parameters: [
          { name: 'Authorization', value: `=Bearer ${HALO_BOT_TOKEN}` },
          { name: 'Content-Type', value: 'application/json; charset=utf-8' },
        ] },
        sendBody: true, specifyBody: 'json',
        jsonBody: `={{ { channel: '${HALO_HOME_CHANNEL_ID}', text: ($json.content?.[0]?.text) || 'Weekly report generation failed.' } }}`,
        options: {} } },
  ],
  connections: {
    'Schedule Trigger':        { main: [[{ node: 'Build Date Ranges',         type: 'main', index: 0 }]] },
    'Build Date Ranges':       { main: [[{ node: 'Fetch Refill Due Orders',   type: 'main', index: 0 }]] },
    'Fetch Refill Due Orders': { main: [[{ node: 'Fetch Showerhead Orders',   type: 'main', index: 0 }]] },
    'Fetch Showerhead Orders': { main: [[{ node: 'Fetch This Week Orders',    type: 'main', index: 0 }]] },
    'Fetch This Week Orders':  { main: [[{ node: 'Fetch Last Week Orders',    type: 'main', index: 0 }]] },
    'Fetch Last Week Orders':  { main: [[{ node: 'Build Report Data',         type: 'main', index: 0 }]] },
    'Build Report Data':       { main: [[{ node: 'Format Report',             type: 'main', index: 0 }]] },
    'Format Report':           { main: [[{ node: 'Post to Slack',             type: 'main', index: 0 }]] },
  },
};

function n8nRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const u = new URL(N8N_URL + path);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method,
      headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } }); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function deploy() {
  if (!SHOPIFY_TOKEN)        { console.error('ERROR: SHOPIFY_ACCESS_TOKEN not set');  process.exit(1); }
  if (!HALO_BOT_TOKEN)       { console.error('ERROR: HALO_HOME_BOT_TOKEN not set');   process.exit(1); }
  if (!ANTHROPIC_KEY)        { console.error('ERROR: ANTHROPIC_API_KEY not set');     process.exit(1); }
  if (!HALO_HOME_CHANNEL_ID) { console.warn('WARNING: HALO_HOME_SLACK_CHANNEL_ID not set'); }

  const result = WORKFLOW_ID
    ? await n8nRequest('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, workflow)
    : await n8nRequest('POST', '/api/v1/workflows', workflow);

  if (!result.id) { console.error('ERROR:', JSON.stringify(result).slice(0, 2000)); process.exit(1); }
  await n8nRequest('POST', `/api/v1/workflows/${result.id}/activate`);
  console.log('SUCCESS — Workflow ID:', result.id);
  console.log('URL: https://noatakhel.app.n8n.cloud/workflow/' + result.id);
  console.log('Schedule: every Monday at 9 AM PHT (1 AM UTC)');
  console.log('\nSet env: HALO_HOME_WEEKLY_REPORT_WORKFLOW_ID=' + result.id);
}

if (require.main === module) deploy().catch(e => console.error('Deploy failed:', e.message));
module.exports = { workflow };
