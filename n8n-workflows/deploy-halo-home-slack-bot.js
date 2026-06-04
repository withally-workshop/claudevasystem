const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const HALO_BOT_TOKEN = process.env.HALO_HOME_BOT_TOKEN;
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SHOPIFY_DOMAIN = 'homewithhalo.myshopify.com';
const HALO_HOME_CHANNEL_ID = process.env.HALO_HOME_SLACK_CHANNEL_ID || '';
const WORKFLOW_ID = process.env.HALO_HOME_SLACK_BOT_WORKFLOW_ID || 'XgHWMBeHoPWelE9r';

// ─────────────────────────────────────────────────────────────────────────────
// DESIGN RULE: Code nodes = data transformation only. HTTP calls = HTTP Request nodes.
// n8n sandboxes Code nodes — $helpers.httpRequest and fetch are not available.
// Cross-node $('Name').item.json references work in Code nodes (confirmed working).
// Pattern: HTTP Request node replaces $json with its response.
//          Use an "aggregator" Code node after each HTTP call to recombine data.
// ─────────────────────────────────────────────────────────────────────────────

// ─── n2: Parse Slack Event ────────────────────────────────────────────────────
const PARSE_EVENT_CODE = `
const body = $json.body || $json;
const event = body.event || {};
const text = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
return { json: {
  text,
  userId: event.user || '',
  channel: event.channel || '',
  ts: event.ts || '',
  threadTs: event.thread_ts || event.ts || '',
  type: event.type || body.type || '',
  challenge: body.challenge || '',
} };
`.trim();

// ─── n3c: Build Thread Context ────────────────────────────────────────────────
// Aggregator: combines Fetch Thread Context (Slack API) output with Parse Slack Event data.
// $('Parse Slack Event') cross-node ref confirmed working.
const BUILD_THREAD_CONTEXT_CODE = `
let threadContext = '';
try {
  const messages = ($json.messages || []).filter(m => !m.subtype);
  if (messages.length > 1) {
    const lines = messages.slice(0, -1).map(m => {
      const isBot = !!(m.bot_id || m.app_id);
      const txt = (m.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
      return txt ? (isBot ? 'Halo AI' : 'VA') + ': ' + txt : null;
    }).filter(Boolean);
    if (lines.length) threadContext = 'Previous messages:\\n' + lines.join('\\n');
  }
} catch {}
const ev = $('Parse Slack Event').item.json;
return { json: { text: ev.text, userId: ev.userId, channel: ev.channel, ts: ev.ts, threadTs: ev.threadTs, threadContext } };
`.trim();

// ─── n5: Build Shopify URL ────────────────────────────────────────────────────
// Aggregator: parses Classify Intent (Claude) response, builds Shopify URL,
// and pulls channel/threadTs/context forward from Build Thread Context.
// $json = Claude API response from Classify Intent.
const BUILD_SHOPIFY_URL_CODE = `
const raw = ($json.content?.[0]?.text) || ($json.choices?.[0]?.message?.content) || '{}';
let intent = { action: 'general', params: {}, original_question: '' };
try {
  const match = raw.match(/\\{[\\s\\S]*\\}/);
  if (match) intent = JSON.parse(match[0]);
} catch {}

const action = intent.action || 'general';
const params = intent.params || {};
const btc = $('Build Thread Context').item.json;
const originalQuestion = intent.original_question || btc.text || '';
const channel = btc.channel;
const threadTs = btc.threadTs;
const threadContext = btc.threadContext || '';

function sgtOffset(d) { return new Date(d.getTime() + 8 * 3600 * 1000); }
function sgtDate(ago) { const d = sgtOffset(new Date()); if (ago) d.setUTCDate(d.getUTCDate() - ago); return d.toISOString().split('T')[0]; }
function weekStart() { const d = sgtOffset(new Date()); const day = d.getUTCDay(); d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1)); return d.toISOString().split('T')[0]; }
function monthStart() { return sgtDate().slice(0, 7) + '-01'; }

const BASE = 'https://${SHOPIFY_DOMAIN}/admin/api/2024-10';
let shopifyUrl = null;
switch (action) {
  case 'orders_today':    shopifyUrl = BASE + '/orders.json?status=any&limit=100&created_at_min=' + sgtDate() + 'T00:00:00+08:00'; break;
  case 'orders_week': case 'revenue_report': { const f = params.date_from || (params.period==='month'?monthStart():weekStart()); const t = params.date_to?'&created_at_max='+params.date_to+'T23:59:59+08:00':''; shopifyUrl = BASE+'/orders.json?status=any&limit=250&created_at_min='+f+'T00:00:00+08:00'+t; break; }
  case 'orders_month':    shopifyUrl = BASE + '/orders.json?status=any&limit=250&created_at_min=' + monthStart() + 'T00:00:00+08:00'; break;
  case 'order_lookup_email': case 'customer_history': shopifyUrl = BASE + '/orders.json?status=any&limit=20&email=' + encodeURIComponent(params.email || ''); break;
  case 'order_lookup_number': shopifyUrl = BASE + '/orders.json?status=any&name=%23' + (params.order_number||'') + '&limit=5'; break;
  case 'inventory': case 'product_availability': case 'product_catalog': shopifyUrl = BASE + '/products.json?limit=50'; break;
  case 'refunds':         shopifyUrl = BASE + '/orders.json?financial_status=refunded&limit=50&created_at_min=' + weekStart() + 'T00:00:00+08:00'; break;
  case 'subscriptions':   shopifyUrl = BASE + '/orders.json?status=any&limit=250&created_at_min=2024-01-01T00:00:00+08:00'; break;
  case 'comped_orders':   shopifyUrl = BASE + '/orders.json?status=any&limit=50&created_at_min=' + weekStart() + 'T00:00:00+08:00'; break;
  case 'run_digest': { const yest = sgtDate(1); shopifyUrl = BASE + '/orders.json?status=any&limit=250&created_at_min=' + yest + 'T00:00:00+08:00&created_at_max=' + sgtDate() + 'T00:00:00+08:00'; break; }
  case 'run_inventory': shopifyUrl = BASE + '/products.json?limit=250'; break;
  case 'unfulfilled_orders': shopifyUrl = BASE + '/orders.json?fulfillment_status=unfulfilled&status=open&limit=50'; break;
  case 'order_status': {
    if (params.order_number) shopifyUrl = BASE + '/orders.json?status=any&name=%23' + params.order_number + '&limit=5';
    else if (params.email) shopifyUrl = BASE + '/orders.json?status=any&limit=20&email=' + encodeURIComponent(params.email || '');
    break;
  }
  case 'draft_orders': shopifyUrl = BASE + '/draft_orders.json?status=open&limit=50'; break;
  case 'abandoned_checkouts': shopifyUrl = BASE + '/checkouts.json?limit=50'; break;
  case 'discount_lookup': if (params.code) shopifyUrl = BASE + '/discount_codes/lookup.json?code=' + encodeURIComponent(params.code); break;
  case 'refill_due': { const d105 = sgtDate(105); const d75 = sgtDate(75); shopifyUrl = BASE + '/orders.json?status=any&limit=100&created_at_min=' + d105 + 'T00:00:00+08:00&created_at_max=' + d75 + 'T00:00:00+08:00'; break; }
}
return { json: { shopifyUrl, action, originalQuestion, channel, threadTs, threadContext } };
`.trim();

// ─── n7: Build Claude Prompt ──────────────────────────────────────────────────
// Aggregator: combines Fetch Shopify Data response with Build Shopify URL context.
// For run_inventory: pre-processes product JSON into clean in/out/low-stock lists so
// Claude doesn't have to interpret inventory_policy + inventory_quantity from raw JSON.
const BUILD_CLAUDE_PROMPT_CODE = `
const urlNode = $('Build Shopify URL').item.json;
let dataSection = '';

if (urlNode.action === 'run_inventory') {
  const products = ($json.products || []);
  const inStock = [], outOfStock = [], lowStock = [], flags = [];
  for (const p of products) {
    if (p.status !== 'active') continue;
    for (const v of p.variants || []) {
      const label = (v.title && v.title !== 'Default Title') ? p.title + ' — ' + v.title : p.title;
      const qty = v.inventory_quantity;
      const mgmt = v.inventory_management;
      const policy = v.inventory_policy;
      if (mgmt !== 'shopify') { inStock.push(label + ' (untracked)'); continue; }
      if (policy === 'deny' && (qty == null || qty <= 0)) {
        outOfStock.push(label);
      } else {
        inStock.push(label + ' (' + (qty != null ? qty : '?') + ' units)');
        if (qty != null && qty < 10) lowStock.push(label + ': ' + qty + ' units');
      }
      if (qty != null && qty < 0) flags.push(label + ' at ' + qty + ' units — restock needed');
    }
  }
  dataSection = 'IN STOCK:\\n' + (inStock.length ? inStock.join('\\n') : 'none') +
    '\\n\\nOUT OF STOCK:\\n' + (outOfStock.length ? outOfStock.join('\\n') : 'none') +
    (lowStock.length ? '\\n\\nLOW STOCK (<10 units):\\n' + lowStock.join('\\n') : '') +
    (flags.length ? '\\n\\nFLAGS:\\n' + flags.join('\\n') : '');
} else if (urlNode.action !== 'general') {
  dataSection = 'Shopify data:\\n' + JSON.stringify($json).slice(0, 8000);
}

const content = 'Action: ' + urlNode.action + '\\nQuestion: ' + urlNode.originalQuestion +
  (urlNode.threadContext ? '\\n\\nConversation context:\\n' + urlNode.threadContext : '') +
  (dataSection ? '\\n\\n' + dataSection : '');
return { json: { content, channel: urlNode.channel, threadTs: urlNode.threadTs } };
`.trim();

// ─── n9: Extract Reply ────────────────────────────────────────────────────────
// Aggregator: extracts text from Format Response (Claude), pulls channel/threadTs
// from Build Claude Prompt. $json = Claude API response from Format Response.
const EXTRACT_REPLY_CODE = `
const text = ($json.content?.[0]?.text) || ($json.choices?.[0]?.message?.content) || 'No response generated.';
const promptNode = $('Build Claude Prompt').item.json;
return { json: { responseText: text.trim(), channel: promptNode.channel, threadTs: promptNode.threadTs } };
`.trim();

const INTENT_SYSTEM_PROMPT = `You are an intent classifier for Halo Home Shopify store ops.
Return ONLY valid JSON, no markdown fences:
{"action":"orders_today|orders_week|orders_month|order_lookup_email|order_lookup_number|order_status|unfulfilled_orders|draft_orders|abandoned_checkouts|discount_lookup|refill_due|inventory|product_availability|refunds|customer_history|subscriptions|comped_orders|revenue_report|product_catalog|run_digest|run_inventory|general","params":{"email":"if mentioned","order_number":"digits only","code":"discount code if mentioned","period":"today|week|month","date_from":"YYYY-MM-DD","date_to":"YYYY-MM-DD"},"original_question":"verbatim"}
orders_today=today's orders, orders_week=this week, orders_month=this month, order_lookup_email=find by email, order_lookup_number=find by order#, order_status=has a specific order shipped/tracking info, unfulfilled_orders=what's unshipped, draft_orders=open quotes/unpaid drafts, abandoned_checkouts=abandoned carts/people who didn't complete checkout, discount_lookup=check if a discount code is valid and how many times used (put code in params.code), refill_due=customers due for filter refill (bought filters 75-105 days ago), inventory=all stock, product_availability=specific item stock, refunds=refunded orders, customer_history=history by email, subscriptions=refill plan orders, comped_orders=$0 orders, revenue_report=revenue summary, product_catalog=list products, run_digest=run the daily digest, run_inventory=full inventory status, general=no Shopify needed.`;

const FORMAT_SYSTEM_PROMPT = `You are Halo AI, Slack ops assistant for Halo Home (homewithhalo.myshopify.com).
Currency: SGD. Timezone: UTC+8. Bestseller: Brushed Chrome Showerhead $125. Refill plan $33/90 days.
Rules: plain Slack text, *bold* key numbers only, answer first, no preamble.
Inventory: ✓ in-stock ✗ out-of-stock. Orders: totals first then breakdown.
Subscriptions: only show orders with SKU SH-HR-FILTERPLAN-0015.
Comped: only show orders where total_price="0.00".
Empty Shopify array = "No [items] found for that period." Never say you lack access.
Max 40 lines.

When action=abandoned_checkouts, format as:
*Abandoned Checkouts — X carts*
─────────────────────────────
[email or "Guest"]  $XXX SGD  [items]  [X hours/days ago]
If none: "No abandoned checkouts."

When action=discount_lookup, format as:
*Discount Code: [CODE]*
Valid:      Yes / No
Type:       [% off / $X off / free shipping]
Uses:       XX times used
If code not found or error: "Code [X] not found or has expired."
If no code specified: "Which discount code should I look up?"

When action=refill_due, format as:
*Filter Refill Due — X customers*
─────────────────────────────
[email]  Last order: [date] ([X] days ago)  #XXXX
Only include orders containing filter SKUs: SH-HR-HEADCALCIUM-NA-0013, SH-HR-HANDLEPP-NA-0011, SH-HR-HEADVITA-LAVENDER-0014, SH-HR-FILTERPLAN-0015.
If none: "No customers in the 75–105 day refill window right now."

When action=unfulfilled_orders, format as:
*Unfulfilled Orders — [X] pending*
─────────────────────────────
#XXXX  [email]  [items]  Ordered [X] days ago
#XXXX  [email]  [items]  Ordered [X] days ago
If none: "No unfulfilled orders right now."

When action=order_status, format as:
*Order #XXXX — [customer email]*
Status:    [FULFILLED / UNFULFILLED / PARTIALLY_FULFILLED]
Paid:      $XXX SGD  ([financial_status])
Items:     [list]
[If fulfilled]: Shipped [date] via [carrier] — Tracking: [number]
[If unfulfilled]: Not yet shipped. Ordered [X] days ago.
[If no tracking]: No tracking info available.

When action=draft_orders, format as:
*Open Draft Orders — [X] total*
─────────────────────────────
#D-XXX  [customer email or "No customer"]  $XXX SGD  [X] days old
#D-XXX  [customer email or "No customer"]  $XXX SGD  [X] days old
If none: "No open draft orders."

When action=run_digest, format EXACTLY as:
*Halo Home — [Weekday, DD Month YYYY] Digest*
─────────────────────────────
Revenue:     *$X,XXX SGD*
Orders:      *XX*
AOV:         *$XXX SGD*

Top products:
  [product name] — XX units
  [product name] — XX units

Refunds: X ($XXX SGD)  [omit line if none]
Comped ($0): X orders  [omit line if none]

When action=run_inventory, format EXACTLY as:
*Halo Home — Inventory Status*
─────────────────────────────
IN STOCK
  ✓ [product name]

OUT OF STOCK
  ✗ [product name]

FLAGS  [omit section if none]
  ⚠ [issue]`;

// ─── Workflow ─────────────────────────────────────────────────────────────────
const workflow = {
  name: 'Halo Home - Slack Bot',
  settings: { executionOrder: 'v1', saveManualExecutions: true, timezone: 'Asia/Manila' },
  nodes: [
    // n1: Receive Slack events. responseNode so we can handle url_verification challenge.
    { id: 'n1', name: 'Webhook', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [240, 300],
      webhookId: 'halo-home-bot',
      parameters: { httpMethod: 'POST', path: 'halo-home-bot', responseMode: 'responseNode', options: {} } },

    // n2: Extract event type, text, channel, threadTs, challenge from Slack payload.
    { id: 'n2', name: 'Parse Slack Event', type: 'n8n-nodes-base.code', typeVersion: 2, position: [460, 300],
      parameters: { mode: 'runOnceForEachItem', jsCode: PARSE_EVENT_CODE } },

    // n2b: Route url_verification (Slack handshake) vs real events.
    { id: 'n2b', name: 'Is URL Verification', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [680, 300],
      parameters: { conditions: { options: { caseSensitive: true, typeValidation: 'strict', version: 2 },
        conditions: [{ id: 'c1', leftValue: '={{ $json.type }}', rightValue: 'url_verification', operator: { type: 'string', operation: 'equals' } }],
        combinator: 'and' } } },

    // n2c: Echo challenge back to Slack (required for verification).
    { id: 'n2c', name: 'Respond Challenge', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [900, 420],
      parameters: { respondWith: 'json', responseBody: '={{ JSON.stringify({ challenge: $json.challenge }) }}', options: {} } },

    // n2d: Ack real event immediately (Slack requires <3s). Processing continues async.
    { id: 'n2d', name: 'Acknowledge Event', type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position: [900, 220],
      parameters: { respondWith: 'noData', options: {} } },

    // n3: Only process app_mention events.
    { id: 'n3', name: 'Is App Mention', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [1120, 220],
      parameters: { conditions: { options: { caseSensitive: true, typeValidation: 'strict', version: 2 },
        conditions: [{ id: 'c2', leftValue: '={{ $json.type }}', rightValue: 'app_mention', operator: { type: 'string', operation: 'equals' } }],
        combinator: 'and' } } },

    // n3b: Fetch thread history for conversational context. Continues on failure.
    { id: 'n3b', name: 'Fetch Thread Context', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1340, 220],
      onError: 'continueRegularOutput',
      parameters: { method: 'GET',
        url: `=https://slack.com/api/conversations.replies?channel={{ $('Parse Slack Event').item.json.channel }}&ts={{ $('Parse Slack Event').item.json.threadTs }}&limit=10`,
        sendHeaders: true, headerParameters: { parameters: [{ name: 'Authorization', value: `=Bearer ${HALO_BOT_TOKEN}` }] }, options: {} } },

    // n3c: Aggregator — builds thread context string + passes all event data forward.
    { id: 'n3c', name: 'Build Thread Context', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1560, 220],
      parameters: { mode: 'runOnceForEachItem', jsCode: BUILD_THREAD_CONTEXT_CODE } },

    // n4: Classify intent — what Shopify data does the VA need?
    { id: 'n4', name: 'Classify Intent', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1780, 220],
      parameters: { method: 'POST', url: 'https://api.anthropic.com/v1/messages',
        sendHeaders: true, headerParameters: { parameters: [
          { name: 'x-api-key', value: ANTHROPIC_KEY },
          { name: 'anthropic-version', value: '2023-06-01' },
          { name: 'content-type', value: 'application/json' },
        ] },
        sendBody: true, specifyBody: 'json',
        jsonBody: `={{ { model: 'claude-haiku-4-5-20251001', max_tokens: 256, system: ${JSON.stringify(INTENT_SYSTEM_PROMPT)}, messages: [{ role: 'user', content: ($json.threadContext ? $json.threadContext + '\\n\\n' : '') + 'Current question: ' + $json.text }] } }}` } },

    // n5: Aggregator — parses Claude intent, builds Shopify URL, carries channel/threadTs/context.
    { id: 'n5', name: 'Build Shopify URL', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2000, 220],
      parameters: { mode: 'runOnceForEachItem', jsCode: BUILD_SHOPIFY_URL_CODE } },

    // n6: Fetch Shopify data. Uses $json.shopifyUrl. Falls back to shop endpoint for general queries.
    { id: 'n6', name: 'Fetch Shopify Data', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [2220, 220],
      onError: 'continueRegularOutput',
      parameters: { method: 'GET',
        url: `={{ $json.shopifyUrl || 'https://${SHOPIFY_DOMAIN}/admin/api/2024-10/shop.json' }}`,
        sendHeaders: true, headerParameters: { parameters: [{ name: 'X-Shopify-Access-Token', value: SHOPIFY_TOKEN }] }, options: {} } },

    // n7: Aggregator — combines Shopify response with question/context/channel from Build Shopify URL.
    { id: 'n7', name: 'Build Claude Prompt', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2440, 220],
      parameters: { mode: 'runOnceForEachItem', jsCode: BUILD_CLAUDE_PROMPT_CODE } },

    // n8: Format response — Claude formats the Shopify data into a clean Slack message.
    { id: 'n8', name: 'Format Response', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [2660, 220],
      parameters: { method: 'POST', url: 'https://api.anthropic.com/v1/messages',
        sendHeaders: true, headerParameters: { parameters: [
          { name: 'x-api-key', value: ANTHROPIC_KEY },
          { name: 'anthropic-version', value: '2023-06-01' },
          { name: 'content-type', value: 'application/json' },
        ] },
        sendBody: true, specifyBody: 'json',
        jsonBody: `={{ { model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system: ${JSON.stringify(FORMAT_SYSTEM_PROMPT)}, messages: [{ role: 'user', content: $json.content }] } }}` } },

    // n9: Aggregator — extracts Claude reply text, restores channel/threadTs from Build Claude Prompt.
    { id: 'n9', name: 'Extract Reply', type: 'n8n-nodes-base.code', typeVersion: 2, position: [2880, 220],
      parameters: { mode: 'runOnceForEachItem', jsCode: EXTRACT_REPLY_CODE } },

    // n10: Post reply in thread as Halo AI.
    { id: 'n10', name: 'Post Slack Reply', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [3100, 220],
      parameters: { method: 'POST', url: 'https://slack.com/api/chat.postMessage',
        sendHeaders: true, headerParameters: { parameters: [
          { name: 'Authorization', value: `=Bearer ${HALO_BOT_TOKEN}` },
          { name: 'Content-Type', value: 'application/json; charset=utf-8' },
        ] },
        sendBody: true, specifyBody: 'json',
        jsonBody: `={{ { channel: $json.channel, thread_ts: $json.threadTs, text: $json.responseText } }}`,
        options: {} } },
  ],
  connections: {
    'Webhook':              { main: [[{ node: 'Parse Slack Event',    type: 'main', index: 0 }]] },
    'Parse Slack Event':    { main: [[{ node: 'Is URL Verification',  type: 'main', index: 0 }]] },
    'Is URL Verification':  { main: [[{ node: 'Respond Challenge',    type: 'main', index: 0 }],
                                     [{ node: 'Acknowledge Event',    type: 'main', index: 0 }]] },
    'Acknowledge Event':    { main: [[{ node: 'Is App Mention',       type: 'main', index: 0 }]] },
    'Is App Mention':       { main: [[{ node: 'Fetch Thread Context', type: 'main', index: 0 }], []] },
    'Fetch Thread Context': { main: [[{ node: 'Build Thread Context', type: 'main', index: 0 }]] },
    'Build Thread Context': { main: [[{ node: 'Classify Intent',      type: 'main', index: 0 }]] },
    'Classify Intent':      { main: [[{ node: 'Build Shopify URL',    type: 'main', index: 0 }]] },
    'Build Shopify URL':    { main: [[{ node: 'Fetch Shopify Data',   type: 'main', index: 0 }]] },
    'Fetch Shopify Data':   { main: [[{ node: 'Build Claude Prompt',  type: 'main', index: 0 }]] },
    'Build Claude Prompt':  { main: [[{ node: 'Format Response',      type: 'main', index: 0 }]] },
    'Format Response':      { main: [[{ node: 'Extract Reply',        type: 'main', index: 0 }]] },
    'Extract Reply':        { main: [[{ node: 'Post Slack Reply',     type: 'main', index: 0 }]] },
  },
};

// ─── Deploy ────────────────────────────────────────────────────────────────────
function n8nRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const u = new URL(N8N_URL + path);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method,
      headers: { 'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d||'{}')); } catch { resolve({}); } }); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function deploy() {
  if (!HALO_BOT_TOKEN)  { console.error('ERROR: HALO_HOME_BOT_TOKEN not set');  process.exit(1); }
  if (!SHOPIFY_TOKEN)   { console.error('ERROR: SHOPIFY_ACCESS_TOKEN not set'); process.exit(1); }
  if (!ANTHROPIC_KEY)   { console.error('ERROR: ANTHROPIC_API_KEY not set');    process.exit(1); }

  const result = WORKFLOW_ID
    ? await n8nRequest('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, workflow)
    : await n8nRequest('POST', '/api/v1/workflows', workflow);

  if (!result.id) { console.error('ERROR:', JSON.stringify(result).slice(0, 2000)); process.exit(1); }
  await n8nRequest('POST', `/api/v1/workflows/${result.id}/activate`);
  console.log('SUCCESS — Workflow ID:', result.id);
  console.log('URL: https://noatakhel.app.n8n.cloud/workflow/' + result.id);
  console.log('Webhook: https://noatakhel.app.n8n.cloud/webhook/halo-home-bot');
}

if (require.main === module) deploy().catch(e => console.error('Deploy failed:', e.message));
module.exports = { workflow };
