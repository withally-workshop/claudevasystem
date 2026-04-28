# Skill: Invoice Approval Polling
**Trigger:** Runs as part of Invoice Ops cron (every 2 hrs, Mon–Fri 9 AM–5 PM PHT) — also invocable manually: "check approvals", "/invoice-approval-polling"
**Purpose:** Scan John's private channel for "approve" replies on pending invoice drafts, finalize them in Airwallex, get the digital payment link, notify the strategist, and email the client if an email is on file.

---

## Key Data
- **John's private channel:** C0AQZGJDR38
- **Client Invoice Tracker Sheet ID:** `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`
- **Client Invoice Tracker Tab:** `Invoices`
- **Payments channel:** #payments-invoices-updates (C09HN2EBPR7)

## Column Map
| Col | Field |
|-----|-------|
| A | Date Created |
| B | Client Name |
| C | Email Address |
| D | Project Description |
| E | Invoice # |
| F | Airwallex Invoice ID |
| G | Amount |
| H | Currency |
| I | Due Date |
| J | Status (notes) — write here; Col N is formula, never touch |
| K | Requested By (Slack user_id, e.g. U0AM5EGRVTP) |
| L | Reminders Sent |
| M | Payment Confirmed Date |
| N | Status (display formula) — never write |
| O | Notes |
| P | Origin Thread TS |

---

## Execution Steps

### Step 1 — Pull Pending Drafts from Tracker
Use `sheets_get_rows` on the Client Invoice Tracker (range `A:P`).
Filter for rows where Col J = `Draft - Pending John Review`.

If no pending drafts → skip all remaining steps. Nothing to process.

### Step 2 — Scan John's Channel for Approval Replies
For each pending draft, use `mcp__slack__slack_get_channel_history` on C0AQZGJDR38 (limit: 200).

Find the bot message that contains both:
- Text matching `New Invoice Draft` or `New invoice draft`
- The Airwallex Invoice ID from Col F (e.g. `inv_xxx`)

Then use `mcp__slack__slack_get_thread_replies` on that message's `ts` to get replies.

Check replies for any message containing `approve` (case-insensitive).

**If no "approve" reply found for a draft:** skip it, leave status unchanged.

### Step 3 — Finalize in Airwallex
For each draft with an "approve" reply:

1. Call `airwallex_finalize_invoice` with the invoice ID (Col F)
2. Inspect the **finalize response** — look for the digital payment link in these fields (in order):
   - `hosted_invoice_url`
   - `digital_invoice_link`
   - `payment_link`
   - `checkout_url`
3. If none of those fields are present in the finalize response, call `airwallex_get_invoice` and check the same fields there
4. If still not found: post to C0AQZGJDR38: `⚠️ Could not retrieve payment link for [Client] [Invoice #] — get it manually from Airwallex dashboard → Invoices`
   - Continue processing the rest regardless

### Step 4 — Update Tracker
Use `sheets_find_row` to locate the row by Invoice # (Col E), then `sheets_update_row`:

| Col | Update |
|-----|--------|
| J — Status | `Invoice Sent` |

**Range format:** bare ranges only (e.g. `J5`), not `Invoices!J5`.
**Do NOT write to Col N.**

### Step 5 — Reply in John's Approval Thread
Reply in the same Slack thread where John said "approve":

```
✅ *Invoice finalized — [Client Name]*
• Invoice #: [Invoice #]
• Amount: [Amount] [Currency]
• Due: [Due Date]
• Payment link: [digital_invoice_link]

Strategist notified in #payments-invoices-updates.
```

If no payment link retrieved: omit the link line, add `⚠️ Payment link unavailable — retrieve from Airwallex dashboard.`

### Step 6 — Notify Strategist in #payments-invoices-updates
Post to C09HN2EBPR7 as a **reply to the origin thread** (use Col P — Origin Thread TS as `thread_ts`).

If Col P is blank, post as a new message (no thread).

```
✅ *Invoice sent — [Client Name]*
• Invoice #: [Invoice #]
• Amount: [Amount] [Currency]
• Due: [Due Date]
• Requested by: [if Col K starts with "U" → <@[Col K]>, else display as plain text]
• Payment link: [digital_invoice_link]
• Client email: [see rules below]
```

**Client email line rules:**
- Email sent successfully → `Sent to [Col C]`
- Col C blank → `No email on file — please share the payment link with the client directly`
- Email failed → `Email to [Col C] failed — please share the payment link with the client directly`

### Step 7 — Email Client (if email on file)
Check Col C (Email Address) of the tracker row.

**If Col C is blank:** skip email silently. The Step 6 strategist message already instructs them to share the link.

**If Col C has an email address:**

First, look up the requester's email via `slack_get_user_profile` on the Slack user_id in Col K.

Use `mcp__gmail-john__gmail_send` (or create draft then send):

```
From: john@kravemedia.co
To: [Col C — client email]
Cc: noa@kravemedia.co, [requester email from Col K Slack profile]
Subject: Invoice [Invoice #] - [Client Name] - [Amount] [Currency]
```

**Email body — generate dynamically** using client name, project description (Col D), amount, currency, due date, invoice #, and payment link. Tone: professional, warm, concise — Krave Media creative agency voice. No generic filler.

Content must cover:
- Invoice is ready for the project (Col D)
- Invoice # and amount
- Due date
- Payment link — tell client they can view, download, and pay from this link
- Close: `Best regards, / John / Krave Media`

**Reference structure (not a rigid template):**
```
Hi [Client Name],

Your invoice for [Project Description] is ready.

Invoice #: [Invoice #]
Amount: [Amount] [Currency]
Due: [Due Date]

View, download, and pay your invoice here:
[digital_invoice_link]

Best regards,
John
Krave Media
```

**On email failure:**
- Flag in John's channel: `⚠️ Email to [client email] failed for [Invoice #] — send manually`
- Update the Step 6 strategist message to include: `⚠️ Email failed — please share the payment link with the client directly`

**n8n note:** When porting to n8n, add an OpenAI AI Agent node (GPT-4o) before the Gmail node to generate the email body using the guidelines above as the system prompt.

### Step 8 — Run Summary
After processing all pending drafts, output:

```
*Approval Polling Run — [DATE] [TIME] PHT*
✅ Finalized: [n] invoices
⏭️ Pending (no approval yet): [n] invoices
⚠️ Errors: [n] (see above)
```

---

## Notes
- Only process invoices where Col J = `Draft — Pending John Review` — never touch other statuses
- "approve" match is case-insensitive — "Approve", "APPROVE", "approved" all count
- If finalize call fails (e.g. invoice already finalized) → check current status via `airwallex_get_invoice`, update tracker accordingly, don't re-finalize
- This skill is invoked by Invoice Ops cron — do not schedule it separately
