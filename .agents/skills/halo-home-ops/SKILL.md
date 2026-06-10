---
name: halo-home-ops
description: Run Halo Home store ops queries — sales snapshots, order lookup, order search by SKU/product, orders by discount code, inventory status, refund tracking, customer history, subscription list, subscription charges, subscription shipping-fee exceptions, comped orders, revenue reports, daily digest. Trigger with "halo home", "/halo-home", "halo orders", "halo sales", "halo inventory", "what came in today", "halo revenue", "halo refunds", "halo subscriptions", "run digest", "daily digest", "run inventory check", "which orders contain [SKU]", "who ordered [product]", "which orders used [code]", "who was charged for subscriptions today", "which subscriptions were charged shipping".
metadata:
  short-description: Halo Home Shopify store ops queries
---

# Halo Home Ops — Codex Skill

Full operational read access to the Halo Home Shopify store (homewithhalo.myshopify.com).

## How to Trigger

Use `mcp__shopify__*` tools directly. The `shopify` MCP server is always-on.

**Common intents → tools:**

| Intent | Primary Tool |
|--------|-------------|
| Daily digest (on-demand) | `mcp__shopify__get-orders` yesterday + format as digest, post to `#halo-home-shopify` |
| Inventory status (on-demand) | `mcp__shopify__get-products` limit 250, format full status |
| Abandoned checkouts | `GET /checkouts.json?limit=50` |
| Discount code lookup | `GET /discount_codes/lookup.json?code={CODE}` |
| Filter refill due (75–105 days) | `mcp__shopify__get-orders` date range 75–105 days ago, filter by filter SKUs |
| Unfulfilled orders | `mcp__shopify__get-orders` with `query: "fulfillment_status:unfulfilled"` + `status: open` |
| Order status / tracking | `mcp__shopify__get-orders` by order# or email, focus on `fulfillments` array |
| Draft orders | `/draft_orders.json?status=open` — note: not yet in MCP tool set, use Shopify admin or REST directly |
| Sales snapshot / revenue | `mcp__shopify__get-orders` with date query |
| Order lookup by email | `mcp__shopify__get-orders` with `query: "email:x"` |
| Order lookup by # | `mcp__shopify__get-order` |
| Inventory check | `mcp__shopify__get-products` limit 50 |
| Customer history | `mcp__shopify__get-customers` + `get-orders` |
| Refund tracking | `mcp__shopify__get-orders` with `query: "financial_status:refunded"` |
| Subscription (refill plan) customers | `mcp__shopify__get-orders` with `query: "sku:SH-HR-FILTERPLAN-0015"` |
| Order search by SKU / product | `mcp__shopify__get-orders` over range (default 30d), filter `line_items[].sku`/`title`. See #9 in `.claude` skill |
| Orders by discount code | `mcp__shopify__get-orders` over range (default 90d), filter `discount_codes[].code` **exact** (not substring). See #10 |
| Subscription charges (Smart Refill) | `mcp__shopify__get-orders` (default today), keep subs (tags/selling_plan/filter SKUs). Sub ID + next charge date are in Seal, not Shopify. See #11 |
| Subscription shipping-fee exceptions ($5 refund report) | `mcp__shopify__get-orders` (default 7d), of subs flag `shipping_lines` total > 0. See #12 |
| $0 comped orders | `mcp__shopify__get-orders` with `query: "total_price:0"` |
| Product catalog | `mcp__shopify__get-products` limit 50 |

## Full Instructions

See `.claude/skills/halo-home-ops/SKILL.md` for complete step-by-step procedures and output formats.

## Key Store Data

- Store: homewithhalo.myshopify.com | Currency: SGD
- Best seller: Brushed Chrome Showerhead (SKU: SH-HH-BrushedChrome-0009, $125)
- Refill plan SKU: SH-HR-FILTERPLAN-0015 ($33)
- Filter pair SKUs: SH-HR-HANDLEPP-NA-0011 + SH-HR-HEADCALCIUM-NA-0013
- Known data bug: Bamboo Pillowcase - Grey priced at $423.44 (should be $39)

## Constraints

- Read-only. No mutations in Phase 1.
- MCP token is sensitive — never print `SHOPIFY_ACCESS_TOKEN`.
