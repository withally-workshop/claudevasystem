import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";

const KEY_FILE = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
const IMPERSONATE_EMAIL = process.env.GMAIL_IMPERSONATE_EMAIL || "john@kravemedia.co";

if (!KEY_FILE) {
  console.error("Missing GOOGLE_SERVICE_ACCOUNT_KEY_FILE env var");
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE,
  scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  clientOptions: { subject: IMPERSONATE_EMAIL },
});

const gmail = google.gmail({ version: "v1", auth });

// ─── Tool Definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "gmail_search_messages",
    description:
      "Search Gmail inbox by query. Returns message summaries (ID, subject, sender, date, snippet). Use to find invoice emails from creators.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Gmail search query, e.g. 'subject:invoice has:attachment newer_than:7d' or 'from:creator@example.com'",
        },
        max_results: {
          type: "number",
          description: "Maximum number of messages to return (default: 20, max: 50)",
          default: 20,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "gmail_get_message",
    description:
      "Get the full content of a specific Gmail message — body text, attachment filenames, sender, date. Use after gmail_search_messages to read an invoice email in detail.",
    inputSchema: {
      type: "object",
      properties: {
        message_id: {
          type: "string",
          description: "The Gmail message ID (from gmail_search_messages results)",
        },
      },
      required: ["message_id"],
    },
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function decodeBase64(str) {
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

function extractTextFromParts(parts) {
  if (!parts) return "";
  let text = "";
  for (const part of parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      text += decodeBase64(part.body.data) + "\n";
    } else if (part.parts) {
      text += extractTextFromParts(part.parts);
    }
  }
  return text.trim();
}

function extractAttachments(parts) {
  if (!parts) return [];
  const attachments = [];
  for (const part of parts) {
    if (part.filename && part.filename.length > 0) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType,
        size: part.body?.size || 0,
      });
    }
    if (part.parts) {
      attachments.push(...extractAttachments(part.parts));
    }
  }
  return attachments;
}

function getHeader(headers, name) {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

// ─── Tool Handlers ────────────────────────────────────────────────────────────

async function handleTool(name, args) {
  switch (name) {
    case "gmail_search_messages": {
      const maxResults = Math.min(args.max_results || 20, 50);
      const listRes = await gmail.users.messages.list({
        userId: "me",
        q: args.query,
        maxResults,
      });

      const messages = listRes.data.messages || [];
      if (messages.length === 0) return { messages: [], total: 0 };

      // Fetch basic metadata for each message in parallel
      const details = await Promise.all(
        messages.map((m) =>
          gmail.users.messages.get({
            userId: "me",
            id: m.id,
            format: "metadata",
            metadataHeaders: ["Subject", "From", "Date"],
          })
        )
      );

      return {
        messages: details.map((d) => ({
          id: d.data.id,
          subject: getHeader(d.data.payload?.headers, "Subject"),
          from: getHeader(d.data.payload?.headers, "From"),
          date: getHeader(d.data.payload?.headers, "Date"),
          snippet: d.data.snippet || "",
        })),
        total: messages.length,
      };
    }

    case "gmail_get_message": {
      const res = await gmail.users.messages.get({
        userId: "me",
        id: args.message_id,
        format: "full",
      });

      const payload = res.data.payload;
      const headers = payload?.headers || [];

      let bodyText = "";
      if (payload?.body?.data) {
        bodyText = decodeBase64(payload.body.data);
      } else if (payload?.parts) {
        bodyText = extractTextFromParts(payload.parts);
      }

      const attachments = extractAttachments(payload?.parts || []);

      return {
        id: res.data.id,
        subject: getHeader(headers, "Subject"),
        from: getHeader(headers, "From"),
        to: getHeader(headers, "To"),
        date: getHeader(headers, "Date"),
        body: bodyText.slice(0, 3000), // cap to avoid huge emails
        attachments,
        labelIds: res.data.labelIds || [],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "gmail", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, args || {});
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Gmail MCP server running — impersonating:", IMPERSONATE_EMAIL);
