# Skill: Inbox Triage
**Trigger:** "triage inbox", "run email triage", "morning triage", "/inbox-triage", "inbox zero setup", "archive old emails"
**Account:** noa@kravemedia.co
**Deliver to:** Noa's Slack DM (~9 AM PHT daily)
**Live behavior reference:** `n8n-workflows/WORKFLOWS.md` (Workflow 5) + deploy script `n8n-workflows/deploy-inbox-triage-daily.js`

---

## What This Skill Does

Two modes:

1. **Inbox Zero Setup** *(run once)* — Bulk-moves all pre-2026 email to `Z_Archive`, scans existing labels to understand the current taxonomy, samples 2026 emails to determine the right label structure, then categorizes and moves all 2026 emails out of inbox into the appropriate labels. Result: inbox = 0.

2. **Daily Triage** *(run each morning ~9 AM PHT)* — Reads new inbox email, applies two-layer labels, drafts replies, archives noise, and posts an audit summary to John's `#ops-command`. **Inbox is the actionable queue:** `EA/Urgent` + `EA/Needs-Reply` + `EA/Unsure` (and client payments) stay in the inbox; only `EA/FYI` + `EA/Auto-Sorted` are archived. Noa's daily read of all of this is the Morning Coffee DM — the `#ops-command` post is John's QA/audit view, not Noa's surface.

---

## MODE 1: Inbox Zero Setup (one-time)

### Step 1 — Read existing labels
Use `gmail_list_labels` to pull the full list of labels already in the account.
Output the list to the user and confirm before proceeding — do not overwrite or delete existing labels.

### Step 2 — Propose label taxonomy
Sample 30–50 emails from 2026 across different senders and subjects using:
```
gmail_list_messages with q: "after:2025/12/31 in:inbox"
```
Read subject + sender + first 2 lines of body for each.

Based on what you find, propose a two-layer label structure:

**Layer 1 — Tier (action status):**
| Label | Meaning |
|-------|---------|
| `EA/Urgent` | Requires Noa's response today |
| `EA/Needs-Reply` | Draft ready — Noa to review and send |
| `EA/FYI` | No action — Noa should know |
| `EA/Auto-Sorted` | Newsletters, receipts, notifications |
| `EA/Unsure` | Ambiguous — leave in inbox for Noa to decide |

**Layer 2 — Context (what it's about):**
Propose labels based on what you actually find in the inbox. Common examples:
`Krave`, `IM8`, `Halo-Home`, `Skyvane`, `Invoices`, `Contracts`, `Receipts`, `Newsletters`, `Suppliers`, `Legal`

> Do not invent context labels that don't match actual email volume. If only 2 emails mention Skyvane, don't create a Skyvane label — use a broader one. Propose only labels you can justify with real email volume.

Present the proposed taxonomy to the user and get confirmation before creating any labels.

### Step 3 — Create labels
For each confirmed label, use `gmail_create_label` to create it (skip any that already exist by exact name).
Always create `Z_Archive` first.

### Step 4 — Bulk archive pre-2026 emails
Fetch all emails with `q: "before:2026/01/01 in:inbox"`.

> **Scale note:** This may return thousands of emails. Process in batches of 50. For each batch:
> - Apply label `Z_Archive` via `gmail_modify_message` with `addLabelIds`
> - Remove from inbox via `removeLabelIds: ["INBOX"]`
> - Report progress to the user every 50 emails

Do NOT read content of these emails — just apply `Z_Archive` and remove from inbox. Speed over accuracy here.

### Step 5 — Categorize 2026 emails
Fetch all remaining inbox emails with `q: "after:2025/12/31 in:inbox"`.

For each email:
1. Read sender, subject, and first 3 lines of body
2. Assign one **Tier label** + one **Context label**
3. Apply both labels via `gmail_modify_message`
4. Remove from inbox via `removeLabelIds: ["INBOX"]`
5. Exception: if tier = `EA/Unsure` → apply label but leave in INBOX

Output a running tally as you go. When complete, report:
```
Inbox Zero Setup Complete — [DATE]

Z_Archive: [N] emails (pre-2026)
2026 emails categorized: [N]
  → EA/Urgent: [N]
  → EA/Needs-Reply: [N]
  → EA/FYI: [N]
  → EA/Auto-Sorted: [N]
  → EA/Unsure: [N] (still in inbox — review manually)

Labels created: [list]
Inbox count: [N] (unsure items only)
```

Post this summary to John's private channel (C0AQZGJDR38), not to Noa.

---

## MODE 2: On-Demand Triage Trigger

The daily triage now runs automatically at 9 AM PHT via n8n workflow `EuT6REDs5PUaoycE`. This skill's Mode 2 is an on-demand trigger — fire the workflow immediately without waiting for the schedule.

### Step 1 — POST to the triage webhook

```
POST https://noatakhel.app.n8n.cloud/webhook/krave-inbox-triage-v2
Content-Type: application/json
Body: {}
```

Use `mcp__gmail-noa__gmail_search_messages` or a raw HTTP call. The webhook responds immediately (responseMode: onReceived) — the workflow runs asynchronously.

### Step 2 — Confirm and report

After the POST succeeds, report:
```
Inbox triage triggered. The workflow will classify unread emails, apply EA/* labels,
create drafts, archive, and post the summary to #ops-command within ~2 minutes.
```

If the POST fails (non-2xx), report the status code and suggest checking n8n at:
https://noatakhel.app.n8n.cloud/workflow/EuT6REDs5PUaoycE

Do NOT attempt to classify emails manually in Mode 2 — the n8n workflow handles all classification, drafting, and archiving. This skill only triggers it.

---

## Gmail MCP Tools Reference

| Action | MCP Function |
|--------|-------------|
| List labels | `gmail_list_labels` |
| Create label | `gmail_create_label` with `name` |
| Search messages | `gmail_list_messages` with `q` (Gmail search syntax) |
| Read email | `gmail_get_message` with message ID |
| Apply label / remove INBOX | `gmail_modify_message` with `addLabelIds` / `removeLabelIds` |
| Create draft | `gmail_create_draft` with `threadId`, `to`, `subject`, `body` |

**Useful Gmail search query syntax:**
- Pre-2026: `before:2026/01/01 in:inbox`
- 2026 only: `after:2025/12/31 in:inbox`
- Yesterday onwards: `after:YYYY/MM/DD in:inbox`

---

## Escalation Rules
- Payment overdue > 30 days → `EA/Urgent`, tag Amanda in Slack summary
- Halo Home US launch blockers → `EA/Urgent`, note for afternoon session
- Any legal or contract email → `EA/Urgent` regardless of tone
- Any email from Amy or Shuo Shimpa (Halo suppliers) → `EA/Needs-Reply` minimum

---

## Notes
- Noa's Slack handle: @U06TBGX9L93
- John's private channel: C0AQZGJDR38 — ALL triage summaries post here (both setup reports and daily triage). John forwards to Noa manually.
- All drafts saved to Gmail Drafts — Noa reviews and sends herself
- Never send on Noa's behalf without explicit confirmation
- **Archive rule (as of 2026-06-15):** the daily workflow archives **only** `EA/FYI` + `EA/Auto-Sorted`. `EA/Urgent`, `EA/Needs-Reply`, and `EA/Unsure` stay in the inbox as Noa's actionable queue. The `archive_ok` flag is computed in the deploy script's "Restore Email Metadata" node.
- **Client payments stay in inbox:** emails labeled `_Payment_Received` (Airwallex client deposits) are classified `EA/FYI` but are explicitly excluded from archiving (the `archive_ok` flag forces `false` for `_Payment_Received`), so they remain in the inbox per Noa's rule. Pairs with the Gmail filter routing client deposits to inbox + `_Payment_Received` (see setup-filters.js).
- If Noa corrects a mis-tier, update classification rules in this skill
