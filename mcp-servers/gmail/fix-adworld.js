import { google } from "googleapis";
const auth = new google.auth.GoogleAuth({
  keyFile: "C:\\Users\\jopso\\Downloads\\krave-ea-4ceace6542ec.json",
  scopes: ["https://www.googleapis.com/auth/gmail.modify"],
  clientOptions: { subject: "noa@kravemedia.co" }
});
const gmail = google.gmail({ version: "v1", auth });
// Restore INBOX to Ahmed's message so the thread surfaces at the top
gmail.users.messages.modify({
  userId: "me", id: "19e5e1452611b4c2",
  requestBody: { addLabelIds: ["INBOX"] }
}).then(() => console.log("✓ Ad World Prime thread restored to inbox top")).catch(e => console.error(e.message));
