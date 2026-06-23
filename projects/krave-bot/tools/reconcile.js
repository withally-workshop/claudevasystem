'use strict';

// EOD reconcile: mirror Airwallex Spend bills into the Creator & AP Bills Tracker.
// Reuses the bot's airwallex + sheets handlers (same spend key + Google creds).
//   - bill already in the sheet (by Bill ID) → skip
//   - bill matches a row missing its Bill ID (invoice# + amount + currency) → fill the Bill ID
//   - no match → append a new row
// No status lifecycle — the Bill ID column is the only signal a bill exists.
// Exposed via POST /cron/reconcile-bills (see server.js), triggered by an n8n EOD schedule.

const aw = require('./airwallex');
const sheets = require('./sheets');

const TAB = 'Krave — Creator & AP Bills Tracker';
const normInv = (s) => String(s || '').trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '');
const normAmt = (s) => Math.round(parseFloat(String(s || '0').replace(/[^0-9.]/g, '')) * 100) || 0;

async function reconcileBills() {
  // NOTE: page_size 100 covers current volume (~20 bills). Add cursor pagination
  // (page_after) if bills ever exceed 100.
  const billsRes = await aw.handlers.airwallex_list_bills({ page_size: 100 });
  const bills = billsRes.bills || [];
  const vendRes = await aw.handlers.airwallex_list_vendors({ page_size: 100 });
  const vmap = Object.fromEntries((vendRes.vendors || []).map((v) => [v.id, v.name]));

  const sheetRes = await sheets.handlers.sheets_get_rows({ spreadsheet_id: 'bills', sheet: TAB, range: 'A:J' });
  const rows = sheetRes.rows || []; // array of header-keyed objects; index i ↔ sheet row i+2

  const existing = new Set(rows.map((r) => String(r['Airwallex Bill ID'] || '').trim()).filter(Boolean));
  const blank = new Map(); // invoice#+amount+currency → row index (rows missing a Bill ID)
  rows.forEach((r, i) => {
    if (String(r['Airwallex Bill ID'] || '').trim()) return;
    const k = `${normInv(r['Invoice #'])}|${normAmt(r['Amount'])}|${String(r['Currency'] || '').trim().toUpperCase()}`;
    if (!blank.has(k)) blank.set(k, i);
  });

  const today = new Date().toISOString().split('T')[0];
  const filledRows = [], addedRows = [];
  for (const b of bills) {
    if (existing.has(b.id)) continue;
    const k = `${normInv(b.invoice_number)}|${normAmt(b.amount)}|${String(b.currency || '').trim().toUpperCase()}`;
    const vendor = vmap[b.vendor_id] || '(unknown vendor)';
    if (blank.has(k)) {
      const i = blank.get(k);
      blank.delete(k);
      await sheets.handlers.sheets_update_row({ spreadsheet_id: 'bills', sheet: TAB, range: `D${i + 2}`, values: [[b.id]] });
      filledRows.push({ row: i + 2, vendor, invoice: b.invoice_number || '', amount: b.amount || '', currency: b.currency || '', billId: b.id });
    } else {
      await sheets.handlers.sheets_append_row({
        spreadsheet_id: 'bills', sheet: TAB,
        values: [today, vendor, b.invoice_number || '', b.id, b.amount || '', b.currency || '', b.due_date ? String(b.due_date).split('T')[0] : '', '', '', 'Auto-added from Airwallex EOD reconcile'],
      });
      addedRows.push({ vendor, invoice: b.invoice_number || '', amount: b.amount || '', currency: b.currency || '', billId: b.id });
    }
  }
  return { total: bills.length, filled: filledRows.length, added: addedRows.length, filledRows, addedRows };
}

module.exports = { reconcileBills };
