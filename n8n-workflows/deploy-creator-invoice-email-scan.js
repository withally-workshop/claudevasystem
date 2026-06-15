'use strict';

/**
 * Krave — Creator Invoice Email Scan
 *
 * PREP & HANDOFF MODEL (rebuilt 2026-06-15). Scans john@kravemedia.co for unread
 * emails with PDF attachments, parses + classifies each with Claude, validates,
 * and HANDS OFF to John — it does NOT create the bill or forward by email.
 * Per valid invoice: post a ready-to-create prep package to #ops-command (vendor
 * exists/NEW from a hardcoded map, payout currency, fields, bank, PDF pointer),
 * reply ONE line to the requester (allowlisted senders only), log the tracker
 * (status "Prepped — awaiting manual creation", Bill ID blank). John creates the
 * DRAFT bill manually in Airwallex (API can't create DRAFT or attach PDFs until
 * ~Aug 2026, at which point this flips to auto-create).
 *
 * GUARDS:
 *   1. PDF-only intake — images never ingested.
 *   2. Claude classifies IS-invoice (with email context) before extraction.
 *   3. One reply/flag per message, never per attachment.
 *   4. HARDCODED SENDER ALLOWLIST — replies (success + missing-bank) go ONLY to
 *      @kravemedia.co. Any other sender → no reply, #ops-command flag only.
 *      (Fixes the 2026-06-12 client-as-creator misfire AND the prior ungated
 *      success-reply bug that replied even on forward failure.)
 *
 * v1 NOTE: live FX is deferred — the prep package shows the invoice amount and
 * flags a payout-currency conversion (e.g. Butanas USD→PHP) for John to apply at
 * creation. Vendor match uses a hardcoded map kept in sync with the SOP.
 *
 * ACTIVE — tested end-to-end + activated 2026-06-15 (sample invoice noa→john ran
 * the full success path: prep package posted to #ops-command, one-line reply to
 * the allowlisted sender, email marked read, no tracker write). Activation is
 * gated behind ACTIVATE=1 so a plain redeploy won't silently re-enable it.
 *
 * Deploy:
 *   node deploy-creator-invoice-email-scan.js
 *
 * Credentials required (set in n8n):
 *   Gmail account     → vsDW3WpKXqS9HUs3  (john@kravemedia.co)
 *   Google Sheets     → 83MQOm78gYDvziTO
 *   Krave Slack Bot   → Bn2U6Cwe1wdiCXzD
 *
 * Environment variables required:
 *   N8N_API_KEY
 *   ANTHROPIC_API_KEY
 */

const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set in env');

const GMAIL_CRED_ID  = 'vsDW3WpKXqS9HUs3';   // Gmail (john@kravemedia.co)
const SHEETS_CRED_ID = '83MQOm78gYDvziTO';   // Google Sheets
const SLACK_CRED_ID  = 'Bn2U6Cwe1wdiCXzD';   // Krave Slack Bot

const BILLS_SHEET_ID  = '14kiX9MnWyel_4_OxvL2TlnOAqBqFwwECf7Dm24znuJc';
const BILLS_SHEET_TAB = 'Krave — Creator & AP Bills Tracker';
const OPS_CHANNEL     = 'C0AQZGJDR38';         // John's private channel (#ops-command)
// NOTE: Airwallex credentials were removed — this workflow forwards by email and
// makes no Airwallex API call. If a future version needs them, read from
// process.env (AIRWALLEX_CLIENT_ID / AIRWALLEX_API_KEY), never hardcode.

// ─── Code node contents ───────────────────────────────────────────────────────

const EXTRACT_PDF_ATTACHMENTS = `
// Runs once across all input items.
// Accepts PDF attachments ONLY. Images are deliberately excluded: inline
// pricing screenshots in a client lead's reply were ingested as "invoices"
// on 2026-06-12. Real invoices arrive as PDFs.

// ── Sender blocklist (HARD GUARD) ──────────────────────────────────────────
// Creator invoices come from real people — strategists/team forwarding on behalf
// of creators, or creators directly — never from the payment platform itself.
// Do NOT block kravemedia.co: strategists manage the creators and send/forward
// invoices, sometimes from that domain. Any email from a blocked sender is
// dropped here: NOT downloaded, parsed, replied to, forwarded, logged, or marked
// read — it stays untouched in the inbox. Backstop for the -from: query
// exclusion. NEVER reply to Airwallex.
function isBlockedSender(email) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) return true; // no parseable sender → don't auto-reply into the void
  const patterns = [
    /(^|@)([a-z0-9-]+\\.)*airwallex\\.com$/,  // airwallex.com + any subdomain (bills., notifications., etc.)
    /no-?reply@/,                              // automated no-reply senders
    /notifications?@/,                         // automated notification senders
    /^(mailer-daemon|postmaster)@/,            // bounce / delivery-failure notices
  ];
  return patterns.some(re => re.test(e));
}

function findAttachments(parts, found) {
  if (!parts) return found;
  for (const p of parts) {
    if (p.body && p.body.attachmentId) {
      const name = (p.filename || p.name || '').toLowerCase();
      const mime = (p.mimeType || '').toLowerCase();
      const isInvoiceFile = name.endsWith('.pdf') || mime === 'application/pdf';
      if (isInvoiceFile && (p.filename || p.name)) {
        found.push({ attachmentId: p.body.attachmentId, attachmentName: p.filename || p.name, mimeType: p.mimeType || 'application/octet-stream' });
      }
    }
    if (p.parts) findAttachments(p.parts, found);
  }
  return found;
}

function getHeader(msg, name) {
  const payload = msg.payload || {};
  const arr = Array.isArray(payload.headers) ? payload.headers : [];
  const fromArr = arr.find(h => String(h.name || '').toLowerCase() === name.toLowerCase());
  if (fromArr) return fromArr.value;
  const flat = msg.headers && typeof msg.headers === 'object' ? msg.headers : {};
  const raw = flat[name.toLowerCase()] || flat[name] || '';
  if (!raw) return '';
  const colon = raw.indexOf(':');
  if (colon > 0 && colon < 20) return raw.slice(colon + 1).trim();
  return raw;
}

const output = [];
for (const item of $input.all()) {
  const msg = item.json;
  const payload = msg.payload || {};
  const attachments = findAttachments(payload.parts || [], []);
  if (!attachments.length) continue;

  const rawFrom = getHeader(msg, 'from');
  const mf = rawFrom.match(/^([^<]*?)<([^>]+)>/);
  const fromName  = mf ? mf[1].trim().replace(/^["']|["']$/g, '') : rawFrom.trim();
  const fromEmail = (mf ? mf[2] : rawFrom).trim().toLowerCase();
  const subject   = getHeader(msg, 'subject') || '(no subject)';

  // HARD GUARD: never process or reply to Airwallex / automated senders.
  // Skip the whole message — leaves it untouched (unread) in the inbox.
  if (isBlockedSender(fromEmail)) continue;

  for (const att of attachments) {
    output.push({ json: {
      messageId:      String(msg.id || ''),
      threadId:       String(msg.threadId || ''),
      subject:        String(subject),
      fromName:       String(fromName),
      fromEmail:      String(fromEmail),
      attachmentId:   String(att.attachmentId),
      attachmentName: String(att.attachmentName),
      mimeType:       String(att.mimeType),
    }});
  }
}
return output;
`.trim();

const MERGE_ATTACHMENT_DATA = `
const contexts = $('Extract PDF Attachments').all();
const output = [];
$input.all().forEach((item, i) => {
  const ctx = (contexts[i] || { json: {} }).json;
  const raw64 = (item.json.data || '').replace(/-/g, '+').replace(/_/g, '/');
  output.push({ json: { ...ctx, pdfBase64: raw64 } });
});
return output;
`.trim();

const PREPARE_CLAUDE_REQUEST = `
const output = [];
for (const item of $input.all()) {
  const ctx = item.json;
  // PDF-only intake — images never reach this node (see Extract PDF Attachments).
  const contentBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: ctx.pdfBase64 } };

  const system = 'You are a document classifier and invoice parser for Krave Media, a creative agency that PAYS creators and vendors. FIRST decide whether the attached document is an actual INVOICE or BILL issued TO Krave Media requesting payment. Proposals, quotes, pricing pages or package screenshots, pitch decks, contracts, receipts for already-completed payments, statements, and invoices issued BY Krave Media to its own clients are NOT invoices for this purpose. Use the email context (sender, subject) to judge — e.g. a prospect replying on a sales thread is not submitting a creator invoice. Return ONLY valid JSON with these exact fields: { "is_invoice": boolean, "classification_reason": "one short sentence", "creator_name": "string", "email": "string or null", "invoice_number": "string or null", "issued_date": "YYYY-MM-DD or null", "due_date": "YYYY-MM-DD or null", "amount": number, "currency": "ISO currency code e.g. USD SGD AUD", "line_items": [{"description":"string","quantity":number,"unit_price":number}], "bank_details": { "bank_name": "string or null", "account_name": "string or null", "account_number": "string or null", "swift": "string or null", "iban": "string or null", "bsb": "string or null", "routing_number": "string or null" }, "has_bank_details": boolean }. If is_invoice is false, still fill the other fields with your best guess or nulls.';

  output.push({ json: {
    ...ctx,
    claudeSystem: system,
    claudeMessages: [{
      role: 'user',
      content: [
        contentBlock,
        { type: 'text', text: 'Email context — From: ' + (ctx.fromName || '') + ' <' + (ctx.fromEmail || '') + '>, Subject: ' + (ctx.subject || '') + '. Classify the attached document per the system instructions and, if it is an invoice to Krave Media, extract the data as specified. Return ONLY the JSON.' }
      ]
    }]
  }});
}
return output;
`.trim();

const PARSE_VALIDATE = `
const contexts = $('Prepare Claude Request').all();

function genInvoiceNumber(name, date) {
  const d = date ? new Date(date) : new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  const parts = (name || '').trim().split(/\\s+/).filter(Boolean);
  const first = parts[0] || 'X';
  const last = parts[parts.length - 1] || 'X';
  return mm + dd + yyyy + '-' + first.charAt(0).toUpperCase() + last;
}

function getFriday() {
  const utc = Date.now() + (new Date().getTimezoneOffset() * 60000);
  const pht = new Date(utc + 8 * 3600000);
  const day = pht.getDay();
  pht.setDate(pht.getDate() + (day <= 5 ? 5 - day : 6));
  return pht.toISOString().split('T')[0];
}

const output = [];
$input.all().forEach((item, i) => {
  const claudeText = (item.json.content || []).map(c => c.text || '').join('');
  const ctx = (contexts[i] || { json: {} }).json;
  let inv = {};
  try { const m = claudeText.match(/\\{[\\s\\S]*\\}/); inv = m ? JSON.parse(m[0]) : {}; } catch(_) {}

  const creatorName = inv.creator_name || inv.vendor_name || ctx.fromName || '';
  const creatorEmail = inv.email || ctx.fromEmail || '';
  const invoiceNumber = inv.invoice_number || genInvoiceNumber(creatorName, inv.issued_date);
  const dueDate = inv.due_date || getFriday();
  const issuedDate = inv.issued_date || new Date().toISOString().split('T')[0];
  const amount = Number(inv.amount) || 0;
  const currency = (inv.currency || 'USD').toUpperCase();
  const lineItems = (inv.line_items && inv.line_items.length) ? inv.line_items : [{ description: 'Services', quantity: 1, unit_price: amount }];
  const bd = inv.bank_details || {};
  const hasBankDetails = inv.has_bank_details === true || !!(bd.account_number || bd.iban || bd.swift || bd.bsb || bd.routing_number);
  // is_invoice must come from Claude's explicit classification. A parse failure
  // (inv = {}) leaves it undefined → false → not-invoice path (fail-safe).
  // name + amount remain as a sanity floor, not the test (2026-06-12 incident).
  const isInvoice = inv.is_invoice === true && !!(creatorName && amount > 0);
  const classificationReason = String(inv.classification_reason || '');

  output.push({ json: { ...ctx, creatorName, creatorEmail, invoiceNumber, dueDate, issuedDate, amount, currency, lineItems, bankDetails: bd, hasBankDetails, isInvoice, classificationReason } });
});
return output;
`.trim();


const BUILD_PREP_CONTEXT = `
// PREP & HANDOFF (2026-06-15): build the #ops-command package John uses to create
// the DRAFT bill manually. No Airwallex API call, no email forward. Vendor match +
// payout currency come from a hardcoded map (kept in sync with the SOP); live FX is
// deferred — John applies the rate at creation (note added for non-payout currency).
const contexts = $('Parse & Validate').all();

// payee name (lowercased) → payout currency. Default = invoice currency.
const PAYOUT = {
  'paul butanas': 'PHP',
  'jeissa maryce manalili domingo': 'USD', 'jm domingo': 'USD', 'j.m. domingo': 'USD',
  'sebastian dimaculangan perez': 'SGD', 'baste perez': 'SGD', 'baste': 'SGD', 'sebastian perez': 'SGD',
};
// Known existing Airwallex vendors (lowercased). Not here → NEW (John creates it).
const KNOWN_VENDORS = new Set([
  'kang ying xuan','marian borynets','hailey nolin','asli yerdelen','nichole zhang',
  'sebastian dimaculangan perez','priscilla tan','holly crocker','amanda ng','paul butanas',
  'jeissa maryce manalili domingo','brianna alvarran','diamond danielle','stashworks pte ltd',
  'alleah grace mapula','jeneena gabrielle briones','reclaim movement llc',
]);

const output = [];
$input.all().forEach((item, i) => {
  const ctx = (contexts[i] || { json: {} }).json;
  const nameKey = String(ctx.creatorName || '').trim().toLowerCase();
  const exists = KNOWN_VENDORS.has(nameKey);
  const payoutCcy = PAYOUT[nameKey] || ctx.currency || 'USD';
  const needsConvert = payoutCcy !== (ctx.currency || '');

  const bd = ctx.bankDetails || {};
  const bankStr = [bd.bank_name, bd.account_name, bd.account_number, bd.swift, bd.iban, bd.bsb, bd.routing_number]
    .filter(Boolean).join(' / ') || 'see PDF';
  const items = (ctx.lineItems || []).map(li => (li.description || 'item') + ' — ' + (li.quantity || 1) + ' × ' + (li.unit_price || 0)).join('; ');

  const lines = [
    ':receipt: *Ready to create — ' + (ctx.creatorName || 'Unknown') + '*',
    'Vendor: ' + (ctx.creatorName || 'Unknown') + (exists ? ' (exists)' : ' (NEW — create first)') + ' · payout ' + payoutCcy,
    'Invoice #' + (ctx.invoiceNumber || '?') + ' · issued ' + (ctx.issuedDate || '?') + ' · due ' + (ctx.dueDate || '?'),
    'Amount: ' + (ctx.currency || '') + ' ' + (ctx.amount || '') + (needsConvert ? ('  → pay in ' + payoutCcy + ', apply live rate ×0.97 at creation') : ''),
    'Line items: ' + (items || 'Services'),
    'Bank: ' + bankStr,
    'PDF: email from ' + (ctx.fromEmail || '') + ' — "' + (ctx.subject || '') + '" (in john@kravemedia.co inbox)',
    (exists ? '' : ':rotating_light: NEW VENDOR — create the vendor in Airwallex first.'),
    (needsConvert ? ':rotating_light: CONVERTED payout — verify the rate.' : ''),
    ':arrow_right: New draft bill in Airwallex Spend → vendor above → fill fields → upload the PDF → submit.',
  ].filter(Boolean);

  // senderKnown gates the one-line requester reply (hardcoded team domain only).
  const senderKnown = /@kravemedia\\.co$/.test(String(ctx.fromEmail || '').toLowerCase());

  // pairedItem set so $('Build Prep Context').item resolves downstream of the
  // Slack HTTP node (which replaces $json with its response).
  output.push({ json: { ...ctx, slackText: lines.join('\\n'), payoutCcy, vendorExists: exists, senderKnown }, pairedItem: i });
});
return output;
`.trim();

const DEDUP_FILTER = `
// Tracker dedup BACKSTOP. Primary dedup is still the is:unread search + mark-as-read
// at the end of each path. This catches the gap: a run that forwarded/logged a bill
// but failed before marking the email read, or a schedule + manual webhook overlap.
//
// Key = Gmail messageId, matched against column I ("Slack Thread TS") of the Bills
// tracker, which the Log nodes write for every email-sourced bill (forwarded OR
// held). Fetch range is B:I, so messageId is index 7 and vendor name index 0.
//
// FAIL-OPEN: if the tracker read errored (continueOnFail), process everything — we
// never drop a real invoice because of a transient read failure. Worst case the
// is:unread/mark-as-read layer still prevents most repeats.
const keys = new Set();
try {
  const fetched = $('Fetch Existing Bills').first();
  const rows = (fetched && fetched.json && fetched.json.values) || [];
  for (const r of rows) {
    const v = String((r && r[7]) || '').trim(); // column I within the B:I range
    if (v) keys.add(v);
  }
} catch (_) { /* fail-open */ }

const output = [];
for (const item of $input.all()) {
  const mid = String(item.json.messageId || '').trim();
  if (mid && keys.has(mid)) continue; // already in tracker → skip, do not reprocess
  output.push(item);
}
return output;
`.trim();

const DEDUP_REPLY_GATE = `
// Missing-bank-details path guard (2026-06-12 incident):
// 1. Dedup per MESSAGE — one email with N failing PDFs gets ONE reply/flag,
//    never N (the incident sent the same reply twice, once per attachment).
// 2. senderKnown — only @kravemedia.co senders and vendors already present in
//    the Bills tracker (column B) qualify for the auto-reply. Everyone else is
//    flagged to #ops-command with NO outbound email.
const seen = new Set();
const names = new Set();
try {
  const fetched = $('Fetch Existing Bills').first();
  const rows = (fetched && fetched.json && fetched.json.values) || [];
  for (const r of rows) {
    const v = String((r && r[0]) || '').trim().toLowerCase();
    if (v) names.add(v);
  }
} catch (_) { /* tracker read failed → names empty → unknown sender → flag path (fail-safe) */ }

const output = [];
for (const item of $input.all()) {
  const j = item.json;
  const mid = String(j.messageId || '').trim();
  if (mid && seen.has(mid)) continue;
  if (mid) seen.add(mid);
  const email = String(j.fromEmail || '').toLowerCase();
  // HARDCODED allowlist (2026-06-15): reply ONLY to the Krave team domain.
  // External / unknown senders never get an outbound reply — flagged to
  // #ops-command instead. (Replaces the old tracker-name matching.)
  const senderKnown = /@kravemedia\\.co$/.test(email);
  output.push({ json: { ...j, senderKnown } });
}
return output;
`.trim();

const DEDUP_NOTICE = `
// One not-invoice Slack notice per email, even if it carried several PDFs.
const seen = new Set();
const output = [];
for (const item of $input.all()) {
  const mid = String(item.json.messageId || '').trim();
  if (mid && seen.has(mid)) continue;
  if (mid) seen.add(mid);
  output.push(item);
}
return output;
`.trim();

// ─── Workflow definition ──────────────────────────────────────────────────────

const workflow = {
  name: 'Krave — Creator Invoice Email Scan',
  settings: { executionOrder: 'v1', saveManualExecutions: true, timezone: 'Asia/Manila' },
  nodes: [
    // ── Triggers ──────────────────────────────────────────────────────────────
    {
      id: 'n1', name: 'Schedule Trigger',
      type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
      position: [240, 200],
      parameters: {
        rule: { interval: [{ field: 'cronExpression', expression: '0 9,12,15,18 * * 1-5' }] },
      },
    },
    {
      id: 'n2', name: 'Webhook Trigger',
      type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [240, 400],
      parameters: {
        httpMethod: 'POST',
        path: 'krave-creator-invoice-email-scan',
        responseMode: 'onReceived',
        options: {},
      },
    },

    // ── Dedup: load existing tracker keys (one item out, so it does NOT multiply
    //    the Gmail search the way a native Sheets-read node would) ───────────────
    {
      id: 'n30', name: 'Fetch Existing Bills',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [360, 300],
      continueOnFail: true,
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'googleSheetsOAuth2Api',
        method: 'GET',
        // B:I — vendor names (B, index 0) feed the known-sender allowlist in
        // Dedup Reply Gate; messageIds (I, index 7) feed the Dedup Filter.
        url: 'https://sheets.googleapis.com/v4/spreadsheets/' + BILLS_SHEET_ID + '/values/' + encodeURIComponent(BILLS_SHEET_TAB + '!B:I'),
        options: {},
      },
      credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
    },

    // ── Email intake ──────────────────────────────────────────────────────────
    {
      id: 'n3', name: 'Search Inbox',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [500, 300],
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'getAll',
        returnAll: false,
        limit: 20,
        simple: true,
        // Sender exclusion is the FIRST line of defense — keep Airwallex platform
        // mail (receipts/statements/notices) out of the pipeline entirely, so
        // Claude is never even called on them. We do NOT exclude kravemedia.co:
        // strategists (the team managing creators) send/forward invoices and may
        // use that domain. See the BLOCKED_SENDER backstop in Extract PDF
        // Attachments for the hard guard.
        // PDF-only (2026-06-12): filename:png/jpg matched inline pricing
        // screenshots on a client sales thread and caused a misfire.
        filters: { q: 'is:unread has:attachment in:inbox (invoice OR bill OR creator OR payment) filename:pdf -from:airwallex.com' },
      },
    },
    {
      id: 'n4', name: 'Get Message Details',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [740, 300],
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'gmailOAuth2',
        method: 'GET',
        url: '={{ "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + $json.id + "?format=full" }}',
        options: {},
      },
    },
    {
      id: 'n5', name: 'Extract PDF Attachments',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [980, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: EXTRACT_PDF_ATTACHMENTS },
    },
    {
      id: 'n31', name: 'Dedup Filter',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1100, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: DEDUP_FILTER },
    },

    // ── Download & parse ──────────────────────────────────────────────────────
    {
      id: 'n6', name: 'Download Attachment',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [1220, 300],
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'gmailOAuth2',
        method: 'GET',
        url: '={{ "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + $json.messageId + "/attachments/" + $json.attachmentId }}',
        options: {},
      },
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
    },
    {
      id: 'n7', name: 'Merge Attachment Data',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1460, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: MERGE_ATTACHMENT_DATA },
    },
    {
      id: 'n8', name: 'Prepare Claude Request',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1700, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: PREPARE_CLAUDE_REQUEST },
    },
    {
      id: 'n9', name: 'Call Claude API',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [1940, 300],
      parameters: {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'x-api-key',          value: ANTHROPIC_API_KEY },
          { name: 'anthropic-version',   value: '2023-06-01' },
          { name: 'anthropic-beta',      value: 'pdfs-2024-09-25' },
          { name: 'Content-Type',        value: 'application/json' },
        ]},
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ { model: "claude-sonnet-4-6", max_tokens: 2000, system: $json.claudeSystem, messages: $json.claudeMessages } }}',
        options: {},
      },
    },
    {
      id: 'n10', name: 'Parse & Validate',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [2180, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: PARSE_VALIDATE },
    },

    // ── Guard: is this actually an invoice? ───────────────────────────────────
    {
      id: 'n11a', name: 'Is Invoice?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [2420, 300],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [{ id: 'c1', leftValue: '={{ $json.isInvoice }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
          combinator: 'and',
        },
        options: {},
      },
    },
    {
      id: 'n11c', name: 'Dedup Notice Per Message',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [2660, 500],
      parameters: { mode: 'runOnceForAllItems', jsCode: DEDUP_NOTICE },
    },
    {
      // Nothing is marked read silently anymore: every not-invoice skip is
      // visible to John in #ops-command (2026-06-12 incident guard).
      id: 'n11d', name: 'Post Not-Invoice Notice',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [2780, 500],
      continueOnFail: true,
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'POST',
        url: 'https://slack.com/api/chat.postMessage',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ { channel: "' + OPS_CHANNEL + '", text: ":mag: *Invoice scan — skipped (not an invoice), marking read*\\n- From: " + ($json.fromName || "?") + " <" + ($json.fromEmail || "?") + ">\\n- Subject: " + ($json.subject || "?") + "\\n- File: " + ($json.attachmentName || "?") + "\\n- Why: " + ($json.classificationReason || "no classification returned") } }}',
        options: {},
      },
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
    },
    {
      id: 'n11b', name: 'Mark Read (not invoice)',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [2900, 600],
      continueOnFail: true,
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'markAsRead',
        messageId: '={{ $json.messageId }}',
      },
    },

    // ── Validate: bank details ─────────────────────────────────────────────────
    {
      id: 'n11', name: 'Has Bank Details?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [2660, 200],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [{ id: 'c1', leftValue: '={{ $json.hasBankDetails }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
          combinator: 'and',
        },
        options: {},
      },
    },

    // ── [false] Missing bank details path ─────────────────────────────────────
    // Dedup per message + known-sender gate, THEN either auto-reply (known) or
    // flag to #ops-command with no outbound email (unknown). 2026-06-12 guard.
    {
      id: 'n12a', name: 'Dedup Reply Gate',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [2900, 440],
      parameters: { mode: 'runOnceForAllItems', jsCode: DEDUP_REPLY_GATE },
    },
    {
      id: 'n12b', name: 'Known Sender?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [3020, 440],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [{ id: 'c1', leftValue: '={{ $json.senderKnown }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
          combinator: 'and',
        },
        options: {},
      },
    },
    {
      id: 'n12', name: 'Reply Missing Bank Details',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [3260, 380],
      continueOnFail: true,
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'reply',
        messageId: '={{ $json.messageId }}',
        emailType: 'text',
        message: '={{ "Hi " + ($json.fromName || "there").split(" ")[0] + ",\\n\\nThe invoice doesn\'t include bank details (account number, SWIFT/BIC, or IBAN). Could you ask them to reissue with bank info? We can\'t process payment without it.\\n\\nCheers,\\nJohn\\nKrave Media" }}',
        options: {},
      },
    },
    {
      id: 'n13', name: 'Mark Read (missing bank details)',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [3500, 380],
      continueOnFail: true,
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'markAsRead',
        messageId: '={{ $json.messageId }}',
      },
    },
    {
      id: 'n14a', name: 'Flag Unknown Sender to Ops',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [3260, 520],
      continueOnFail: true,
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'POST',
        url: 'https://slack.com/api/chat.postMessage',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ { channel: "' + OPS_CHANNEL + '", text: ":rotating_light: *Invoice scan — HELD for review (unknown sender, missing bank details)*\\n- From: " + ($json.fromName || "?") + " <" + ($json.fromEmail || "?") + ">\\n- Subject: " + ($json.subject || "?") + "\\n- Parsed as: " + ($json.creatorName || "?") + " — " + ($json.currency || "") + " " + ($json.amount || "") + "\\n- Why held: sender is not @kravemedia.co and not in the Bills tracker\\n- *No auto-reply was sent.* Handle manually (ask for reissue with bank details, or dismiss). Logged On hold; email marked read." } }}',
        options: {},
      },
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
    },
    {
      id: 'n14b', name: 'Log On Hold to Bills Tab',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [3500, 520],
      continueOnFail: true,
      credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet',
        operation: 'append',
        documentId: { __rl: true, value: BILLS_SHEET_ID, mode: 'id' },
        sheetName:  { __rl: true, value: BILLS_SHEET_TAB, mode: 'name' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            'Date Received':     '={{ new Date().toISOString().split("T")[0] }}',
            'Creator / Vendor':  '={{ $json.creatorName }}',
            'Invoice #':         '={{ $json.invoiceNumber }}',
            'Airwallex Bill ID': '',
            'Amount':            '={{ $json.amount }}',
            'Currency':          '={{ $json.currency }}',
            'Due Date':          '={{ $json.dueDate }}',
            'Status':            'On hold — missing bank details',
            'Slack Thread TS':   '={{ $json.messageId }}',
            'Notes':             '={{ "Unknown sender " + $json.fromEmail + " — flagged to #ops-command, no auto-reply sent" }}',
          },
          schema: [],
        },
        options: {},
      },
    },
    {
      id: 'n14c', name: 'Mark Read (held)',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [3740, 520],
      continueOnFail: true,
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'markAsRead',
        messageId: '={{ $json.messageId }}',
      },
    },

    // ── [true] Email forward path ─────────────────────────────────────────────
    {
      id: 'n25', name: 'Build Prep Context',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [2900, 200],
      parameters: { mode: 'runOnceForAllItems', jsCode: BUILD_PREP_CONTEXT },
    },
    {
      id: 'n25c', name: 'Known Sender? (reply gate)',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [5060, 240],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          combinator: 'and',
          conditions: [{
            id: 'cond-sender-known',
            leftValue: '={{ $(\'Build Prep Context\').item.json.senderKnown }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'true', singleValue: true },
          }],
        },
        options: {},
      },
    },
    {
      id: 'n26', name: 'Post Slack Prep Report',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [4820, 340],
      continueOnFail: true,
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'POST',
        url: 'https://slack.com/api/chat.postMessage',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ { channel: "' + OPS_CHANNEL + '", text: $json.slackText } }}',
        options: {},
      },
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
    },
    {
      id: 'n27', name: 'Reply Received',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [5280, 160],
      continueOnFail: true,
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'reply',
        messageId: '={{ $(\'Build Prep Context\').item.json.messageId }}',
        emailType: 'text',
        // One line only — no creator/amount/invoice/vendor detail (all detail is in
        // the #ops-command prep package). Only reached for allowlisted senders.
        message: '={{ "Hi " + ($(\'Build Prep Context\').item.json.fromName || "there").split(" ")[0] + ",\\n\\nReceived — staged for payment.\\n\\nCheers,\\nJohn\\nKrave Media" }}',
        options: {},
      },
    },
    // (Removed "Log Prepped to Bills Tab" 2026-06-15 — the tracker is now populated
    // solely by the EOD reconcile job, which mirrors real Airwallex bills. A prep-
    // time row would duplicate/mismatch on currency-converted bills.)
    {
      id: 'n29', name: 'Mark Read (fallback)',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [5720, 340],
      continueOnFail: true,
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'markAsRead',
        messageId: '={{ $(\'Build Prep Context\').item.json.messageId }}',
      },
    },
  ],

  connections: {
    // Triggers → Fetch existing tracker keys → Search (Fetch runs once, upstream of
    // everything, so Dedup Filter can reference it and ordering is guaranteed)
    'Schedule Trigger': { main: [[{ node: 'Fetch Existing Bills', type: 'main', index: 0 }]] },
    'Webhook Trigger':  { main: [[{ node: 'Fetch Existing Bills', type: 'main', index: 0 }]] },
    'Fetch Existing Bills': { main: [[{ node: 'Search Inbox',     type: 'main', index: 0 }]] },
    // Email intake chain
    'Search Inbox':               { main: [[{ node: 'Get Message Details',     type: 'main', index: 0 }]] },
    'Get Message Details':        { main: [[{ node: 'Extract PDF Attachments', type: 'main', index: 0 }]] },
    'Extract PDF Attachments':    { main: [[{ node: 'Dedup Filter',           type: 'main', index: 0 }]] },
    'Dedup Filter':               { main: [[{ node: 'Download Attachment',     type: 'main', index: 0 }]] },
    'Download Attachment':        { main: [[{ node: 'Merge Attachment Data',   type: 'main', index: 0 }]] },
    'Merge Attachment Data':      { main: [[{ node: 'Prepare Claude Request',  type: 'main', index: 0 }]] },
    'Prepare Claude Request':     { main: [[{ node: 'Call Claude API',         type: 'main', index: 0 }]] },
    'Call Claude API':            { main: [[{ node: 'Parse & Validate',        type: 'main', index: 0 }]] },
    'Parse & Validate':  { main: [[{ node: 'Is Invoice?', type: 'main', index: 0 }]] },
    // Guard: not an invoice → notify #ops-command, then mark read (never silent)
    'Is Invoice?': { main: [
      [{ node: 'Has Bank Details?',        type: 'main', index: 0 }],  // true — is an invoice
      [{ node: 'Dedup Notice Per Message', type: 'main', index: 0 }],  // false — skip with visibility
    ]},
    'Dedup Notice Per Message': { main: [[{ node: 'Post Not-Invoice Notice',  type: 'main', index: 0 }]] },
    'Post Not-Invoice Notice':  { main: [[{ node: 'Mark Read (not invoice)',  type: 'main', index: 0 }]] },
    // Validation branch
    'Has Bank Details?': { main: [
      [{ node: 'Build Prep Context', type: 'main', index: 0 }],  // true
      [{ node: 'Dedup Reply Gate',   type: 'main', index: 0 }],  // false
    ]},
    // Missing bank details path: one item per message + known-sender gate
    'Dedup Reply Gate': { main: [[{ node: 'Known Sender?', type: 'main', index: 0 }]] },
    'Known Sender?': { main: [
      [{ node: 'Reply Missing Bank Details', type: 'main', index: 0 }],  // true — known sender, auto-reply OK
      [{ node: 'Flag Unknown Sender to Ops', type: 'main', index: 0 }],  // false — NO email, flag John
    ]},
    'Reply Missing Bank Details':  { main: [[{ node: 'Mark Read (missing bank details)', type: 'main', index: 0 }]] },
    'Flag Unknown Sender to Ops':  { main: [[{ node: 'Log On Hold to Bills Tab',          type: 'main', index: 0 }]] },
    'Log On Hold to Bills Tab':    { main: [[{ node: 'Mark Read (held)',                  type: 'main', index: 0 }]] },
    // Prep & handoff path: post the #ops-command package (always), then gate the
    // one-line requester reply by the hardcoded allowlist; both branches log + mark read.
    'Build Prep Context':         { main: [[{ node: 'Post Slack Prep Report', type: 'main', index: 0 }]] },
    'Post Slack Prep Report':     { main: [[{ node: 'Known Sender? (reply gate)', type: 'main', index: 0 }]] },
    'Known Sender? (reply gate)': { main: [
      [{ node: 'Reply Received',      type: 'main', index: 0 }],  // true — allowlisted, one-line reply
      [{ node: 'Mark Read (fallback)', type: 'main', index: 0 }], // false — no reply
    ]},
    'Reply Received':             { main: [[{ node: 'Mark Read (fallback)', type: 'main', index: 0 }]] },
  },
};

// ─── Deploy ───────────────────────────────────────────────────────────────────

function n8nRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const u = new URL(N8N_URL + path);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        'X-N8N-API-KEY': API_KEY,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function deploy() {
  const list     = await n8nRequest('GET', `/api/v1/workflows?name=${encodeURIComponent(workflow.name)}&limit=250`);
  const existing = (list.data || []).find((w) => w.name === workflow.name && w.active !== null);
  let result;
  if (existing) {
    result = await n8nRequest('PUT', `/api/v1/workflows/${existing.id}`, workflow);
    if (!result.id) result = await n8nRequest('POST', '/api/v1/workflows', workflow);
  } else {
    result = await n8nRequest('POST', '/api/v1/workflows', workflow);
  }
  if (!result.id) {
    console.log('ERROR:', JSON.stringify(result, null, 2).substring(0, 2000));
    return;
  }
  // Activation is GATED — this workflow sends outbound email + touches money, so
  // a deploy must not silently re-enable the schedule. Deploy inactive, test via
  // the webhook, then re-run with ACTIVATE=1 to enable.
  if (process.env.ACTIVATE === '1') {
    await n8nRequest('POST', `/api/v1/workflows/${result.id}/activate`);
    console.log('SUCCESS — ACTIVATED (schedule + webhook live).');
  } else {
    await n8nRequest('POST', `/api/v1/workflows/${result.id}/deactivate`);
    console.log('SUCCESS — deployed INACTIVE. Re-run with ACTIVATE=1 to enable the schedule.');
  }
  console.log('Workflow ID:', result.id);
  console.log('Name:', result.name);
  console.log('URL: https://noatakhel.app.n8n.cloud/workflow/' + result.id);
  console.log('\nManual test via:');
  console.log('POST https://noatakhel.app.n8n.cloud/webhook/krave-creator-invoice-email-scan');
}

if (require.main === module) {
  deploy().catch((e) => console.error('Deploy failed:', e.message));
}

module.exports = { workflow };
