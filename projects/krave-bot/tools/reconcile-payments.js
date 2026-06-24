'use strict';

// Payment reconcile: poll Airwallex for the TRUE paid-status of every open client
// invoice in the AR tracker and mark the paid ones. Email-independent — catches
// card/link payments that settle net-of-fees with NO deposit email (the gap that
// left INV-N06BN4Z8-0001 "unpaid" in the tracker on 2026-06-23 even though the
// client had paid via the hosted link).
//
// Two entry points, one write path (markPaid):
//   - reconcilePayments()        — sweep all open invoices (hourly interval + /cron/reconcile-payments)
//   - reconcileInvoiceById(id)   — single invoice (Airwallex /webhook/airwallex paid event)
//
// IMPORTANT: use airwallex_get_invoice (raw), NOT airwallex_get_billing_invoice —
// the latter trims the response and drops payment_status / paid_at.

const aw = require('./airwallex');
const sheets = require('./sheets');
const slack = require('./slack');

const PAYMENTS_CHANNEL = 'C09HN2EBPR7'; // #payments-invoices-updates

// Col J (Payment Status) values worth re-checking vs. already settled.
const OPEN_RE = /invoice sent|unpaid|overdue|late fee|collections|sent/i;
const DONE_RE = /paid|payment complete|void/i;

const dateOnly = (s) => String(s || '').split('T')[0];

// Write J (Payment Status), M (Payment Confirmed Date), Q (Amount Paid) on a
// 1-based tracker row. Never touches N (formula-driven Status column).
async function markPaid(sheetRow, inv, trackerRow) {
  const paidDate = dateOnly(inv.paid_at) || new Date().toISOString().split('T')[0];
  const amountPaid = String(
    inv.total_amount != null ? inv.total_amount
      : inv.amount != null ? inv.amount
        : (trackerRow['Amount'] || '')
  );
  await sheets.handlers.sheets_update_row({ range: `J${sheetRow}`, values: [['Payment Complete']] });
  await sheets.handlers.sheets_update_row({ range: `M${sheetRow}`, values: [[paidDate]] });
  await sheets.handlers.sheets_update_row({ range: `Q${sheetRow}`, values: [[amountPaid]] });
  return {
    row: sheetRow,
    client: trackerRow['Client Name'] || '',
    number: trackerRow['Invoice #'] || inv.invoice_number || '',
    amount: amountPaid,
    currency: trackerRow['Currency'] || inv.currency || '',
    paidDate,
  };
}

async function postPaidSummary(marked) {
  if (!marked.length) return;
  const lines = [':white_check_mark: *Payment reconcile* — newly detected as paid in Airwallex:'];
  for (const m of marked) {
    lines.push(`• ${m.client} — ${m.number} — ${m.amount} ${m.currency} — paid ${m.paidDate}`);
  }
  try {
    await slack.handlers.slack_post_message({ channel: PAYMENTS_CHANNEL, text: lines.join('\n') });
  } catch (e) {
    console.error('payment-reconcile slack post failed:', e.message);
  }
}

const isPaid = (inv) => inv && String(inv.payment_status || '').toUpperCase() === 'PAID';

// Sweep: check every open invoice in the tracker against Airwallex.
async function reconcilePayments() {
  const sheetRes = await sheets.handlers.sheets_get_rows({ range: 'A:R' });
  const rows = sheetRes.rows || []; // row i (0-based) ↔ sheet row i+2
  let checked = 0;
  const marked = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const invId = String(r['Airwallex Invoice ID'] || '').trim();
    const status = String(r['Payment Status'] || '').trim();
    if (!invId.startsWith('inv_')) continue;   // only Airwallex billing invoices
    if (DONE_RE.test(status)) continue;         // already paid/void
    if (!OPEN_RE.test(status)) continue;        // skip drafts / unknown states
    checked++;
    try {
      const inv = await aw.handlers.airwallex_get_invoice({ invoice_id: invId });
      if (isPaid(inv)) marked.push(await markPaid(i + 2, inv, r));
    } catch (e) {
      console.error(`payment-reconcile: ${invId} check failed:`, e.message);
    }
  }
  await postPaidSummary(marked);
  const result = { checked, marked: marked.length, rows: marked };
  console.log('reconcile-payments:', JSON.stringify(result));
  return result;
}

// Single invoice (webhook). Re-verifies via the API → idempotent + safe against
// spoofed/duplicate events.
async function reconcileInvoiceById(invoiceId) {
  const invId = String(invoiceId || '').trim();
  if (!invId.startsWith('inv_')) return { skipped: 'not a billing invoice id' };
  const sheetRes = await sheets.handlers.sheets_get_rows({ range: 'A:R' });
  const rows = sheetRes.rows || [];
  const i = rows.findIndex((r) => String(r['Airwallex Invoice ID'] || '').trim() === invId);
  if (i < 0) return { skipped: 'invoice not in tracker' };
  if (DONE_RE.test(String(rows[i]['Payment Status'] || ''))) return { skipped: 'already reconciled' };
  const inv = await aw.handlers.airwallex_get_invoice({ invoice_id: invId });
  if (!isPaid(inv)) return { skipped: 'not paid yet' };
  const m = await markPaid(i + 2, inv, rows[i]);
  await postPaidSummary([m]);
  console.log('reconcile-payments (webhook):', JSON.stringify(m));
  return { marked: 1, row: m };
}

module.exports = { reconcilePayments, reconcileInvoiceById };
