# Skill: Osome Reconciliation

**Purpose:** Work through Osome's "documents needed" flagged transactions — auto-generate PDFs from Airwallex, stage in Google Drive, and surface anything unresolvable for Noa.

**Invoke when:** Osome flags transactions as "documents needed."

**Note on Osome API:** Osome has no public API or ingestion email. The upload step remains manual. This skill eliminates the PDF hunt — the only remaining manual step is dragging files from the staging Drive folder into Osome (~2 min).

---

## Instructions

When this skill is invoked:

### Step 1 — Get the flagged transactions
Ask the user to paste all transactions currently flagged in Osome as "documents needed."

Capture per transaction:
- Date
- Vendor / Description
- Amount + Currency
- Account (e.g., Airwal...USD·5725, SGD·7476)

### Step 2 — Triage each transaction by source

| Type | Where to look |
|------|--------------|
| Payout to individual (name visible) | Airwallex API → confirmation letter PDF |
| SaaS / subscription (ClickUp, Typeform, Notion, etc.) | Gmail — auto-saved to Drive via Zapier |
| Supplier / transfer payment | Airwallex API → confirmation letter PDF |
| PayPal payment | Airwallex receipt or PayPal email |
| Grocery / personal (e.g., FairPrice) | Flag for Noa — likely not a business expense |
| Unknown | Flag for Noa |

### Step 3 — Airwallex API: Generate confirmation letter PDFs
For each Airwallex payout transaction:

**Step 3a — Authenticate**
```
POST https://api.airwallex.com/api/v1/authentication/login
Headers: x-client-id: [CLIENT_ID], x-api-key: [API_KEY]
Returns: access_token (valid 30 min)
```

**Step 3b — Find the transaction ID**
```
GET https://api.airwallex.com/api/v1/transfers?page_num=0&page_size=20
Headers: Authorization: Bearer [access_token]
Filter by: created_at (date), amount, beneficiary name
Returns: transfer.id
```

**Step 3c — Generate confirmation letter PDF**
```
POST https://api.airwallex.com/api/v1/confirmation_letters/create
Headers: Authorization: Bearer [access_token]
Body: { "transaction_id": "[transfer.id]", "format": "STANDARD" }
Returns: PDF binary stream
```

**Step 3d — Save to Google Drive**
Save each PDF to: `Osome Uploads / [YYYY-MM] / [Date]_[Vendor]_[Amount].pdf`

### Step 4 — Gmail receipts (SaaS transactions)
These are handled automatically by Zapier (see Automation section below). If the Zapier zap is running, the PDF will already be in the Drive folder. If not, output Gmail search strings:

> `from:[vendor] subject:receipt OR invoice after:[YYYY/MM/DD] before:[YYYY/MM/DD]`

### Step 5 — Compile the unresolved list
Any transaction not found in Airwallex or Gmail gets escalated.

Output a Slack message:

---

*Osome Reconciliation — [DATE]*

*Staged for Upload ([N] transactions)*
- PDFs ready in Google Drive → `Osome Uploads / [YYYY-MM]`

*Needs Your Input ([N] transactions)*
- [Date] [Vendor] [Amount] — not found in Airwallex or Gmail. Please advise.

---

After user confirms the message, send via `mcp__slack__slack_post_message` to Noa's DM channel (look up her user ID via `mcp__slack__slack_get_users` if needed). If Slack MCP is not connected, output the formatted message for manual send as fallback.

### Step 6 — Manual upload (final step)
Instruct the user:
1. Open Google Drive → `Osome Uploads / [YYYY-MM]`
2. Open Osome → find each flagged transaction by date + amount
3. Drag the matching PDF from Drive into Osome

---

## Automation Setup

### Workflow A — Airwallex payout PDFs (n8n)
**Status:** Not yet built — use Steps 3a–3d above manually or build in n8n:
- Trigger: Manual or scheduled (monthly)
- Steps: Auth → GET transfers (filter by date range) → POST confirmation_letters/create → save to Google Drive
- Credentials needed: Airwallex production API key + Client ID (Settings → Developers in Airwallex)

### Workflow B — Gmail SaaS receipts (Zapier)
**Status:** Not yet built
- Trigger: New email in noa@kravemedia.co matching "receipt OR invoice OR order confirmation"
- Filter: Exclude personal/non-business senders
- Action: Save attachment (or generate PDF of email) → Google Drive → `Osome Uploads / [YYYY-MM]`

### Phase 2 — Browser automation for Osome upload (if Osome API never materialises)
Use Playwright to automate the Osome upload step:
- Script logs into Osome, finds each flagged transaction by amount + date, uploads the matching PDF from Drive
- Runs as an n8n "Execute Command" node or standalone Node.js script
- Risk: brittle if Osome changes their UI — acceptable as a fallback

### Osome API (pending)
Email sent to dev@osome.com asking about API/ingestion email access. If they respond with an endpoint, this skill will be updated to fully automate the upload step.