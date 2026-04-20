# n8n Workflow: Payment Detection

**Purpose:** Daily scan of noa@kravemedia.co for Airwallex deposit emails → match to open invoices → update Client Invoice Tracker → Slack notify.
**Replaces:** `.claude/skills/payment-detection/SKILL.md` (currently runs via Claude API daily)
**Schedule:** 9:00 AM ICT daily = **02:00 UTC** cron: `0 2 * * *`

---

## Credentials Required

| Credential | n8n Type | Account | Notes |
|-----------|---------|---------|-------|
| Gmail OAuth2 | Gmail (OAuth2) | noa@kravemedia.co | Must authorize via Google Workspace OAuth — noa@ account |
| Google Sheets OAuth2 | Google Sheets (OAuth2) | Same Google account as Sheets owner | Sheet ID: `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50` |
| Slack Bot Token | Slack API | Krave Slack workspace | Channel: C09HN2EBPR7 (#payments-invoices-updates) |
| Airwallex API | HTTP Request (Header Auth) | Airwallex account | `x-client-id` + `x-api-key` headers |

---

## Node Map (in order)

```
[1] Schedule Trigger
    ↓
[2] Gmail Search — Airwallex deposit emails
    ↓
[3] IF — Any emails found?
    → No → [14] Slack: "No payment emails found"
    → Yes ↓
[4] Loop Over Items (each email)
    ↓
[5] Gmail Get Message — full body
    ↓
[6] Code — Parse email body (extract amount, currency, invoice #, date)
    ↓
[7] IF — Shopify payment? (skip)
    → Yes → continue loop
    → No ↓
[8] Google Sheets — Get all open invoices (Col A:N)
    ↓
[9] Code — Match deposit to invoice (invoice # first, then amount)
    ↓
[10] IF — Match found?
    → No → [13] Slack: Unmatched deposit alert
    → Yes ↓
[11] Google Sheets — Update row (Col J = Payment Complete, Col M = today)
    ↓
[12] HTTP Request — Airwallex mark_paid
    ↓
[13] Slack — Post payment confirmation to #payments-invoices-updates
    ↓
[14] Aggregate — Collect all run results
    ↓
[15] Slack — Post run summary digest
```

---

## Node Configurations

### Node 1 — Schedule Trigger
- **Type:** Schedule Trigger
- **Cron:** `0 2 * * *` (2:00 AM UTC = 9:00 AM ICT)

---

### Node 2 — Gmail Search
- **Type:** Gmail node → Search Emails
- **Credential:** Gmail OAuth2 (noa@kravemedia.co)
- **Query:** `from:airwallex.com (subject:payment OR subject:deposit OR subject:received) newer_than:7d`
- **Limit:** 20
- **Return All:** No

**Fallback query** (add as second Gmail Search node connected via Merge if first returns 0):
- **Query:** `from:no-reply@airwallex.com newer_than:7d`

---

### Node 3 — IF: Any emails?
- **Condition:** `{{ $json.length > 0 }}` OR check if items array is non-empty
- **True:** continue to Loop
- **False:** go to Node 15 (no-op Slack message)

---

### Node 4 — Loop Over Items
- **Type:** Split In Batches
- **Batch Size:** 1 (process one email at a time)

---

### Node 5 — Gmail Get Message
- **Type:** Gmail node → Get Message
- **Message ID:** `{{ $json.id }}`
- **Format:** Full (get body)
- **Decode Body:** Yes

---

### Node 6 — Code: Parse Email Body
```javascript
// Extract payment details from Airwallex email body
const body = $input.item.json.text || $input.item.json.body || '';
const subject = $input.item.json.subject || '';
const date = $input.item.json.date || new Date().toISOString().split('T')[0];

// Extract amount — Airwallex format: "USD 3,400.00" or "$3,400.00 USD"
const amountMatch = body.match(/([A-Z]{3})\s*[\$]?\s*([\d,]+\.?\d*)|[\$]?\s*([\d,]+\.?\d*)\s*([A-Z]{3})/);
let amount = null;
let currency = null;

if (amountMatch) {
  if (amountMatch[1]) {
    currency = amountMatch[1];
    amount = parseFloat(amountMatch[2].replace(/,/g, ''));
  } else {
    amount = parseFloat(amountMatch[3].replace(/,/g, ''));
    currency = amountMatch[4];
  }
}

// Extract invoice number — Airwallex format: "INV-XXXX" or "Invoice #XXXX"
const invoiceMatch = body.match(/INV-[\w\d]+|Invoice\s*#?\s*([\w\d-]+)/i);
const invoiceNumber = invoiceMatch ? invoiceMatch[0].replace(/Invoice\s*#?\s*/i, '').trim() : null;

// Shopify detection — irregular amounts or "Shopify" in body
const isShopify = body.toLowerCase().includes('shopify') || subject.toLowerCase().includes('shopify');

// Round number check (client payments tend to be round)
const isRoundAmount = amount && (amount % 1 === 0 || amount % 10 === 0 || amount % 100 === 0);

return {
  emailId: $input.item.json.id,
  subject,
  date: date.split('T')[0],
  amount,
  currency,
  invoiceNumber,
  isShopify,
  isLikelyClientPayment: !isShopify && isRoundAmount,
  rawBody: body.substring(0, 500) // for debugging
};
```

---

### Node 7 — IF: Shopify? Skip
- **Condition:** `{{ $json.isShopify === true }}`
- **True:** loop continue (skip)
- **False:** proceed to Node 8

---

### Node 8 — Google Sheets: Get Open Invoices
- **Type:** Google Sheets node → Read Rows
- **Credential:** Google Sheets OAuth2
- **Sheet ID:** `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`
- **Sheet Name:** `Invoices`
- **Range:** `A:N`
- **First Row as Header:** Yes (or map manually — see column map below)

**Note:** This pulls the full sheet every loop iteration. If performance is an issue, move this node before the loop and pass data through.

Column reference:
```
A=Date Created, B=Client Name, C=Email, D=Project,
E=Invoice#, F=AirwallexID, G=Amount, H=Currency,
I=Due Date, J=Status, K=Requested By, L=Reminders,
M=Payment Confirmed Date, N=Status Display (read-only)
```

---

### Node 9 — Code: Match Deposit to Invoice
```javascript
const deposit = $('Node 6 - Parse Email').item.json;
const rows = $('Node 8 - Get Open Invoices').all();

// Filter: only open invoices (not already paid or in collections)
const openInvoices = rows.filter(row => {
  const status = (row.json['J'] || row.json['Status'] || '').toString().trim();
  return !['Payment Complete', 'Collections'].includes(status);
});

let match = null;
let confidence = 'none';

// Priority 1: Invoice number match
if (deposit.invoiceNumber) {
  const found = openInvoices.find(row => {
    const invNum = (row.json['E'] || row.json['Invoice #'] || '').toString().trim();
    return invNum.toLowerCase() === deposit.invoiceNumber.toLowerCase();
  });
  if (found) {
    match = found;
    confidence = 'high';
  }
}

// Priority 2: Amount + currency match
if (!match && deposit.amount) {
  const amountMatches = openInvoices.filter(row => {
    const rowAmount = parseFloat((row.json['G'] || row.json['Amount'] || '0').toString().replace(/,/g, ''));
    const rowCurrency = (row.json['H'] || row.json['Currency'] || '').toString().trim().toUpperCase();
    return Math.abs(rowAmount - deposit.amount) < 0.01 && rowCurrency === deposit.currency;
  });

  if (amountMatches.length === 1) {
    match = amountMatches[0];
    confidence = 'medium';
  } else if (amountMatches.length > 1) {
    confidence = 'ambiguous';
  }
}

const today = new Date().toISOString().split('T')[0];

if (match) {
  return {
    matched: true,
    confidence,
    rowIndex: match.json['_rowIndex'] || match.json['row'], // n8n includes row number
    clientName: match.json['B'] || match.json['Client Name'],
    invoiceNumber: match.json['E'] || match.json['Invoice #'],
    airwallexInvoiceId: match.json['F'] || match.json['Airwallex Invoice ID'],
    amount: deposit.amount,
    currency: deposit.currency,
    paymentDate: deposit.date,
    today,
    deposit
  };
} else {
  return {
    matched: false,
    confidence,
    deposit,
    today
  };
}
```

---

### Node 10 — IF: Match found?
- **Condition:** `{{ $json.matched === true }}`
- **True:** Node 11 (update Sheets)
- **False:** Node 13a (unmatched Slack alert)

---

### Node 11 — Google Sheets: Update Row
- **Type:** Google Sheets node → Update Row
- **Sheet ID:** `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`
- **Sheet Name:** `Invoices`
- **Row Number:** `{{ $json.rowIndex }}`
- **Columns to update:**
  - `J` (Status) → `Payment Complete`
  - `M` (Payment Confirmed Date) → `{{ $json.today }}`
- **Do NOT write to column N** — formula-driven

**Alternative if row update by index isn't available:** use `sheets_find_row` equivalent — filter by Invoice # in col E, then update that row.

---

### Node 12 — HTTP Request: Airwallex Mark Paid
- **Type:** HTTP Request
- **Method:** POST
- **URL:** `https://api.airwallex.com/api/v1/invoices/{{ $json.airwallexInvoiceId }}/mark_as_paid`
- **Headers:**
  - `x-client-id`: `{{ $credentials.airwallexClientId }}`
  - `x-api-key`: `{{ $credentials.airwallexApiKey }}`
  - `Content-Type`: `application/json`
- **Body:** `{}`
- **Continue On Fail:** Yes (if this fails, flag in Slack but don't stop the workflow)

---

### Node 13a — Slack: Payment Confirmed
- **Type:** Slack node → Post Message
- **Channel:** `C09HN2EBPR7`
- **Text:**
```
✅ *Payment Received — {{ $json.clientName }}*
• Invoice: {{ $json.invoiceNumber }}
• Amount: {{ $json.amount }} {{ $json.currency }}
• Confirmed: {{ $json.paymentDate }}
• Tracker: Updated to Payment Complete
{{ $('Node 12').item.json.error ? '⚠️ Airwallex needs manual status update → mark as paid in Invoices' : '' }}
```

---

### Node 13b — Slack: Unmatched Deposit Alert
- **Type:** Slack node → Post Message
- **Channel:** `C09HN2EBPR7`
- **Text:**
```
⚠️ *Unmatched Deposit Detected*
• Amount: {{ $json.deposit.amount }} {{ $json.deposit.currency }}
• Date: {{ $json.deposit.date }}
• Email subject: {{ $json.deposit.subject }}
• Action needed: Match this to an invoice manually and confirm in tracker
```

---

### Node 14 — Aggregate Results
- **Type:** Merge or Aggregate node
- Collect all outputs from the loop (matched, unmatched, skipped)
- Count each category

---

### Node 15 — Slack: Run Summary Digest
- **Type:** Slack node → Post Message
- **Channel:** `C09HN2EBPR7`
- **Text:**
```
*Payment Detection Run — {{ $now.toFormat('yyyy-MM-dd') }}*
✅ Matched & updated: {{ $json.matchedCount }} invoices
⚠️ Unmatched deposits: {{ $json.unmatchedCount }} (posted above)
⏭️ Shopify payments skipped: {{ $json.shopifyCount }}
```

If nothing found at all:
```
✅ Payment check complete — no Airwallex deposit emails in last 7 days.
```

---

## Error Handling

| Failure point | Behavior |
|--------------|---------|
| Gmail auth fails | Workflow errors → n8n sends failure email to operator |
| Sheets read fails | Post to Slack: "Payment detection failed — Sheets read error. Manual check required." |
| Airwallex mark_paid fails | Log in Slack message for that invoice, continue processing rest |
| No emails found | Post digest: "No Airwallex deposit emails found — check complete." |
| Ambiguous amount match (multiple invoices same amount) | Skip auto-update, post to Slack: "Ambiguous match — [amount] [currency] matches [N] open invoices. Manual confirmation needed." |

---

## Setup Checklist

- [ ] Google Workspace admin: authorize n8n OAuth app for noa@kravemedia.co Gmail
- [ ] Google Sheets: confirm n8n service account has edit access to Sheet ID `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`
- [ ] Airwallex: generate API key (Admin → API Keys) — note Client ID + API Key
- [ ] Slack: confirm bot token has `chat:write` permission for C09HN2EBPR7
- [ ] Test with a known paid invoice — verify Col J + Col M update correctly
- [ ] Verify Shopify filter works by checking a known Shopify deposit email

---

## Notes

- The Google Sheets node returns rows with a `_rowIndex` property — use this for the update step. If not available, use a filter on Col E (Invoice #) to find the row number.
- Airwallex `mark_as_paid` endpoint path may vary — verify against current API docs at `https://www.airwallex.com/docs/api`
- If noa@kravemedia.co Gmail OAuth is blocked by workspace policy, alternative: forward Airwallex emails from noa@ to john@ automatically (Gmail filter), and poll john@kravemedia.co instead — john@ is already authorized via gmail-john MCP.
