const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const { getProducts, getPages, getBlogArticles, getOrdersByEmail, getInventoryStatus, getAllRenderedPages, getActiveDiscounts } = require('./shopify');
const { buildSystemPrompt } = require('./system-prompt');
const { createSession, getSession, updateSessionEmail, setOwner, appendHistory, getHistory, registerSocket, getSocketId, touchSession } = require('./session');
const { notifyEscalation, relayCustomerMessage, verifySlackSignature, handleInteraction, handleSlashReply, handleSlashHandback } = require('./slack');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const ALLOWED_ORIGINS = [
  'https://homewithhalo.com',
  'https://www.homewithhalo.com',
  'https://homewithhalo.myshopify.com',
];

// ── Socket.io ────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
  },
  transports: ['websocket', 'polling'],
});

// ── Catalog cache ─────────────────────────────────────────────────────────────
let catalogCache = {
  products: [],
  inventoryStatus: { inStock: [], outOfStock: [] },
  pages: [],
  articles: [],
  renderedPages: [],
  discounts: null,
  lastRefresh: 0,
};
const CACHE_TTL = 6 * 60 * 60 * 1000;

async function refreshCatalog() {
  try {
    const [products, pages, articles, discounts] = await Promise.all([
      getProducts(),
      getPages(),
      getBlogArticles(),
      getActiveDiscounts(),
    ]);
    const [inventoryStatus, renderedPages] = await Promise.all([
      getInventoryStatus(products),
      getAllRenderedPages(pages),
    ]);
    catalogCache = { products, inventoryStatus, pages, articles, renderedPages, discounts, lastRefresh: Date.now() };
    console.log(`Catalog refreshed: ${products.length} products, ${pages.length} pages, ${articles.length} articles, discounts: ${discounts === null ? 'unavailable (fallback)' : discounts.length}`);
  } catch (err) {
    console.error('Catalog refresh failed:', err.message);
  }
}

async function ensureCatalog() {
  if (Date.now() - catalogCache.lastRefresh > CACHE_TTL) await refreshCatalog();
}

// ── Escalation helpers ────────────────────────────────────────────────────────
const ESCALATION_KEYWORDS = [
  'refund', 'broken', 'complaint', 'unhappy', 'frustrated', 'frustrating',
  'cancel', 'return', 'defective', 'not working', 'damaged', 'wrong item',
];

function detectEscalation(message) {
  const lower = message.toLowerCase();
  if (/talk\s+to\s+(a\s+|the\s+)?(human|person|agent|someone|team)|speak\s+to\s+(a\s+|the\s+)?(human|person|agent|someone|team)|real\s+person|connect\s+me\s+(with|to)\s+(a\s+)?(human|agent|team|person)/i.test(lower)) {
    return { escalate: true, trigger: 'explicit_request', keyword: null };
  }
  for (const kw of ESCALATION_KEYWORDS) {
    if (lower.includes(kw)) {
      return { escalate: true, trigger: 'keyword', keyword: kw };
    }
  }
  return { escalate: false, trigger: null, keyword: null };
}

function isBusinessHours() {
  const now = new Date();
  const sgtHour = (now.getUTCHours() + 8) % 24;
  const sgtDay = new Date(now.getTime() + 8 * 60 * 60 * 1000).getUTCDay(); // 0=Sun, 6=Sat
  if (sgtDay === 0 || sgtDay === 6) return false;
  return sgtHour >= 9 && sgtHour < 18;
}

function formatTranscript(history) {
  return history.slice(-12).map(entry => {
    const label = entry.role === 'user' ? 'Customer' : entry.role === 'human_agent' ? 'Agent' : 'Mimi';
    return `${label}: ${entry.content}`;
  }).join('\n');
}

// Single source of truth for handing a session to a human: one natural handoff
// bubble + escalate. Used by both the explicit-request short-circuit and the
// post-Claude escalation path so customers only ever see ONE handoff message.
async function escalateAndHandoff(socket, sessionId, { email, triggeredBy, reason }) {
  const bh = isBusinessHours();
  const handoffMessage = bh
    ? "Got it. I'm passing this to our Halo support team now, and someone will follow up with you by email shortly."
    : "Our support team is offline right now, but I've flagged your message and someone will follow up by email within 24 hours.";

  socket.emit('bot_message', { content: handoffMessage, parts: [handoffMessage] });
  socket.emit('escalated', { sessionId, businessHours: bh });

  try {
    await setOwner(sessionId, 'human');
    await appendHistory(sessionId, { role: 'assistant', content: handoffMessage });
    const fullHistory = await getHistory(sessionId);
    const transcript = formatTranscript(fullHistory);
    await notifyEscalation(sessionId, { email, transcript, isBusinessHours: bh, triggeredBy, reason });
  } catch (err) {
    console.error('[Socket] escalation error:', err.message);
  }
}

// ── Claude API call (shared by socket handler and /chat HTTP endpoint) ────────
async function callClaude({ content, historyEntries = [], email }) {
  await ensureCatalog();

  const systemPrompt = buildSystemPrompt({
    inventoryStatus: catalogCache.inventoryStatus,
    products: catalogCache.products,
    pages: catalogCache.pages,
    articles: catalogCache.articles,
    renderedPages: catalogCache.renderedPages,
    discounts: catalogCache.discounts,
  });

  let orderContext = '';
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    try {
      const orders = await getOrdersByEmail(email);
      if (orders.length > 0) {
        const summaries = orders.slice(0, 5).map((o) => {
          const items = (o.line_items || []).map((li) => `${li.name} x${li.quantity}`).join(', ');
          const fulfillment = o.fulfillment_status || 'unfulfilled';
          const tracking = o.fulfillments?.[0]?.tracking_number || null;
          return `Order #${o.order_number} — ${o.financial_status} — ${fulfillment} — ${o.created_at?.split('T')[0]} — ${items} — $${o.total_price} SGD${tracking ? ' — Tracking: ' + tracking : ''}`;
        });
        orderContext = `\n\n[Order data for ${email}]\n${summaries.join('\n')}`;
      } else {
        orderContext = `\n\n[No orders found for email: ${email}]`;
      }
    } catch {
      orderContext = '\n\n[Could not retrieve order data — please contact hello@homewithhalo.com]';
    }
  }

  const userMessage = content + orderContext;
  const messages = [...historyEntries.slice(-10), { role: 'user', content: userMessage }];

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: systemPrompt,
      messages,
    }),
  });

  if (!claudeRes.ok) {
    const err = await claudeRes.text();
    console.error('Claude error:', err);
    throw new Error('Claude API error');
  }

  const data = await claudeRes.json();
  return data.content?.[0]?.text || "I'm having trouble responding right now. Please contact hello@homewithhalo.com for help.";
}

// ── Socket.io rate limiter ────────────────────────────────────────────────────
const socketMessageCounts = new Map();
const SOCKET_RATE_LIMIT = 20;
const SOCKET_WINDOW_MS = 60 * 1000;

function checkSocketRateLimit(socketId) {
  const now = Date.now();
  const entry = socketMessageCounts.get(socketId) || { count: 0, windowStart: now };
  if (now - entry.windowStart > SOCKET_WINDOW_MS) {
    socketMessageCounts.set(socketId, { count: 1, windowStart: now });
    return true;
  }
  entry.count++;
  socketMessageCounts.set(socketId, entry);
  return entry.count <= SOCKET_RATE_LIMIT;
}

// ── Socket.io connection handler ──────────────────────────────────────────────
io.on('connection', (socket) => {
  let activeSessionId = null;

  socket.on('session_init', async ({ sessionId, email } = {}) => {
    try {
      let sid = sessionId;
      if (sid) {
        const existing = await getSession(sid);
        if (!existing) sid = null;
      }
      if (!sid) sid = await createSession(email || '');
      activeSessionId = sid;
      await registerSocket(sid, socket.id);
      socket.emit('session_ready', { sessionId: sid });
    } catch (err) {
      console.error('[Socket] session_init error:', err.message);
      socket.emit('error', { message: 'Failed to initialize session.' });
    }
  });

  socket.on('heartbeat', async () => {
    if (activeSessionId) {
      try { await registerSocket(activeSessionId, socket.id); } catch {}
    }
  });

  socket.on('message', async ({ content, email } = {}) => {
    if (!activeSessionId) {
      socket.emit('error', { message: 'No active session.' });
      return;
    }
    if (!content || typeof content !== 'string' || content.trim().length === 0) return;
    if (content.length > 2000) {
      socket.emit('error', { message: 'Message too long.' });
      return;
    }

    if (!checkSocketRateLimit(socket.id)) {
      socket.emit('rate_limited', { message: 'Too many messages — please wait a moment.' });
      return;
    }

    let session;
    try {
      session = await getSession(activeSessionId);
    } catch (err) {
      socket.emit('error', { message: 'Session error — please refresh.' });
      return;
    }
    if (!session) {
      socket.emit('error', { message: 'Session expired.' });
      return;
    }

    if (email && email !== session.email) {
      try { await updateSessionEmail(activeSessionId, email); } catch {}
    }

    try {
      await appendHistory(activeSessionId, { role: 'user', content });
      await touchSession(activeSessionId);
    } catch {}

    // Human-owned session — relay to Slack, ack to browser
    if (session.owner === 'human') {
      try { await relayCustomerMessage(activeSessionId, { content, email: session.email || email }); } catch {}
      socket.emit('relay_ack', {});
      return;
    }

    // Keyword / explicit escalation check before calling Claude
    const escalationCheck = detectEscalation(content);

    // Explicit "talk to a human" request: hand off in ONE natural message and
    // skip Claude. Calling Claude here only produces a filler reply that stacks
    // on top of the injected handoff — the 3-bubble spam customers complained about.
    if (escalationCheck.trigger === 'explicit_request') {
      await escalateAndHandoff(socket, activeSessionId, {
        email: session.email || email || '',
        triggeredBy: 'explicit request',
        reason: null,
      });
      return;
    }

    socket.emit('typing', { typing: true });

    let botReply;
    try {
      const history = await getHistory(activeSessionId);
      // After a human handback, give the bot a clean slate: drop everything from
      // before the handback (the human-handled exchange) so it doesn't resurface
      // and answer a question from the human-owned part of the conversation.
      const prior = session.botResumedAt
        ? history.slice(0, -1).filter(e => e.ts && e.ts >= session.botResumedAt)
        : history.slice(0, -1);
      const historyEntries = prior.map(e => ({ role: e.role === 'human_agent' ? 'assistant' : e.role, content: e.content }));
      botReply = await callClaude({ content, historyEntries, email: session.email || email });
    } catch (err) {
      socket.emit('typing', { typing: false });
      socket.emit('bot_message', {
        content: "I'm having trouble right now. Please contact hello@homewithhalo.com for help.",
        parts: ["I'm having trouble right now. Please contact hello@homewithhalo.com for help."],
      });
      return;
    }

    socket.emit('typing', { typing: false });

    // Claude escalation signal
    const shippingFeeEscalate = botReply.includes('[[ESCALATE:SHIPPING_FEE]]');
    const claudeEscalate = shippingFeeEscalate || botReply.includes('[[ESCALATE]]');
    const shouldEscalate = escalationCheck.escalate || claudeEscalate;
    const cleanReply = botReply.replace(/\[\[ESCALATE(?::SHIPPING_FEE)?\]\]/g, '').trim();

    const parts = cleanReply.split('|||').map(s => s.trim()).filter(Boolean);
    socket.emit('bot_message', { content: cleanReply, parts });

    try { await appendHistory(activeSessionId, { role: 'assistant', content: cleanReply }); } catch {}

    if (shouldEscalate) {
      const triggeredBy = shippingFeeEscalate
        ? 'wrong $5 subscription shipping fee — needs refund review'
        : escalationCheck.keyword
          ? `keyword: ${escalationCheck.keyword}`
          : 'Claude judgment';

      await escalateAndHandoff(socket, activeSessionId, {
        email: session.email || email || '',
        triggeredBy,
        reason: shippingFeeEscalate ? 'shipping_fee' : null,
      });
    }
  });

  socket.on('disconnect', () => {
    socketMessageCounts.delete(socket.id);
  });
});

// ── Express middleware ─────────────────────────────────────────────────────────
app.use(express.json());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

// ── HTTP rate limiter (existing /chat endpoint) ───────────────────────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please try again in a moment.' },
});
app.use('/chat', limiter);

// ── Static files ──────────────────────────────────────────────────────────────
app.get('/widget.js', (_req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.sendFile(path.join(__dirname, 'widget.js'));
});

app.get('/health', (_req, res) => res.json({
  status: 'ok',
  catalogAge: Date.now() - catalogCache.lastRefresh,
  products: catalogCache.products.length,
  pages: catalogCache.pages.length,
  articles: catalogCache.articles.length,
}));

// ── Slack slash commands ──────────────────────────────────────────────────────
const captureRawBody = express.urlencoded({
  extended: true,
  verify: (req, _res, buf) => { req.rawBody = buf.toString(); },
});

app.post('/slack/interactions', captureRawBody, verifySlackSignature, (req, res) => handleInteraction(req, res, io));
app.post('/slack/commands/reply', captureRawBody, verifySlackSignature, (req, res) => handleSlashReply(req, res, io));
app.post('/slack/commands/handback', captureRawBody, verifySlackSignature, (req, res) => handleSlashHandback(req, res, io));

// ── Legacy /chat HTTP endpoint (kept for backward compatibility) ───────────────
app.post('/chat', async (req, res) => {
  const { message, email, conversation_history = [] } = req.body || {};

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'message is required' });
  }
  if (message.length > 2000) {
    return res.status(400).json({ error: 'message too long' });
  }

  try {
    const historyEntries = conversation_history.slice(-10);
    const response = await callClaude({ content: message, historyEntries, email });
    const cleanResponse = response.replace(/\[\[ESCALATE(?::SHIPPING_FEE)?\]\]/g, '').trim();
    res.json({ response: cleanResponse });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'Something went wrong — please try again.' });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────
server.listen(PORT, async () => {
  console.log(`Halo Home Chat backend running on port ${PORT}`);
  await refreshCatalog();
});
