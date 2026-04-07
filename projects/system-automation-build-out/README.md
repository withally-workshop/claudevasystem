# System Automation Build-Out

**Description:** Designing and deploying n8n/Zapier workflows to eliminate manual data entry and free Noa from operational bottlenecks.

**Status:** Active

**Key workstreams:**

- **n8n:** IM8 ad brief extraction from #ad-production-internal → Master Tracker → editor ping
- **n8n + Zapier:** Osome reconciliation — Airwallex API generates PDFs, Zapier saves Gmail receipts, all staged to Google Drive for fast manual upload into Osome
- **Zapier:** Airwallex AR alerts + auto-generate $200 late fee notices

**Osome reconciliation — full automation now unblocked:**
- Osome ingestion email confirmed: `977e06fe7c21-628067@my.osome.com`
- Airwallex API confirmed: `POST /confirmation_letters/create` returns PDF stream
- Full pipeline: Airwallex API → generate PDF → email to Osome ingestion address. Zero manual uploads.
- Gmail SaaS receipts: n8n Gmail node → download attachment → email to Osome ingestion address
- Blockers remaining: Airwallex API key (Admin access) + Google Workspace OAuth whitelist for n8n

**Key dates:** Q2 2026 — automation build-out supporting founder autonomy goal.
