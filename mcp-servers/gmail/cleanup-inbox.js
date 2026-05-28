/**
 * One-time inbox cleanup — noa@kravemedia.co
 * Applies EA/* labels and archives noise. Run once:
 *   node cleanup-inbox.js
 */

import { google } from "googleapis";

const KEY_FILE = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || "C:\\Users\\jopso\\Downloads\\krave-ea-4ceace6542ec.json";
const USER = "noa@kravemedia.co";

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE,
  scopes: ["https://www.googleapis.com/auth/gmail.modify"],
  clientOptions: { subject: USER },
});
const gmail = google.gmail({ version: "v1", auth });

const LABEL_NEEDS_REPLY = "Label_4";
const LABEL_FYI         = "Label_5";
const LABEL_AUTO_SORTED = "Label_6";

// ── Keep in inbox (EA/Needs-Reply) ────────────────────────────────────────────
const NEEDS_REPLY = [
  "19e5053a518f8376", // Cody/TooHi — asking for referral to cheaper firm
  "19e4d67438165131", // Lucas (Wonderbiotics) — media buying questions
  "19e4d61755e5be0d", // Joseph Siegel — Zenwise intro, needs Noa to connect Rene
  "19e4d4e2914450c5", // Roshni/Cashew — reschedule to next Thursday
  "19e4d7b70be83f1a", // Amanda — Nancy influencer invoice approved, needs processing
];

// ── Label + archive (EA/FYI) ──────────────────────────────────────────────────
const FYI = [
  "19e5e1452611b4c2", // Ahmed Mushtaq — masterclass confirmed, FYI
  "19e5daceff791d4a", // john@ — Blitzscale invoice FYA
  "19e5d2a2aeed6f34", // WelleCo — finalising payment (John handles)
  "19e5cfab00073bc3", // Joseph x Lucas intro thread
  "19e5cdc5b3479e96", // john@ — WELLE invoice followup FYA
  "19e5ccf65de9e16b", // Lucas — Joseph x Lucas reply
  "19e5c38235754ff4", // john@ — Halo Intelligence May 25
  "19e5239ee7c73a72", // john@ — Halo Intelligence May 23
  "19e584ea9da60814", // Joseph — Joseph x Lucas cal.com link
  "19e4ed39d6f1e2ad", // john@ — StashAway invoice FYA 0002
  "19e4ecec0cf46b15", // Lucas — Joseph x Lucas
  "19e4ebde8dce45ac", // Lucas — Noa x Lucas WeChat
  "19e4dc9fb05edd19", // john@ — StashAway invoice FYA 0001
  "19e4d82fa7cc2369", // Amanda — Superpower FYA invoice
  "19e4cfbb98a0e732", // Stashworks — warehouse charge revision Jun 22
  "19e4b3141fa5bf44", // Lucas — "thanks for sharing"
  "19e4a31a7f93a418", // Gemini — Adrian x Noa meeting notes
  "19e4a229fa554b03", // Joanna (Clear Aligners) — "I'll speed up payment"
  "19e4a1c3c95821dc", // john@ — Clear Aligners invoice followup
  "19e4a184f11d2750", // Joanna — "can't open link" (John handled)
  "19e4a032dc2a5936", // Bing/Airwallex — "will reach out to John"
  "19e499a5a8c7a4d6", // Gemini — Lucas x Noa meeting notes
  "19e4ed3da5e8fb9f", // Gemini — Noa x Ani meeting notes
  "19e451a764603004", // Ahmed Mushtaq — "Amazing! Thanks"
  "19e450ee3cdc9289", // American Express — fraud monitoring notice
  "19e4509a7c250b61", // Roshni — "Let's do Friday morning?" (handled by John)
  "19e4918ab9589c47", // Roshni — "Great - thank you!"
  "19e49085b788b51b", // john@ — Cashew confirming calendar invite
  "19e465e350de821b", // Dojo Accounting — invite sent
  "19e465da6fe7a2d7", // For Youth/BILL — wants to pay (already resolved)
  "19e465da645ca826", // For Youth/BILL — duplicate
  "19e494e5070d7517", // BILL — thanks for adding payment info
];

// ── Label + archive (EA/Auto-Sorted) ─────────────────────────────────────────
const AUTO_SORTED = [
  "19e5c382bd0e1653", // Ron & Ash newsletter
  "19e5c0453777bbbc", // Nik Sharma newsletter
  "19e5bc826590bb98", // The Performers newsletter
  "19e5b6b061e44bee", // IM8 "What To Expect"
  "19e511e59aa6b95f", // IM8 "Why Settle"
  "19e5078ab83037fb", // Robert Lai/Kaliber newsletter
  "19e56308ab351387", // Calendly — Yvette Jones booking
  "19e4fff4cca97dda", // IM8 "Giannis bottle" marketing
  "19e4ee40980f1c55", // Gary HUI — updated past invite
  "19e49c3884c3142a", // Adrian Waga — calendar accept
  "19e497fa18fc3f24", // Google Drive share noreply
  "19e4889d99178d2d", // Mehdi — cal.com booking confirmation
  "19e44f6646ff0c5b", // Roshni contact form (noreply, already in system)
];

async function modifyMessage(id, addLabels, removeLabels) {
  await gmail.users.messages.modify({
    userId: "me",
    id,
    requestBody: {
      addLabelIds: addLabels,
      removeLabelIds: removeLabels,
    },
  });
}

(async () => {
  let ok = 0, fail = 0;

  for (const id of NEEDS_REPLY) {
    try {
      await modifyMessage(id, [LABEL_NEEDS_REPLY], []);
      console.log(`✓ Needs-Reply: ${id}`);
      ok++;
    } catch (e) {
      console.error(`✗ ${id}: ${e.message}`);
      fail++;
    }
  }

  for (const id of FYI) {
    try {
      await modifyMessage(id, [LABEL_FYI], ["INBOX", "UNREAD"]);
      console.log(`✓ FYI+archive: ${id}`);
      ok++;
    } catch (e) {
      console.error(`✗ ${id}: ${e.message}`);
      fail++;
    }
  }

  for (const id of AUTO_SORTED) {
    try {
      await modifyMessage(id, [LABEL_AUTO_SORTED], ["INBOX", "UNREAD"]);
      console.log(`✓ Auto-Sorted+archive: ${id}`);
      ok++;
    } catch (e) {
      console.error(`✗ ${id}: ${e.message}`);
      fail++;
    }
  }

  console.log(`\nDone. ${ok} succeeded, ${fail} failed.`);
})();
