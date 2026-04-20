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
  scopes: ["https://www.googleapis.com/auth/gmail.modify"],
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
  {
    name: "gmail_send",
    description:
      "Send an email or reply to an existing thread from the impersonated Gmail account. To reply in-thread, provide thread_id and in_reply_to_message_id (Gmail message ID of the message you're replying to).",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address(es), comma-separated" },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Plain text email body" },
        thread_id: { type: "string", description: "Gmail thread ID to reply into (from gmail_get_message)" },
        in_reply_to_message_id: { type: "string", description: "Gmail message ID of the message being replied to — used to set In-Reply-To header for proper threading" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "gmail_download_attachment",
    description:
      "Download a specific attachment from a Gmail message. Returns the file content as a base64 string. Use gmail_get_message first to get the attachment_id and filename. Supports PDF invoices.",
    inputSchema: {
      type: "object",
      properties: {
        message_id: {
          type: "string",
          description: "The Gmail message ID containing the attachment",
        },
        attachment_id: {
          type: "string",
          description: "The attachment ID (from gmail_get_message results)",
        },
        filename: {
          type: "string",
          description: "The attachment filename (for reference in output)",
        },
      },
      required: ["message_id", "attachment_id"],
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
        attachment_id: part.body?.attachmentId || null,
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
        thread_id: res.data.threadId,
        subject: getHeader(headers, "Subject"),
        from: getHeader(headers, "From"),
        to: getHeader(headers, "To"),
        date: getHeader(headers, "Date"),
        body: bodyText.slice(0, 3000),
        attachments,
        labelIds: res.data.labelIds || [],
      };
    }

    case "gmail_send": {
      let inReplyToHeader = "";
      let referencesHeader = "";

      if (args.in_reply_to_message_id) {
        const orig = await gmail.users.messages.get({
          userId: "me",
          id: args.in_reply_to_message_id,
          format: "metadata",
          metadataHeaders: ["Message-ID", "References"],
        });
        const msgId = getHeader(orig.data.payload?.headers || [], "Message-ID");
        const refs = getHeader(orig.data.payload?.headers || [], "References");
        if (msgId) {
          inReplyToHeader = `In-Reply-To: ${msgId}\r\n`;
          referencesHeader = `References: ${refs ? refs + " " : ""}${msgId}\r\n`;
        }
      }

      const from = IMPERSONATE_EMAIL;
      const mime = [
        `From: ${from}`,
        `To: ${args.to}`,
        `Subject: ${args.subject}`,
        "Content-Type: text/plain; charset=UTF-8",
        inReplyToHeader.trimEnd(),
        referencesHeader.trimEnd(),
        "",
        args.body,
      ]
        .filter((l) => l !== "")
        .join("\r\n");

      const raw = Buffer.from(mime).toString("base64url");
      // Auto-derive thread_id from in_reply_to message if not explicitly provided
      let threadId = args.thread_id;
      if (!threadId && args.in_reply_to_message_id) {
        const origFull = await gmail.users.messages.get({
          userId: "me",
          id: args.in_reply_to_message_id,
          format: "minimal",
        });
        threadId = origFull.data.threadId;
      }

      const sendParams = { userId: "me", requestBody: { raw } };
      if (threadId) sendParams.requestBody.threadId = threadId;

      const sent = await gmail.users.messages.send(sendParams);
      return { message_id: sent.data.id, thread_id: sent.data.threadId, status: "sent" };
    }

    case "gmail_download_attachment": {
      const res = await gmail.users.messages.attachments.get({
        userId: "me",
        messageId: args.message_id,
        id: args.attachment_id,
      });
      return {
        filename: args.filename || "attachment",
        mimeType: res.data.size ? "application/octet-stream" : "unknown",
        size: res.data.size || 0,
        data: res.data.data, // base64url-encoded content
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
