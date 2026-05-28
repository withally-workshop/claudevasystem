/**
 * Inbox cleanup round 2 — older emails
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

const ops = [
  // Needs-Reply — keep in inbox
  { id: "19e446ff2a58167c", add: ["Label_4", "Label_16"], remove: [] },         // Syaar — UGC creator inbound (typeform reply needed) + Creators-Inbound
  { id: "19e4447cedc9acff", add: ["Label_4"], remove: [] },                     // Ahmed — can't download slides, needs PPTX
  { id: "19e41d0227a98f2a", add: ["Label_4"], remove: [] },                     // Dojo Accounting — needs banking info for bill.com
  { id: "19e4123263d1a894", add: ["Label_4"], remove: [] },                     // Jilan Wise — Discord link request

  // FYI — label + archive
  { id: "19e443280e160b52", add: ["Label_5"], remove: ["INBOX", "UNREAD"] },    // Gemini — Krave Team Catch Up notes
  { id: "19e43703a3528b66", add: ["Label_5"], remove: ["INBOX", "UNREAD"] },    // Jilan Wise — "Sounds good, thanks" (resolved)
  { id: "19e433bc8507ac38", add: ["Label_5"], remove: ["INBOX", "UNREAD"] },    // EstheClinic — passed for now
  { id: "19e43e167a7fcd05", add: ["Label_5"], remove: ["INBOX", "UNREAD"] },    // EstheClinic — "appreciate the flexibility"
  { id: "19e4308ddf994375", add: ["Label_5"], remove: ["INBOX", "UNREAD"] },    // Amanda — "I'll get Noa on it" (escalated)

  // Auto-Sorted — label + archive
  { id: "19e44e32ca2796e8", add: ["Label_6"], remove: ["INBOX", "UNREAD"] },    // Ninja Van delivery
  { id: "19e43ee4ab158768", add: ["Label_6"], remove: ["INBOX", "UNREAD"] },    // Google Meet notes problem
  { id: "19e4379f11a7d73d", add: ["Label_6"], remove: ["INBOX", "UNREAD"] },    // SellUSeller product sync
  { id: "19e41604b12f1c67", add: ["Label_6"], remove: ["INBOX", "UNREAD"] },    // Insense — tool sales pitch
  { id: "19e4121a5ff5923c", add: ["Label_6"], remove: ["INBOX", "UNREAD"] },    // noreply contact form
  { id: "19e40f07925c8eb8", add: ["Label_6"], remove: ["INBOX", "UNREAD"] },    // Calendly — Ani Mishra (past event)
];

(async () => {
  let ok = 0, fail = 0;
  for (const { id, add, remove } of ops) {
    try {
      await gmail.users.messages.modify({
        userId: "me", id,
        requestBody: { addLabelIds: add, removeLabelIds: remove },
      });
      console.log(`✓ ${id}`);
      ok++;
    } catch (e) {
      console.error(`✗ ${id}: ${e.message}`);
      fail++;
    }
  }
  console.log(`\nDone. ${ok} ok, ${fail} failed.`);
})();
