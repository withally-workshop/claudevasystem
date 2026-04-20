import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const TOKEN = process.env.SLACK_BOT_TOKEN;
if (!TOKEN) {
  console.error("Missing SLACK_BOT_TOKEN");
  process.exit(1);
}

const BASE = "https://slack.com/api";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, "state.json");

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function slackGet(method, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}/${method}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API error (${method}): ${data.error}`);
  return data;
}

async function slackPost(method, body) {
  const res = await fetch(`${BASE}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack API error (${method}): ${data.error}`);
  return data;
}

// ─── Tool Definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "slack_list_channels",
    description: "List public channels in the Slack workspace.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max channels to return (default 100)" },
        cursor: { type: "string", description: "Pagination cursor" },
      },
    },
  },
  {
    name: "slack_get_channel_history",
    description:
      "Fetch messages from a Slack channel. Pass `oldest` (Unix timestamp) to only retrieve messages after that point — avoids re-reading already-processed messages.",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string", description: "Channel ID e.g. C09HN2EBPR7" },
        limit: { type: "number", description: "Max messages (default 50)" },
        oldest: { type: "string", description: "Only return messages after this Unix timestamp e.g. '1713500000.000000'" },
        latest: { type: "string", description: "Only return messages before this Unix timestamp" },
      },
      required: ["channel_id"],
    },
  },
  {
    name: "slack_get_thread_replies",
    description: "Get all replies in a Slack thread.",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string" },
        thread_ts: { type: "string", description: "Timestamp of the parent message" },
      },
      required: ["channel_id", "thread_ts"],
    },
  },
  {
    name: "slack_post_message",
    description: "Post a message to a Slack channel.",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string" },
        text: { type: "string" },
      },
      required: ["channel_id", "text"],
    },
  },
  {
    name: "slack_reply_to_thread",
    description: "Reply to an existing Slack thread.",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string" },
        thread_ts: { type: "string" },
        text: { type: "string" },
      },
      required: ["channel_id", "thread_ts", "text"],
    },
  },
  {
    name: "slack_add_reaction",
    description: "Add an emoji reaction to a Slack message.",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string" },
        timestamp: { type: "string", description: "Message timestamp" },
        reaction: { type: "string", description: "Emoji name without colons e.g. white_check_mark" },
      },
      required: ["channel_id", "timestamp", "reaction"],
    },
  },
  {
    name: "slack_get_users",
    description: "List users in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        cursor: { type: "string" },
      },
    },
  },
  {
    name: "slack_get_user_profile",
    description: "Get profile information for a Slack user.",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "Slack user ID e.g. U06TBGX9L93" },
      },
      required: ["user_id"],
    },
  },
  {
    name: "slack_download_file",
    description:
      "Download a Slack file attachment to a local path. Use this when a strategist attaches an invoice PDF to a Slack message. Returns the local file path for use with airwallex_upload_bill_document.",
    inputSchema: {
      type: "object",
      properties: {
        file_id: { type: "string", description: "Slack file ID from message attachments e.g. F123ABC" },
        dest_path: { type: "string", description: "Absolute local path to save the file e.g. C:/Users/jopso/Desktop/claude-ea/temp/invoice.pdf" },
      },
      required: ["file_id", "dest_path"],
    },
  },
  {
    name: "slack_get_last_read",
    description:
      "Get the last-read Slack timestamp for a channel. Returns a Unix timestamp string or null if never set. Use this as `oldest` in slack_get_channel_history to avoid re-processing old messages.",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string", description: "Channel ID e.g. C09HN2EBPR7" },
      },
      required: ["channel_id"],
    },
  },
  {
    name: "slack_set_last_read",
    description:
      "Save the last-read Slack timestamp for a channel. Call this after successfully processing a batch of messages, passing the `ts` of the newest message processed.",
    inputSchema: {
      type: "object",
      properties: {
        channel_id: { type: "string", description: "Channel ID e.g. C09HN2EBPR7" },
        ts: { type: "string", description: "Unix timestamp of the newest message processed e.g. '1713500000.000000'" },
      },
      required: ["channel_id", "ts"],
    },
  },
];

// ─── Tool Handlers ────────────────────────────────────────────────────────────

async function handleTool(name, args) {
  switch (name) {
    case "slack_list_channels": {
      const params = { types: "public_channel", exclude_archived: "true" };
      if (args.limit) params.limit = args.limit;
      if (args.cursor) params.cursor = args.cursor;
      return await slackGet("conversations.list", params);
    }

    case "slack_get_channel_history": {
      const params = { channel: args.channel_id, limit: args.limit || 50 };
      if (args.oldest) params.oldest = args.oldest;
      if (args.latest) params.latest = args.latest;
      return await slackGet("conversations.history", params);
    }

    case "slack_get_thread_replies": {
      return await slackGet("conversations.replies", {
        channel: args.channel_id,
        ts: args.thread_ts,
      });
    }

    case "slack_post_message": {
      return await slackPost("chat.postMessage", {
        channel: args.channel_id,
        text: args.text,
      });
    }

    case "slack_reply_to_thread": {
      return await slackPost("chat.postMessage", {
        channel: args.channel_id,
        thread_ts: args.thread_ts,
        text: args.text,
      });
    }

    case "slack_add_reaction": {
      return await slackPost("reactions.add", {
        channel: args.channel_id,
        timestamp: args.timestamp,
        name: args.reaction,
      });
    }

    case "slack_get_users": {
      const params = {};
      if (args.limit) params.limit = args.limit;
      if (args.cursor) params.cursor = args.cursor;
      return await slackGet("users.list", params);
    }

    case "slack_get_user_profile": {
      return await slackGet("users.profile.get", { user: args.user_id });
    }

    case "slack_download_file": {
      const info = await slackGet("files.info", { file: args.file_id });
      const url = info.file?.url_private_download;
      if (!url) throw new Error(`No download URL for file ${args.file_id}`);

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      if (!res.ok) throw new Error(`Failed to download file: ${res.status}`);

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

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "slack", version: "1.0.0" },
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
console.error("Slack MCP server running");
