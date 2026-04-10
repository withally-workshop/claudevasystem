# Skill: Inbox Triage
**Trigger:** "triage inbox", "run email triage", "morning triage", "/inbox-triage", "inbox zero setup", "archive old emails"
**Account:** noa@kravemedia.co
**Deliver to:** Noa's Slack DM (~9 AM ICT daily)
**SOP:** references/sops/inbox-triage.md

---

## What This Skill Does

Two modes:

1. **Inbox Zero Setup** *(run once)* — Bulk-moves all pre-2026 email to `Z_Archive`, scans existing labels to understand the current taxonomy, samples 2026 emails to determine the right label structure, then categorizes and moves all 2026 emails out of inbox into the appropriate labels. Result: inbox = 0.

2. **Daily Triage** *(run each morning ~9 AM ICT)* — Reads new inbox email, applies two-layer labels, drafts replies, and posts a clean Slack DM summary to Noa. Inbox stays at 0.

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

## MODE 2: Daily Triage (~9 AM ICT)

### Step 1 — Fetch new inbox emails
```
gmail_list_messages with q: "in:inbox after:[yesterday's date]"
```
If Gmail MCP is not connected: ask the user to paste email threads manually.

### Step 2 — Classify each email (two layers)

**Tier classification — apply in order, first match wins:**

| Tier | Criteria |
|------|----------|
| `EA/Urgent` | Hard deadline today · Legal/contract/financial risk · Client loss risk · True emergency |
| `EA/Needs-Reply` | Client questions · Vendor requests · Team escalations · Anything awaiting Noa's direct response |
| `EA/FYI` | Confirmations · Tracking · Status updates · Receipts · Payment notifications |
| `EA/Auto-Sorted` | Newsletters · Marketing · Automated SaaS notifications · noreply@ · no-reply@ |
| `EA/Unsure` | Genuinely ambiguous — cannot confidently assign any tier |

**Classification rules:**
- When in doubt between `Needs-Reply` and `FYI`: use `Needs-Reply` — never miss an action item
- Emails from Amanda, Shin, Joshua, IM8 agencies, Krave strategists → always `Urgent` or `Needs-Reply`
- `EA/Unsure` emails: apply label, leave in INBOX, surface in Slack summary under "Review These"
- Never auto-sort an email from a known contact into `Auto-Sorted`

**Context classification:**
Assign the best-fit context label from the confirmed taxonomy. If none fits cleanly, skip the context label — do not force it.

### Step 3 — Draft replies (Urgent + Needs-Reply only)
For each email in these tiers:
1. Draft a reply in Noa's voice — direct, outcome-oriented, no filler
2. Apply the **3-and-1 Framework** if a decision is needed: list 3 options, mark the recommendation
3. Save via `gmail_create_draft` — do NOT send
4. Note draft subject in the Slack summary

**Noa's voice:**
- No: "Hope this helps", "Let me know", "Great question!", "I hope you're doing well"
- Yes: Clear next step, named owner, deadline if applicable
- External: authoritative and professional
- Internal: sharp and direct

### Step 4 — Apply labels + move out of inbox
- Apply both tier + context labels to every email
- Remove from inbox via `removeLabelIds: ["INBOX"]` for all tiers except `EA/Unsure`
- `EA/Unsure` emails: label applied, remain in inbox

### Step 5 — Post Slack summary to John's private channel
Post via `mcp__slack__slack_post_message` to John's private channel (`C0AQZGJDR38`).
John reviews and forwards to Noa manually — do NOT post directly to Noa's DM.

**Format:**
```
*Morning Triage — [DAY, DATE] (ICT)*

*[URGENT] — Action today ([N])*
- [Sender] | [Subject] — [1-line context + deadline] → Draft ready in Gmail

*Needs Your Reply ([N])*
- [Sender] | [Subject] — [1-line context] → Draft ready in Gmail

*FYI ([N])*
- [Sender] | [Subject] — [1-line summary]

*Review These ([N])* ← EA/Unsure — still in inbox
- [Sender] | [Subject] — [why ambiguous]

*Auto-Sorted ([N])* — newsletters, receipts, notifications

Inbox: [N] (unsure items only, or 0 ✓)
```

Omit sections with 0 items. Always include Auto-Sorted count.
If deep work block is active (1:30–7:00 PM ICT): do not post — queue for 7:00 PM.
If Slack MCP is not connected: output for manual send.

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
- If Noa corrects a mis-tier, update classification rules in this skill
