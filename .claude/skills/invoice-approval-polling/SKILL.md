# Skill: Invoice Approval Polling
**Trigger:** Runs as part of Invoice Ops cron (every 2 hrs, Mon–Fri 9 AM–5 PM PHT) — also invocable manually: "check approvals", "/invoice-approval-polling"
**Purpose:** Scan John's private channel for "approve" replies on pending invoice drafts, finalize them in Airwallex, get the digital payment link, notify the strategist, and email the client if an email is on file.

---

## Key Data
- **John's private channel:** C0AQZGJDR38
- **Client Invoice Tracker Sheet ID:** `1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50`
- **Client Invoice Tracker Tab:** `Invoices`
- **Payments channel:** #payments-invoices-updates (C09HN2EBPR7)
- **Slack posting identity:** use the `Krave Slack Bot` n8n credential for approval replies and strategist notifications; do not use a user-profile Slack connector for invoice audit-trail corrections.

## Column Map
| Col | Field |
|-----|-------|
| A | Date Created |
| B | Client Name |
| C | Email Address |
| D | Project Description |
| E | Invoice # — Airwallex invoice `number` (`INV-...`) |
| F | Airwallex Invoice ID — Airwallex invoice `id` (`inv_...`) |
| G | Amount |
| H | Currency |
| I | Due Date |
| J | Payment Status — write here; operational lifecycle state |
| K | Requested By — strategist/requester name; map to Slack ID before tagging |
| L | Reminders Sent |
| M | Payment Confirmed Date |
| N | Status (display formula) — never write |
| O | Notes |
| P | Origin Thread TS — original #payments-invoices-updates receipt thread; preserve full decimal timestamp |
| Q | Amount Paid |
| R | Invoice URL |

---

## Execution Steps

### Step 1 — Pull Pending Drafts from Tracker
Use `sheets_get_rows` on the Client Invoice Tracker (range `A:R`).
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
   - `hosted_url`
   - `digital_invoice_link`
   - `payment_link`
   - `checkout_url`
3. If none of those fields are present in the finalize response, call `airwallex_get_invoice` and check the same fields there
4. If still not found: post to C0AQZGJDR38: `⚠️ Could not retrieve payment link for [Client] [Invoice #] — get it manually from Airwallex dashboard → Invoices`
   - Continue processing the rest regardless

### Step 4 — Update Tracker
Use the stable Airwallex Invoice ID (Col F) to locate/update the tracker row. Do not match by Invoice # because Airwallex can change the draft number from `...-DRAFT` to the finalized `...-0001` value.

| Col | Update |
|-----|--------|
| E — Invoice # | Finalized Airwallex invoice `number` |
| J — Payment Status | `Invoice Sent` |
| R — Invoice URL | Airwallex hosted payment link, if available |

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

### Step 6 — Tag Requester in Origin Thread (#payments-invoices-updates)
Reply to C09HN2EBPR7 using Col P (Origin Thread TS) as `thread_ts`.

If Col P is blank, post as a new message.

Use Slack Web API `chat.postMessage` with explicit `thread_ts` for threaded audit-trail replies. Do not rely on Slack node `otherOptions.thread_ts`.

```
✅ *Invoice approved and ready to send — [Client Name]*
• Invoice #: [Invoice #]
• Amount: [Amount] [Currency]
• Due: [Due Date]
• Payment link: [digital_invoice_link]

<@[Col K]> please download the invoice from the link above and email it to the client[(Col C email if on file)] with:
  - The payment link
  - The downloaded invoice file as an attachment
  CC: john@kravemedia.co, noa@kravemedia.co
```

- Col K tag: if starts with `U` → `<@Col K>`; otherwise map known names like Amanda, Jeneena, Sybil, Noa, and John to Slack IDs before posting. If a name is unknown, use the plain name and include a warning.
- If Col C has an email, include it in the instruction so the requester knows where to send it
- If no payment link retrieved: replace link line with `⚠️ Payment link unavailable — retrieve from Airwallex dashboard`

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
