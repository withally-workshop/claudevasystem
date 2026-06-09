# Halo Bot Feedback — Why It Happens & What We're Doing

Prepared for: Alleah
Date: 2026-06-09
Re: Your two feedback docs (Website Chat Widget + Shopify/Slack Bot)

## First, the key thing to know: there are two separate bots

Your feedback covers two different "Mimi" systems. They share a name but are built separately, which explains why they behave differently.

| Bot | Who uses it | What it does |
|-----|-------------|--------------|
| **Website Chat Widget ("Mimi")** | Customers on homewithhalo.com | Answers product, shipping, order, and policy questions live |
| **Shopify / Slack Ops Bot** | Internal team in Slack | Looks up orders, discounts, inventory, subscriptions from Shopify |

The website bot answers from a fixed instruction sheet plus live inventory. It does **not** see the manual notes, task lists, or one-off info the team holds. So when its instruction sheet is out of date or missing something, it confidently says the wrong thing. That is the root cause behind most of your website feedback.

---

## Part 1 — Website Chat Widget

| Your feedback | Why the bot does this | What we're doing |
|---------------|----------------------|------------------|
| **$5 shipping fee** — customers contacting support about the wrong $5 charge | The bot was told the $5 is an optional "faster shipping upgrade." It has no idea about the subscription billing glitch, so it explains the charge as if it's normal. | Rewrite the instruction so the bot says affected subscription orders can be reviewed and refunded after the order is placed (your suggested wording). Plus: tag you in Slack whenever a customer raises it, so you can refund promptly. |
| **Mimi name confusion** — "connecting you with a team member" is unclear since email-Mimi is also Mimi | The bot is named Mimi and the email agent is also Mimi, with no rule to distinguish them at handoff. | Change the handoff wording so it's clear the customer is moving to the human support team by email. Needs Noa's call on whether we rename the bot or just fix the wording. |
| **Ships to Philippines?** | The bot's sheet currently says we do **not** ship to the Philippines. | Flagged to Noa to confirm. If we do ship there, we correct it. See "Needs confirmation" below. |
| **Outdated product availability** (Matte Black showerhead, Brushed Chrome dates) | The sheet has a hardcoded "Matte Black restock ~35-40 days" line, even though another rule tells the bot not to quote dates. The two contradict, so the old date leaks out. | Delete the hardcoded date. Availability will come only from live Shopify stock; for timelines the bot points to the website or email. |
| **Referral program** — bot says none exists | The referral program was never added to the bot's sheet, so it assumes there isn't one. | Flagged to Noa to confirm the program is live, then add it with the correct link and terms. |
| **Europe shipping** | The sheet says we ship to "all EU countries," which conflicts with your Feb note that we cannot ship to Italy/Europe. | Flagged to Noa to confirm the current approved country list, then correct it. |
| **Buy 2 Get 1 Brushed Chrome promo not mentioned** | The promo was never added to the sheet. The bot only knows what it's been told. | Confirm live promos with Noa, then add them (ideally pulled from Shopify so they expire on their own). |
| **Discount code redemption unclear** | The bot says discounts "may auto-apply" but was never given the step-by-step. | Add the redemption steps (e.g. click "CLAIM 15% OFF VOUCHER"). |

---

## Part 2 — Shopify / Slack Ops Bot

| Your feedback | Why the bot does this | What we're doing |
|---------------|----------------------|------------------|
| **SKU search returns "no orders found"** (e.g. SH-HR-HEADVITA-LAVENDER-0014) | The bot only searches orders by email, order number, or date. It never looks inside an order's line items for a SKU, so SKU searches always come back empty. | Add real SKU/product search: scan order line items and return order number, customer, date, and fulfillment status, with date-range support. |
| **Discount code search returns the wrong order** (DIVINE20 returned #4225 instead of #4074) | The bot only checks whether a code exists and how many times it was used. It does not pull the actual orders that used the code, so it guesses and gets it wrong. | Add a proper lookup that matches the exact discount code against real orders. Returns order, customer, discount amount, fulfillment, usage count, and revenue. |
| **"Who needs to reorder" is less useful than "who was charged today"** | The current report estimates reorders from a 75-day-old purchase. It does not read actual subscription charges. | Add a real "who was charged today for Smart Refill" query: customer, order number, charge amount, subscription ID, last fulfillment, next charge date. |
| **$5 subscription shipping fee tracked manually** | There is no automated check for subscription orders charged shipping. It's all manual review right now. | Build a daily exception report that flags any Smart Refill order charged shipping: customer, order number, amount, date. This is the same $5 problem as the website item, fixed from the data side so nothing slips through. |

---

## Needs confirmation from Noa before we change anything

These four items contradict what the bot says today, or rely on info that may be out of date. We're confirming first so we don't replace one wrong answer with another:

1. Do we ship to the **Philippines**?
2. Current **Europe/EU** shipping status and exact approved country list.
3. Is the **referral program** live, and are the terms still correct?
4. Which **promotions** are live right now and when do they end?

---

## What happens next

1. **Immediate (no confirmation needed):** Fix the $5 fee message + Slack alert to you, remove the outdated Matte Black date, add SKU search, fix discount-code search, build the $5 subscription exception report.
2. **After Noa confirms:** Correct shipping destinations (PH + Europe), add the referral program, add current promos and the discount redemption steps.
3. We'll update you when each batch ships so you can spot-check the live answers.

One note for going forward: the website bot only knows what it's been written into its instruction sheet. If a policy, promo, or shipping rule changes, it won't know until we update it. Best to loop us in whenever something customer-facing changes, so the bot stays current.
