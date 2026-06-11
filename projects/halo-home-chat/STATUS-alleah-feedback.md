# Alleah Feedback Round — Status

Last updated: 2026-06-11 (PHT) — refund scope decided + relayed

Master plan: `alleah-feedback-response.md` | Open questions doc: `noa-verification-questions.md`

## Done & verified
- $5 fee messaging + `ESCALATE:SHIPPING_FEE` Slack alert (commits `cd23fdf`, `0780fc6`)
- Matte Black hardcoded date removed (`cd23fdf`)
- Shipping list corrected: SG/MY/HK/AU/NZ/UK only, no EU/PH (`e60433f`; Noa confirmed 2026-06-09)
- Promos (Buy 2 Get 1 Brushed Chrome, 15% voucher + redemption steps) in prompt (`system-prompt.js:107-111`)
- Slack ops bot: SKU search, orders-by-discount, charged-today, daily $5 exception report (`bb225d4`)
- Seal free-shipping toggle live — renewals bill $0 since 2026-06-09 (verified Jun 9–11)
- Mimi explains $109-first-order vs $33-renewal, escalates real renewal overcharges (`4d5ea74`, verified live on /chat)
- Refund worklist delivered to Alleah in #halo-home-shopify feedback thread (ts `1780967657.532539`): 49 orders May 1–Jun 10, $264.84 SGD (48×$5 + #3989 $24.84 outlier — needs Noa's call, looks like an international rate)
- Seal $109 fix instructions DM'd to Alleah as John (John↔Alleah DM `D0AM5EJ2NE9`, 2026-06-11)
- **Seal $109 display FIXED** — Alleah applied the config 2026-06-11 (fixed price $109, change after initial order → $33); verified live on both showerhead products via `/products/{handle}.js`: cycles `[109, 33]`

## Waiting on
| Who | What | Then |
|-----|------|------|
| Noa | #3989 outlier ($24.84 — international rate or bug?); referral terms (live ReferralCandy says $50/$50, Feb terms said $20/$10); Mimi rename vs wording | Prompt edits; release/skip #3989 |
| Alleah | Execute the 48 × $5 refunds (May 1–Jun 10, $240 SGD, shipping amount only); #3989 on hold | Exception report confirms cleanup |

**Refund scope DECIDED (Noa, 2026-06-11):** May 1 onward only. April and earlier: no proactive refunds, case-by-case if customers ask (flag to John). Relayed to Alleah in the worklist thread (bot msg ts `1781161965.368079`).

## Key technical facts (verified 2026-06-11)
- **Shopify app sees only a rolling 60-day order window** — `read_all_orders` not effective. Full-history audit needs the dev-dashboard toggle (Noa/John) or Alleah's admin UI. April 14–30 has 20 more eligible orders ($100); pre-Apr-12 unknown.
- **Selling plans are Seal-owned** — Admin API `sellingPlanGroups` returns empty; read display data from public storefront `/products/{handle}.js`. Root cause of $109: plan `691661832514` fixed-price $109 with no first-order restriction; Smart Refill plan `691934396738` is correct ($33).
- Reconciliation: `reconcile-shipping-refunds.js` (read-only; env `FROM`/`TO`). Output CSVs are gitignored (customer PII): `shipping-refund-reconciliation.csv` (full), `shipping-refunds-eligible.csv` (worklist), `shipping-refunds-audit-skipped.csv`.
- 1:1 DMs to team go out as John (`SLACK_JOHN_USER_TOKEN`, John↔Alleah `D0AM5EJ2NE9`), bot for channels.

## Backlog (ours, not blocked)
- Wire promos to pull from Shopify so they expire on their own (root cause of stale-answer feedback)
- Catalog cleanup: Bamboo Pillowcase Grey priced $423.44 (should be $39); Sweet Citrus OOS
