import { google } from "googleapis";

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
  scopes: [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.settings.basic",
  ],
  clientOptions: { subject: "noa@kravemedia.co" },
});
const gmail = google.gmail({ version: "v1", auth });

const SAAS_RECEIPTS_LABEL = "Label_4693217381219157368"; // _Admin/SaaS Receipts

// Labels to delete (id → display name)
const DELETE_LABELS = {
  Label_12:  "Admin",
  Label_10:  "Halo-Home",
  Label_9:   "IM8",
  Label_11:  "Invoices",
  Label_8:   "Krave",
  Label_13:  "Newsletters",
  Label_4726321074668732722: "_Pandadoc",
};

async function createFilter(criteria, action, desc) {
  try {
    await gmail.users.settings.filters.create({
      userId: "me",
      requestBody: { criteria, action },
    });
    console.log(`  ✓ ${desc}`);
  } catch (err) {
    if (err.code === 409) console.log(`  → already exists: ${desc}`);
    else console.error(`  ✗ ${desc}: ${err.message}`);
  }
}

async function deleteLabel(id, name) {
  try {
    await gmail.users.labels.delete({ userId: "me", id });
    console.log(`  ✓ deleted: ${name}`);
  } catch (err) {
    console.error(`  ✗ delete "${name}": ${err.message}`);
  }
}

console.log("\n── New PandaDoc filters ─────────────────────────────");

// PandaDoc "viewed" notifications → skip inbox (low signal, not signed yet)
await createFilter(
  { from: "docs@email.pandadoc.net", query: "has viewed" },
  { removeLabelIds: ["INBOX"] },
  "PandaDoc: document viewed → skip inbox"
);

// PandaDoc payment receipts → skip inbox, tag _Admin/SaaS Receipts
await createFilter(
  { from: "invoices@pandadoc.com" },
  { removeLabelIds: ["INBOX"], addLabelIds: [SAAS_RECEIPTS_LABEL] },
  "PandaDoc: payment receipt → _Admin/SaaS Receipts"
);

console.log();
console.log("── Delete stale labels ──────────────────────────────");

for (const [id, name] of Object.entries(DELETE_LABELS)) {
  await deleteLabel(id, name);
}

console.log("\n✅ Done.\n");
