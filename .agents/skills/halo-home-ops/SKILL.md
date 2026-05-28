---
name: halo-home-ops
description: Run Halo Home store ops queries — sales snapshots, order lookup, inventory status, refund tracking, customer history, subscription list, comped orders, revenue reports. Trigger with "halo home", "/halo-home", "halo orders", "halo sales", "halo inventory", "what came in today", "halo revenue", "halo refunds", "halo subscriptions".
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
| Sales snapshot / revenue | `mcp__shopify__get-orders` with date query |
| Order lookup by email | `mcp__shopify__get-orders` with `query: "email:x"` |
| Order lookup by # | `mcp__shopify__get-order` |
| Inventory check | `mcp__shopify__get-products` limit 50 |
| Customer history | `mcp__shopify__get-customers` + `get-orders` |
| Refund tracking | `mcp__shopify__get-orders` with `query: "financial_status:refunded"` |
| Subscription (refill plan) customers | `mcp__shopify__get-orders` with `query: "sku:SH-HR-FILTERPLAN-0015"` |
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
