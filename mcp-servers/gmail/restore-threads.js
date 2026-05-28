/**
 * Restore threads that were wrongly archived — label stays, INBOX comes back
 */
import { google } from "googleapis";
const auth = new google.auth.GoogleAuth({
  keyFile: "C:\\Users\\jopso\\Downloads\\krave-ea-4ceace6542ec.json",
  scopes: ["https://www.googleapis.com/auth/gmail.modify"],
  clientOptions: { subject: "noa@kravemedia.co" }
});
const gmail = google.gmail({ version: "v1", auth });

const THREADS_TO_RESTORE = [
  // WelleCo invoice thread
  { id: "19e5d2a2aeed6f34", label: "WelleCo payment confirm" },
  // Joseph x Lucas intro thread (Noa facilitated)
  { id: "19e5cfab00073bc3", label: "Joseph x Lucas thread (1)" },
  { id: "19e5ccf65de9e16b", label: "Joseph x Lucas thread (2)" },
  { id: "19e584ea9da60814", label: "Joseph x Lucas thread (3)" },
  { id: "19e4ecec0cf46b15", label: "Joseph x Lucas thread (4)" },
  { id: "19e4ebde8dce45ac", label: "Noa x Lucas WeChat" },
  // Clear Aligners invoice thread
  { id: "19e4a229fa554b03", label: "Clear Aligners Joanna (1)" },
  { id: "19e4a184f11d2750", label: "Clear Aligners Joanna (2)" },
  // Airwallex feedback thread
  { id: "19e4a032dc2a5936", label: "Bing Airwallex thread" },
  // Cashew older thread messages
  { id: "19e4509a7c250b61", label: "Roshni Cashew older" },
  { id: "19e4918ab9589c47", label: "Roshni Cashew reply" },
  { id: "19e49085b788b51b", label: "john Cashew confirm" },
  // EstheClinic thread
  { id: "19e43e167a7fcd05", label: "EstheClinic (1)" },
  { id: "19e433bc8507ac38", label: "EstheClinic (2)" },
  // Dojo Accounting thread
  { id: "19e465e350de821b", label: "Dojo Accounting" },
  // Jilan Discord thread
  { id: "19e43703a3528b66", label: "Jilan Discord reply" },
  // Amanda Superpower FYA (internal thread)
  { id: "19e4d82fa7cc2369", label: "Amanda Superpower FYA" },
];

(async () => {
  let ok = 0;
  for (const { id, label } of THREADS_TO_RESTORE) {
    try {
      await gmail.users.messages.modify({ userId: "me", id, requestBody: { addLabelIds: ["INBOX"] } });
      console.log(`✓ ${label}`);
      ok++;
    } catch (e) {
      console.error(`✗ ${label}: ${e.message}`);
    }
  }
  console.log(`\n${ok}/${THREADS_TO_RESTORE.length} restored.`);
})();
