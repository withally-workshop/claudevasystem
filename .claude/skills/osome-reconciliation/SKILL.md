# Skill: Osome Reconciliation

**Purpose:** Work through Osome's "documents needed" flagged transactions systematically — hunt the PDF for each, compile a clean resolution list, and surface anything unresolvable for Noa.

**Invoke when:** Osome flags transactions as "documents needed" and PDFs need to be sourced.

---

## Instructions

When this skill is invoked:

### Step 1 — Get the flagged transactions
Ask the user to paste or list all transactions currently flagged in Osome as "documents needed."

Format to capture per transaction:
- Date
- Vendor / Description
- Amount + Currency
- Account (e.g., Airwal...USD·5725, SGD·7476)

### Step 2 — Triage each transaction
For each transaction, classify the likely document source:

| Type | Where to look |
|------|--------------|
| SaaS / subscription (ClickUp, Typeform, Notion, etc.) | Gmail — search vendor name + amount |
| Supplier / transfer payment | Airwallex — Transfers or Card Statements |
| PayPal payment | Airwallex receipt or PayPal email confirmation |
| Grocery / personal (e.g., FairPrice) | Flag for Noa — likely not a business expense |
| Unknown | Flag for Noa |

Output a sorted table: **Gmail hunt**, **Airwallex hunt**, **Flag for Noa**.

### Step 3 — Gmail hunt checklist
For each Gmail item, output a ready-to-run Gmail search string:

> `from:[vendor] subject:receipt OR invoice after:[YYYY/MM/DD] before:[YYYY/MM/DD]`

Work through each one. Mark as Resolved or Not Found.

### Step 4 — Airwallex hunt checklist
For each Airwallex item, output the exact transaction details to search:
- Date
- Amount
- Last 4 of card or account

Mark as Resolved or Not Found.

### Step 5 — Compile the unresolved list
Any transaction marked Not Found in both Gmail and Airwallex gets escalated to Noa.

Output a clean Slack message:

---

*Osome Reconciliation — [DATE]*

*Resolved ([N] transactions)*
- [Date] [Vendor] [Amount] → PDF source: [Gmail / Airwallex]

*Needs Your Input ([N] transactions)*
- [Date] [Vendor] [Amount] — not found in Airwallex or Gmail. Please advise.

---

Send this to Noa only after exhausting both sources.

After user confirms the message, send via `mcp__slack__slack_post_message` to Noa's DM channel (look up her user ID via `mcp__slack__slack_get_users` if needed). If Slack MCP is not connected, output the formatted message for manual send as fallback.

---

## Automation Target

**Goal:** Eliminate the manual PDF hunt entirely via n8n/Zapier.

**Workflow A — Gmail SaaS receipts (Zapier):**
- Trigger: Email arrives in noa@kravemedia.co matching labels/keywords (receipt, invoice, order confirmation)
- Action: Auto-forward to Osome's document ingestion email (confirm address with Osome)

**Workflow B — Airwallex transaction receipts (n8n):**
- Trigger: Airwallex webhook on card transaction
- Action: Pull transaction receipt PDF via Airwallex API → push to Osome

**Workflow C — Unknown/unresolvable transactions:**
- Any transaction not matched after 48 hours → compile into a weekly Slack message to Noa for manual review

**Status:** Not yet built. Skill currently operates in manual-assist mode.

**Pre-requisite before building:** Confirm Osome's document ingestion email address or API endpoint.
