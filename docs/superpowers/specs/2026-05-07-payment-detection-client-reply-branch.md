# Payment Detection — Client Payment Reply Branch (Option 2)

Status: Draft
Author: Claude (with John)
Date: 2026-05-07
Workflow: `Krave — Payment Detection` (ID `NurOLZkg3J6rur5Q`)
Related: `n8n-workflows/deploy-payment-detection.js`, `n8n-workflows/WORKFLOWS.md` (Workflow 1)

---

## Problem

The Nutrition Kitchen 2/2 payment (2026-05-07, INV-QIWVIG7H-0001, 4975.65 USD) was confirmed by the client (Hala, halaachakra@nutritionkitchensg.com) on the existing invoice thread with a bank transfer notice PDF attached. Payment Detection produced **no Slack alert** because:

1. The `Search Airwallex Emails` Gmail query is `from:airwallex.com (subject:payment OR deposit OR received)`. Hala's reply is from `nutritionkitchensg.com` → excluded.
2. The `Poll Airwallex Invoices` API path can't see it. The invoice was paid into a non-Airwallex SG account ("Eclipse Ventures Pte. Ltd."), so Airwallex never registers the deposit.
3. The `from:john@kravemedia.co` forwarded-receipt path requires a human to forward — no one did.

We have **no automated path** today for client-reply payment confirmations on non-Airwallex bank accounts. This will recur for every new SG/HK bank flow.

## Goal

Detect client-reply payment confirmations automatically and route them to **Needs Review** in Slack — never auto-mark paid. Strict matching to keep false-positive volume low.

## Non-goals

- No auto-mutation of Airwallex state.
- No auto-mark-paid in the tracker. All hits go to `Slack Needs Review` for human confirmation, mirroring the existing v5.1 pattern.
- No NLP/LLM classifier. Static phrase + signal matching only.

---

## Design

### New branch: `Client Payment Reply`

Runs alongside the existing `Search Airwallex Emails` and `Poll Airwallex Invoices` branches. Output merges into the same `Match Deposits To Invoices` node downstream.

### Gmail query (claim-window scoped)

```
has:attachment in:anywhere
  -from:airwallex.com -from:noa@kravemedia.co -from:john@kravemedia.co -from:amanda@kravemedia.co
  (subject:invoice OR subject:payment OR subject:transfer OR subject:remittance)
  after:<lastRunTs>
```

Notes:
- `has:attachment` is the cheapest precision filter — payment confirmations almost always carry a transfer notice / receipt PDF.
- Sender denylist excludes our own domain replies and Airwallex (already covered by the other branch).
- Subject filter is a coarse net; the parser does the strict matching.

### Parser rules (must satisfy ALL of A and at least one of B/C)

**A. Phrase signal** — body or subject contains one of:
- "payment is done"
- "payment done"
- "payment completed"
- "transfer details"
- "transfer notice"
- "payment slip"
- "remittance advice"
- "proof of payment"
- "pls find attached" + "transfer"
- "kindly find attached" + "transfer"

**B. Invoice number match** — `INV-[A-Z0-9]+-\d+` regex hit anywhere in the email body OR in the **threaded thread history** (use Gmail `threadId` to fetch prior messages and search them too — this is the key step; the client reply itself rarely repeats the invoice number).

**C. Tracker fuzzy match** — sender domain matches a tracker row's `Client Email` domain AND extracted amount±0.5% matches `Amount` AND currency matches.

### Negative signals (skip if any present)

- Subject or body matches reminder phrases: `following up`, `gentle reminder`, `wanted to check in`, `chasing`, `just checking` — these are our reminder echoes, not client confirmations.
- Sender domain is in the depositor denylist (Stripe, Shopify, PayPal, Gusto).
- Email is older than 14 days (cap on lookback).

### Routing

| Condition | Action |
|---|---|
| A + B + matched tracker row not yet `Payment Complete` | → `Slack Needs Review` with: invoice#, client, amount inferred (from C if available, else "TBD"), email link, attachment filename |
| A + C (no invoice# in thread) | → `Slack Needs Review` with: matched tracker row, amount, currency, sender domain, email link |
| A only | → silent skip (insufficient evidence) |
| Already-reconciled (tracker row is `Payment Complete`) | silent dedup |
| `emailId` already in `processedEmailIds` static data | silent skip |

All hits flow through the same idempotency guard as the Airwallex branch. The `Slack Needs Review` post includes a copy-paste line for the operator: "Confirm: forward this email from john@ to noa@ with invoice# and amount in subject" — which keeps the existing `from:john@` path as the canonical paid-marking route. We never paid-mark from this branch directly.

### Why "Needs Review" only, not auto-mark

Client replies are noisier than Airwallex deposit notices. We want a human eyeball before mutating the tracker, especially because:
- Amount may be missing or partial.
- "Payment is done" can refer to internal payments (creator payouts) we shouldn't capture.
- Multi-invoice clients (Nutrition Kitchen has 1/2 + 2/2) need disambiguation.

Routing to Needs Review keeps the operator in the loop while still removing the silent-failure mode.

---

## Implementation plan

The live workflow is hardened in place; the deploy script is stale. Use the surgical patch pattern via `PUT /api/v1/workflows/{id}`:

1. **GET** current workflow JSON → save as `n8n-workflows/snapshots/payment-detection-pre-client-reply.json` (gitignored).
2. **Add nodes:**
   - `Search Client Payment Replies` (Gmail node, simple mode, `q` param from new claim-window field).
   - `Fetch Thread History` (HTTP Request node → Gmail API `users.messages.list?q=threadId:<id>` for each match — cheap, only fires per matched email).
   - `Parse Client Payment Replies` (Code node — phrase + invoice# regex + tracker fuzzy match).
   - Merge node combining all three detection paths into the existing `Match Deposits To Invoices`.
3. **Update `Claim Window`** Code node — add `clientReplyQuery` to the output.
4. **Extend `processedEmailIds`** static-data idempotency to cover the new branch (same key, same TTL).
5. **Validate** with `validate_workflow` (n8n MCP) using exported code — but apply via REST `PUT` to preserve credential bindings (per memory `reference_n8n_surgical_patch.md`).
6. **Update docs in same PR:**
   - `n8n-workflows/WORKFLOWS.md` — Workflow 1 node flow + new outputs row + runbook entry "Client confirms payment via reply".
   - `n8n-workflows/README.md` — Payment Detection section: note third detection path.
   - `decisions/log.md` — append decision entry.
7. **Test plan:**
   - Replay the Hala 7 May email through the new branch (manual trigger via test webhook). Expect: Slack `Needs Review` post with INV-QIWVIG7H-0001 + Hala domain + 4975.65 USD inferred from tracker fuzzy match.
   - Replay an existing reminder reply where client says "I'll pay tomorrow" — expect: silent skip (no phrase match).
   - Replay an Airwallex deposit email — expect: existing path catches it, new branch silent (denylist).

## Open questions

1. Should the new branch also handle image attachments (transfer screenshots), or PDF only? Default: any attachment.
2. Cap on Slack `Needs Review` per run — current workflow has no cap; should we add one (e.g., max 5 Needs Review posts per run) to avoid Slack flood if a query goes wrong? Recommend yes, capped at 10.
3. Do we want a quiet-mode flag (env var) so an operator can switch this branch off mid-incident without redeploying? Recommend yes — `staticData.clientReplyEnabled = true|false`.

## Rollout

- Deploy off-hours (outside Noa's deep-work block 1:30–7 PM ICT).
- First 48h: monitor Slack `Needs Review` volume. If >5 false positives/day, tighten phrase list or require both B AND C.
- Add to `decisions/log.md`:
  `[2026-05-07] DECISION: added Client Payment Reply branch to Payment Detection | REASONING: Nutrition Kitchen 2/2 silent-miss exposed gap for non-Airwallex bank accounts | CONTEXT: routes to Needs Review only, no auto-mark`
