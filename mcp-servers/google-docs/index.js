import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";

// Auth — service account with domain-wide delegation, impersonating a Workspace
// user (mirrors the gmail server). Accepts either a key file path or inline JSON.
const KEY_FILE = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
const KEY_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
const IMPERSONATE_EMAIL = process.env.DOCS_IMPERSONATE_EMAIL || "john@kravemedia.co";

if (!KEY_FILE && !KEY_JSON) {
  console.error("Missing GOOGLE_SERVICE_ACCOUNT_KEY_FILE or GOOGLE_SERVICE_ACCOUNT_KEY env var");
  process.exit(1);
}

const SCOPES = ["https://www.googleapis.com/auth/documents"];

let authOptions;
if (KEY_FILE) {
  authOptions = { keyFile: KEY_FILE, scopes: SCOPES, clientOptions: { subject: IMPERSONATE_EMAIL } };
} else {
  let creds;
  try {
    creds = JSON.parse(KEY_JSON);
  } catch {
    console.error("GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON");
    process.exit(1);
  }
  authOptions = { credentials: creds, scopes: SCOPES, clientOptions: { subject: IMPERSONATE_EMAIL } };
}

const auth = new google.auth.GoogleAuth(authOptions);
const docs = google.docs({ version: "v1", auth });

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Flatten a documents.get response into plain text (paragraphs + table cells).
function extractText(doc) {
  let text = "";
  const walk = (content) => {
    for (const el of content || []) {
      if (el.paragraph) {
        for (const pe of el.paragraph.elements || []) {
          if (pe.textRun?.content) text += pe.textRun.content;
        }
      } else if (el.table) {
        for (const row of el.table.tableRows || []) {
          for (const cell of row.tableCells || []) {
            walk(cell.content);
          }
        }
      }
    }
  };
  walk(doc.body?.content);
  return text;
}

// End index of the body (the position of the mandatory trailing newline + 1).
function bodyEndIndex(doc) {
  const content = doc.body?.content || [];
  let end = 1;
  for (const el of content) {
    if (typeof el.endIndex === "number") end = el.endIndex;
  }
  return end;
}

// ─── Tool Definitions ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "docs_get",
    description:
      "Read a Google Doc's plain-text content. Returns the title, text, and bodyEndIndex. Use before overwriting so you know the current content.",
    inputSchema: {
      type: "object",
      properties: {
        document_id: {
          type: "string",
          description: "The Google Doc ID (from the URL: /document/d/<ID>/edit)",
        },
      },
      required: ["document_id"],
    },
  },
  {
    name: "docs_replace_all_text",
    description:
      "Find and replace every occurrence of a string in a Google Doc. Best for surgical edits (a price, a status line) without touching the rest of the doc.",
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "The Google Doc ID" },
        find: { type: "string", description: "Exact text to find" },
        replace: { type: "string", description: "Replacement text" },
        match_case: {
          type: "boolean",
          description: "Case-sensitive match (default true)",
          default: true,
        },
      },
      required: ["document_id", "find", "replace"],
    },
  },
  {
    name: "docs_append",
    description: "Append plain text to the end of a Google Doc's body.",
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "The Google Doc ID" },
        text: {
          type: "string",
          description: "Text to append (start with \\n for a new line)",
        },
      },
      required: ["document_id", "text"],
    },
  },
  {
    name: "docs_overwrite",
    description:
      "Replace the ENTIRE body of a Google Doc with new plain text. Clears existing content first, keeping the same file and link. Use to update a doc in place.",
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "The Google Doc ID" },
        text: { type: "string", description: "The full new body text" },
      },
      required: ["document_id", "text"],
    },
  },
  {
    name: "docs_insert_text",
    description:
      "Insert plain text at a specific character index in the body (index 1 = start of body).",
    inputSchema: {
      type: "object",
      properties: {
        document_id: { type: "string", description: "The Google Doc ID" },
        index: {
          type: "number",
          description: "1-based index to insert at (1 = start of body)",
        },
        text: { type: "string", description: "Text to insert" },
      },
      required: ["document_id", "index", "text"],
    },
  },
];

// ─── Tool Handlers ────────────────────────────────────────────────────────────

async function handleTool(name, args) {
  switch (name) {
    case "docs_get": {
      const res = await docs.documents.get({ documentId: args.document_id });
      const doc = res.data;
      return {
        title: doc.title,
        documentId: doc.documentId,
        text: extractText(doc),
        bodyEndIndex: bodyEndIndex(doc),
      };
    }

    case "docs_replace_all_text": {
      const res = await docs.documents.batchUpdate({
        documentId: args.document_id,
        requestBody: {
          requests: [
            {
              replaceAllText: {
                containsText: {
                  text: args.find,
                  matchCase: args.match_case !== false,
                },
                replaceText: args.replace,
              },
            },
          ],
        },
      });
      return {
        occurrencesChanged:
          res.data.replies?.[0]?.replaceAllText?.occurrencesChanged || 0,
      };
    }

    case "docs_append": {
      const getRes = await docs.documents.get({ documentId: args.document_id });
      const insertAt = Math.max(1, bodyEndIndex(getRes.data) - 1);
      await docs.documents.batchUpdate({
        documentId: args.document_id,
        requestBody: {
          requests: [{ insertText: { location: { index: insertAt }, text: args.text } }],
        },
      });
      return { appended: true, insertedAt: insertAt, chars: args.text.length };
    }

    case "docs_overwrite": {
      const getRes = await docs.documents.get({ documentId: args.document_id });
      const endIndex = bodyEndIndex(getRes.data);
      const requests = [];
      // Delete everything except the body's mandatory trailing newline.
      if (endIndex > 2) {
        requests.push({
          deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } },
        });
      }
      requests.push({ insertText: { location: { index: 1 }, text: args.text } });
      await docs.documents.batchUpdate({
        documentId: args.document_id,
        requestBody: { requests },
      });
      return { overwritten: true, chars: args.text.length };
    }

    case "docs_insert_text": {
      await docs.documents.batchUpdate({
        documentId: args.document_id,
        requestBody: {
          requests: [{ insertText: { location: { index: args.index }, text: args.text } }],
        },
      });
      return { inserted: true, index: args.index, chars: args.text.length };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP Server ────────────────────────────────────────────────────────────────

const server = new Server(
  { name: "google-docs", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await handleTool(name, args || {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Google Docs MCP server running (impersonating ${IMPERSONATE_EMAIL})`);
