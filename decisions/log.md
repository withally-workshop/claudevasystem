# Decision Log

Append-only. When a meaningful decision is made, log it here.

Format: [YYYY-MM-DD] DECISION: ... | REASONING: ... | CONTEXT: ...

---

[2026-04-08] DECISION: Paused Osome reconciliation automation build. | REASONING: Too many upstream blockers to make meaningful progress — Airwallex MCP needs Admin API key + transfers endpoint, takhelnoa@gmail.com auth failed, n8n not yet built. Manual SOP + Osome ingestion email are in place; automation resumes when blockers are cleared. | CONTEXT: 700 transactions remaining (Dec 2024–Dec 2025), deadline end of April 2026 for Eclipse Ventures tax submission.

**Osome automation status snapshot (2026-04-08):**
- Working: SOP documented (FIN-001), skill built, Osome ingestion email confirmed (977e06fe7c21-628067@my.osome.com), noa@kravemedia.co Gmail MCP connected
- Blocked: Airwallex MCP (401 — needs Admin API key), Airwallex transfers endpoint missing from MCP, takhelnoa@gmail.com not connected
- Next actions to unblock:
  1. Noa generates Admin API key in Airwallex → Settings → Developers → replace key in .mcp.json
  2. Add `list_transfers` + `get_transfer` endpoints to mcp-servers/airwallex/index.js
  3. Set up Gmail forwarding filter in takhelnoa@gmail.com → noa@kravemedia.co
  4. Build n8n workflow: Airwallex API → confirmation letter PDF → email to Osome ingestion address
