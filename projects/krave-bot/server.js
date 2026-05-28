'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

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

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SYSTEM_PROMPT = buildSystemPrompt();

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
  for (const file of supported) {
    try {
      const buf = await downloadSlackImage(file.url_private);
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
  return blocks.length === 1 && !images.length ? text : blocks;
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

  try {
    // agentic loop — keep calling until no more tool_use
    while (true) {
      let response;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          response = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 2048,
            system: SYSTEM_PROMPT,
            tools: ALL_TOOLS,
            messages,
          });
          break;
        } catch (e) {
          const isOverloaded = e.status === 529 || (e.message && e.message.includes('overloaded'));
          const isRateLimit = e.status === 429;
          if (isOverloaded && attempt < 3) {
            await new Promise((r) => setTimeout(r, (attempt + 1) * 8000));
            continue;
          }
          if (isRateLimit && attempt < 2) {
            await new Promise((r) => setTimeout(r, 65000));
            continue;
          }
          throw e;
        }
      }

      messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
        finalText = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
        break;
      }

      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
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
    // clear corrupt history so next message starts clean
    conversations.delete(convKey);
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
const N8N_APPROVAL_WEBHOOK = 'https://noatakhel.app.n8n.cloud/webhook/krave-approval-reply-trigger';

function forwardToN8n(payload) {
  const buf = Buffer.from(JSON.stringify(payload));
  const req = require('https').request({
    hostname: 'noatakhel.app.n8n.cloud',
    path: '/webhook/krave-approval-reply-trigger',
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

function withContext(text, displayName, threadTs) {
  const parts = [`[Requester: ${displayName}]`];
  if (threadTs) parts.push(`[Slack Thread TS: ${threadTs}]`);
  return `${parts.join(' ')}\n${text}`;
}

// DMs
app.event('message', async ({ event, say, client }) => {
  if (event.bot_id || event.subtype) return;
  if (isDuplicate(event.client_msg_id || event.ts)) return;

  // Forward drafts channel messages to n8n approval polling workflow
  if (event.channel === DRAFTS_CHANNEL) {
    forwardToN8n(event);
    return;
  }

  if (event.channel_type !== 'im') return;

  const convKey = getConvKey(event.channel, null);
  try {
    const displayName = await resolveDisplayName(client, event.user);
    const text = withContext(event.text || '', displayName, event.ts);
    const userContent = await buildUserContent(text, event.files);
    const reply = await runAgent(userContent, convKey);
    await say({ text: reply, thread_ts: event.ts });
  } catch (e) {
    console.error('DM handler error:', e);
    await say({ text: `Error: ${e.message}` });
  }
});

// @mentions in channels
app.event('app_mention', async ({ event, say, client }) => {
  if (isDuplicate(event.client_msg_id || event.ts)) return;
  const text = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
  const convKey = getConvKey(event.channel, event.thread_ts || event.ts);
  try {
    const displayName = await resolveDisplayName(client, event.user);
    const contextText = withContext(text, displayName, event.thread_ts || event.ts);
    const userContent = await buildUserContent(contextText, event.files);
    const reply = await runAgent(userContent, convKey);
    await say({ text: reply, thread_ts: event.thread_ts || event.ts });
  } catch (e) {
    console.error('Mention handler error:', e);
    await say({ text: `Error: ${e.message}`, thread_ts: event.thread_ts || event.ts });
  }
});

// ---------------------------------------------------------------------------
// /api/chat — dashboard chatbot endpoint
// ---------------------------------------------------------------------------

receiver.router.use(require('express').json());

receiver.router.use('/api/chat', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

receiver.router.post('/api/chat', async (req, res) => {
  const { message, session_key } = req.body || {};
  if (!message) return res.status(400).json({ error: 'message required' });

  const convKey = `dashboard:${session_key || 'default'}`;
  try {
    const reply = await runAgent(message, convKey);
    res.json({ reply });
  } catch (e) {
    console.error('Chat API error:', e);
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
