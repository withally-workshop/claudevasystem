# Skill: Halo Home Ops

**Trigger:** "halo home", "/halo-home", "halo orders", "halo sales", "halo inventory", "halo customers", "halo refunds", "halo revenue", "halo subscriptions", "what came in today", "halo digest"
**Store:** homewithhalo.myshopify.com
**MCP Server:** `shopify` (always-on via `.mcp.json`)
**SOP:** `references/sops/halo-home-ops.md`

---

## What This Skill Does

Live read-only access to the Halo Home Shopify store via MCP. Handles all internal ops queries for Noa and John — sales, orders, inventory, customers, refunds, subscriptions.

All tools are read-only. No write operations in Phase 1.

---

## Capabilities

### 1. Sales Snapshot / Revenue Report

**Triggers:** "what came in today", "this week's revenue", "how did we do in May", "sales snapshot", "revenue report"

**Step 1** — Call `mcp__shopify__get-orders` with:
- `sortKey: CREATED_AT`, `reverse: true`
- `query`: filter by date range based on intent:
  - Today: `created_at:>=[today 00:00 UTC]`
  - This week: `created_at:>=[Monday 00:00 UTC]`
  - This month: `created_at:>=[first of month]`
  - Custom: parse date range from message

**Step 2** — Calculate:
- Total revenue (SGD)
- Order count
- Revenue by product/SKU
- Average order value
- Any refunds or $0 orders in the window

**Step 3** — Output format:
```
Halo Home — [Period] Sales Snapshot
──────────────────────────────────
Revenue:     $X,XXX SGD
Orders:      XX
AOV:         $XXX SGD
Top product: [name] (XX units)

Refunds:     X ($XXX SGD)
Comped ($0): X orders

By product:
  Brushed Chrome Showerhead  XX units  $X,XXX
  Filter Refills (pair)      XX units  $XXX
  ...
```

---

### 2. Order Lookup

**Triggers:** "find order from [email]", "order #[number]", "look up [email]'s order", "what did [email] buy"

**Step 1** — Determine lookup type:
- By email: `mcp__shopify__get-orders` with `query: "email:[email]"`
- By order number: `mcp__shopify__get-order` with order ID, or `get-orders` with `query: "name:#[number]"`

**Step 2** — Output:
```
Order #XXXX — [Customer Email]
Status:    PAID / REFUNDED / PENDING
Date:      [date] SGD [amount]
Items:     [list with SKUs]
Ships to:  [country]
```

If no order found: "No order found for [email]. Check spelling or try order number."

---

### 3. Inventory Status

**Triggers:** "what's in stock", "inventory check", "what's out of stock", "is [product] available", "stock status"

**Step 1** — Call `mcp__shopify__get-products` with `limit: 50`

**Step 2** — Classify each variant:
- `CONTINUE` = in stock (can oversell)
- `DENY` = out of stock

**Step 3** — Output:
```
Halo Home — Inventory Status
─────────────────────────────
IN STOCK
  ✓ Brushed Chrome Showerhead
  ✓ Cleansing Calcium Sulfite Filter
  ✓ Purifying PP Cotton Filter
  ✓ Lavender Bliss Vita C Aroma Filter
  ✓ Showerhead Smart Refill Plan
  ✓ 1 Year Supply Filter Refills

OUT OF STOCK
  ✗ Filtered Showerhead - Matte Black
  ✗ Sweet Citrus Vita C Aroma Filter
  ✗ Bamboo Pillowcases (all variants)
  ✗ Silk Pillowcases (all variants)
  ✗ Glow & Clean Bundle
  ✗ Luxe Shower Ritual Bundle

FLAGS
  ⚠ Bamboo Pillowcase - Grey priced at $423.44 — likely data error
```

---

### 4. Refund Tracker

**Triggers:** "any refunds", "refunds this week", "refund check", "what got refunded"

**Step 1** — Call `mcp__shopify__get-orders` with `query: "financial_status:refunded"` + date range

**Step 2** — Output:
```
Refunds — [Period]
──────────────────
#4093  annlynnlynn@hotmail.com   $219.09 SGD   Brushed Chrome x3
#4076  smiley_ysq@yahoo.com.sg   $106.25 SGD   Matte Black x1

Total refunded: $325.34 SGD (2 orders)
```

If none: "No refunds in this period."

---

### 5. Customer History

**Triggers:** "what has [email] ordered", "customer history for [email]", "lookup [email]"

**Step 1** — `mcp__shopify__get-customers` to find customer by email, then `mcp__shopify__get-orders` with `query: "email:[email]"`

**Step 2** — Output:
```
Customer: [email]
──────────────────
Total orders:  X
Total spend:   $XXX SGD
First order:   [date]
Last order:    [date]

Order history:
  #XXXX  [date]  $XXX  [items]
  #XXXX  [date]  $XXX  [items]
```

---

### 6. Subscription / Refill Plan Customers

**Triggers:** "who's on the refill plan", "subscription customers", "smart refill plan list"

**Step 1** — `mcp__shopify__get-orders` with `query: "sku:SH-HR-FILTERPLAN-0015"`

**Step 2** — Deduplicate by customer email, sort by most recent

**Step 3** — Output:
```
Smart Refill Plan Customers
────────────────────────────
XX unique customers on the refill plan

Recent:
  email@x.com     Order #XXXX   [date]
  email@x.com     Order #XXXX   [date]
  ...
```

---

### 7. $0 / Comped Order Log

**Triggers:** "show comped orders", "$0 orders", "free orders", "what got comped"

**Step 1** — `mcp__shopify__get-orders` with `query: "total_price:0"` + date range

**Step 2** — Output:
```
Comped Orders — [Period]
─────────────────────────
#4111  eibbedoey@gmail.com      SH-HR-HeadPlate-NA-0017 x2   (reason unknown)
#4077  miyuki.saito1@gmail.com  Brushed Chrome x2            (reason unknown)
...

Total comped: X orders ($X,XXX face value)
Note: No tagging system yet — reason cannot be determined from order data alone.
```

---

### 8. Product Info / Catalog

**Triggers:** "what products do we have", "show me the catalog", "what filters do we sell"

**Step 1** — `mcp__shopify__get-products` with `limit: 50`

**Step 2** — Group by category (Shower / Sleep / Bundles) and output clean catalog with prices and SKUs.

---

## Shopify MCP Tools Reference

| Action | Tool |
|--------|------|
| Get orders (filtered) | `mcp__shopify__get-orders` |
| Get single order | `mcp__shopify__get-order` |
| Get all products | `mcp__shopify__get-products` |
| Search products by title | `mcp__shopify__get-products` with `searchTitle` |
| Get customers | `mcp__shopify__get-customers` |
| Get collections | `mcp__shopify__get-collections` |
| Get shop info | `mcp__shopify__get-shop-details` |

---

## Key Store Data

| Field | Value |
|-------|-------|
| Store | homewithhalo.myshopify.com |
| Currency | SGD |
| Best-selling SKU | SH-HH-BrushedChrome-0009 (Brushed Chrome Showerhead, $125) |
| Refill plan SKU | SH-HR-FILTERPLAN-0015 ($33/cycle) |
| Filter pair | SH-HR-HANDLEPP-NA-0011 + SH-HR-HEADCALCIUM-NA-0013 ($33 combined) |
| Replace cycle | 90 days |
| Known data issue | Bamboo Pillowcase - Grey priced at $423.44 (should be $39) |

---

## Notes

- All operations are read-only. No order mutations, no tagging, no discount creation in Phase 1.
- MCP token is in `.env` as `SHOPIFY_ACCESS_TOKEN` — never print it.
- If MCP is unavailable, direct Noa/John to Shopify admin at admin.shopify.com/store/homewithhalo.
- VA Slack bot uses the same logic but via n8n + direct REST API (see `n8n-workflows/deploy-halo-home-slack-bot.js`).
