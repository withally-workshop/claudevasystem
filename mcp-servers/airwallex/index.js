import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE_URL = "https://api.airwallex.com";
const CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID;
const API_KEY = process.env.AIRWALLEX_API_KEY;

if (!CLIENT_ID || !API_KEY) {
  console.error("Missing AIRWALLEX_CLIENT_ID or AIRWALLEX_API_KEY");
  process.exit(1);
}

// Token cache — valid for 30 min
let tokenCache = { token: null, expiresAt: 0 };

async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  const res = await fetch(`${BASE_URL}/api/v1/authentication/login`, {
    method: "POST",
    headers: {
      "x-client-id": CLIENT_ID,
      "x-api-key": API_KEY,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Airwallex auth failed: ${err}`);
  }
  const data = await res.json();
  tokenCache = {
    token: data.token,
    expiresAt: Date.now() + 25 * 60 * 1000, // refresh 5 min early
  };
  return tokenCache.token;
}

async function airwallexRequest(method, path, body) {
  const token = await getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Airwallex API error ${res.status}: ${text}`);
  return JSON.parse(text);
}

// ─── Tool Definitions ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "airwallex_list_invoices",
    description:
      "List invoices from Airwallex. Filter by status: DRAFT, OPEN (unpaid/sent), PAID, OVERDUE, VOID.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Filter by invoice status: DRAFT, OPEN, PAID, OVERDUE, VOID",
        },
        page_num: { type: "number", description: "Page number (default 0)" },
        page_size: { type: "number", description: "Results per page (default 20, max 100)" },
      },
    },
  },
  {
    name: "airwallex_get_invoice",
    description: "Get full details of a specific invoice by ID.",
    inputSchema: {
      type: "object",
      properties: {
        invoice_id: { type: "string", description: "The invoice ID" },
      },
      required: ["invoice_id"],
    },
  },
  {
    name: "airwallex_create_invoice",
    description:
      "Create a new invoice in Airwallex for a client. Returns a draft invoice ID.",
    inputSchema: {
      type: "object",
      properties: {
        billing_customer_id: {
          type: "string",
          description: "Airwallex billing customer ID. Use airwallex_list_customers to find it.",
        },
        currency: { type: "string", description: "Invoice currency e.g. USD, SGD" },
        line_items: {
          type: "array",
          description: "Invoice line items",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              amount: { type: "number", description: "Amount in smallest currency unit (cents)" },
              quantity: { type: "number" },
            },
            required: ["description", "amount"],
          },
        },
        due_date: {
          type: "string",
          description: "Due date in YYYY-MM-DD format",
        },
        collection_method: {
          type: "string",
          description: "CHARGE_ON_CHECKOUT or OUT_OF_BAND (default OUT_OF_BAND for bank transfer)",
          default: "OUT_OF_BAND",
        },
      },
      required: ["billing_customer_id", "currency", "line_items"],
    },
  },
  {
    name: "airwallex_finalize_invoice",
    description:
      "Finalize a draft invoice — makes it non-editable and sets status to UNPAID/OPEN, ready to send.",
    inputSchema: {
      type: "object",
      properties: {
        invoice_id: { type: "string", description: "The invoice ID to finalize" },
      },
      required: ["invoice_id"],
    },
  },
  {
    name: "airwallex_list_customers",
    description:
      "List billing customers in Airwallex. Use this to find a customer's billing_customer_id before creating an invoice.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Filter by customer name (partial match)" },
        page_size: { type: "number", description: "Results per page (default 20)" },
      },
    },
  },
  {
    name: "airwallex_list_bills",
    description:
      "List bills (outgoing payments to creators/vendors) from Airwallex. Filter by status.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Filter by status: DRAFT, SUBMITTED, APPROVED, PAID",
        },
        page_num: { type: "number" },
        page_size: { type: "number" },
      },
    },
  },
  {
    name: "airwallex_get_bill",
    description: "Get full details of a specific bill by ID.",
    inputSchema: {
      type: "object",
      properties: {
        bill_id: { type: "string", description: "The bill ID" },
      },
      required: ["bill_id"],
    },
  },
];

// ─── Tool Handlers ───────────────────────────────────────────────────────────

async function handleTool(name, args) {
  switch (name) {
    case "airwallex_list_invoices": {
      const params = new URLSearchParams();
      if (args.status) params.set("status", args.status);
      if (args.page_num !== undefined) params.set("page_num", args.page_num);
      if (args.page_size !== undefined) params.set("page_size", args.page_size);
      const query = params.toString() ? `?${params}` : "";
      return await airwallexRequest("GET", `/api/v1/invoices/list${query}`);
    }

    case "airwallex_get_invoice": {
      return await airwallexRequest("GET", `/api/v1/invoices/${args.invoice_id}`);
    }

    case "airwallex_create_invoice": {
      const body = {
        billing_customer_id: args.billing_customer_id,
        currency: args.currency,
        collection_method: args.collection_method || "OUT_OF_BAND",
        items: args.line_items.map((item) => ({
          description: item.description,
          unit_amount: item.amount,
          quantity: item.quantity || 1,
        })),
      };
      if (args.due_date) body.due_date = args.due_date;
      return await airwallexRequest("POST", "/api/v1/invoices/create", body);
    }

    case "airwallex_finalize_invoice": {
      return await airwallexRequest(
        "POST",
        `/api/v1/invoices/${args.invoice_id}/finalize`,
        {}
      );
    }

    case "airwallex_list_customers": {
      const params = new URLSearchParams();
      if (args.name) params.set("name", args.name);
      if (args.page_size) params.set("page_size", args.page_size);
      const query = params.toString() ? `?${params}` : "";
      return await airwallexRequest("GET", `/api/v1/billing/customers/list${query}`);
    }

    case "airwallex_list_bills": {
      const params = new URLSearchParams();
      if (args.status) params.set("status", args.status);
      if (args.page_num !== undefined) params.set("page_num", args.page_num);
      if (args.page_size !== undefined) params.set("page_size", args.page_size);
      const query = params.toString() ? `?${params}` : "";
      return await airwallexRequest("GET", `/api/v1/bills/list${query}`);
    }

    case "airwallex_get_bill": {
      return await airwallexRequest("GET", `/api/v1/bills/${args.bill_id}`);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: "airwallex", version: "1.0.0" },
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
console.error("Airwallex MCP server running");
