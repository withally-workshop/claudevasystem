import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, "state.json");

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return {}; }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const TOOLS = [
  {
    name: "slack_download_file",
    description: "Download a Slack file attachment (invoice PDF) to a local path. Returns the local file path for use with airwallex_upload_bill_document.",
    inputSchema: {
      type: "object",
      properties: {
        file_id: { type: "string", description: "Slack file ID from message file attachments e.g. F123ABC" },
        dest_path: { type: "string", description: "Absolute local path to save the file e.g. C:/Users/jopso/Desktop/claude-ea/temp/invoice.pdf" },
      },
      required: ["file_id", "dest_path"],
    },
  },
  {
    name: "slack_get_last_read",
    description: "Get the saved last-read timestamp for a Slack channel. Returns Unix timestamp string or null. Pass the result as `oldest` to slack_get_channel_history to skip already-processed messages.",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string", description: "Slack channel ID e.g. C09HN2EBPR7" },
      },
      required: ["channel_id"],
    },
  },
  {
    name: "slack_set_last_read",
    description: "Save the last-read timestamp for a Slack channel. Call after processing a batch, passing the ts of the newest message handled.",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string", description: "Slack channel ID e.g. C09HN2EBPR7" },
        ts: { type: "string", description: "Unix timestamp of the newest message processed e.g. 1713500000.000000" },
      },
      required: ["channel_id", "ts"],
    },
  },
];

async function handleTool(name, args) {
  switch (name) {
    case "slack_download_file": {
      if (!SLACK_TOKEN) throw new Error("SLACK_BOT_TOKEN not set");
      const infoRes = await fetch(`https://slack.com/api/files.info?file=${args.file_id}`, {
        headers: { Authorization: `Bearer ${SLACK_TOKEN}` },
      });
      const info = await infoRes.json();
      if (!info.ok) throw new Error(`Slack files.info error: ${info.error}`);
      const url = info.file?.url_private_download;
      if (!url) throw new Error(`No download URL for file ${args.file_id}`);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${SLACK_TOKEN}` } });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const dir = path.dirname(args.dest_path);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(args.dest_path, buffer);
      return { success: true, local_path: args.dest_path, size_bytes: buffer.length };
    }
    case "slack_get_last_read": {
      const state = loadState();
      return { ts: state[args.channel_id] || null };
    }
    case "slack_set_last_read": {
      const state = loadState();
      state[args.channel_id] = args.ts;
      saveState(state);
      return { success: true, channel_id: args.channel_id, ts: args.ts };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server(
  { name: "krave-tools", version: "1.0.0" },
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
console.error("Krave Tools MCP server running");
