/**
 * Targeted fixes for inbox cleanup issues
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

async function modify(id, add, remove, label) {
  await gmail.users.messages.modify({ userId: "me", id, requestBody: { addLabelIds: add, removeLabelIds: remove } });
  console.log(`✓ ${label} (${id})`);
}

(async () => {
  // 1. Restore May 25 priority emails to inbox (were archived by previous broken workflow run)
  await modify("19e5d436ba3e66f3", ["INBOX"], [], "Ani Mishra $10K → back to inbox");
  await modify("19e5ca7219ff23cf", ["INBOX"], [], "Shin Halo Home invite → back to inbox");

  // 2. ClickUp [Overdue] — was wrongly set to EA/Urgent by old broken run → fix to Auto-Sorted
  await modify("19e506dfc55e6088", ["Label_6"], ["Label_3", "INBOX"], "ClickUp Overdue → Auto-Sorted, archive");

  // 3. Kit weekly digest — EA/Unsure → Auto-Sorted
  await modify("19e52c9822e9b9e5", ["Label_6"], ["Label_7", "INBOX"], "Kit digest → Auto-Sorted, archive");

  // 4. Strip Creators-Inbound (Label_16) from Ahmed/Ad World Prime thread messages that got it wrongly
  //    The thread has the label because of Gmail filter — remove from the two visible messages
  await modify("19e5e1452611b4c2", [], ["Label_16"], "Ahmed Ad World Prime → remove Creators-Inbound");
  await modify("19e4447cedc9acff", [], ["Label_16"], "Ahmed older message → remove Creators-Inbound");
  await modify("19e451a764603004", [], ["Label_16"], "Ahmed oldest message → remove Creators-Inbound");

  // 5. Strip Creators-Inbound from john's Blitzscale invoice (wrong label)
  await modify("19e5daceff791d4a", [], ["Label_16"], "john Blitzscale invoice → remove Creators-Inbound");

  // 6. IM8 invoice (john automated followup) in EA/Needs-Reply — should be FYI, archive
  await modify("19e5cdc5da15509a", ["Label_5"], ["Label_4", "INBOX"], "IM8 invoice followup → FYI, archive");

  // 7. Shin Halo Home invite — keep EA/Needs-Reply but confirm it's in inbox (handled above by restore)

  console.log("\nAll fixes done.");
})().catch(e => console.error(e));
