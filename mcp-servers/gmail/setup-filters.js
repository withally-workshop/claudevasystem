/**
 * Gmail Filter Setup — noa@kravemedia.co
 *
 * Creates server-side Gmail filters to remove inbox noise before triage.
 * Run once from this directory:
 *
 *   GOOGLE_SERVICE_ACCOUNT_KEY_FILE="C:\Users\jopso\Downloads\krave-ea-4ceace6542ec.json" \
 *   node setup-filters.js
 *
 * If you get a 403 on filter creation, the service account needs
 * gmail.settings.basic scope added in Google Workspace Admin:
 *   Admin Console → Security → API Controls → Domain-wide Delegation
 *   Add scope: https://www.googleapis.com/auth/gmail.settings.basic
 */

import { google } from "googleapis";

const KEY_FILE =
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE ||
  "C:\\Users\\jopso\\Downloads\\krave-ea-4ceace6542ec.json";
const USER = "noa@kravemedia.co";

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE,
  scopes: [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.settings.basic",
  ],
  clientOptions: { subject: USER },
});

const gmail = google.gmail({ version: "v1", auth });

// ─── Known label IDs (verified by message inspection 2026-05-25) ─────────────
// If these ever change, re-run: node -e "..." to list all labels
const KNOWN_LABELS = {
  airwallex: "Label_1880242623832050573",       // Stripe/Shopify payouts
  paymentReceived: "Label_5194298534623747326", // Client invoice payments
  zArchive: "Label_1966831095696420025",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function listLabels() {
  const res = await gmail.users.labels.list({ userId: "me" });
  return res.data.labels || [];
}

async function ensureLabel(labels, name) {
  const existing = labels.find((l) => l.name === name);
  if (existing) {
    console.log(`  → exists: "${name}" (${existing.id})`);
    return existing;
  }
  const res = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });
  console.log(`  ✓ created: "${name}" (${res.data.id})`);
  return res.data;
}

async function listFilters() {
  const res = await gmail.users.settings.filters.list({ userId: "me" });
  return res.data.filter || [];
}

async function deleteFilter(id, desc) {
  try {
    await gmail.users.settings.filters.delete({ userId: "me", id });
    console.log(`  ✓ deleted: ${desc} (${id})`);
  } catch (err) {
    console.error(`  ✗ delete failed ${id}: ${err.message}`);
  }
}

async function createFilter(criteria, action, desc) {
  try {
    await gmail.users.settings.filters.create({
      userId: "me",
      requestBody: { criteria, action },
    });
    console.log(`  ✓ ${desc}`);
  } catch (err) {
    if (err.code === 409) {
      console.log(`  → already exists: ${desc}`);
    } else if (err.code === 403) {
      console.error(
        `  ✗ 403 on "${desc}" — add gmail.settings.basic scope to service account in Google Workspace Admin`
      );
    } else {
      console.error(`  ✗ ${desc}: ${err.message}`);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nSetting up Gmail filters for ${USER}\n`);

  // 1. Labels
  console.log("── Labels ──────────────────────────────────────────");
  const labels = await listLabels();
  const compliance = await ensureLabel(labels, "Compliance");
  const haloLogistics = await ensureLabel(labels, "Halo/Logistics");
  const creatorsInbound = await ensureLabel(labels, "Creators-Inbound");
  console.log();

  const INBOX = "INBOX";
  const skipInbox = { removeLabelIds: [INBOX] };
  const skipAndTag = (id) => ({ removeLabelIds: [INBOX], addLabelIds: [id] });
  const tagOnly = (id) => ({ addLabelIds: [id] });

  // 1b. Cleanup: remove filters that used hasWords (silently ignored by Gmail API)
  //     These ended up as bare from: filters, catching OTPs/card failures incorrectly.
  console.log("── Cleanup: remove incorrect hasWords filters ────────");
  const existingFilters = await listFilters();
  const airwallexInfoFilters = existingFilters.filter(
    (f) => f.criteria?.from === "support@info.airwallex.com" && !f.criteria?.query
  );
  if (airwallexInfoFilters.length === 0) {
    console.log("  → none to remove");
  }
  for (const f of airwallexInfoFilters) {
    await deleteFilter(f.id, `bare from:support@info.airwallex.com (id ${f.id})`);
  }
  console.log();

  // 2. Filters
  console.log("── Airwallex ────────────────────────────────────────");

  // Stripe/Shopify payouts → skip inbox, airwallex label
  // Uses query field (not hasWords) — Gmail API ignores hasWords silently without other criteria
  await createFilter(
    { from: "support@info.airwallex.com", query: "STRIPE PAYMENTS SINGAPORE" },
    skipAndTag(KNOWN_LABELS.airwallex),
    "Airwallex: Stripe/Shopify deposits (query) → skip inbox"
  );

  // Daily task digest → skip inbox, airwallex label
  await createFilter(
    { from: "support@info.airwallex.com", query: "tasks to complete" },
    skipAndTag(KNOWN_LABELS.airwallex),
    "Airwallex: daily task digest (query) → skip inbox"
  );

  // Outbound transfers FYI → skip inbox, airwallex label
  await createFilter(
    { from: "support@info.airwallex.com", subject: "Transfers are on the way" },
    skipAndTag(KNOWN_LABELS.airwallex),
    "Airwallex: outbound transfers → skip inbox"
  );

  // Rebate issued → skip inbox, airwallex label
  await createFilter(
    { from: "support@info.airwallex.com", subject: "successfully issued your rebate" },
    skipAndTag(KNOWN_LABELS.airwallex),
    "Airwallex: rebate issued → skip inbox"
  );

  // New card expenses reminder → skip inbox
  await createFilter(
    { from: "support@info.airwallex.com", hasWords: "new expenses" },
    skipInbox,
    "Airwallex: new expenses reminder → skip inbox"
  );

  // Airwallex marketing/product updates → skip inbox
  await createFilter(
    { from: "hello@airwallex.com" },
    skipInbox,
    "Airwallex: marketing emails → skip inbox"
  );

  // Airwallex CS → skip inbox (unless replying to Noa directly — handled by triage)
  await createFilter(
    { from: "customer-success-sg@airwallex.com" },
    skipInbox,
    "Airwallex: CS emails → skip inbox"
  );

  // NOTE: OTPs ("Your one-time passcode") and "Card Payment Failed" are NOT filtered — stay in inbox

  console.log();
  console.log("── ClickUp ──────────────────────────────────────────");

  await createFilter(
    { from: "notifications@tasks.clickup.com" },
    skipInbox,
    "ClickUp task status notifications → skip inbox"
  );
  await createFilter(
    { from: "noreply@clickup.com" },
    skipInbox,
    "ClickUp daily summary → skip inbox"
  );

  console.log();
  console.log("── Frame.io ─────────────────────────────────────────");

  await createFilter(
    { from: "notifications@frame.io" },
    skipInbox,
    "Frame.io comment notifications → skip inbox"
  );
  // Frame.io product emails
  await createFilter(
    { from: "team@email.frame.io" },
    skipInbox,
    "Frame.io product emails → skip inbox"
  );

  console.log();
  console.log("── Meeting Notes ────────────────────────────────────");

  await createFilter(
    { from: "gemini-notes@google.com" },
    skipInbox,
    "Gemini AI meeting notes → skip inbox"
  );
  await createFilter(
    { from: "no-reply@fathom.video" },
    skipInbox,
    "Fathom meeting recaps → skip inbox"
  );

  console.log();
  console.log("── Scheduling ───────────────────────────────────────");

  await createFilter(
    { from: "notifications@calendly.com" },
    skipInbox,
    "Calendly new booking notifications → skip inbox"
  );

  console.log();
  console.log("── Halo Logistics ───────────────────────────────────");

  await createFilter(
    { from: "noreply@ninjavan.co" },
    skipAndTag(haloLogistics.id),
    "Ninja Van delivery confirmations → Halo/Logistics"
  );
  await createFilter(
    { from: "nelly@stashworks.co" },
    skipAndTag(haloLogistics.id),
    "Stashworks backorder reports → Halo/Logistics"
  );
  await createFilter(
    { from: "no-reply@selluseller.com" },
    skipAndTag(haloLogistics.id),
    "SellUseller product sync → Halo/Logistics"
  );
  // Stashworks finance invoices (Xero) — keep in inbox, tag for reference
  await createFilter(
    { from: "messaging-service@post.xero.com" },
    tagOnly(haloLogistics.id),
    "Stashworks Xero invoices → tag Halo/Logistics (stay in inbox)"
  );

  console.log();
  console.log("── Compliance (Osome) ───────────────────────────────");

  // Osome stays in inbox — just gets labeled so triage picks it up as Urgent
  await createFilter(
    { from: "no-reply@osome.com" },
    tagOnly(compliance.id),
    "Osome compliance → Compliance label (stay in inbox)"
  );

  console.log();
  console.log("── Mailsuite ────────────────────────────────────────");

  await createFilter(
    { from: "daily-report@mailsuite.com" },
    skipInbox,
    "Mailsuite daily tracking report → skip inbox"
  );

  console.log();
  console.log("── Meta / Facebook Ads ──────────────────────────────");

  // Ad approval spam — volume is huge (30+ per weekend)
  await createFilter(
    { from: "noreply@business-updates.facebook.com", subject: "Your ad was approved" },
    skipInbox,
    "Meta: single ad approved → skip inbox"
  );
  await createFilter(
    { from: "noreply@business-updates.facebook.com", subject: "Your ads were approved" },
    skipInbox,
    "Meta: multiple ads approved → skip inbox"
  );
  // Meta receipts (subject: "Your Meta ads receipt") — NOT filtered, stay in inbox as financial records

  console.log();
  console.log("── IM8 Consumer Marketing ───────────────────────────");

  await createFilter(
    { from: "Care@im8health.com" },
    skipInbox,
    "IM8 consumer marketing → skip inbox"
  );

  console.log();
  console.log("── Newsletters ──────────────────────────────────────");

  const newsletters = [
    ["chew-on-this@mail.beehiiv.com", "Ron & Ash / Chew on This"],
    ["niceads@mail.beehiiv.com", "Nice Ads"],
    ["theperformers@mail.beehiiv.com", "The Performers"],
    ["niksharma@workweek.com", "Nik Sharma"],
    ["alex@adcrate.co", "AdCrate"],
    ["comms@wgsn.com", "WGSN"],
    ["robert@kaliber.asia", "Kaliber / Robert Lai"],
    ["findyourpeak@e.kajabimail.net", "One Peak Creative"],
    ["chew-on-this@mail.beehiiv.com", "Chew on This"],
  ];
  for (const [from, name] of newsletters) {
    await createFilter({ from }, skipInbox, `Newsletter: ${name} → skip inbox`);
  }

  console.log();
  console.log("── Conference Spam ──────────────────────────────────");

  await createFilter(
    { from: "LEAPEast@event.tahaluf.com" },
    skipInbox,
    "LEAP East → skip inbox"
  );
  await createFilter(
    { from: "team@awconf.com" },
    skipInbox,
    "Affiliate World → skip inbox"
  );

  console.log();
  console.log("── SaaS / Product Marketing ─────────────────────────");

  await createFilter({ from: "hello@fathom.video" }, skipInbox, "Fathom marketing → skip inbox");
  await createFilter({ from: "discover@pandadoc.com" }, skipInbox, "PandaDoc marketing → skip inbox");
  await createFilter({ from: "help@convertkit.com" }, skipInbox, "Kit product tips → skip inbox");
  await createFilter({ from: "help@kit.com" }, skipInbox, "Kit product tips → skip inbox");
  await createFilter({ from: "noreply@campaign.eventbrite.com" }, skipInbox, "Eventbrite → skip inbox");

  console.log();
  console.log("── Hotel / Loyalty ──────────────────────────────────");

  await createFilter(
    { from: "worldofhyatt@loyalty.hyatt.com" },
    skipInbox,
    "World of Hyatt → skip inbox"
  );
  await createFilter(
    { from: "news.all@mail.all.com" },
    skipInbox,
    "ALL Accor → skip inbox"
  );

  console.log();
  console.log("── Google Drive Share Requests ──────────────────────");

  // Generic share requests — skip inbox; @mention notifications from Sheets/Docs stay
  await createFilter(
    { from: "drive-shares-dm-noreply@google.com" },
    skipInbox,
    "Google Drive share requests → skip inbox"
  );

  console.log();
  console.log("✅ Done. Filters are live immediately in Gmail.\n");
  console.log("What stays in inbox (unchanged):");
  console.log("  • Airwallex OTPs (\"Your one-time passcode\")");
  console.log("  • Airwallex card failures (\"Card Payment Failed\")");
  console.log("  • Airwallex client deposits (non-Stripe)  → payment received label");
  console.log("  • Osome compliance messages               → Compliance label");
  console.log("  • Stashworks Xero invoices                → Halo/Logistics label");
  console.log("  • Meta ad receipts (financial records)");
  console.log("  • All real human-sent emails");
}

main().catch((err) => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});
