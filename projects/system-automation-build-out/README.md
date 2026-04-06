# System Automation Build-Out

**Description:** Designing and deploying n8n/Zapier workflows to eliminate manual data entry and free Noa from operational bottlenecks.

**Status:** Active

**Key workstreams:**

- **n8n:** IM8 ad brief extraction from #ad-production-internal → Master Tracker → editor ping
- **n8n + Zapier:** Osome reconciliation — Airwallex API generates PDFs, Zapier saves Gmail receipts, all staged to Google Drive for fast manual upload into Osome
- **Zapier:** Airwallex AR alerts + auto-generate $200 late fee notices

**Osome reconciliation workaround (active):**
- Osome has no public API or ingestion email — upload step remains manual
- Airwallex API confirmed: `POST /confirmation_letters/create` returns PDF stream
- Workflow: n8n pulls + generates PDFs → Google Drive staging folder → jopso drags into Osome
- Email sent to dev@osome.com re: API access — pending response
- Phase 2 fallback: Playwright browser automation for the upload if Osome never responds

**Key dates:** Q2 2026 — automation build-out supporting founder autonomy goal.
