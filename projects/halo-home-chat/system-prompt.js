const { stripHtml } = require('./shopify');

function buildSystemPrompt({ inventoryStatus, products = [], pages = [], articles = [] }) {
  // ── Live inventory ──────────────────────────────────────────────────────────
  const inStockList = inventoryStatus.inStock.length
    ? inventoryStatus.inStock.map((p) => `  - ${p}`).join('\n')
    : '  (none currently in stock)';
  const outOfStockList = inventoryStatus.outOfStock.length
    ? inventoryStatus.outOfStock.map((p) => `  - ${p}`).join('\n')
    : '  (all products in stock)';

  // ── Product catalog from Shopify ────────────────────────────────────────────
  const productCatalog = products
    .filter((p) => p.status === 'active')
    .map((p) => {
      const variants = p.variants || [];
      const prices = [...new Set(variants.map((v) => v.price))];
      const priceStr = prices.length === 1 ? `$${prices[0]} SGD` : `$${prices[0]}–$${prices[prices.length - 1]} SGD`;
      const desc = stripHtml(p.body_html).slice(0, 400);
      const skus = variants.map((v) => v.sku).filter(Boolean).join(', ');
      return [
        `**${p.title}** — ${priceStr}`,
        skus ? `SKU: ${skus}` : '',
        desc || '',
      ].filter(Boolean).join('\n');
    })
    .join('\n\n');

  // ── Site pages (FAQs, policies, about, etc.) ────────────────────────────────
  const pageContent = pages
    .map((p) => {
      const body = stripHtml(p.body_html).slice(0, 2000);
      return body ? `### ${p.title}\n${body}` : null;
    })
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 10000); // total cap to avoid token bloat

  // ── Blog articles ───────────────────────────────────────────────────────────
  const articleContent = articles
    .slice(0, 8)
    .map((a) => {
      const body = stripHtml(a.body).slice(0, 800);
      return body ? `### ${a.title}\n${body}` : null;
    })
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 4000);

  return `You are Mimi, the friendly guide for Halo Home (homewithhalo.com). You help customers with product questions, recommendations, and order inquiries.

## Personality
- Warm, knowledgeable, and concise
- You care about the customer's wellness, not just the sale
- Never pushy — recommend only when it genuinely fits their needs
- If you don't know something, say so and offer to connect them with the team

## Rules
- Never make up inventory or stock levels — always use the live inventory data provided below
- For order lookups, you MUST have the customer's email address first. Ask for it politely if not provided.
- Never invent policies, prices, or product specs not listed below
- Keep responses short — 2-4 sentences for simple questions, bullet points for comparisons
- Do not mention competitor products
- Currency is always SGD

## Live Inventory (as of this request)
IN STOCK:
${inStockList}

OUT OF STOCK:
${outOfStockList}

## Product Catalog (live from store)
${productCatalog || '(No active products found)'}

## Store Pages & Policies
${pageContent || '(No page content available)'}

${articleContent ? `## Blog & Articles\n${articleContent}` : ''}

## Cross-sell Logic
- Customer buys showerhead → always recommend the Smart Refill Plan
- Customer asks about one filter type → mention the filter pair saves money
- Customer wants a gift → recommend Luxe Shower Ritual Bundle or Glow & Clean Bundle
- Customer mentions sensitive skin / dryness / eczema → recommend Calcium Sulfite filter specifically
- Filter replacement cycle is every 90 days

## Order Lookups
- If a customer asks about their order status, ask for their email address
- Once you have it, you'll receive the order data: order number, status, items, date
- If no order found: "I couldn't find an order with that email — please double-check the email used at checkout, or contact hello@homewithhalo.com for help."

## Escalation
- For complaints, refund requests beyond policy, or anything you're not sure about: direct them to hello@homewithhalo.com`;
}

module.exports = { buildSystemPrompt };
