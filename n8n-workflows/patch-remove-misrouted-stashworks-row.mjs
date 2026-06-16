// One-off cleanup (2026-06-16): remove the misrouted creator-bill prep row that
// a pre-fix krave-bot build wrote into the CLIENT/AR tracker (it omitted
// spreadsheet_id:"bills", so sheets.js silently defaulted to the AR sheet).
// The same Stashworks bill (INV-007838) is correctly in the Creator & AP Bills
// tracker with its real Bill ID, so this row is a pure duplicate-in-wrong-place.
//
// FAIL-SAFE: only deletes a row that matches ALL of {vendor Stashworks Pte Ltd,
// invoice INV-007838, status "Prepped — awaiting manual creation"}. If zero or
// more than one match, it aborts and writes nothing.
//
// Usage:  node patch-remove-misrouted-stashworks-row.mjs          (DRY RUN)
//         node patch-remove-misrouted-stashworks-row.mjs --apply  (deletes)
import { readFileSync } from "fs";
import crypto from "crypto";

const APPLY = process.argv.includes("--apply");
const ROOT = "c:/Users/jopso/Desktop/claude-ea";
const SHEET_ID = "1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50"; // CLIENT / AR tracker
const TAB = "Invoices";

const env = {};
for (const l of readFileSync(`${ROOT}/.env`, "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim();
}

async function googleToken() {
  const sa = JSON.parse(readFileSync(env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE, "utf8"));
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

(async () => {
  const token = await googleToken();

  // resolve the Invoices tab's numeric sheetId (needed for deleteDimension)
  const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets(properties(sheetId,title))`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const tab = (meta.sheets || []).find((s) => s.properties.title === TAB);
  if (!tab) throw new Error(`tab "${TAB}" not found`);
  const gid = tab.properties.sheetId;

  // read all rows, find the misrouted Stashworks prep row
  const vals = (await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(TAB + "!A1:N")}`, { headers: { Authorization: `Bearer ${token}` } })).json()).values || [];
  const matches = [];
  vals.forEach((r, i) => {
    if (i === 0) return; // header
    const vendor = String(r[1] || "").trim();
    const inv = String(r[2] || "").trim();
    const status = String(r[7] || "");
    if (vendor === "Stashworks Pte Ltd" && inv === "INV-007838" && /Prepped — awaiting manual creation/.test(status)) {
      matches.push({ rowNum: i + 1, rowIndex: i, preview: r.slice(0, 10).join(" | ") });
    }
  });

  console.log(`Found ${matches.length} matching misrouted row(s):`);
  matches.forEach((m) => console.log(`  row ${m.rowNum}: ${m.preview}`));

  if (matches.length !== 1) {
    console.log(`\nABORT — expected exactly 1 match, got ${matches.length}. Nothing written.`);
    process.exit(matches.length === 0 ? 0 : 1);
  }
  if (!APPLY) {
    console.log("\n(dry run — nothing deleted. Re-run with --apply to delete.)");
    return;
  }

  const { rowIndex } = matches[0];
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId: gid, dimension: "ROWS", startIndex: rowIndex, endIndex: rowIndex + 1 } } }] }),
  });
  if (!r.ok) throw new Error(`batchUpdate ${r.status}: ${(await r.text()).slice(0, 200)}`);
  console.log(`\nDone — deleted row ${matches[0].rowNum} from the CLIENT/AR tracker.`);
})().catch((e) => { console.error("CLEANUP FAILED:", e.message); process.exit(1); });
