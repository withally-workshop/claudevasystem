# Skill: Osome Reconciliation

**SOP Reference:** `references/sops/osome-reconciliation.md` (FIN-001)
**Purpose:** Work through Eclipse Ventures' flagged "documents needed" transactions in Osome — triage each one, locate the PDF, and compile anything unresolvable for Noa.
**Invoke when:** Running a reconciliation session against Osome's Documents needed queue.

**Company:** Eclipse Ventures Pte. Ltd.
**Deadline:** End of April 2026 (tax submission)
**Remaining:** ~700 of original 1,489 transactions

---

## Instructions

When this skill is invoked:

### Step 1 — Get today's batch
Ask: "How many transactions are you working through today, and what's the current highest amount in the queue?"

Confirm sort order before starting: **Osome → Transactions → Documents needed → Sort: Amount, largest first.**

### Step 2 — For each transaction, ask for the details
User provides: date, description/vendor, amount, card (e.g. **5435).

Classify immediately using this decision tree:

| Type | Indicator | Action |
|------|-----------|--------|
| Creator / Contractor | Person name or company name (e.g. "Janvenice Cruz", "Samsotza Enterprise") | Step 3A — Airwallex |
| SaaS / Subscription | Tool name (HeyGen, Magicbrief, Canva, ClickUp, Typeform, etc.) | Step 3B — Gmail |
| Insense | "Insense" in description | Step 3C — Email template |
| Payroll / Internal | Amanda, Joshua, team members | Step 3A — Airwallex |
| Unknown / Ambiguous | Cannot classify | Try Airwallex first, then Gmail |

### Step 3A — Airwallex path
Output exact search instructions:
> Go to app.airwallex.com → Bills > Paid → search: **[vendor name]**
> Match by: amount **[amount]** + date near **[date]**
> Download invoice PDF from left panel of Bill Details
> Upload to Osome transaction

### Step 3B — Gmail path
Output ready-to-run Gmail search string for noa@kravemedia.co:
> Search: `[vendor name] has:attachment`
> Look for: "Your receipt from..." or "Invoice #..." near [date]
> Download PDF attachment → upload to Osome

If not found in work Gmail:
> Repeat search in takhelnoa@gmail.com

HeyGen note: Two PDFs attached — upload the **Invoice PDF**, not the Receipt PDF.

### Step 3C — Insense path
Output a pre-filled email draft:

```
To: support@insense.pro
Subject: Invoice Request — Eclipse Ventures Pte. Ltd.

Hi Insense Support,

Could you please provide an invoice or payment receipt for the
following transaction for our accounting records?

  Account: Eclipse Ventures Pte. Ltd.
  Transaction Date: [DATE]
  Amount: [AMOUNT] USD
  Reference: [TRANSACTION REF]

Thank you,
Noa Nederpelt / Eclipse Ventures Pte. Ltd.
```

### Step 4 — Cannot find (escalate to Noa)
Only after checking: Airwallex + noa@kravemedia.co + takhelnoa@gmail.com + card number search.

Accumulate all unresolvable transactions during the session. At end of session, compile and send to Noa via Slack:

```
*Osome Reconciliation — [DATE]*
*Unresolvable Transactions — Need Your Input*

The following [N] transactions could not be located in Airwallex or either Gmail inbox.
All sources checked before escalating.

| # | Date | Description | Amount | Card | Sources Checked |
|---|------|-------------|--------|------|----------------|
| 1 | [date] | [vendor] | [amount] | [**XXXX] | Airwallex, both Gmails |
...

Please advise on each one.
```

Send via `mcp__slack__slack_post_message` to Noa's DM (look up via `mcp__slack__slack_get_users`).
If Slack MCP not connected, output formatted message for manual send.

### Step 5 — Track progress
After each batch, output an updated progress log row:

| Date | Resolved | Remaining | Sources Used | Escalations |
|------|----------|-----------|--------------|-------------|
| [today] | [+N] | [~XXX] | Airwallex / Gmail / Insense | [N to Noa] |

---

## Exception Rules
- Amount doesn't match → do NOT upload. Flag for Noa with both amounts noted.
- Multiple bills, same vendor + date → match amount first, then date. If still ambiguous, flag for Noa.
- Osome shows "Processing data from X files" → normal, up to 24h. Keep working.
- Card **5435 = Airwallex USD account. Card **7476 = Airwallex SGD account. Use to narrow search.

---

## Automation Target (Post-Deadline)
Once the 700-transaction backlog is cleared:
- n8n workflow: Airwallex API → generate confirmation letter PDFs → save to Google Drive (john@kravemedia.co) → `Osome Uploads / [YYYY-MM]`
- Reduces future reconciliation to upload-only (no PDF hunt)
- Requires: Airwallex API key + Google Workspace OAuth whitelist
