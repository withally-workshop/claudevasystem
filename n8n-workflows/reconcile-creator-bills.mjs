// EOD reconcile: mirror Airwallex Spend bills into the Creator & AP Bills Tracker.
// Lists live bills, cross-checks the sheet, and FILLS what's missing:
//   - bill already in the sheet (by Bill ID) → skip
//   - bill matches a row missing its Bill ID (invoice# + amount + currency) → fill the Bill ID
//   - no match → append a new row
// No status lifecycle — the Bill ID column is the only signal a bill exists.
//
// Usage:  node reconcile-creator-bills.mjs            (DRY RUN — prints, writes nothing)
//         node reconcile-creator-bills.mjs --apply    (writes to the sheet)
import { readFileSync } from "fs";
import crypto from "crypto";

const APPLY = process.argv.includes("--apply");
const ROOT = "c:/Users/jopso/Desktop/claude-ea";
const SHEET_ID = "14kiX9MnWyel_4_OxvL2TlnOAqBqFwwECf7Dm24znuJc";
const TAB = "Krave — Creator & AP Bills Tracker";

// ── env ──
const env = {};
for (const l of readFileSync(`${ROOT}/.env`, "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}
const mcp = JSON.parse(readFileSync(`${ROOT}/.mcp.json`, "utf8")).mcpServers["krave-airwallex"].env;
const AW = "https://api.airwallex.com";

// ── Airwallex (spend key) ──
async function awLogin() {
  const r = await fetch(`${AW}/api/v1/authentication/login`, {
    method: "POST",
    headers: { "x-client-id": mcp.AIRWALLEX_SPEND_CLIENT_ID, "x-api-key": mcp.AIRWALLEX_SPEND_API_KEY, "Content-Type": "application/json" },
  });
  if (!r.ok) throw new Error(`AW login ${r.status}`);
  return (await r.json()).token;
}
async function awGetAll(token, path) {
  const items = [];
  let url = `${AW}${path}${path.includes("?") ? "&" : "?"}page_size=100`;
  for (let i = 0; i < 30; i++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`AW GET ${path} ${r.status}: ${(await r.text()).slice(0, 120)}`);
    const j = await r.json();
    items.push(...(j.items || []));
    if (!j.page_after) break;
    url = `${AW}${path}${path.includes("?") ? "&" : "?"}page_size=100&page_after=${encodeURIComponent(j.page_after)}`;
  }
  return items;
}

// ── Google Sheets (service account) ──
async function googleToken() {
  const sa = JSON.parse(readFileSync(env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: sa.client_email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const input = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claim)}`;
  const sig = crypto.createSign("RSA-SHA256").update(input).sign(sa.private_key, "base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${input}.${sig}`,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("google token failed");
  return j.access_token;
}
async function sheetGet(token, range) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  return j.values || [];
}
async function sheetAppend(token, rows) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(TAB + "!A:A")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: rows, majorDimension: "ROWS" }),
  });
  if (!r.ok) throw new Error(`append ${r.status}: ${(await r.text()).slice(0, 150)}`);
}
async function sheetUpdateCell(token, a1, value) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(a1)}?valueInputOption=USER_ENTERED`, {
    method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [[value]] }),
  });
  if (!r.ok) throw new Error(`update ${a1} ${r.status}`);
}

// ── reconcile ──
const normInv = (s) => String(s || "").trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "");
const normAmt = (s) => Math.round(parseFloat(String(s || "0").replace(/[^0-9.]/g, "")) * 100);

(async () => {
  const awToken = await awLogin();
  const [bills, vendors] = await Promise.all([
    awGetAll(awToken, "/api/v1/spend/bills"),
    awGetAll(awToken, "/api/v1/spend/vendors"),
  ]);
  const vendorName = Object.fromEntries(vendors.map((v) => [v.id, v.name || v.business_name || ""]));
  console.log(`Airwallex: ${bills.length} bills, ${vendors.length} vendors`);

  const gToken = await googleToken();
  const rows = await sheetGet(gToken, TAB);
  const header = rows[0] || [];
  const data = rows.slice(1); // row r is sheet row r+2
  console.log(`Sheet: ${data.length} data rows`);

  const existingIds = new Set(data.map((r) => String(r[3] || "").trim()).filter(Boolean));
  // index blank-ID rows by invoice#+amount+currency for fill-matching
  const blankIdx = new Map();
  data.forEach((r, i) => {
    if (String(r[3] || "").trim()) return; // already has a Bill ID
    const key = `${normInv(r[2])}|${normAmt(r[4])}|${String(r[5] || "").trim().toUpperCase()}`;
    if (!blankIdx.has(key)) blankIdx.set(key, i);
  });

  const fills = [], appends = [];
  for (const b of bills) {
    if (existingIds.has(b.id)) continue; // already tracked
    const key = `${normInv(b.invoice_number)}|${normAmt(b.billing_amount)}|${String(b.billing_currency || "").trim().toUpperCase()}`;
    if (blankIdx.has(key)) {
      const rowNum = blankIdx.get(key) + 2;
      fills.push({ rowNum, billId: b.id, inv: b.invoice_number });
      blankIdx.delete(key); // one bill per blank row
    } else {
      appends.push([
        (b.created_at || "").split("T")[0],
        vendorName[b.vendor_id] || "(unknown vendor)",
        b.invoice_number || "",
        b.id,
        b.billing_amount || "",
        b.billing_currency || "",
        (b.due_date || "").split("T")[0],
        "", // no status — Bill ID present = exists in Airwallex
        "",
        `Auto-added from Airwallex EOD reconcile`,
      ]);
    }
  }

  console.log(`\n${APPLY ? "APPLYING" : "DRY RUN"} — ${fills.length} Bill IDs to fill, ${appends.length} rows to append\n`);
  fills.forEach((f) => console.log(`  FILL  row ${f.rowNum} (inv ${f.inv}) ← ${f.billId}`));
  appends.forEach((a) => console.log(`  ADD   ${a[1]} | inv ${a[2]} | ${a[4]} ${a[5]} | ${a[3]}`));

  if (!APPLY) { console.log("\n(dry run — nothing written. Re-run with --apply to write.)"); return; }

  for (const f of fills) await sheetUpdateCell(gToken, `${TAB}!D${f.rowNum}`, f.billId);
  if (appends.length) await sheetAppend(gToken, appends);
  console.log(`\nDone — filled ${fills.length}, appended ${appends.length}.`);
})().catch((e) => { console.error("RECONCILE FAILED:", e.message); process.exit(1); });
