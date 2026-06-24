'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

// Load .env from repo root
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^([^#=\s][^=]*)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
}

const { App, ExpressReceiver } = require('@slack/bolt');
const Anthropic = require('@anthropic-ai/sdk');
const { buildSystemPrompt } = require('./system-prompt');

const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// Tool registry — auto-discovers all files in ./tools/
// Drop a new tools/xyz.js and it's live on next deploy, no changes needed here
// ---------------------------------------------------------------------------

const fileCache = require('./tools/file-cache');

const ALL_TOOLS = [];
const HANDLERS = {};
fs.readdirSync(path.join(__dirname, 'tools'))
  .filter((f) => f.endsWith('.js'))
  .forEach((f) => {
    const mod = require(`./tools/${f}`);
    if (Array.isArray(mod.definitions)) ALL_TOOLS.push(...mod.definitions);
    if (mod.handlers && typeof mod.handlers === 'object') Object.assign(HANDLERS, mod.handlers);
    console.log(`Loaded tool: ${f} (${(mod.definitions || []).length} tools)`);
  });

// ---------------------------------------------------------------------------
// Anthropic client
// ---------------------------------------------------------------------------

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3 });
const SYSTEM_PROMPT = buildSystemPrompt();
const CACHED_SYSTEM = [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];

// conversation history per thread (keyed by channel+thread_ts or channel for DMs)
const conversations = new Map();

function getConvKey(channel, thread_ts) {
  return thread_ts ? `${channel}:${thread_ts}` : channel;
}

// Download a Slack-hosted file using the bot token (files are auth-gated)
async function downloadSlackImage(urlPrivate) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const url = new URL(urlPrivate);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    };
    https.get(opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // follow one redirect (Slack CDN)
        https.get(res.headers.location, (res2) => {
          const chunks = [];
          res2.on('data', (c) => chunks.push(c));
          res2.on('end', () => resolve(Buffer.concat(chunks)));
        }).on('error', reject);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

// Build a user content block — text + any image attachments
async function buildUserContent(text, files) {
  const blocks = [{ type: 'text', text: text || '(no text)' }];
  const supported = (files || []).filter((f) => f.mimetype && (f.mimetype.startsWith('image/') || f.mimetype === 'application/pdf'));

  // Inject file metadata so Claude can re-fetch files via slack_download_file when needed
  if (supported.length > 0) {
    const meta = supported.map((f) => `  - name: ${f.name || f.id} | mimetype: ${f.mimetype} | url_private: ${f.url_private}`).join('\n');
    blocks[0] = { type: 'text', text: `${blocks[0].text}\n[Attached file(s):\n${meta}\n]` };
  }

  for (const file of supported) {
    try {
      const buf = await downloadSlackImage(file.url_private);
      fileCache.store(file.url_private, buf.toString('base64'));
      const isPdf = file.mimetype === 'application/pdf';
      blocks.push(isPdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } }
        : { type: 'image', source: { type: 'base64', media_type: file.mimetype, data: buf.toString('base64') } }
      );
    } catch (e) {
      console.error('File download failed:', file.url_private, e.message);
      blocks.push({ type: 'text', text: `[File could not be loaded: ${file.name || file.id}]` });
    }
  }
  return blocks.length === 1 && !supported.length ? text : blocks;
}

// Map low-level errors to a clean Slack message. A transient model-connection drop
// (e.g. "Premature close") must never reach the channel as a raw stack — tell the
// user to retry; the real error is still logged via console.error for debugging.
function userFacingError(e) {
  const msg = (e && e.message) || String(e);
  if (/premature close|econnreset|socket hang up|fetch failed|terminated|etimedout|epipe|overloaded|connection error|529/i.test(msg)) {
    return '⚠️ I hit a temporary connection issue reaching the model. Give it a moment and try again.';
  }
  return `⚠️ Something went wrong handling that — try again or rephrase. (${msg.slice(0, 140)})`;
}

async function runAgent(userContent, convKey) {
  // reset command clears corrupt/stale history
  const rawText = typeof userContent === 'string' ? userContent : (userContent.find((b) => b.type === 'text') || {}).text || '';
  if (rawText.trim().toLowerCase() === 'reset') {
    conversations.delete(convKey);
    return 'Conversation reset. Start fresh.';
  }

  const history = conversations.get(convKey) || [];
  history.push({ role: 'user', content: userContent });

  const messages = [...history];
  let finalText = '';
  const isBackground = convKey.startsWith('autonomous:');

  const LOOP_DEADLINE = Date.now() + 10 * 60 * 1000; // 10-minute hard cap

  try {
    // agentic loop — keep calling until no more tool_use
    while (true) {
      if (Date.now() > LOOP_DEADLINE) {
        finalText = '⚠️ Took too long to complete — the task may be partially done. Please check Airwallex and the tracker, then ask me to continue if needed.';
        break;
      }

      let response;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          response = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 2048,
            system: CACHED_SYSTEM,
            tools: ALL_TOOLS.map((t, i) => i === ALL_TOOLS.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t),
            messages,
          });
          break;
        } catch (e) {
          const emsg = (e && e.message) || '';
          const isOverloaded = e.status === 529 || emsg.includes('overloaded');
          const isRateLimit = e.status === 429;
          // Transient connection drops (e.g. "Premature close", ECONNRESET, fetch
          // failed) otherwise reach Slack as a raw error — retry a few times first.
          const isConnDrop = (e && e.name === 'APIConnectionError')
            || /premature close|econnreset|socket hang up|fetch failed|terminated|etimedout|epipe|connection error/i.test(emsg);
          if (isOverloaded && attempt < 3) {
            await new Promise((r) => setTimeout(r, (attempt + 1) * 8000));
            continue;
          }
          if (isConnDrop && attempt < 3) {
            await new Promise((r) => setTimeout(r, (attempt + 1) * 1500));
            continue;
          }
          if (isRateLimit) {
            // Background tasks retry patiently; interactive sessions fail fast
            if (isBackground && attempt < 2) {
              await new Promise((r) => setTimeout(r, 65000));
              continue;
            }
            if (!isBackground && attempt < 1) {
              await new Promise((r) => setTimeout(r, 8000));
              continue;
            }
          }
          throw e;
        }
      }

      messages.push({ role: 'assistant', content: response.content });

      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');

      // end_turn or max_tokens with no pending tool calls → done
      if (response.stop_reason === 'end_turn' || (response.stop_reason === 'max_tokens' && toolUseBlocks.length === 0)) {
        finalText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
        break;
      }

      // tool_use (or max_tokens that still has tool calls) → run tools and continue
      if (toolUseBlocks.length > 0) {
        const toolResults = await Promise.all(toolUseBlocks.map(async (block) => {
          const handler = HANDLERS[block.name];
          let result;
          try {
            result = handler ? await handler(block.input) : { error: `Unknown tool: ${block.name}` };
          } catch (e) {
            result = { error: e.message };
          }
          return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) };
        }));
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      break;
    }

    // persist last 20 turns to keep context manageable
    conversations.set(convKey, messages.slice(-20));
  } catch (e) {
    conversations.delete(convKey);
    if (e.status === 429) {
      return 'Rate limit hit — too many requests this minute. Wait 30 seconds and try again.';
    }
    throw e;
  }

  return finalText || '(no response)';
}

// ---------------------------------------------------------------------------
// Slack Bolt app
// ---------------------------------------------------------------------------

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET || 'dev-placeholder',
  endpoints: '/slack/events',
});

// Deduplicate Slack event retries — track processed event IDs for 5 min
const processedEvents = new Map();
function isDuplicate(eventId) {
  if (!eventId) return false;
  if (processedEvents.has(eventId)) return true;
  processedEvents.set(eventId, Date.now());
  // prune entries older than 5 minutes
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [k, v] of processedEvents) if (v < cutoff) processedEvents.delete(k);
  return false;
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

const DRAFTS_CHANNEL = 'C0AQZGJDR38';
const PAYMENTS_CHANNEL = 'C09HN2EBPR7'; // #payments-invoices-updates (private) — price-reply source
const N8N_APPROVAL_WEBHOOK = 'https://noatakhel.app.n8n.cloud/webhook/krave-approval-reply-trigger';
const N8N_PRICE_REPLY_WEBHOOK = 'https://noatakhel.app.n8n.cloud/webhook/krave-price-reply-resubmit';

// Fire-and-forget POST to an n8n webhook. Defaults to the approval-reply path
// for backward compatibility with the existing #ops-command forward.
function forwardToN8n(payload, path = '/webhook/krave-approval-reply-trigger') {
  const buf = Buffer.from(JSON.stringify(payload));
  const req = require('https').request({
    hostname: 'noatakhel.app.n8n.cloud',
    path,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': buf.length },
  }, (res) => { res.resume(); });
  req.on('error', (e) => console.error('n8n forward error:', e.message));
  req.write(buf);
  req.end();
}

async function resolveDisplayName(client, userId) {
  try {
    const res = await client.users.info({ user: userId });
    return res.user && (res.user.profile.display_name || res.user.real_name || res.user.name) || userId;
  } catch {
    return userId;
  }
}

function withContext(text, displayName, threadTs, channel) {
  const parts = [`[Requester: ${displayName}]`];
  if (channel) parts.push(`[Slack Channel: ${channel}]`);
  if (threadTs) parts.push(`[Slack Thread TS: ${threadTs}]`);
  return `${parts.join(' ')}\n${text}`;
}

// DMs
app.event('message', async ({ event, say, client }) => {
  if (event.bot_id || (event.subtype && event.subtype !== 'file_share')) return;

  // Forward drafts channel messages to n8n approval polling workflow
  if (event.channel === DRAFTS_CHANNEL) {
    forwardToN8n(event);
    return;
  }

  // Event-driven price-reply trigger: forward THREAD REPLIES in
  // #payments-invoices-updates to the Price Reply Auto-Resubmit workflow, which
  // does its own filtering for unactioned "price missing" prompts (replaces the
  // old n8n schedule poll — message.groups delivers these events to the bot).
  // Fire-and-forget and DO NOT return: fall through so the bot's conversational
  // thread follow-ups in this channel (e.g. "Want me to email this?" → "yes")
  // keep working. Price replies are always thread replies, so scope to thread_ts.
  if (event.channel === PAYMENTS_CHANNEL && event.thread_ts) {
    console.log(`[price-reply] forwarding payments-channel reply ts=${event.ts} thread=${event.thread_ts}`);
    forwardToN8n(event, '/webhook/krave-price-reply-resubmit');
  }

  // Handle thread follow-ups in channels when bot is already in that conversation
  if (event.thread_ts && event.channel_type !== 'im') {
    const threadKey = getConvKey(event.channel, event.thread_ts);
    if (!conversations.has(threadKey)) return;
    if (isDuplicate(event.client_msg_id || event.ts)) return;
    try {
      const displayName = await resolveDisplayName(client, event.user);
      const contextText = withContext(event.text || '', displayName, event.thread_ts, event.channel);
      const userContent = await buildUserContent(contextText, event.files);
      const reply = await runAgent(userContent, threadKey);
      await say({ text: reply, thread_ts: event.thread_ts });
    } catch (e) {
      console.error('Thread follow-up error:', e);
      await say({ text: userFacingError(e), thread_ts: event.thread_ts });
    }
    return;
  }

  // Only handle DMs — channel @mentions are handled by app_mention
  if (event.channel_type !== 'im') return;

  if (isDuplicate(event.client_msg_id || event.ts)) return;

  const convKey = getConvKey(event.channel, null);
  try {
    const displayName = await resolveDisplayName(client, event.user);
    const text = withContext(event.text || '', displayName, event.ts, event.channel);
    const userContent = await buildUserContent(text, event.files);
    const reply = await runAgent(userContent, convKey);
    await say({ text: reply, thread_ts: event.ts });
  } catch (e) {
    console.error('DM handler error:', e);
    await say({ text: userFacingError(e) });
  }
});

// @mentions in channels
app.event('app_mention', async ({ event, say, client }) => {
  if (isDuplicate(event.client_msg_id || event.ts)) return;
  const text = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
  const convKey = getConvKey(event.channel, event.thread_ts || event.ts);
  try {
    const displayName = await resolveDisplayName(client, event.user);
    const contextText = withContext(text, displayName, event.thread_ts || event.ts, event.channel);
    const userContent = await buildUserContent(contextText, event.files);
    const reply = await runAgent(userContent, convKey);
    await say({ text: reply, thread_ts: event.thread_ts || event.ts });
  } catch (e) {
    console.error('Mention handler error:', e);
    await say({ text: userFacingError(e), thread_ts: event.thread_ts || event.ts });
  }
});

// ---------------------------------------------------------------------------
// Dashboard file cache — stores uploaded files by session so Claude can
// retrieve them via get_session_file tool when building email attachments
// ---------------------------------------------------------------------------

const sessionFileCache = new Map(); // session_key → [{ name, mimetype, data_base64 }]

// Prune entries older than 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [k, v] of sessionFileCache) if (v._ts < cutoff) sessionFileCache.delete(k);
}, 5 * 60 * 1000);


ALL_TOOLS.push({
  name: 'get_session_file',
  description: 'Retrieve a file uploaded via the dashboard chat as base64. Use this before gmail_send when you need to attach a file that was uploaded through the ops dashboard (not Slack). Returns { name, mimetype, data_base64 }.',
  input_schema: {
    type: 'object',
    properties: {
      session_key: { type: 'string', description: 'The dashboard session key from the message context' },
      filename: { type: 'string', description: 'The filename of the uploaded file (from the [Attached: ...] metadata in the message context)' },
    },
    required: ['session_key'],
  },
});
HANDLERS['get_session_file'] = ({ session_key, filename }) => {
  const files = sessionFileCache.get(session_key);
  if (!files || !files.length) return { error: 'No files found for this session' };
  const file = filename ? files.find((f) => f.name === filename) : files[0];
  if (!file) return { error: `File not found: ${filename}` };
  return { name: file.name, mimetype: file.mimetype, data_base64: file.data_base64 };
};

// ---------------------------------------------------------------------------
// /api/chat — dashboard chatbot endpoint
// ---------------------------------------------------------------------------

receiver.router.use(require('express').json({ limit: '10mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

receiver.router.use('/api/chat', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

receiver.router.post('/api/chat', async (req, res) => {
  const { message, session_key, files } = req.body || {};
  if (!message && !(files && files.length)) return res.status(400).json({ error: 'message or file required' });

  const sk = session_key || 'default';
  const convKey = `dashboard:${sk}`;
  try {
    let userContent = message || '(see attached file)';
    if (files && files.length > 0) {
      // Cache files so Claude can retrieve them via get_session_file tool
      const entry = files.map((f) => ({ name: f.name, mimetype: f.mimetype, data_base64: f.data_base64 }));
      entry._ts = Date.now();
      sessionFileCache.set(sk, entry);

      const blocks = [{ type: 'text', text: `${userContent}\n[Dashboard session: ${sk}]\n[Attached file(s):\n${files.map((f) => `  - name: ${f.name} | mimetype: ${f.mimetype}`).join('\n')}\n]` }];
      for (const file of files) {
        if (!file.data_base64 || !file.mimetype) continue;
        if (file.mimetype === 'application/pdf') {
          blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data_base64 } });
        } else if (file.mimetype.startsWith('image/')) {
          blocks.push({ type: 'image', source: { type: 'base64', media_type: file.mimetype, data: file.data_base64 } });
        }
      }
      if (blocks.length > 1) userContent = blocks;
    }
    const reply = await runAgent(userContent, convKey);
    res.json({ reply });
  } catch (e) {
    console.error('Chat API error:', e);
    res.status(500).json({ error: e.message });
  }
});

// EOD bills reconcile — triggered by the n8n schedule (POST with x-cron-secret).
// Mirrors Airwallex Spend bills into the Creator & AP Bills Tracker.
receiver.router.post('/cron/reconcile-bills', async (req, res) => {
  if (!process.env.CRON_SECRET || (req.headers['x-cron-secret'] || '') !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    const result = await require('./tools/reconcile').reconcileBills();
    console.log('reconcile-bills:', JSON.stringify(result));
    // EOD summary → #ops-command so the team sees what the reconcile did (or that it was a no-op).
    try {
      const lines = [];
      if (!result.filled && !result.added) {
        lines.push(`:white_check_mark: *Creator Bills reconcile* — no changes. ${result.total} Airwallex bill(s) checked, tracker already in sync.`);
      } else {
        lines.push(`:white_check_mark: *Creator Bills reconcile* — ${result.total} bill(s) checked · ${result.filled} Bill ID(s) filled · ${result.added} row(s) added.`);
        for (const f of result.filledRows || []) {
          lines.push(`• Filled row ${f.row}: ${f.vendor} — inv ${f.invoice || '—'} · ${f.amount} ${f.currency} · \`${f.billId}\``);
        }
        for (const a of result.addedRows || []) {
          lines.push(`• Added: ${a.vendor} — inv ${a.invoice || '—'} · ${a.amount} ${a.currency} · \`${a.billId}\``);
        }
      }
      await require('./tools/slack').handlers.slack_post_message({ channel: DRAFTS_CHANNEL, text: lines.join('\n') });
    } catch (e) {
      console.error('reconcile-bills slack summary failed:', e.message);
    }
    res.json({ ok: true, total: result.total, filled: result.filled, added: result.added });
  } catch (e) {
    console.error('reconcile-bills error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Payment reconcile — poll Airwallex for the true paid-status of open invoices
// and mark the paid ones in the AR tracker. Email-independent: catches card/link
// payments that settle with NO deposit email (the gap that left INV-N06BN4Z8-0001
// "unpaid" on 2026-06-23). Three triggers, one write path:
//   - hourly in-bot interval (below)
//   - POST /cron/reconcile-payments  (manual / scheduled)
//   - POST /webhook/airwallex        (Airwallex paid event — real-time)
// ---------------------------------------------------------------------------

const payments = require('./tools/reconcile-payments');

// Hourly sweep. First run 5 min after boot so a redeploy doesn't trigger an
// immediate full sweep; then every 60 min.
setTimeout(() => {
  const run = () => payments.reconcilePayments().catch((e) => console.error('reconcile-payments interval error:', e.message));
  run();
  setInterval(run, 60 * 60 * 1000);
}, 5 * 60 * 1000);

receiver.router.post('/cron/reconcile-payments', async (req, res) => {
  if (!process.env.CRON_SECRET || (req.headers['x-cron-secret'] || '') !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    const result = await payments.reconcilePayments();
    res.json({ ok: true, ...result });
  } catch (e) {
    console.error('reconcile-payments error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Airwallex webhook → real-time mark-paid. Signature-verified when
// AIRWALLEX_WEBHOOK_SECRET is set; reconcileInvoiceById re-verifies via the API
// regardless, so a spoofed/duplicate event can never falsely mark anything paid.
function airwallexSigOk(req) {
  const secret = process.env.AIRWALLEX_WEBHOOK_SECRET;
  if (!secret) return { ok: true, unverified: true }; // not configured yet
  const ts = req.headers['x-timestamp'];
  const sig = req.headers['x-signature'];
  if (!ts || !sig) return { ok: false };
  const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
  const expected = crypto.createHmac('sha256', secret).update(String(ts) + raw).digest('hex');
  try {
    return { ok: sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) };
  } catch { return { ok: false }; }
}

function invoiceIdsFromEvent(body) {
  const ids = new Set();
  const obj = (body && body.data && body.data.object) || {};
  for (const v of [obj.id, obj.invoice_id, obj.invoice, body && body.resource_id, body && body.source_id]) {
    if (typeof v === 'string' && v.startsWith('inv_')) ids.add(v);
  }
  // Deep fallback: pull any inv_ id from anywhere in the payload, so charge /
  // payment_attempt / payment_link events that reference the invoice in a nested
  // field still trigger a reconcile (re-verified via the API regardless).
  try {
    const m = JSON.stringify(body || {}).match(/inv_[a-z0-9]{8,}/gi);
    if (m) m.forEach((id) => ids.add(id));
  } catch { /* ignore */ }
  return [...ids];
}

receiver.router.post('/webhook/airwallex', async (req, res) => {
  const sig = airwallexSigOk(req);
  if (!sig.ok) return res.status(401).json({ error: 'bad signature' });
  if (sig.unverified) console.warn('airwallex webhook: AIRWALLEX_WEBHOOK_SECRET not set — processing unverified');
  try {
    const ids = invoiceIdsFromEvent(req.body);
    const results = [];
    for (const id of ids) {
      try { results.push({ id, ...(await payments.reconcileInvoiceById(id)) }); }
      catch (e) { results.push({ id, error: e.message }); }
    }
    res.json({ ok: true, event: req.body && req.body.name, results });
  } catch (e) {
    console.error('airwallex webhook error:', e);
    res.status(500).json({ error: e.message });
  }
});

// health check
receiver.router.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

(async () => {
  await app.start(PORT);
  console.log(`krave-bot running on port ${PORT}`);
  console.log(`Env: SLACK_BOT_TOKEN=${process.env.SLACK_BOT_TOKEN ? 'set' : 'MISSING'} | SLACK_SIGNING_SECRET=${process.env.SLACK_SIGNING_SECRET ? 'set' : 'MISSING'} | ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ? 'set' : 'MISSING'}`);
})();
