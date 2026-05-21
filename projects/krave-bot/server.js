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

async function runAgent(userText, convKey) {
  const history = conversations.get(convKey) || [];
  history.push({ role: 'user', content: userText });

  const messages = [...history];
  let finalText = '';

  // agentic loop — keep calling until no more tool_use
  while (true) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: ALL_TOOLS,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
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
  const updated = messages.slice(-20);
  conversations.set(convKey, updated);

  return finalText || '(no response)';
}

// ---------------------------------------------------------------------------
// Slack Bolt app
// ---------------------------------------------------------------------------

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET || 'dev-placeholder',
  endpoints: '/slack/events',
});

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

// DMs
app.event('message', async ({ event, say }) => {
  if (event.bot_id || event.subtype) return;

  // Forward drafts channel messages to n8n approval polling workflow
  if (event.channel === DRAFTS_CHANNEL) {
    forwardToN8n(event);
    return;
  }

  if (event.channel_type !== 'im') return;

  const convKey = getConvKey(event.channel, null);
  try {
    const reply = await runAgent(event.text || '', convKey);
    await say({ text: reply, thread_ts: event.ts });
  } catch (e) {
    console.error('DM handler error:', e);
    await say({ text: `Error: ${e.message}` });
  }
});

// @mentions in channels
app.event('app_mention', async ({ event, say }) => {
  const text = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
  const convKey = getConvKey(event.channel, event.thread_ts || event.ts);
  try {
    const reply = await runAgent(text, convKey);
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
