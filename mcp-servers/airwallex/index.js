import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";

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
// Spend module paths (/api/v1/spend/*) DO use x-on-behalf-of
const NO_BEHALF_PATHS = ["/api/v1/invoices", "/api/v1/billing", "/api/v1/billing_customers", "/api/v1/products", "/api/v1/prices", "/api/v1/subscriptions"];

const BILLING_PATHS = ["/api/v1/invoices", "/api/v1/billing_customers", "/api/v1/products", "/api/v1/prices", "/api/v1/subscriptions"];

async function airwallexRequest(method, path, body) {
  const token = await getToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const skipBehalf = NO_BEHALF_PATHS.some((p) => path.startsWith(p));
  if (ACCOUNT_ID && !skipBehalf) headers["x-on-behalf-of"] = ACCOUNT_ID;
  if (BILLING_PATHS.some((p) => path.startsWith(p))) headers["x-api-version"] = "2025-06-16";

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Airwallex API error ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function airwallexUploadFile(base64, filename) {
  const token = await getToken();
  const fileBuffer = Buffer.from(base64, "base64");
  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: "application/pdf" });
  formData.append("file", blob, filename || "invoice.pdf");
  const headers = { Authorization: `Bearer ${token}` };
  if (ACCOUNT_ID) headers["x-on-behalf-of"] = ACCOUNT_ID;
  const res = await fetch(`${BASE_URL}/api/v1/files/upload`, {
    method: "POST",
    headers,
    body: formData,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Airwallex file upload error ${res.status}: ${text}`);
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
      "List billing customers in Airwallex. Use this to find a customer's billing_customer_id before creating an invoice. Filter by email (exact match) or name (partial match).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Filter by customer name (partial match)" },
        email: { type: "string", description: "Filter by customer email (exact match)" },
        page_size: { type: "number", description: "Results per page (default 20)" },
      },
    },
  },
  {
    name: "airwallex_list_bills",
    description:
      "List bills (accounts payable) from Airwallex Spend. Filter by status: DRAFT, AWAITING_APPROVAL, APPROVED, PAID, VOIDED.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: "Filter by status: DRAFT, AWAITING_APPROVAL, APPROVED, PAID, VOIDED",
        },
        vendor_id: { type: "string", description: "Filter by vendor ID" },
        page_num: { type: "number" },
        page_size: { type: "number" },
      },
    },
  },
  {
    name: "airwallex_get_bill",
    description: "Get full details of a specific bill by ID (Airwallex Spend module).",
    inputSchema: {
      type: "object",
      properties: {
        bill_id: { type: "string", description: "The bill ID" },
      },
      required: ["bill_id"],
    },
  },
  {
    name: "airwallex_upload_file",
    description:
      "Upload a PDF file to Airwallex and get back a file_id. Call this BEFORE airwallex_create_bill to attach the invoice PDF. Pass the file_id to airwallex_create_bill as attachment_file_id.",
    inputSchema: {
      type: "object",
      properties: {
        pdf_base64: { type: "string", description: "Base64-encoded PDF content" },
        filename: { type: "string", description: "Filename e.g. invoice-001.pdf" },
      },
      required: ["pdf_base64"],
    },
  },
  {
    name: "airwallex_create_bill",
    description:
      "Create a new bill in Airwallex Spend (accounts payable). Requires a vendor_id — use airwallex_list_vendors or airwallex_create_vendor first. Optionally pass attachment_file_id from airwallex_upload_file to attach the invoice PDF.",
    inputSchema: {
      type: "object",
      properties: {
        external_id: {
          type: "string",
          description: "Your internal identifier for this bill (e.g. receipt_ts or invoice ref)",
        },
        vendor_id: {
          type: "string",
          description: "Airwallex vendor UUID — use airwallex_list_vendors to look up",
        },
        legal_entity_id: {
          type: "string",
          description: "Airwallex legal entity ID for your account",
        },
        invoice_number: { type: "string", description: "Vendor invoice number" },
        issued_date: { type: "string", description: "Invoice issue date ISO8601 e.g. 2026-05-28" },
        due_date: { type: "string", description: "Invoice due date ISO8601 e.g. 2026-06-04" },
        currency: { type: "string", description: "Bill currency e.g. USD, SGD" },
        description: { type: "string", description: "Optional bill description / memo" },
        attachment_file_id: {
          type: "string",
          description: "Optional file_id from airwallex_upload_file — attaches the PDF to the bill",
        },
        line_items: {
          type: "array",
          description: "Line items — each with description, quantity, unit_price (tax-exclusive)",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              quantity: { type: "number" },
              unit_price: { type: "number", description: "Tax-exclusive unit price" },
            },
            required: ["description", "quantity", "unit_price"],
          },
        },
      },
      required: ["external_id", "vendor_id", "invoice_number", "issued_date", "due_date", "currency", "line_items"],
    },
  },
  {
    name: "airwallex_list_vendors",
    description:
      "List vendors in Airwallex Spend. Use this to find a vendor_id before creating a bill. Filter by name.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Filter by vendor name (partial match)" },
        page_num: { type: "number" },
        page_size: { type: "number" },
      },
    },
  },
  {
    name: "airwallex_create_vendor",
    description:
      "Create a new vendor in Airwallex Spend. Required before creating a bill for a vendor that doesn't exist yet. Returns vendor_id.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Vendor/supplier name" },
        email: { type: "string", description: "Vendor billing email" },
        currency: { type: "string", description: "Default payment currency e.g. USD, SGD" },
        country_code: { type: "string", description: "ISO country code e.g. SG, US, PH" },
      },
      required: ["name"],
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
  {
    name: "airwallex_list_subscriptions",
    description: "List recurring subscriptions in Airwallex. Filter by status or customer ID.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status e.g. ACTIVE, CANCELED, PAST_DUE, TRIALING" },
        customer_id: { type: "string", description: "Filter by billing customer ID" },
        page_num: { type: "number" },
        page_size: { type: "number" },
      },
    },
  },
  {
    name: "airwallex_create_subscription",
    description:
      "Create a recurring subscription in Airwallex. Requires a billing customer ID and at least one price ID (from airwallex_create_price). Returns the subscription ID.",
    inputSchema: {
      type: "object",
      properties: {
        billing_customer_id: { type: "string", description: "Airwallex billing customer ID" },
        items: {
          type: "array",
          description: "Subscription line items — each with a price_id and optional quantity",
          items: {
            type: "object",
            properties: {
              price_id: { type: "string", description: "Price ID from airwallex_create_price" },
              quantity: { type: "number", description: "Quantity (default 1)" },
            },
            required: ["price_id"],
          },
        },
        currency: { type: "string", description: "Subscription currency e.g. USD, SGD" },
        collection_method: { type: "string", description: "AUTO_CHARGE (requires payment_source_id), CHARGE_ON_CHECKOUT (requires linked_payment_account_id), or OUT_OF_BAND" },
        linked_payment_account_id: { type: "string", description: "Required for AUTO_CHARGE and CHARGE_ON_CHECKOUT" },
        payment_source_id: { type: "string", description: "Required for AUTO_CHARGE — the saved payment source ID" },
        period_unit: { type: "string", description: "Billing interval: DAY, WEEK, MONTH, or YEAR" },
        invoice_memo: { type: "string", description: "Optional memo to include on generated invoices" },
        default_tax_percent: { type: "number", description: "Optional default tax percentage e.g. 9 for 9%" },
        starts_at: { type: "string", description: "Optional subscription start date ISO8601 e.g. 2026-07-01" },
        trial_ends_at: { type: "string", description: "Optional trial end date ISO8601 e.g. 2026-07-01" },
        description: { type: "string", description: "Optional internal note" },
      },
      required: ["billing_customer_id", "items", "currency"],
    },
  },
  {
    name: "airwallex_get_subscription",
    description: "Get full details of a specific subscription by ID.",
    inputSchema: {
      type: "object",
      properties: {
        subscription_id: { type: "string", description: "The subscription ID" },
      },
      required: ["subscription_id"],
    },
  },
  {
    name: "airwallex_cancel_subscription",
    description: "Cancel an active subscription. By default cancels at period end. Use proration_behavior to control refund handling.",
    inputSchema: {
      type: "object",
      properties: {
        subscription_id: { type: "string", description: "The subscription ID to cancel" },
        cancel_immediately: { type: "boolean", description: "If true, cancel now. If false (default), cancel at end of current billing period." },
        proration_behavior: { type: "string", description: "Refund handling: ALL (full period refund), PRORATED (refund remaining days), or NONE (no refund). Default NONE." },
      },
      required: ["subscription_id"],
    },
  },
  {
    name: "airwallex_list_subscription_items",
    description: "List all line items on a subscription.",
    inputSchema: {
      type: "object",
      properties: {
        subscription_id: { type: "string", description: "The subscription ID" },
      },
      required: ["subscription_id"],
    },
  },
  {
    name: "airwallex_get_subscription_item",
    description: "Get a specific line item on a subscription.",
    inputSchema: {
      type: "object",
      properties: {
        subscription_id: { type: "string", description: "The subscription ID" },
        item_id: { type: "string", description: "The subscription item ID" },
      },
      required: ["subscription_id", "item_id"],
    },
  },
  {
    name: "airwallex_update_subscription",
    description: "Update a subscription — change items, quantity, payment method, or trial end date. Only fields provided are updated; array fields are fully replaced if included.",
    inputSchema: {
      type: "object",
      properties: {
        subscription_id: { type: "string", description: "The subscription ID to update" },
        items: {
          type: "array",
          description: "Replacement line items — fully replaces existing items if provided",
          items: {
            type: "object",
            properties: {
              price_id: { type: "string" },
              quantity: { type: "number" },
            },
            required: ["price_id"],
          },
        },
        collection_method: { type: "string", description: "AUTO_CHARGE, CHARGE_ON_CHECKOUT, or OUT_OF_BAND" },
        linked_payment_account_id: { type: "string" },
        payment_source_id: { type: "string", description: "Required if switching to AUTO_CHARGE" },
        trial_ends_at: { type: "string", description: "Updated trial end date ISO8601" },
        invoice_memo: { type: "string", description: "Updated default invoice memo" },
        default_tax_percent: { type: "number" },
        description: { type: "string" },
      },
      required: ["subscription_id"],
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
        request_id: randomUUID(),
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
      const body = { request_id: randomUUID(), name: args.name };
      if (args.description) body.description = args.description;
      return await airwallexRequest("POST", "/api/v1/products/create", body);
    }

    case "airwallex_create_price": {
      const body = {
        request_id: randomUUID(),
        product_id: args.product_id,
        currency: args.currency,
        unit_amount: args.unit_amount,
      };
      if (args.nickname) body.nickname = args.nickname;
      return await airwallexRequest("POST", "/api/v1/prices/create", body);
    }

    case "airwallex_add_invoice_line_items": {
      const body = {
        request_id: randomUUID(),
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
        { request_id: randomUUID() }
      );
    }

    case "airwallex_create_customer": {
      const body = {
        request_id: randomUUID(),
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
      if (args.email) params.set("email", args.email);
      if (args.name) params.set("name", args.name);
      if (args.page_size) params.set("page_size", args.page_size);
      const query = params.toString() ? `?${params}` : "";
      return await airwallexRequest("GET", `/api/v1/billing_customers${query}`);
    }

    case "airwallex_list_bills": {
      const params = new URLSearchParams();
      if (args.status) params.set("status", args.status);
      if (args.page_num !== undefined) params.set("page_num", args.page_num);
      if (args.page_size !== undefined) params.set("page_size", args.page_size);
      const query = params.toString() ? `?${params}` : "";
      return await airwallexRequest("GET", `/api/v1/spend/bills${query}`);
    }

    case "airwallex_get_bill": {
      return await airwallexRequest("GET", `/api/v1/spend/bills/${args.bill_id}`);
    }

    case "airwallex_upload_file": {
      return await airwallexUploadFile(args.pdf_base64, args.filename);
    }

    case "airwallex_create_bill": {
      const body = {
        request_id: randomUUID(),
        external_id: args.external_id,
        vendor_id: args.vendor_id,
        invoice_number: args.invoice_number,
        issued_date: args.issued_date,
        due_date: args.due_date,
        currency: args.currency,
        line_items: args.line_items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
        })),
      };
      if (args.legal_entity_id) body.legal_entity_id = args.legal_entity_id;
      if (args.description) body.description = args.description;
      if (args.attachment_file_id) body.attachments = [{ file_id: args.attachment_file_id }];
      return await airwallexRequest("POST", "/api/v1/spend/bills/create", body);
    }

    case "airwallex_list_vendors": {
      const params = new URLSearchParams();
      if (args.name) params.set("name", args.name);
      if (args.page_num !== undefined) params.set("page_num", args.page_num);
      if (args.page_size !== undefined) params.set("page_size", args.page_size);
      const query = params.toString() ? `?${params}` : "";
      return await airwallexRequest("GET", `/api/v1/spend/vendors${query}`);
    }

    case "airwallex_create_vendor": {
      const body = { request_id: randomUUID(), name: args.name };
      if (args.email) body.email = args.email;
      if (args.currency) body.currency = args.currency;
      if (args.country_code) body.country_code = args.country_code;
      return await airwallexRequest("POST", "/api/v1/spend/vendors/create", body);
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

    case "airwallex_list_subscriptions": {
      const params = new URLSearchParams();
      if (args.status) params.set("status", args.status);
      if (args.customer_id) params.set("customer_id", args.customer_id);
      if (args.page_num !== undefined) params.set("page_num", args.page_num);
      if (args.page_size !== undefined) params.set("page_size", args.page_size);
      const query = params.toString() ? `?${params}` : "";
      return await airwallexRequest("GET", `/api/v1/subscriptions${query}`);
    }

    case "airwallex_create_subscription": {
      const body = {
        request_id: randomUUID(),
        billing_customer_id: args.billing_customer_id,
        currency: args.currency,
        items: args.items.map((i) => ({ price_id: i.price_id, quantity: i.quantity || 1 })),
      };
      if (args.collection_method) body.collection_method = args.collection_method;
      if (args.linked_payment_account_id) body.linked_payment_account_id = args.linked_payment_account_id;
      if (args.payment_source_id) body.payment_source_id = args.payment_source_id;
      if (args.period_unit) body.duration = { period_unit: args.period_unit };
      if (args.invoice_memo || args.default_tax_percent !== undefined) {
        body.default_invoice_template = {};
        if (args.invoice_memo) body.default_invoice_template.invoice_memo = args.invoice_memo;
        if (args.default_tax_percent !== undefined) body.default_invoice_template.default_tax_percent = args.default_tax_percent;
      }
      if (args.starts_at) body.starts_at = args.starts_at;
      if (args.trial_ends_at) body.trial_ends_at = args.trial_ends_at;
      if (args.description) body.description = args.description;
      return await airwallexRequest("POST", "/api/v1/subscriptions/create", body);
    }

    case "airwallex_get_subscription": {
      return await airwallexRequest("GET", `/api/v1/subscriptions/${args.subscription_id}`);
    }

    case "airwallex_cancel_subscription": {
      const body = { request_id: randomUUID() };
      if (args.cancel_immediately !== undefined) body.cancel_immediately = args.cancel_immediately;
      if (args.proration_behavior) body.proration_behavior = args.proration_behavior;
      return await airwallexRequest("POST", `/api/v1/subscriptions/${args.subscription_id}/cancel`, body);
    }

    case "airwallex_list_subscription_items": {
      return await airwallexRequest("GET", `/api/v1/subscriptions/${args.subscription_id}/items`);
    }

    case "airwallex_get_subscription_item": {
      return await airwallexRequest("GET", `/api/v1/subscriptions/${args.subscription_id}/items/${args.item_id}`);
    }

    case "airwallex_update_subscription": {
      const body = { request_id: randomUUID() };
      if (args.items) body.items = args.items.map((i) => ({ price_id: i.price_id, quantity: i.quantity || 1 }));
      if (args.collection_method) body.collection_method = args.collection_method;
      if (args.linked_payment_account_id) body.linked_payment_account_id = args.linked_payment_account_id;
      if (args.payment_source_id) body.payment_source_id = args.payment_source_id;
      if (args.trial_ends_at) body.trial_ends_at = args.trial_ends_at;
      if (args.invoice_memo || args.default_tax_percent !== undefined) {
        body.default_invoice_template = {};
        if (args.invoice_memo) body.default_invoice_template.invoice_memo = args.invoice_memo;
        if (args.default_tax_percent !== undefined) body.default_invoice_template.default_tax_percent = args.default_tax_percent;
      }
      if (args.description) body.description = args.description;
      return await airwallexRequest("POST", `/api/v1/subscriptions/${args.subscription_id}/update`, body);
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
