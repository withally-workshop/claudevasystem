// =====================================================================
// !!! STALE — DO NOT RE-RUN WITHOUT UPDATING FIRST !!!
//
// This script was the original deploy-from-scratch source for the
// Krave Payment Detection workflow. After the May 2026 WELLE incident,
// the live workflow was hardened in place via the n8n REST API
// across multiple patches (v4, v5, v5.1, v6, v6.1):
//
//   - REMOVED:  Airwallex Auth, Airwallex Mark Paid nodes
//               (no auto-mutation of external Airwallex state)
//   - ADDED:    Needs Review? (If), Slack Needs Review (Slack)
//   - STRICT MATCHING: invoice# OR (amount+currency+clientName fuzzy);
//               no amount-only fallback
//   - IDEMPOTENCY: processedEmailIds (last 500) in workflow staticData
//   - ALREADY-RECONCILED CHECK: deposits matching paid tracker rows
//               silently dedup instead of routing to Needs Review
//   - DEPOSITOR DENYLIST: STRIPE PAYMENTS, SHOPIFY, PAYPAL HOLDINGS,
//               GUSTO silently skipped at parse stage
//   - PARSER FIX: msg.Subject/msg.From fallbacks in Gmail simple mode
//   - FORWARDED RECEIPT SUPPORT: from:john@kravemedia.co with strict
//               to:noa filter and reminder-phrase exclusions
//   - INV REGEX: requires INV- dash prefix (no bare "INVOICE" matches)
//   - v6.3 PDF ATTACHMENT EXTRACTION (2026-05-08):
//       n3 (Parse All Emails): added PDF extraction for Airwallex Global
//       Account "Confirmation of Receipt of Funds" emails, which have a
//       completely empty body. Extraction: download attachment via Gmail
//       API, inflate FlateDecode streams, parse ToUnicode CMaps, decode
//       CID content stream → plain text → parsed for clientName/INV# as
//       normal. Guard: airwallex-email source + empty body + pdf present.
//       n5 (Match Deposits To Invoices): added amount+currency fallback
//       dedup (90-day window) for airwallex-email when clientName null
//       after PDF extraction. Belt-and-suspenders against repeat noise.
//   - v6.2 RECURSIVE MIME TRAVERSAL (2026-05-08):
//       n3 (Parse All Emails): replaced 2-level nested for-loop with
//       a recursive findBodyParts() walker that traverses any depth of
//       MIME nesting. Airwallex invoice-paid notification emails nest
//       text/html at level 3+. gmailOAuth2 credential vxHex5lFrkakcsPi
//       kept on node for full-message fetch via requestWithAuthentication.
//   - v6.1 BROADENED paid_amount DETECTION (2026-05-08):
//       n17 (Poll Airwallex Invoices): added amount_settled,
//       amount_received, collected_amount candidates; added status-based
//       fallback — if status is PAID/COMPLETED/SETTLED and all field
//       candidates are null, uses invoice total as paid amount.
//
// Re-running this script as-is would OVERWRITE the hardened workflow
// with the old vulnerable topology. If you need to redeploy from
// scratch, first port the current live state (GET /api/v1/workflows/{id})
// into this script.
//
// Live workflow ID: NurOLZkg3J6rur5Q
// Authoritative reference: n8n-workflows/WORKFLOWS.md "Workflow 1"
// =====================================================================

const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;

// Reads n8n workflow static data for the last run timestamp, claims the new window
// by writing nowTs back immediately, then builds the time-windowed Gmail query.
// Static data persists across executions with no external storage required.
const CLAIM_WINDOW_CODE = `
const staticData = $getWorkflowStaticData('global');
const lastRunTs = staticData.lastRunTs || 0;
const nowTs = Math.floor(Date.now() / 1000);
staticData.lastRunTs = nowTs;
const afterFilter = lastRunTs > 0 ? 'after:' + lastRunTs : 'newer_than:1d';
const gmailQuery = 'from:airwallex.com (subject:payment OR subject:deposit OR subject:received) ' + afterFilter;
return [{ json: { lastRunTs, nowTs, gmailQuery } }];
`.trim();

// v6.3: PDF extraction for Airwallex deposit confirmation emails (2026-05-08).
// Added findPdfParts, parseCMap, decodeContentStream, extractAirwallexPdfText
// helpers. Trigger: airwallex-email source + empty body + pdf attachment found.
// Gmail OAuth2 credential (vxHex5lFrkakcsPi) must be present on the n3 node
// for both full-message fetch and attachment download via requestWithAuthentication.
const PARSE_CODE = `
const items = $input.all();
const NON_CLIENT_DEPOSITORS = ['STRIPE PAYMENTS', 'SHOPIFY', 'PAYPAL HOLDINGS', 'GUSTO'];

function stripHtml(html) {
  return html
    .replace(/<script[\\s\\S]*?<\\/script>/gi, '')
    .replace(/<style[\\s\\S]*?<\\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\\s+/g, ' ')
    .trim();
}

function findBodyParts(parts, result) {
  if (!result) result = { plain: null, html: null };
  if (!Array.isArray(parts)) return result;
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body && part.body.data && !result.plain) {
      result.plain = Buffer.from(part.body.data, 'base64').toString('utf-8');
    } else if (part.mimeType === 'text/html' && part.body && part.body.data && !result.html) {
      result.html = stripHtml(Buffer.from(part.body.data, 'base64').toString('utf-8'));
    } else if (part.parts) {
      findBodyParts(part.parts, result);
    }
  }
  return result;
}

// v6.3: PDF attachment helpers for Airwallex deposit confirmation emails
function findPdfParts(parts) {
  const found = [];
  if (!Array.isArray(parts)) return found;
  for (const p of parts) {
    if (p.mimeType === 'application/pdf' && p.body && p.body.attachmentId) {
      found.push(p);
    } else if (p.parts) {
      found.push(...findPdfParts(p.parts));
    }
  }
  return found;
}

function parseCMap(cmapText) {
  const map = new Map();
  if (!cmapText) return map;
  const charRe = /beginbfchar([\\s\\S]*?)endbfchar/g;
  let m;
  while ((m = charRe.exec(cmapText)) !== null) {
    for (const line of m[1].trim().split('\\n')) {
      const pair = line.match(/<([0-9a-fA-F]+)>\\s*<([0-9a-fA-F]+)>/);
      if (pair) map.set(parseInt(pair[1], 16), String.fromCodePoint(parseInt(pair[2], 16)));
    }
  }
  const rangeRe = /beginbfrange([\\s\\S]*?)endbfrange/g;
  while ((m = rangeRe.exec(cmapText)) !== null) {
    for (const line of m[1].trim().split('\\n')) {
      const triple = line.match(/<([0-9a-fA-F]+)>\\s*<([0-9a-fA-F]+)>\\s*<([0-9a-fA-F]+)>/);
      if (triple) {
        const start = parseInt(triple[1], 16), end = parseInt(triple[2], 16), uStart = parseInt(triple[3], 16);
        for (let i = 0; i <= end - start; i++) map.set(start + i, String.fromCodePoint(uStart + i));
      }
    }
  }
  return map;
}

function decodeContentStream(contentText, fontCmaps) {
  let text = '';
  let currentCmap = null;
  let inText = false;
  for (const line of contentText.split('\\n')) {
    const t = line.trim();
    if (t === 'BT') { inText = true; continue; }
    if (t === 'ET') { inText = false; continue; }
    if (!inText) continue;
    const fontM = t.match(/\\/(F\\d+)\\s+[\\d.]+\\s+Tf/);
    if (fontM) { currentCmap = fontCmaps.get(fontM[1]) || null; continue; }
    if (t === 'T*' || /^-?[\\d.]+\\s+-?[\\d.]+\\s+T[dD]$/i.test(t) || /^-?[\\d.]+\\s+-?[\\d.]+\\s+-?[\\d.]+\\s+-?[\\d.]+\\s+-?[\\d.]+\\s+-?[\\d.]+\\s+Tm$/i.test(t)) {
      text += '\\n'; continue;
    }
    if (!currentCmap) continue;
    const tjHex = t.match(/^<([0-9a-fA-F]+)>\\s+Tj$/);
    if (tjHex) {
      const hex = tjHex[1];
      for (let i = 0; i + 4 <= hex.length; i += 4) text += currentCmap.get(parseInt(hex.slice(i, i + 4), 16)) || '';
      continue;
    }
    const tjArr = t.match(/^\\[(.*)\\]\\s+TJ$/);
    if (tjArr) {
      const hexRe = /<([0-9a-fA-F]+)>/g;
      let hm;
      while ((hm = hexRe.exec(tjArr[1])) !== null) {
        const hex = hm[1];
        for (let i = 0; i + 4 <= hex.length; i += 4) text += currentCmap.get(parseInt(hex.slice(i, i + 4), 16)) || '';
      }
    }
  }
  return text;
}

function extractAirwallexPdfText(pdfBuf) {
  const zlib = require('zlib');
  const raw = pdfBuf.toString('latin1');

  function inflate(startIdx) {
    try {
      const streamStart = raw.indexOf('stream', startIdx);
      if (streamStart === -1) return null;
      const nl = raw.indexOf('\\n', streamStart);
      const streamEnd = raw.indexOf('endstream', nl);
      if (streamEnd === -1) return null;
      const compressed = Buffer.from(raw.slice(nl + 1, streamEnd), 'binary');
      try { return zlib.inflateSync(compressed).toString('utf8'); }
      catch(e) { return zlib.inflateRawSync(compressed).toString('utf8'); }
    } catch(e) { return null; }
  }

  function findObjOffset(objNum) {
    const idx = raw.search(new RegExp('\\\\b' + objNum + '\\\\s+0\\\\s+obj\\\\b'));
    return idx === -1 ? null : idx;
  }

  // Pass 1: find all CMap streams by inflating FlateDecode objects
  const cmapByObjNum = new Map();
  const objNumRe = /\\b(\\d+)\\s+0\\s+obj\\b/g;
  let om;
  while ((om = objNumRe.exec(raw)) !== null) {
    const objNum = parseInt(om[1]);
    if (!raw.slice(om.index, om.index + 200).includes('FlateDecode')) continue;
    const decompressed = inflate(om.index);
    if (decompressed && (decompressed.includes('beginbfchar') || decompressed.includes('beginbfrange'))) {
      cmapByObjNum.set(objNum, parseCMap(decompressed));
    }
  }

  // Pass 2: map font names to CMaps via /ToUnicode refs
  const fontCmaps = new Map();
  const fontRefRe = /\\/(F\\d+)\\s+(\\d+)\\s+0\\s+R/g;
  let frm;
  while ((frm = fontRefRe.exec(raw)) !== null) {
    const fontName = frm[1];
    if (fontCmaps.has(fontName)) continue;
    const fontObjOffset = findObjOffset(parseInt(frm[2]));
    if (fontObjOffset === null) continue;
    const fontChunk = raw.slice(fontObjOffset, fontObjOffset + 400);
    const tuMatch = fontChunk.match(/\\/ToUnicode\\s+(\\d+)\\s+0\\s+R/);
    if (!tuMatch) continue;
    const cmapObjNum = parseInt(tuMatch[1]);
    let cmap = cmapByObjNum.get(cmapObjNum);
    if (!cmap) {
      const cmapOffset = findObjOffset(cmapObjNum);
      if (cmapOffset !== null) {
        const d = inflate(cmapOffset);
        if (d) { cmap = parseCMap(d); cmapByObjNum.set(cmapObjNum, cmap); }
      }
    }
    if (cmap) fontCmaps.set(fontName, cmap);
  }

  if (fontCmaps.size === 0) return '';

  // Pass 3: decode page content streams
  let pageText = '';
  const pageTypeRe = /\\/Type\\s*\\/Page\\b/g;
  let pgm;
  while ((pgm = pageTypeRe.exec(raw)) !== null) {
    const pageObjEnd = raw.indexOf('endobj', pgm.index);
    const pageSlice = raw.slice(pgm.index, pageObjEnd > 0 ? pageObjEnd : pgm.index + 600);
    const cm = pageSlice.match(/\\/Contents\\s+(\\d+)\\s+0\\s+R/);
    if (!cm) continue;
    const contentOffset = findObjOffset(parseInt(cm[1]));
    if (contentOffset === null) continue;
    const contentText = inflate(contentOffset);
    if (contentText) pageText += decodeContentStream(contentText, fontCmaps) + '\\n';
  }

  return pageText.replace(/\\n{3,}/g, '\\n\\n').trim();
}

const emails = [];
for (const item of items) {
  const msg = item.json;
  let body = '';
  try {
    const payload = msg.payload || {};
    if (msg.id && !payload.parts && !(payload.body && payload.body.data)) {
      try {
        const fullMsg = await this.helpers.requestWithAuthentication.call(this, 'gmailOAuth2', {
          method: 'GET',
          url: \`https://gmail.googleapis.com/gmail/v1/users/me/messages/\${msg.id}?format=full\`,
          json: true
        });
        if (fullMsg && fullMsg.payload) Object.assign(payload, fullMsg.payload);
      } catch(e) {}
    }
    if (payload.body && payload.body.data) {
      body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
    } else if (payload.parts) {
      const { plain, html } = findBodyParts(payload.parts);
      body = plain || html || '';
    }
    // v6.3: For Airwallex emails with empty body, extract text from PDF attachment
    if (!body) {
      const _headers = payload.headers || (msg.payload && msg.payload.headers) || [];
      const _from = (_headers.find(h => h.name && h.name.toLowerCase() === 'from') || {}).value || '';
      if (_from.toLowerCase().includes('airwallex.com')) {
        const pdfParts = findPdfParts(payload.parts || []);
        for (const pdfPart of pdfParts) {
          try {
            const attResp = await this.helpers.requestWithAuthentication.call(this, 'gmailOAuth2', {
              method: 'GET',
              url: \`https://gmail.googleapis.com/gmail/v1/users/me/messages/\${msg.id}/attachments/\${pdfPart.body.attachmentId}\`,
              json: true
            });
            if (attResp && attResp.data) {
              const extracted = extractAirwallexPdfText(Buffer.from(attResp.data, 'base64'));
              if (extracted && extracted.trim()) { body = extracted; break; }
            }
          } catch(e) {}
        }
      }
    }
    if (!body && msg.snippet) body = msg.snippet;
  } catch(e) {}

  const headerArr = (msg.payload && msg.payload.headers) || [];
  const subjectFromHeaders = (headerArr.find(h => h.name && h.name.toLowerCase() === 'subject') || {}).value;
  const subject = subjectFromHeaders || msg.Subject || msg.subject || msg.snippet || '';
  const fromFromHeaders = (headerArr.find(h => h.name && h.name.toLowerCase() === 'from') || {}).value;
  const fromHeader = fromFromHeaders || msg.From || msg.from || '';
  const searchText = body + ' ' + subject;
  if (searchText.toLowerCase().includes('shopify')) continue;
  const fromLower = (fromHeader || '').toLowerCase();
  const source = fromLower.includes('airwallex.com') ? 'airwallex-email'
    : fromLower.includes('john@kravemedia.co') ? 'forwarded'
    : 'unknown';
  let amount = null, currency = null;
  const p1 = searchText.match(/([A-Z]{3})[\\s$]*([\\d,]+\\.?\\d*)/);
  const p2 = searchText.match(/([\\d,]+\\.?\\d*)\\s*(USD|SGD|HKD|AUD|EUR|GBP|MYR|JPY|CNY|INR)/);
  if (p1 && /^[A-Z]{3}$/.test(p1[1]) && ['USD','SGD','HKD','AUD','EUR','GBP','MYR','JPY','CNY','INR'].includes(p1[1])) {
    currency = p1[1]; amount = parseFloat(p1[2].replace(/,/g,''));
  } else if (p2) {
    amount = parseFloat(p2[1].replace(/,/g,'')); currency = p2[2];
  }
  const invMatch = (subject + ' ' + body).match(/INV-[A-Z0-9]+(?:-\\d+)?/i);
  const invoiceNumber = invMatch ? invMatch[0].toUpperCase() : null;
  const fracMatch = searchText.match(/Payment\\s+(\\d+)\\s*\\/\\s*(\\d+)/i);
  const paymentNumber = fracMatch ? parseInt(fracMatch[1]) : null;
  const totalPayments = fracMatch ? parseInt(fracMatch[2]) : null;
  let clientName = null;
  const patterns = [
    /from\\s+([A-Z][A-Z0-9\\s.,&'-]+?)\\s+via\\s+your/i,
    /(?:received|payment|deposit|wire|transfer)\\s+from\\s+([A-Z][A-Z0-9\\s.,&'-]{3,}?)(?:[.,;\\n]|\\s+for\\s|\\s+on\\s|$)/i,
    /paid\\s+by\\s+([A-Z][A-Z0-9\\s.,&'-]{3,}?)(?:[.,;\\n]|\\s+for\\s|\\s+on\\s|$)/i,
    /sender:\\s*([A-Z][A-Z0-9\\s.,&'-]{3,}?)(?:[.,;\\n]|$)/i
  ];
  for (const pat of patterns) {
    const m = searchText.match(pat);
    if (m) { clientName = m[1].trim().replace(/[\\s.,]+$/, ''); break; }
  }
  if (clientName) {
    const upper = clientName.toUpperCase();
    if (NON_CLIENT_DEPOSITORS.some(d => upper.includes(d))) continue;
  }
  emails.push({ emailId: msg.id, subject, source, amount, currency, invoiceNumber, date: new Date().toISOString().split('T')[0], paymentNumber, totalPayments, clientName });
}
return [{ json: { emails, count: emails.length } }];
`.trim();

// Polls Airwallex invoice API directly for open invoices — second detection path for
// SWIFT bank transfers where no Airwallex notification email is generated.
// Receives tracker rows as $input; outputs emails array in same shape as PARSE_CODE.
// NOTE: Airwallex paid_amount field name is unconfirmed — inspect on first run with
// a live partial invoice and update the field name candidates below if needed.
const POLL_AW_CODE = `
const trackerRows = $input.all();
const today = new Date().toISOString().split('T')[0];

// Only poll non-Osome, payment-eligible rows that have an Airwallex Invoice ID.
// Column N Status is formula/display-only: read for eligibility, never write.
const openRows = trackerRows.filter(r => {
  const displayStatus = (r.json['Status'] || '').toString().trim();
  const paymentStatus = (r.json['Payment Status'] || '').toString().trim();
  const awId = (r.json['Airwallex Invoice ID'] || '').toString().trim();
  const notes = (r.json['Notes'] || '').toString().toLowerCase();
  const isOsome = notes.includes('osome') || !awId;
  return ['Unpaid', 'Overdue', ''].includes(displayStatus) &&
    !['Payment Complete', 'Collections'].includes(paymentStatus) &&
    !paymentStatus.startsWith('Draft') &&
    !isOsome;
});

if (openRows.length === 0) return [{ json: { emails: [], count: 0, source: 'airwallex-api' } }];

let token = null;
try {
  const authResp = await $helpers.httpRequest({
    method: 'POST',
    url: 'https://api.airwallex.com/api/v1/authentication/login',
    headers: {
      'x-client-id': '${process.env.AIRWALLEX_CLIENT_ID}',
      'x-api-key': '${process.env.AIRWALLEX_API_KEY}'
    }
  });
  token = authResp.token;
} catch(e) {
  return [{ json: { emails: [], count: 0, source: 'airwallex-api', error: 'auth-failed: ' + e.message } }];
}

const emails = [];
for (const row of openRows) {
  const awId = row.json['Airwallex Invoice ID'].trim();
  const invoiceNumber = (row.json['Invoice #'] || '').toString().trim().toUpperCase();
  const currency = (row.json['Currency'] || '').toString().trim().toUpperCase();
  const existingAmountPaid = parseFloat((row.json['Amount Paid'] || '0').toString().replace(/,/g, ''));
  try {
    const inv = await $helpers.httpRequest({
      method: 'GET',
      url: 'https://api.airwallex.com/api/v1/invoices/' + awId,
      headers: { 'Authorization': 'Bearer ' + token, 'x-api-version': '2025-06-16' }
    });
    // Check Airwallex field name candidates for amount received (v6.1: broadened)
    let apiPaidAmount = inv.paid_amount ?? inv.amount_paid ?? inv.total_paid ??
      inv.amount_settled ?? inv.amount_received ?? inv.collected_amount ?? null;
    if (apiPaidAmount === null) {
      const paidStatuses = ['PAID', 'paid', 'COMPLETED', 'completed', 'SETTLED', 'settled'];
      if (paidStatuses.includes(String(inv.status || ''))) {
        const totalStr = String(inv.total_amount ?? inv.total ?? inv.amount ?? inv.amount_due ?? 0);
        apiPaidAmount = parseFloat(totalStr.replace(/,/g, ''));
      }
    }
    if (apiPaidAmount === null) continue;
    const newPaymentAmount = apiPaidAmount - existingAmountPaid;
    if (newPaymentAmount > 1.00) {
      emails.push({
        emailId: 'api-' + awId,
        subject: 'Airwallex API: payment on ' + invoiceNumber,
        amount: newPaymentAmount,
        currency,
        invoiceNumber,
        date: today,
        paymentNumber: null,
        totalPayments: null,
        source: 'airwallex-api'
      });
    }
  } catch(e) {
    // Per-invoice failure is silent — Gmail scan remains primary
  }
}
return [{ json: { emails, count: emails.length, source: 'airwallex-api' } }];
`.trim();

// Merges Gmail-detected and Airwallex API-detected emails; Gmail takes precedence
// for the same invoice number to avoid double-processing.
const COMBINE_SIGNALS_CODE = `
const allItems = $input.all();
const gmailItem = allItems.find(i => !i.json.source);
const apiItem   = allItems.find(i => i.json.source === 'airwallex-api');
const gmailEmails = (gmailItem && gmailItem.json.emails) || [];
const apiEmails   = (apiItem   && apiItem.json.emails)   || [];
const seen = new Set(gmailEmails.filter(e => e.invoiceNumber).map(e => e.invoiceNumber));
const emails = [...gmailEmails, ...apiEmails.filter(e => !e.invoiceNumber || !seen.has(e.invoiceNumber))];
return [{ json: { emails, count: emails.length } }];
`.trim();

// v6.3: Updated to match live hardened state (idempotency, strict matching,
// clientName fuzzy, already-reconciled dedup, PDF-extraction fallback dedup).
const MATCH_CODE = `
// STRICT MATCHING with idempotency + already-reconciled awareness (v5).
const staticData = $getWorkflowStaticData('global');
staticData.processedEmailIds = staticData.processedEmailIds || [];
const processedSet = new Set(staticData.processedEmailIds);

const signalItems = $('Combine Payment Signals').all();
const rawEmails = signalItems.flatMap(item => item.json.emails || []);
const seenEvents = new Set();
const emails = [];
for (const email of rawEmails) {
  if (email.emailId && processedSet.has(email.emailId)) continue;
  const invoiceKey = (email.invoiceNumber || '').toString().trim().toUpperCase();
  const amountKey = email.amount === null || email.amount === undefined ? '' : Number(email.amount).toFixed(2);
  const currencyKey = (email.currency || '').toString().trim().toUpperCase();
  const dateKey = email.date || '';
  const fallbackKey = email.emailId || email.subject || '';
  const eventKey = invoiceKey
    ? invoiceKey + '|' + amountKey + '|' + currencyKey + '|' + dateKey
    : fallbackKey + '|' + amountKey + '|' + currencyKey + '|' + dateKey;
  if (seenEvents.has(eventKey)) continue;
  seenEvents.add(eventKey);
  emails.push(email);
}
const today = new Date().toISOString().split('T')[0];
if (emails.length === 0) return [];

const allRows = $('Get Invoice Tracker').all();
const openRows = allRows.filter(r => {
  const displayStatus = (r.json['Status'] || '').toString().trim();
  const paymentStatus = (r.json['Payment Status'] || '').toString().trim();
  return ['Unpaid', 'Overdue', ''].includes(displayStatus) &&
    !['Payment Complete', 'Collections'].includes(paymentStatus) &&
    !paymentStatus.startsWith('Draft') &&
    r.json['Invoice #'];
});
const completedRows = allRows.filter(r => (r.json['Payment Status'] || '').toString().trim() === 'Payment Complete');

const normalize = (s) => (s || '').toString().toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\\s+/g, ' ').trim();
const SUFFIX_TOKENS = ['LLC','LTD','INC','PTE','PTY','CORP','CO','GMBH','SDN','BHD','LIMITED'];
const tokenize = (s) => normalize(s).split(' ').filter(t => t.length >= 3 && !SUFFIX_TOKENS.includes(t));
const clientNameMatches = (emailClient, trackerClient) => {
  const a = tokenize(emailClient);
  const b = tokenize(trackerClient);
  if (!a.length || !b.length) return false;
  return a.some(t => b.includes(t)) || b.some(t => a.includes(t));
};

const results = [];
for (const email of emails) {
  // Tier 0: already-reconciled check — silently dedup if deposit matches a paid row
  if (email.amount && email.currency && email.clientName) {
    const reconciled = completedRows.find(r => {
      const amt = parseFloat((r.json['Amount Paid'] || r.json['Amount'] || '0').toString().replace(/,/g,''));
      const cur = (r.json['Currency'] || '').toString().trim().toUpperCase();
      if (Math.abs(amt - email.amount) >= 0.01 || cur !== email.currency) return false;
      return clientNameMatches(email.clientName, r.json['Client Name']);
    });
    if (reconciled) {
      processedSet.add(email.emailId);
      continue;
    }
  }
  // v6.3: Belt-and-suspenders dedup for Airwallex deposit confirmation emails
  // where PDF extraction failed (clientName still null). Dedup by amount+currency
  // against recently-paid rows (90-day window) to silence repeat notifications.
  if (!email.clientName && email.source === 'airwallex-email' && email.amount && email.currency) {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const recentlyPaid = completedRows.find(r => {
      const amt = parseFloat((r.json['Amount Paid'] || r.json['Amount'] || '0').toString().replace(/,/g,''));
      const cur = (r.json['Currency'] || '').toString().trim().toUpperCase();
      const payDate = (r.json['Payment Confirmed Date'] || '').toString();
      return Math.abs(amt - email.amount) < 0.01 && cur === email.currency && payDate >= cutoff;
    });
    if (recentlyPaid) {
      processedSet.add(email.emailId);
      continue;
    }
  }
  // For invoice-number forwards: also check if the invoice is already paid
  if (email.invoiceNumber) {
    const completedInv = completedRows.find(r =>
      (r.json['Invoice #'] || '').toString().trim().toUpperCase() === email.invoiceNumber);
    if (completedInv) {
      processedSet.add(email.emailId);
      continue;
    }
  }

  let match = null, confidence = 'none', reason = null;

  // 1. Exact invoice number match (high)
  if (email.invoiceNumber) {
    const found = openRows.find(r => (r.json['Invoice #'] || '').toString().trim().toUpperCase() === email.invoiceNumber);
    if (found) {
      if (email.source === 'forwarded' && email.clientName) {
        if (!clientNameMatches(email.clientName, found.json['Client Name'])) {
          reason = 'invoice number found but forwarded client name does not match tracker client';
        } else {
          match = found; confidence = 'high';
        }
      } else {
        match = found; confidence = 'high';
      }
      if (match && (email.source === 'forwarded' || email.source === 'unknown') && (!email.amount || email.amount <= 0)) {
        const invAmount = parseFloat((match.json['Amount'] || '0').toString().replace(/,/g, ''));
        const invCurrency = (match.json['Currency'] || '').toString().trim().toUpperCase();
        if (invAmount > 0) {
          email.amount = invAmount;
          email.currency = invCurrency;
          confidence = 'high-tracker-amount';
        }
      }
    } else {
      reason = 'invoice number ' + email.invoiceNumber + ' not in open invoices';
    }
  }

  // 2. Airwallex emails: amount + currency + clientName fuzzy (medium-client)
  if (!match && email.source === 'airwallex-email' && email.amount && email.currency && email.clientName) {
    const candidates = openRows.filter(r => {
      const amt = parseFloat((r.json['Amount'] || '0').toString().replace(/,/g,''));
      const cur = (r.json['Currency'] || '').toString().trim().toUpperCase();
      if (Math.abs(amt - email.amount) >= 0.01 || cur !== email.currency) return false;
      return clientNameMatches(email.clientName, r.json['Client Name']);
    });
    if (candidates.length === 1) { match = candidates[0]; confidence = 'medium-client'; }
    else if (candidates.length > 1) { confidence = 'ambiguous-after-client'; reason = candidates.length + ' open invoices match amount+currency+client'; }
    else { reason = 'no open invoice matches amount+currency+client (depositor: ' + email.clientName + ')'; }
  }

  const hasSignal = email.amount || email.invoiceNumber;
  if (match && (confidence === 'high' || confidence === 'high-tracker-amount' || confidence === 'medium-client')) {
    const notes = (match.json['Notes'] || '').toString().toLowerCase();
    const airwallexId = (match.json['Airwallex Invoice ID'] || '').toString().trim();
    const isOsome = notes.includes('osome') || !airwallexId;
    const invoiceAmount = parseFloat((match.json['Amount'] || '0').toString().replace(/,/g, ''));
    const existingAmountPaid = parseFloat((match.json['Amount Paid'] || '0').toString().replace(/,/g, ''));
    const newAmountPaid = existingAmountPaid + (email.amount || 0);
    const remainingAmount = Math.max(0, invoiceAmount - newAmountPaid);
    const isPartial = remainingAmount > 1.00;
    results.push({
      json: {
        needsReview: false,
        emailId: email.emailId,
        clientName: match.json['Client Name'] || '',
        invoiceNumber: match.json['Invoice #'] || '',
        airwallexInvoiceId: airwallexId,
        amount: email.amount, currency: email.currency, paymentDate: today,
        isOsome, isPartial,
        invoiceAmount, newAmountPaid, remainingAmount,
        matchConfidence: confidence,
        source: email.source
      }
    });
    processedSet.add(email.emailId);
  } else if (hasSignal) {
    results.push({
      json: {
        needsReview: true,
        emailId: email.emailId,
        subject: email.subject,
        source: email.source,
        parsedAmount: email.amount,
        parsedCurrency: email.currency,
        parsedInvoiceNumber: email.invoiceNumber,
        parsedClientName: email.clientName,
        reason: reason || 'no high-confidence match',
        matchConfidence: confidence
      }
    });
    processedSet.add(email.emailId);
  } else {
    processedSet.add(email.emailId);
  }
}

staticData.processedEmailIds = Array.from(processedSet).slice(-500);
return results;
`.trim();

const SLACK_PARTIAL_TEXT = "={{ '🔄 *Partial Payment Received — ' + $json.clientName + '*\\n• Invoice: ' + $json.invoiceNumber + '\\n• Received: ' + $json.amount + ' ' + $json.currency + '\\n• Total paid: ' + $json.newAmountPaid + ' / ' + $json.invoiceAmount + ' ' + $json.currency + '\\n• Remaining: ' + $json.remainingAmount + ' ' + $json.currency + '\\n• Tracker: Updated to Partial Payment' }}";

const SLACK_CONFIRMED_TEXT = "={{ '✅ *Payment Received — ' + $('Match Deposits To Invoices').item.json.clientName + '*\\n• Invoice: ' + $('Match Deposits To Invoices').item.json.invoiceNumber + '\\n• Amount: ' + $('Match Deposits To Invoices').item.json.amount + ' ' + $('Match Deposits To Invoices').item.json.currency + '\\n• Confirmed: ' + $('Match Deposits To Invoices').item.json.paymentDate + '\\n• Tracker: Updated to Payment Complete' }}";

const AW_MARK_PAID_URL = "={{ 'https://api.airwallex.com/api/v1/invoices/' + $('Match Deposits To Invoices').item.json.airwallexInvoiceId + '/mark_as_paid' }}";
const AW_BEARER = "={{ 'Bearer ' + $json.token }}";

const workflow = {
  name: 'Krave — Payment Detection',
  settings: { executionOrder: 'v1', saveManualExecutions: true, timezone: 'Asia/Manila' },
  nodes: [
    {
      id: 'n1', name: 'Hourly',
      type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
      position: [240, 200],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 * * * *' }] } }
    },
    {
      id: 'n12', name: 'Webhook Trigger',
      type: 'n8n-nodes-base.webhook', typeVersion: 2,
      position: [240, 400],
      webhookId: 'krave-payment-detection',
      parameters: { httpMethod: 'POST', path: 'krave-payment-detection', responseMode: 'onReceived', options: {} }
    },
    {
      // Reads lastRunTs from n8n static data, writes nowTs back immediately to
      // claim the window, then outputs the time-windowed Gmail query.
      id: 'n13', name: 'Claim Window',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [460, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: CLAIM_WINDOW_CODE }
    },
    {
      // Tracker rows feed matching and the Airwallex API poll only. They must not
      // feed the Gmail node, or Gmail will run once per tracker row.
      id: 'n4', name: 'Get Invoice Tracker',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [680, 300],
      credentials: { googleSheetsOAuth2Api: { id: '83MQOm78gYDvziTO', name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet', operation: 'read',
        documentId: { __rl: true, value: '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50', mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        filtersUI: {}, options: {}
      }
    },
    {
      id: 'n2', name: 'Search Airwallex Emails',
      type: 'n8n-nodes-base.gmail', typeVersion: 2.1,
      position: [900, 140],
      credentials: { gmailOAuth2: { id: 'vxHex5lFrkakcsPi', name: 'Gmail account' } },
      parameters: {
        resource: 'message', operation: 'getAll',
        returnAll: false, limit: 20,
        filters: { q: "={{ $('Claim Window').first().json.gmailQuery }}" },
        options: { format: 'full' }
      }
    },
    {
      id: 'n3', name: 'Parse All Emails',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1120, 140],
      parameters: { mode: 'runOnceForAllItems', jsCode: PARSE_CODE }
    },
    {
      // Second detection path: polls Airwallex invoice API for open invoices.
      // Catches SWIFT bank-transfer payments where no Airwallex email is sent.
      id: 'n17', name: 'Poll Airwallex Invoices',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [900, 460],
      continueOnFail: true,
      parameters: { mode: 'runOnceForAllItems', jsCode: POLL_AW_CODE }
    },
    {
      // Waits for both paths. Match Deposits To Invoices dedupes the merged signals
      // before any tracker update or Slack notification can happen.
      id: 'n18', name: 'Combine Payment Signals',
      type: 'n8n-nodes-base.merge', typeVersion: 2,
      position: [1340, 300],
      parameters: { mode: 'append' }
    },
    {
      id: 'n5', name: 'Match Deposits To Invoices',
      type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1560, 300],
      parameters: { mode: 'runOnceForAllItems', jsCode: MATCH_CODE }
    },
    {
      // Route on whether this is a partial payment (cumulative paid < invoice total by >$1).
      id: 'n19', name: 'Is Partial?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [1780, 300],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [{ id: 'c1', leftValue: '={{ $json.isPartial }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
          combinator: 'and'
        },
        options: {}
      }
    },
    {
      // Partial path: record in tracker; do NOT call Airwallex mark_paid.
      id: 'n20', name: 'Update Partial Tracker',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [2000, 140],
      credentials: { googleSheetsOAuth2Api: { id: '83MQOm78gYDvziTO', name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet', operation: 'appendOrUpdate',
        documentId: { __rl: true, value: '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50', mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            'Invoice #': '={{ $json.invoiceNumber }}',
            'Payment Status': 'Partial Payment',
            'Payment Confirmed Date': '={{ $json.paymentDate }}',
            'Amount Paid': '={{ $json.newAmountPaid }}'
          },
          matchingColumns: ['Invoice #'],
          schema: []
        },
        options: {}
      }
    },
    {
      id: 'n21', name: 'Slack Partial Alert',
      type: 'n8n-nodes-base.slack', typeVersion: 2.2,
      position: [2220, 140],
      credentials: { slackApi: { id: 'Bn2U6Cwe1wdiCXzD', name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message', operation: 'post',
        select: 'channel',
        channelId: { __rl: true, value: 'C09HN2EBPR7', mode: 'id' },
        text: SLACK_PARTIAL_TEXT,
        otherOptions: {}
      }
    },
    {
      // Full payment path: route on whether invoice was created in Osome (no Airwallex record).
      id: 'n14', name: 'Is Osome?',
      type: 'n8n-nodes-base.if', typeVersion: 2.1,
      position: [2000, 460],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
          conditions: [{ id: 'c1', leftValue: '={{ $json.isOsome }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }],
          combinator: 'and'
        },
        options: {}
      }
    },
    {
      id: 'n7', name: 'Airwallex Auth',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [2220, 340],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: 'https://api.airwallex.com/api/v1/authentication/login',
        authentication: 'none', sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'x-client-id', value: process.env.AIRWALLEX_CLIENT_ID },
          { name: 'x-api-key', value: process.env.AIRWALLEX_API_KEY }
        ]},
        sendBody: false, options: {}
      }
    },
    {
      id: 'n8', name: 'Airwallex Mark Paid',
      type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [2440, 340],
      continueOnFail: true,
      parameters: {
        method: 'POST', url: AW_MARK_PAID_URL,
        authentication: 'none', sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'Authorization', value: AW_BEARER },
          { name: 'Content-Type', value: 'application/json' },
          { name: 'x-api-version', value: '2025-06-16' }
        ]},
        sendBody: false, options: {}
      }
    },
    {
      id: 'n9', name: 'Update Invoice Status',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [2660, 340],
      credentials: { googleSheetsOAuth2Api: { id: '83MQOm78gYDvziTO', name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet', operation: 'appendOrUpdate',
        documentId: { __rl: true, value: '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50', mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            'Invoice #': "={{ $('Match Deposits To Invoices').item.json.invoiceNumber }}",
            'Payment Status': 'Payment Complete',
            'Payment Confirmed Date': "={{ $('Match Deposits To Invoices').item.json.paymentDate }}",
            'Amount Paid': "={{ $('Match Deposits To Invoices').item.json.invoiceAmount }}"
          },
          matchingColumns: ['Invoice #'],
          schema: []
        },
        options: {}
      }
    },
    {
      id: 'n10', name: 'Slack Payment Confirmed',
      type: 'n8n-nodes-base.slack', typeVersion: 2.2,
      position: [2880, 340],
      credentials: { slackApi: { id: 'Bn2U6Cwe1wdiCXzD', name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message', operation: 'post',
        select: 'channel',
        channelId: { __rl: true, value: 'C09HN2EBPR7', mode: 'id' },
        text: SLACK_CONFIRMED_TEXT,
        otherOptions: {}
      }
    },
    {
      // Osome path: tracker update only — no Airwallex call since Osome has no API.
      id: 'n15', name: 'Update Osome Invoice Status',
      type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [2220, 580],
      credentials: { googleSheetsOAuth2Api: { id: '83MQOm78gYDvziTO', name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet', operation: 'appendOrUpdate',
        documentId: { __rl: true, value: '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50', mode: 'id' },
        sheetName: { __rl: true, value: 'Invoices', mode: 'name' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            'Invoice #': "={{ $('Match Deposits To Invoices').item.json.invoiceNumber }}",
            'Payment Status': 'Payment Complete',
            'Payment Confirmed Date': "={{ $('Match Deposits To Invoices').item.json.paymentDate }}",
            'Amount Paid': "={{ $('Match Deposits To Invoices').item.json.invoiceAmount }}"
          },
          matchingColumns: ['Invoice #'],
          schema: []
        },
        options: {}
      }
    },
    {
      id: 'n16', name: 'Slack Osome Payment Confirmed',
      type: 'n8n-nodes-base.slack', typeVersion: 2.2,
      position: [2440, 580],
      credentials: { slackApi: { id: 'Bn2U6Cwe1wdiCXzD', name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'message', operation: 'post',
        select: 'channel',
        channelId: { __rl: true, value: 'C09HN2EBPR7', mode: 'id' },
        text: SLACK_CONFIRMED_TEXT,
        otherOptions: {}
      }
    },
  ],
  connections: {
    'Hourly':          { main: [[{ node: 'Claim Window', type: 'main', index: 0 }]] },
    'Webhook Trigger': { main: [[{ node: 'Claim Window', type: 'main', index: 0 }]] },
    'Claim Window': { main: [[
      { node: 'Get Invoice Tracker', type: 'main', index: 0 },
      { node: 'Search Airwallex Emails', type: 'main', index: 0 }
    ]]},
    // Tracker rows feed the Airwallex API poll and matching lookup, not Gmail.
    'Get Invoice Tracker': { main: [[
      { node: 'Poll Airwallex Invoices', type: 'main', index: 0 }
    ]]},
    'Search Airwallex Emails': { main: [[{ node: 'Parse All Emails',         type: 'main', index: 0 }]] },
    'Parse All Emails':        { main: [[{ node: 'Combine Payment Signals',  type: 'main', index: 0 }]] },
    'Poll Airwallex Invoices': { main: [[{ node: 'Combine Payment Signals',  type: 'main', index: 1 }]] },
    'Combine Payment Signals': { main: [[{ node: 'Match Deposits To Invoices', type: 'main', index: 0 }]] },
    'Match Deposits To Invoices': { main: [[{ node: 'Is Partial?', type: 'main', index: 0 }]] },
    'Is Partial?': { main: [
      [{ node: 'Update Partial Tracker', type: 'main', index: 0 }],  // true — partial
      [{ node: 'Is Osome?',             type: 'main', index: 0 }]   // false — full payment
    ]},
    'Update Partial Tracker': { main: [[{ node: 'Slack Partial Alert', type: 'main', index: 0 }]] },
    'Is Osome?': { main: [
      [{ node: 'Update Osome Invoice Status', type: 'main', index: 0 }],  // true — Osome: skip Airwallex
      [{ node: 'Airwallex Auth',              type: 'main', index: 0 }]   // false — Airwallex invoice
    ]},
    'Airwallex Auth':              { main: [[{ node: 'Airwallex Mark Paid',            type: 'main', index: 0 }]] },
    'Airwallex Mark Paid':         { main: [[{ node: 'Update Invoice Status',          type: 'main', index: 0 }]] },
    'Update Invoice Status':       { main: [[{ node: 'Slack Payment Confirmed',        type: 'main', index: 0 }]] },
    'Update Osome Invoice Status': { main: [[{ node: 'Slack Osome Payment Confirmed',  type: 'main', index: 0 }]] }
  }
};

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
  const list = await n8nRequest('GET', `/api/v1/workflows?name=${encodeURIComponent(workflow.name)}&limit=250`);
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
  await n8nRequest('POST', `/api/v1/workflows/${result.id}/activate`);
  console.log('SUCCESS');
  console.log('Workflow ID:', result.id);
  console.log('Name:', result.name);
  console.log('URL: https://noatakhel.app.n8n.cloud/workflow/' + result.id);
  console.log('Last-run timestamp is stored in n8n workflow static data — no external setup required.');
  console.log('NOTE: Verify Airwallex paid_amount field name on first run with a live partial invoice.');
}

if (require.main === module) {
  deploy().catch((e) => console.error('Deploy failed:', e.message));
}

module.exports = { workflow };
