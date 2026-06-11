// Throwaway: distinguish scope-block (401) vs validation (400) on the newly
// released Spend endpoints. Empty/invalid bodies — nothing can be created.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const mcpConfig = JSON.parse(readFileSync(path.join(root, ".mcp.json"), "utf8"));
const env = mcpConfig.mcpServers["krave-airwallex"].env;
const ACCOUNT_ID = env.AIRWALLEX_ACCOUNT_ID || "";

const BASE = "https://api.airwallex.com";

// Prefer the org-level Spend scoped key when configured
const clientId = env.AIRWALLEX_SPEND_CLIENT_ID || env.AIRWALLEX_CLIENT_ID;
const apiKey = env.AIRWALLEX_SPEND_API_KEY || env.AIRWALLEX_API_KEY;
console.log(`using ${env.AIRWALLEX_SPEND_CLIENT_ID ? "SPEND scoped key" : "main key"}`);

const login = await fetch(`${BASE}/api/v1/authentication/login`, {
  method: "POST",
  headers: {
    "x-client-id": clientId,
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  },
});
if (!login.ok) {
  console.log("AUTH FAILED", login.status, await login.text());
  process.exit(1);
}
const { token } = await login.json();
console.log("auth ok");

async function probe(label, method, path2, body, behalf) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (behalf && ACCOUNT_ID) headers["x-on-behalf-of"] = ACCOUNT_ID;
  const res = await fetch(`${BASE}${path2}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  console.log(`[${label}] ${res.status}: ${text.slice(0, 250)}`);
}

// file upload on files.airwallex.com — needs Upload Files (Write) on the key
const fd = new FormData();
fd.append("file", new Blob([Buffer.from("%PDF-1.4\n%%EOF", "utf8")], { type: "application/pdf" }), "probe.pdf");
const up = await fetch("https://files.airwallex.com/api/v1/files/upload", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: fd,
});
console.log(`[file upload] ${up.status}: ${(await up.text()).slice(0, 200)}`);

// create with empty body: 400 = access OK (validation), 401 = scope block
await probe("create / empty body / behalf", "POST", "/api/v1/spend/bills/create", {}, true);
await probe("create / empty body / no-behalf", "POST", "/api/v1/spend/bills/create", {}, false);
// mark_as_paid with fake id: 404 = access OK, 401 = scope block
await probe("mark_as_paid / fake id / behalf", "POST", "/api/v1/spend/bills/00000000-0000-0000-0000-000000000000/mark_as_paid", undefined, true);
// vendors list (needed for vendor_id lookup before create)
await probe("vendors list / behalf", "GET", "/api/v1/spend/vendors?page_size=1", undefined, true);
await probe("vendors list / no-behalf", "GET", "/api/v1/spend/vendors?page_size=1", undefined, false);
