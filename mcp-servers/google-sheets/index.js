import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { google } from "googleapis";

// Auth — accepts either a file path or inline JSON
const KEY_FILE = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
const KEY_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

if (!KEY_FILE && !KEY_JSON) {
  console.error("Missing GOOGLE_SERVICE_ACCOUNT_KEY_FILE or GOOGLE_SERVICE_ACCOUNT_KEY env var");
  process.exit(1);
}

let authOptions;
if (KEY_FILE) {
  authOptions = { keyFile: KEY_FILE, scopes: ["https://www.googleapis.com/auth/spreadsheets"] };
} else {
  let creds;
  try { creds = JSON.parse(KEY_JSON); } catch {
    console.error("GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON");
    process.exit(1);
  }
  authOptions = { credentials: creds, scopes: ["https://www.googleapis.com/auth/spreadsheets"] };
}

const auth = new google.auth.GoogleAuth(authOptions);

const sheets = google.sheets({ version: "v4", auth });

// ─── Tool Definitions ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "sheets_append_row",
    description:
      "Append a new row to the end of a Google Sheet. Use for logging invoice entries to the tracker.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "The Google Sheets spreadsheet ID (from the URL)",
        },
        sheet_name: {
          type: "string",
          description: "Sheet tab name (e.g. 'Sheet1'). Defaults to first sheet if omitted.",
          default: "Sheet1",
        },
        values: {
          type: "array",
          description: "Array of cell values for the row, in column order (A, B, C...)",
          items: { type: "string" },
        },
      },
      required: ["spreadsheet_id", "values"],
    },
  },
  {
    name: "sheets_get_rows",
    description:
      "Read rows from a Google Sheet. Returns all rows in the specified range.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "The Google Sheets spreadsheet ID",
        },
        range: {
          type: "string",
          description: "A1 notation range, e.g. 'Sheet1!A1:L100' or 'Sheet1' for all data",
        },
      },
      required: ["spreadsheet_id", "range"],
    },
  },
  {
    name: "sheets_update_row",
    description:
      "Update specific cells in an existing row. Use to update Airwallex status or flags on an existing invoice entry.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "The Google Sheets spreadsheet ID",
        },
        range: {
          type: "string",
          description: "A1 notation range for the cell(s) to update, e.g. 'Sheet1!H5' or 'Sheet1!H5:L5'",
        },
        values: {
          type: "array",
          description: "2D array of values — outer array = rows, inner array = columns. For a single row: [[val1, val2, ...]]",
          items: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
      required: ["spreadsheet_id", "range", "values"],
    },
  },
  {
    name: "sheets_list_sheets",
    description:
      "List all sheet tab names in a Google Sheets spreadsheet. Use this at the start of any workflow to discover available tabs before reading them.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "The Google Sheets spreadsheet ID (from the URL)",
        },
      },
      required: ["spreadsheet_id"],
    },
  },
  {
    name: "sheets_find_row",
    description:
      "Search a column for a value and return the matching row number. Use to locate an existing invoice entry before updating it.",
    inputSchema: {
      type: "object",
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "The Google Sheets spreadsheet ID",
        },
        sheet_name: {
          type: "string",
          description: "Sheet tab name (e.g. 'Sheet1')",
          default: "Sheet1",
        },
        search_column: {
          type: "string",
          description: "Column letter to search in (e.g. 'B' for Vendor/Creator Name)",
        },
        search_value: {
          type: "string",
          description: "Value to search for (case-insensitive partial match)",
        },
      },
      required: ["spreadsheet_id", "search_column", "search_value"],
    },
  },
];

// ─── Tool Handlers ───────────────────────────────────────────────────────────

async function handleTool(name, args) {
  switch (name) {
    case "sheets_append_row": {
      const sheetName = args.sheet_name || "Sheet1";
      const response = await sheets.spreadsheets.values.append({
        spreadsheetId: args.spreadsheet_id,
        range: `${sheetName}!A:A`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: [args.values],
        },
      });
      return {
        updatedRange: response.data.updates?.updatedRange,
        updatedRows: response.data.updates?.updatedRows,
      };
    }

    case "sheets_get_rows": {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: args.spreadsheet_id,
        range: args.range,
      });
      return {
        range: response.data.range,
        values: response.data.values || [],
        rowCount: (response.data.values || []).length,
      };
    }

    case "sheets_update_row": {
      const response = await sheets.spreadsheets.values.update({
        spreadsheetId: args.spreadsheet_id,
        range: args.range,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: args.values,
        },
      });
      return {
        updatedRange: response.data.updatedRange,
        updatedCells: response.data.updatedCells,
      };
    }

    case "sheets_list_sheets": {
      const response = await sheets.spreadsheets.get({
        spreadsheetId: args.spreadsheet_id,
        fields: "sheets.properties.title,sheets.properties.hidden",
      });
      const allSheets = response.data.sheets || [];
      const visibleSheets = allSheets
        .filter((s) => !s.properties.hidden)
        .map((s) => s.properties.title);
      return { sheets: visibleSheets, count: visibleSheets.length };
    }

    case "sheets_find_row": {
      const sheetName = args.sheet_name || "Sheet1";
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: args.spreadsheet_id,
        range: `${sheetName}!${args.search_column}:${args.search_column}`,
      });
      const rows = response.data.values || [];
      const searchLower = args.search_value.toLowerCase();
      const matches = [];
      rows.forEach((row, index) => {
        if (row[0] && row[0].toLowerCase().includes(searchLower)) {
          matches.push({ rowNumber: index + 1, value: row[0] });
        }
      });
      return { matches, totalRowsSearched: rows.length };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: "google-sheets", version: "1.0.0" },
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
console.error("Google Sheets MCP server running");
