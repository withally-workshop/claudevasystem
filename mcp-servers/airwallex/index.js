import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE_URL = "https://api.airwallex.com";
const CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID;
const API_KEY = process.env.AIRWALLEX_API_KEY;
const ACCOUNT_ID = process.env.AIRWALLEX_ACCOUNT_ID || "";

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

// Billing read/write paths — do NOT use x-on-behalf-of (causes 401)
// Bills (spend module) needs x-on-behalf-of
const NO_BEHALF_PATHS = ["/api/v1/invoices", "/api/v1/billing", "/api/v1/bills", "/api/v1/billing_customers"];

async function airwallexRequest(method, path, body) {
  const token = await getToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const skipBehalf = NO_BEHALF_PATHS.some((p) => path.startsWith(p));
  if (ACCOUNT_ID && !skipBehalf) headers["x-on-behalf-of"] = ACCOUNT_ID;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
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
      "Create a new DRAFT invoice in Airwallex. Does NOT include line items — add them separately with airwallex_add_invoice_line_items. Returns a draft invoice ID.",
    inputSchema: {
      type: "object",
      properties: {
        billing_customer_id: {
          type: "string",
          description: "Airwallex billing customer ID from airwallex_list_customers.",
        },
        currency: { type: "string", description: "Invoice currency e.g. USD, SGD" },
        days_until_due: {
          type: "number",
          description: "Days until invoice is due (default 7). E.g. 7 or 30.",
        },
        collection_method: {
          type: "string",
          description: "CHARGE_ON_CHECKOUT (digital invoice link) or OUT_OF_BAND (bank transfer). Default CHARGE_ON_CHECKOUT.",
        },
        linked_payment_account_id: {
          type: "string",
          description: "Required for CHARGE_ON_CHECKOUT. The Airwallex payment account ID to receive funds.",
        },
        legal_entity_id: {
          type: "string",
          description: "Merchant legal entity ID from Airwallex account settings.",
        },
        memo: {
          type: "string",
          description: "Optional note on the invoice e.g. 'Thank you for your business'",
        },
      },
      required: ["billing_customer_id", "currency"],
    },
  },
  {
    name: "airwallex_create_product",
    description:
      "Create a billing product in Airwallex. Required before creating a price. Use once per service type e.g. 'Krave Media Starter Pack'. Returns product_id.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Product name e.g. 'Krave Media Starter Pack'" },
        description: { type: "string", description: "Optional product description" },
      },
      required: ["name"],
    },
  },
  {
    name: "airwallex_create_price",
    description:
      "Create a one-time price for a product. Must be called after airwallex_create_product. Returns price_id used in add_invoice_line_items.",
    inputSchema: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "Product ID from airwallex_create_product" },
        currency: { type: "string", description: "Currency e.g. USD, SGD" },
        unit_amount: { type: "number", description: "Price amount e.g. 500 for $500" },
        nickname: { type: "string", description: "Optional label e.g. 'April 2026 package'" },
      },
      required: ["product_id", "currency", "unit_amount"],
    },
  },
  {
    name: "airwallex_add_invoice_line_items",
    description:
      "Add line items to a DRAFT invoice using a price_id (from airwallex_create_price). Must be called after airwallex_create_invoice.",
    inputSchema: {
      type: "object",
      properties: {
        invoice_id: { type: "string", description: "The draft invoice ID" },
        line_items: {
          type: "array",
          description: "Line items to add",
          items: {
            type: "object",
            properties: {
              price_id: { type: "string", description: "Price ID from airwallex_create_price" },
              quantity: { type: "number", description: "Quantity (default 1)" },
            },
            required: ["price_id"],
          },
        },
      },
      required: ["invoice_id", "line_items"],
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
  {
    name: "airwallex_create_customer",
    description:
      "Create a new billing customer in Airwallex. Use this when a client doesn't exist yet. Returns the billing_customer_id needed for invoice creation.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Customer/company name" },
        email: { type: "string", description: "Billing email address" },
        country_code: { type: "string", description: "ISO country code e.g. SG, US, GB" },
        address: { type: "string", description: "Street address (optional)" },
        city: { type: "string", description: "City (optional)" },
      },
      required: ["name"],
    },
  },
  {
    name: "airwallex_get_billing_invoice",
    description:
      "Get full billing invoice details including the digital payment link (hosted_invoice_url). Use this after finalizing an invoice to retrieve the shareable payment URL to send to clients.",
    inputSchema: {
      type: "object",
      properties: {
        invoice_id: { type: "string", description: "The invoice ID" },
      },
      required: ["invoice_id"],
    },
  },
  {
    name: "airwallex_mark_paid",
    description:
      "Mark an Airwallex invoice as paid. Use this after confirming a client payment via Gmail deposit notification.",
    inputSchema: {
      type: "object",
      properties: {
        invoice_id: { type: "string", description: "The invoice ID to mark as paid" },
      },
      required: ["invoice_id"],
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
      return await airwallexRequest("GET", `/api/v1/invoices${query}`);
    }

    case "airwallex_get_invoice": {
      return await airwallexRequest("GET", `/api/v1/invoices/${args.invoice_id}`);
    }

    case "airwallex_create_invoice": {
      const body = {
        billing_customer_id: args.billing_customer_id,
        currency: args.currency,
        collection_method: args.collection_method || "CHARGE_ON_CHECKOUT",
        days_until_due: args.days_until_due || 7,
      };
      if (args.linked_payment_account_id) body.linked_payment_account_id = args.linked_payment_account_id;
      if (args.legal_entity_id) body.legal_entity_id = args.legal_entity_id;
      if (args.memo) body.memo = args.memo;
      return await airwallexRequest("POST", "/api/v1/invoices/create", body);
    }

    case "airwallex_create_product": {
      const body = { name: args.name };
      if (args.description) body.description = args.description;
      return await airwallexRequest("POST", "/api/v1/billing/products/create", body);
    }

    case "airwallex_create_price": {
      const body = {
        product_id: args.product_id,
        currency: args.currency,
        unit_amount: args.unit_amount,
        recurring: false,
      };
      if (args.nickname) body.nickname = args.nickname;
      return await airwallexRequest("POST", "/api/v1/billing/prices/create", body);
    }

    case "airwallex_add_invoice_line_items": {
      const body = {
        line_items: args.line_items.map((item) => ({
          price_id: item.price_id,
          quantity: item.quantity || 1,
        })),
      };
      return await airwallexRequest("POST", `/api/v1/invoices/${args.invoice_id}/add_line_items`, body);
    }

    case "airwallex_finalize_invoice": {
      return await airwallexRequest(
        "POST",
        `/api/v1/invoices/${args.invoice_id}/finalize`,
        {}
      );
    }

    case "airwallex_create_customer": {
      const body = {
        name: args.name,
        type: args.type || "BUSINESS",
      };
      if (args.email) body.email = args.email;
      if (args.default_billing_currency) body.default_billing_currency = args.default_billing_currency;
      if (args.default_legal_entity_id) body.default_legal_entity_id = args.default_legal_entity_id;
      const address = {};
      if (args.country_code) address.country_code = args.country_code;
      if (args.address) address.line1 = args.address;
      if (args.city) address.city = args.city;
      if (Object.keys(address).length) body.address = address;
      return await airwallexRequest("POST", "/api/v1/billing_customers/create", body);
    }

    case "airwallex_list_customers": {
      const params = new URLSearchParams();
      if (args.name) params.set("name", args.name);
      if (args.page_size) params.set("page_size", args.page_size);
      const query = params.toString() ? `?${params}` : "";
      return await airwallexRequest("GET", `/api/v1/billing_customers/list${query}`);
    }

    case "airwallex_list_bills": {
      const params = new URLSearchParams();
      if (args.status) params.set("status", args.status);
      if (args.page_num !== undefined) params.set("page_num", args.page_num);
      if (args.page_size !== undefined) params.set("page_size", args.page_size);
      const query = params.toString() ? `?${params}` : "";
      return await airwallexRequest("GET", `/api/v1/bills${query}`);
    }

    case "airwallex_get_bill": {
      return await airwallexRequest("GET", `/api/v1/bills/${args.bill_id}`);
    }

    case "airwallex_get_billing_invoice": {
      return await airwallexRequest("GET", `/api/v1/invoices/${args.invoice_id}`);
    }

    case "airwallex_mark_paid": {
      return await airwallexRequest(
        "POST",
        `/api/v1/invoices/${args.invoice_id}/mark_as_paid`,
        {}
      );
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
