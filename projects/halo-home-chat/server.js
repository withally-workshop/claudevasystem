const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const { getProducts, getPages, getBlogArticles, getOrdersByEmail, getInventoryStatus } = require('./shopify');
const { buildSystemPrompt } = require('./system-prompt');

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// Catalog cache — refresh every 6 hours
let catalogCache = {
  products: [],
  inventoryStatus: { inStock: [], outOfStock: [] },
  pages: [],
  articles: [],
  lastRefresh: 0,
};
const CACHE_TTL = 6 * 60 * 60 * 1000;

async function refreshCatalog() {
  try {
    const [products, pages, articles] = await Promise.all([
      getProducts(),
      getPages(),
      getBlogArticles(),
    ]);
    const inventoryStatus = await getInventoryStatus(products);
    catalogCache = { products, inventoryStatus, pages, articles, lastRefresh: Date.now() };
    console.log(`Catalog refreshed: ${products.length} products, ${pages.length} pages, ${articles.length} articles`);
  } catch (err) {
    console.error('Catalog refresh failed:', err.message);
  }
}

async function ensureCatalog() {
  if (Date.now() - catalogCache.lastRefresh > CACHE_TTL) await refreshCatalog();
}

app.use(express.json());

app.use(cors({
  origin: (origin, cb) => {
    const allowed = [
      'https://homewithhalo.com',
      'https://www.homewithhalo.com',
      'https://homewithhalo.myshopify.com',
    ];
    if (!origin || allowed.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please try again in a moment.' },
});
app.use('/chat', limiter);

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

app.post('/chat', async (req, res) => {
  const { message, email, conversation_history = [] } = req.body || {};

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'message is required' });
  }
  if (message.length > 2000) {
    return res.status(400).json({ error: 'message too long' });
  }

  try {
    await ensureCatalog();

    const systemPrompt = buildSystemPrompt({
      inventoryStatus: catalogCache.inventoryStatus,
      products: catalogCache.products,
      pages: catalogCache.pages,
      articles: catalogCache.articles,
    });

    let orderContext = '';
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      try {
        const orders = await getOrdersByEmail(email);
        if (orders.length > 0) {
          const summaries = orders.slice(0, 5).map((o) => {
            const items = (o.line_items || []).map((li) => `${li.name} x${li.quantity}`).join(', ');
            return `Order #${o.order_number} — ${o.financial_status} — ${o.created_at?.split('T')[0]} — ${items} — $${o.total_price} SGD`;
          });
          orderContext = `\n\n[Order data for ${email}]\n${summaries.join('\n')}`;
        } else {
          orderContext = `\n\n[No orders found for email: ${email}]`;
        }
      } catch {
        orderContext = '\n\n[Could not retrieve order data — please contact hello@homewithhalo.com]';
      }
    }

    const userMessage = message + orderContext;
    const history = conversation_history.slice(-10);
    const messages = [...history, { role: 'user', content: userMessage }];

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
      return res.status(502).json({ error: 'AI service unavailable — please try again.' });
    }

    const data = await claudeRes.json();
    const response = data.content?.[0]?.text || "I'm having trouble responding right now. Please contact hello@homewithhalo.com for help.";

    res.json({ response });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'Something went wrong — please try again.' });
  }
});

app.listen(PORT, async () => {
  console.log(`Halo Home Chat backend running on port ${PORT}`);
  await refreshCatalog();
});
