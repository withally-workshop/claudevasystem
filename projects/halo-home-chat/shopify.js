const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const SHOPIFY_DOMAIN = process.env.MYSHOPIFY_DOMAIN || 'homewithhalo.myshopify.com';
const SHOPIFY_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const BASE = `https://${SHOPIFY_DOMAIN}/admin/api/2024-10`;

function headers() {
  return {
    'X-Shopify-Access-Token': SHOPIFY_TOKEN,
    'Content-Type': 'application/json',
  };
}

async function shopifyGet(path) {
  const res = await fetch(`${BASE}${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${path}`);
  return res.json();
}

function stripHtml(html) {
  return (html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function getProducts() {
  const data = await shopifyGet('/products.json?limit=250&fields=id,title,status,variants,product_type,tags,body_html');
  return data.products || [];
}

async function getPages() {
  const data = await shopifyGet('/pages.json?limit=50');
  return (data.pages || []).filter(p => p.published_at);
}

// Fetches the rendered storefront HTML for a page slug.
// Used because accordion/section FAQ content lives in theme data, not body_html.
async function getRenderedPageText(slug) {
  try {
    const url = `https://homewithhalo.com/pages/${slug}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'HaloHomeChatBot/1.0' },
    });
    if (!res.ok) return '';
    const html = await res.text();
    const main = html
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    return stripHtml(main).replace(/\s{3,}/g, '\n').trim().slice(0, 8000);
  } catch {
    return '';
  }
}

// Fetches rendered text for all published pages (handles theme-section content).
async function getAllRenderedPages(pages) {
  const results = await Promise.all(
    pages.map(async (p) => {
      const text = await getRenderedPageText(p.handle);
      return text ? { title: p.title, handle: p.handle, text } : null;
    })
  );
  return results.filter(Boolean);
}

async function getBlogArticles() {
  try {
    const blogsData = await shopifyGet('/blogs.json');
    const blogs = blogsData.blogs || [];
    const articles = [];
    for (const blog of blogs) {
      const artData = await shopifyGet(`/blogs/${blog.id}/articles.json?limit=20`);
      for (const a of (artData.articles || [])) {
        if (a.published_at) articles.push({ title: a.title, body: a.body_html, blog: blog.title });
      }
    }
    return articles;
  } catch {
    return [];
  }
}

async function getOrdersByEmail(email) {
  const encoded = encodeURIComponent(email);
  const data = await shopifyGet(`/orders.json?status=any&limit=10&query=email:${encoded}`);
  return data.orders || [];
}

async function getInventoryStatus(products) {
  const inStock = [];
  const outOfStock = [];
  for (const p of products) {
    if (p.status !== 'active') continue;
    const hasStock = p.variants.some(
      (v) => v.inventory_policy === 'continue' || (v.inventory_management === 'shopify' && v.inventory_quantity > 0)
    );
    if (hasStock) inStock.push(p.title);
    else outOfStock.push(p.title);
  }
  return { inStock, outOfStock };
}

module.exports = { getProducts, getPages, getBlogArticles, getOrdersByEmail, getInventoryStatus, getAllRenderedPages, stripHtml };
