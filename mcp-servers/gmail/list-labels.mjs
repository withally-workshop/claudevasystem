import { google } from "googleapis";

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
  scopes: ["https://www.googleapis.com/auth/gmail.modify"],
  clientOptions: { subject: "noa@kravemedia.co" },
});
const gmail = google.gmail({ version: "v1", auth });
const res = await gmail.users.labels.list({ userId: "me" });
const labels = res.data.labels || [];

const userLabels = labels.filter(l => l.type === "user");

// Get message counts for each user label
const withCounts = await Promise.all(userLabels.map(async (l) => {
  const r = await gmail.users.labels.get({ userId: "me", id: l.id });
  return {
    id: l.id,
    name: l.name,
    total: r.data.messagesTotal || 0,
    unread: r.data.messagesUnread || 0,
  };
}));

withCounts.sort((a, b) => a.name.localeCompare(b.name));

console.log("USER LABELS — noa@kravemedia.co\n");
console.log("ID".padEnd(36) + "Name".padEnd(40) + "Total".padEnd(8) + "Unread");
console.log("─".repeat(90));
for (const l of withCounts) {
  console.log(l.id.padEnd(36) + l.name.padEnd(40) + String(l.total).padEnd(8) + l.unread);
}
console.log(`\nTotal user labels: ${withCounts.length}`);
