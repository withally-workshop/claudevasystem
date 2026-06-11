// reconcile-shipping-refunds.js — READ-ONLY
// Finds Halo Home subscription orders charged shipping (net of discounts) that have
// NOT already been refunded, over a date range. Source of truth = Shopify, not the sheet.
// Usage: node reconcile-shipping-refunds.js   (env: SHOPIFY_ACCESS_TOKEN, optional FROM/TO=YYYY-MM-DD)
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const DOMAIN = 'homewithhalo.myshopify.com';
const API = `https://${DOMAIN}/admin/api/2024-10`;
const FILTER_SKUS = ['SH-HR-HEADCALCIUM-NA-0013', 'SH-HR-HANDLEPP-NA-0011', 'SH-HR-HEADVITA-LAVENDER-0014', 'SH-HR-FILTERPLAN-0015'];

const todayPHT = new Date(Date.now() + 8 * 3600 * 1000).toISOString().split('T')[0];
const FROM = process.env.FROM || '2026-05-01';
const TO = process.env.TO || todayPHT;

function isSub(o) {
  const tags = (o.tags || '').toLowerCase();
  if (tags.includes('subscription') || tags.includes('recurring') || tags.includes('seal')) return true;
  return (o.line_items || []).some(li => li.selling_plan_allocation || (li.sku && FILTER_SKUS.includes(li.sku)));
}
function shippingGross(o) {
  return (o.shipping_lines || []).reduce((s, sl) => s + parseFloat(sl.price || 0), 0);
}
function shippingNet(o) {
  return (o.shipping_lines || []).reduce((s, sl) => {
    if (sl.discounted_price != null) return s + parseFloat(sl.discounted_price);
    const disc = (sl.discount_allocations || []).reduce((d, da) => d + parseFloat(da.amount || 0), 0);
    return s + (parseFloat(sl.price || 0) - disc);
  }, 0);
}
function shippingRefunded(o) {
  let r = 0;
  for (const ref of (o.refunds || [])) {
    for (const adj of (ref.order_adjustments || [])) {
      if ((adj.kind || '').toLowerCase().includes('shipping')) r += Math.abs(parseFloat(adj.amount || 0));
    }
  }
  return r;
}
function custName(o) {
  if (o.customer) {
    const n = `${o.customer.first_name || ''} ${o.customer.last_name || ''}`.trim();
    if (n) return n;
  }
  return (o.shipping_address && o.shipping_address.name) || o.email || '(no name)';
}

async function getAll() {
  let url = `${API}/orders.json?status=any&limit=250&created_at_min=${FROM}T00:00:00+08:00&created_at_max=${TO}T23:59:59+08:00`;
  const out = [];
  let page = 0;
  while (url) {
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': TOKEN } });
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    out.push(...(data.orders || []));
    page++;
    const link = res.headers.get('link') || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : null;
    if (url) await new Promise(r => setTimeout(r, 300)); // be gentle on rate limit
  }
  console.error(`Fetched ${out.length} orders across ${page} page(s).`);
  return out;
}

(async () => {
  if (!TOKEN) { console.error('ERROR: SHOPIFY_ACCESS_TOKEN not set'); process.exit(1); }
  const orders = await getAll();
  const subs = orders.filter(isSub);
  const eligible = [], skip = [];
  const seen = new Set();
  for (const o of subs) {
    if (seen.has(o.id)) continue; seen.add(o.id);
    const gross = shippingGross(o), net = shippingNet(o), refunded = shippingRefunded(o);
    const row = { num: o.order_number, name: custName(o), email: o.email || '', date: (o.created_at || '').split('T')[0], gross: gross.toFixed(2), net: net.toFixed(2), shipRefunded: refunded.toFixed(2), fin: o.financial_status };
    if (net <= 0.001) { row.reason = 'net shipping $0 (discount already applied)'; skip.push(row); }
    else if (refunded >= net - 0.001) { row.reason = 'shipping already refunded'; skip.push(row); }
    else if (o.financial_status === 'refunded') { row.reason = 'order fully refunded'; skip.push(row); }
    else { eligible.push(row); }
  }
  eligible.sort((a, b) => a.num - b.num);
  skip.sort((a, b) => a.num - b.num);

  console.log(`\n=== SUBSCRIPTION SHIPPING RECONCILIATION (${FROM} -> ${TO}) ===`);
  console.log(`Orders scanned: ${orders.length} | Subscription orders: ${subs.length}`);
  console.log(`\n--- ELIGIBLE for shipping refund: ${eligible.length} ---`);
  for (const r of eligible) console.log(`  #${r.num}  ${r.name}  ${r.date}  net $${r.net} charged (refunded $${r.shipRefunded})`);
  console.log(`\n--- SKIP (already handled / not overcharged): ${skip.length} ---`);
  for (const r of skip) console.log(`  #${r.num}  ${r.name}  ${r.date}  net $${r.net}  -- ${r.reason}`);
  const total = eligible.reduce((s, r) => s + parseFloat(r.net), 0);
  console.log(`\n=== TOTAL TO REFUND: $${total.toFixed(2)} SGD across ${eligible.length} orders ===`);

  // CSV for manual refunding / review
  const csv = ['order_number,customer,email,date,net_shipping_charged,status']
    .concat(eligible.map(r => `${r.num},"${r.name}",${r.email},${r.date},${r.net},ELIGIBLE`))
    .concat(skip.map(r => `${r.num},"${r.name}",${r.email},${r.date},${r.net},SKIP: ${r.reason}`))
    .join('\n');
  const outPath = path.join(__dirname, 'shipping-refund-reconciliation.csv');
  fs.writeFileSync(outPath, csv);
  console.log(`\nCSV written: ${outPath}`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
