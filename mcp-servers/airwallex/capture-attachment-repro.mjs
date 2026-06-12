// Throwaway: capture exact request/response pairs for the Airwallex support
// thread on bill attachments. Uses a zero-UUID vendor_id so /spend/bills/create
// can never actually create a bill, even if attachment validation changed.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const mcpConfig = JSON.parse(readFileSync(path.join(root, ".mcp.json"), "utf8"));
const env = mcpConfig.mcpServers["krave-airwallex"].env;
const ACCOUNT_ID = env.AIRWALLEX_ACCOUNT_ID || "";

const login = await fetch("https://api.airwallex.com/api/v1/authentication/login", {
  method: "POST",
  headers: {
    "x-client-id": env.AIRWALLEX_SPEND_CLIENT_ID,
    "x-api-key": env.AIRWALLEX_SPEND_API_KEY,
    "Content-Type": "application/json",
  },
});
if (!login.ok) { console.log("AUTH FAILED", login.status); process.exit(1); }
const { token } = await login.json();
console.log("auth ok (spend scoped key)");

// 1. Upload a minimal PDF — capture the full response so we know the exact file_id shape
const fd = new FormData();
fd.append("file", new Blob([Buffer.from("%PDF-1.4\n%%EOF", "utf8")], { type: "application/pdf" }), "repro.pdf");
const up = await fetch("https://files.airwallex.com/api/v1/files/upload", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: fd,
});
const upBody = await up.text();
console.log(`\n[1] POST files.airwallex.com/api/v1/files/upload -> ${up.status}`);
console.log(upBody);
let fileId = "";
try { fileId = JSON.parse(upBody).file_id || JSON.parse(upBody).id || ""; } catch {}
if (!fileId) { console.log("no file_id parsed — stopping"); process.exit(1); }

const uuidInId = (fileId.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [""])[0];

async function tryCreate(label, attachments) {
  const body = {
    request_id: crypto.randomUUID(),
    external_id: "REPRO-ATTACHMENT-" + label,
    legal_entity_id: "le_Zxw2-ECjOaKKebIGraD1AA",
    vendor_id: "00000000-0000-0000-0000-000000000000", // intentionally nonexistent
    invoice_number: "TEST-ATTACH-REPRO-DO-NOT-PAY",
    issued_date: "2026-06-12",
    due_date: "2026-06-19",
    billing_currency: "SGD",
    tax_status: "TAX_EXCLUSIVE",
    sync_status: "NOT_SYNCED",
    line_items: [{ description: "attachment repro - do not pay", quantity: "1", unit_price: "1.00" }],
    attachments,
  };
  const res = await fetch("https://api.airwallex.com/api/v1/spend/bills/create", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(ACCOUNT_ID ? { "x-on-behalf-of": ACCOUNT_ID } : {}),
    },
    body: JSON.stringify(body),
  });
  console.log(`\n[${label}] POST /api/v1/spend/bills/create`);
  console.log("request body:", JSON.stringify(body, null, 2));
  console.log(`response: ${res.status}`);
  console.log((await res.text()).slice(0, 600));
}

await tryCreate("A-full-file-id", [fileId]);
if (uuidInId) await tryCreate("B-embedded-uuid", [uuidInId]);
