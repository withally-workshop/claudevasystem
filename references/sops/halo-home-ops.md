# SOP: Halo Home Ops

**Store:** homewithhalo.myshopify.com  
**Currency:** SGD  
**Updated:** 2026-05

---

## Who Uses This

| User | Interface | Access Level |
|------|-----------|-------------|
| Noa / John (power users) | Claude Code CLI (`/halo-home` skill) | MCP direct read |
| VA | #halo-home Slack bot (@mention) | n8n → Shopify REST read |
| Customers | Storefront chatbot (homewithhalo.com) | Render backend read |

---

## Query Reference

### Sales Snapshot
- **Ask:** "what came in today / this week / this month"
- **Output:** Revenue (SGD), order count, AOV, top products, refunds, comped orders
- **Data source:** `get-orders` with date range + `created_at` filter

### Order Lookup
- **Ask:** "find order from email@x.com" or "order #4120"
- **By email:** `get-orders` with `query: "email:x"`
- **By number:** `get-orders` with `query: "name:#4120"`

### Inventory Status
- **Ask:** "what's in stock", "is brushed chrome available"
- **Logic:** `get-products` → check `inventory_policy` per variant
  - `CONTINUE` = can oversell (treat as in stock)
  - `DENY` + `inventory_quantity <= 0` = out of stock
- **Known OOS (as of 2026-05):** Matte Black showerhead, Sweet Citrus filter, all pillowcases, Glow & Clean Bundle, Luxe Shower Ritual Bundle

### Refund Tracker
- **Ask:** "any refunds this week"
- **Query:** `get-orders` with `financial_status:refunded` + date range

### Customer History
- **Ask:** "what has email@x.com ordered"
- **Steps:** `get-customers` to find customer → `get-orders` with `query: "email:x"`

### Subscription / Refill Plan Customers
- **Ask:** "who's on the refill plan"
- **Query:** `get-orders` with `query: "sku:SH-HR-FILTERPLAN-0015"`
- **Output:** Deduplicated by email, sorted by most recent

### Comped ($0) Orders
- **Ask:** "show comped orders"
- **Query:** `get-orders` with `query: "total_price:0"`
- **Note:** No tagging system — reason for comp cannot be determined from order data alone

### Order Search by SKU / Product
- **Ask:** "which orders contain SH-HR-HEADVITA-LAVENDER-0014", "who ordered Lavender Bliss"
- **Query:** `get-orders` over range (default 30d), filter `line_items[].sku`/`title`
- **Output:** order #, email, date, fulfillment status, matched items. Single fetch caps at 250 — narrow the date range for wide history.

### Orders by Discount Code
- **Ask:** "which orders used DIVINE20", "revenue from RELAX15"
- **Query:** `get-orders` over range (default 90d), filter `discount_codes[].code` **exact, case-insensitive** (never substring — DIVINE20 ≠ DIVINE2)
- **Output:** order #, customer, date, discount amount, fulfillment, total revenue. Distinct from discount-code lookup (validity/usage only).

### Subscription Charges (Smart Refill)
- **Ask:** "who was charged today for filter subscriptions"
- **Query:** `get-orders` (default today), keep subs (tags/selling_plan/filter SKUs)
- **Output:** customer, order #, charge amount, date, last fulfillment. Subscription ID + next charge date live in **Seal**, not Shopify.

### Subscription Shipping-Fee Exceptions (the $5 refund report)
- **Ask:** "which subscriptions were charged shipping", "who needs a shipping refund"
- **Query:** `get-orders` (default 7d), of subs flag `shipping_lines` total > 0
- **Output:** customer, order #, shipping charged, date. Filter subscriptions must ship free per T&C.

---

## Key Store Data

| Field | Value |
|-------|-------|
| Bestseller SKU | SH-HH-BrushedChrome-0009 — Brushed Chrome Showerhead ($125) |
| Refill plan SKU | SH-HR-FILTERPLAN-0015 — Smart Refill Plan ($33/cycle) |
| Filter pair | SH-HR-HANDLEPP-NA-0011 (PP Cotton) + SH-HR-HEADCALCIUM-NA-0013 (Calcium Sulfite) |
| Replace cycle | Every 90 days |
| Known price bug | Bamboo Pillowcase - Grey showing $423.44 (should be ~$39) — do not quote this price |

---

## Automated Workflows

### Daily Digest
- **Runs:** 8 AM PHT daily
- **Posts to:** #halo-home
- **Content:** Yesterday's revenue, order count, AOV, top products, refunds, comped orders
- **Deploy:** `n8n-workflows/deploy-halo-home-daily-digest.js`

### Inventory Alert
- **Runs:** 8 AM PHT daily
- **Posts to:** #halo-home only when a change is detected
- **Logic:** Compares current DENY+OOS variants against previous run's saved state
  - First run saves baseline — no alert fires
  - Subsequent runs alert on newly OOS or back-in-stock
- **Deploy:** `n8n-workflows/deploy-halo-home-inventory-alert.js`

### VA Slack Bot
- **Trigger:** @mention in #halo-home
- **Intent types handled:** sales snapshot, order lookup by email, order lookup by number, inventory check, specific product availability, refund check, customer history, subscription list, comped orders, revenue report, product info, order search by SKU/product, orders by discount code, week-vs-week comparison, subscription charges, subscription shipping-fee exceptions, general question
- **Deploy:** `n8n-workflows/deploy-halo-home-slack-bot.js`
- **Setup required:** Slack app Event Subscriptions → `app_mention` → webhook URL `https://noatakhel.app.n8n.cloud/webhook/halo-home-bot`

---

## Storefront Chatbot

- **URL:** https://halo-home-chat.onrender.com
- **Backend:** `projects/halo-home-chat/server.js` — Express on Render
- **Widget:** `projects/halo-home-chat/widget.js` — inject into Shopify `theme.liquid`
- **Rate limit:** 20 req/min per IP
- **Catalog cache:** Refreshed every 6 hours on the server
- **Order lookup flow:** Customer mentions order → bot asks for email → backend fetches orders for that email → bot summarizes

### Widget Embed (Shopify theme)
1. In Shopify admin: Online Store → Themes → Edit code
2. Open `layout/theme.liquid`
3. Before `</body>`, add:
```html
<script src="https://halo-home-chat.onrender.com/widget.js" defer></script>
```
Or inline the file contents inside `<script>` tags.

---

## Constraints

- **Read-only (Phase 1).** No order mutations, no discount creation, no tagging.
- **Never print `SHOPIFY_ACCESS_TOKEN`** — it's in `.env` and `.mcp.json` as a secret.
- If MCP is unavailable: direct to Shopify admin at admin.shopify.com/store/homewithhalo

---

## Escalation Path

| Issue | Route |
|-------|-------|
| Returns / refund requests | hello@homewithhalo.com |
| Order not found (customer) | Confirm email used at checkout → hello@homewithhalo.com |
| Price discrepancy (Bamboo Grey) | Fix in Shopify admin → Products → Bamboo Pillowcase |
| Filter/showerhead malfunction | Troubleshoot (see chatbot FAQ) → hello@homewithhalo.com |
