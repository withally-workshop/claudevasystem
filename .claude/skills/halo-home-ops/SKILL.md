# Skill: Halo Home Ops

**Trigger:** "halo home", "/halo-home", "halo orders", "halo sales", "halo inventory", "halo customers", "halo refunds", "halo revenue", "halo subscriptions", "what came in today", "halo digest", "run digest", "daily digest", "run inventory check", "inventory status", "abandoned checkouts", "discount code", "refill due", "who needs to reorder"
**Store:** homewithhalo.myshopify.com
**MCP Server:** `shopify` (always-on via `.mcp.json`)
**SOP:** `references/sops/halo-home-ops.md`

---

## What This Skill Does

Live read-only access to the Halo Home Shopify store via MCP. Handles all internal ops queries for Noa and John — sales, orders, inventory, customers, refunds, subscriptions.

All tools are read-only. No write operations in Phase 1.

---

## Capabilities

### 0. Daily Digest (on-demand)

**Triggers:** "run digest", "daily digest", "show me the digest", "halo digest"

Produces the same formatted output as the scheduled Daily Digest workflow, but on demand.

**Step 1** — Call `mcp__shopify__get-orders` with:
- `sortKey: CREATED_AT`, `reverse: true`
- Date range: yesterday 00:00 UTC+8 → today 00:00 UTC+8
- `status: any`, `limit: 250`

**Step 2** — Calculate: total revenue, order count, AOV, top products by units, refund count + value, comped ($0) count.

**Step 3** — Output format:
```
Halo Home — [Weekday, DD Month YYYY] Digest
─────────────────────────────
Revenue:     $X,XXX SGD
Orders:      XX
AOV:         $XXX SGD

Top products:
  [product name] — XX units

Refunds:     X ($XXX SGD)   ← omit if none
Comped ($0): X orders       ← omit if none
```

Also post to `#halo-home-shopify` via `mcp__slack-noa__slack_post_message` (channel `C0B6J5MUZCL`) after displaying inline.

---

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

### 1e. Abandoned Checkouts

**Triggers:** "abandoned carts", "abandoned checkouts", "who didn't complete checkout"

**Step 1** — `GET /checkouts.json?limit=50`

**Step 2** — Output:
```
Abandoned Checkouts — X carts
──────────────────────────────
email@x.com  $125 SGD  Brushed Chrome x1  2 hours ago
(Guest)       $33 SGD   Filter Refills x2  1 day ago
```
If none: "No abandoned checkouts."

---

### 1f. Discount Code Lookup

**Triggers:** "check discount code X", "is code WELCOME15 valid", "how many times has X been used"

**Step 1** — `GET /discount_codes/lookup.json?code={CODE}`

**Step 2** — Output:
```
Discount Code: WELCOME15
Valid:      Yes
Type:       15% off
Uses:       42 times used
```
If not found: "Code WELCOME15 not found or has expired."

---

### 1g. Filter Refill Due

**Triggers:** "who needs to reorder filters", "refill due", "filter refill list", "who's due for a refill"

Customers who bought filter products (SKUs: SH-HR-HEADCALCIUM, SH-HR-HANDLEPP, SH-HR-HEADVITA, SH-HR-FILTERPLAN) 75–105 days ago — in the refill window.

**Step 1** — `mcp__shopify__get-orders` date range: 75–105 days ago, status: any, limit: 100

**Step 2** — Filter by filter SKUs, output:
```
Filter Refill Due — X customers
────────────────────────────────
email@x.com  Calcium Filter x1  87 days ago  #4050
email@x.com  Refill Plan x1     79 days ago  #4061
```
If none: "No customers in the 75–105 day refill window right now."

---

### 1b. Unfulfilled Orders

**Triggers:** "what's unshipped", "unfulfilled orders", "what needs to go out", "pending fulfillment", "what hasn't shipped"

**Step 1** — `mcp__shopify__get-orders` with `query: "fulfillment_status:unfulfilled"`, `status: open`, `limit: 50`

**Step 2** — Output:
```
Unfulfilled Orders — X pending
──────────────────────────────
#XXXX  email@x.com  Brushed Chrome x1  Ordered 2 days ago
#XXXX  email@x.com  Filter Refills x2  Ordered today
```
If none: "No unfulfilled orders right now."

---

### 1c. Order Status / Fulfillment Tracking

**Triggers:** "has order #X shipped", "tracking for [email]", "did [email]'s order go out", "where is order #X"

**Step 1** — Lookup by order number or email (same as Order Lookup)

**Step 2** — Focus output on fulfillment fields:
```
Order #XXXX — email@x.com
Status:    FULFILLED
Paid:      $125 SGD
Items:     Brushed Chrome Showerhead x1
Shipped:   3 Jun 2026 via DHL — Tracking: 1Z999AA10123456784
```
If unfulfilled: "Not yet shipped. Ordered X days ago."
If no tracking number: "Fulfilled but no tracking info recorded."

---

### 1d. Draft Orders

**Triggers:** "any open quotes", "draft orders", "unpaid drafts", "open drafts"

**Step 1** — `mcp__shopify__get-orders` — note: draft orders are a separate endpoint. Use Shopify admin or note this as a limitation until MCP supports draft_orders directly.

**Step 2** — Output:
```
Open Draft Orders — X total
────────────────────────────
#D-001  email@x.com  $125 SGD  2 days old
#D-002  (no customer)  $33 SGD  5 days old
```
If none: "No open draft orders."

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

**Triggers:** "what's in stock", "inventory check", "what's out of stock", "is [product] available", "stock status", "run inventory check", "inventory status"

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
