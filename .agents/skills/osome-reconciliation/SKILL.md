---
name: osome-reconciliation
description: Use when Codex needs to run an Osome reconciliation session for Eclipse Ventures — triage flagged "documents needed" transactions, locate invoice PDFs in Airwallex or Gmail, email them to Osome's ingestion address, and compile unresolvable items for Noa. Triggers include "/osome-reconciliation", "osome session", "reconcile osome transactions".
metadata:
  short-description: Osome documents-needed reconciliation session
---

# Osome Reconciliation

Work through Eclipse Ventures' flagged transactions in Osome: classify each (creator/SaaS/Insense/payroll), find the PDF, send it to Osome's ingestion email, escalate the rest to Noa.

## How to Trigger

**Manual:** "/osome-reconciliation", "osome session" — interactive; the operator feeds transaction details per batch.

## Key References

- **Full skill (decision tree, templates, exception rules):** `.claude/skills/osome-reconciliation/SKILL.md`
- **SOP:** `references/sops/osome-reconciliation.md` (FIN-001)
- **Osome ingestion email:** `977e06fe7c21-628067@my.osome.com` — emailing a PDF auto-attaches it to the matching transaction
- **Company:** Eclipse Ventures Pte. Ltd.

## Core Flow

1. Confirm batch + sort order (Osome → Transactions → Documents needed → Amount, largest first)
2. Classify: person/company name → Airwallex Bills; tool name → Gmail search (`from:[vendor] has:attachment subject:receipt OR invoice`, noa@ then takhelnoa@); "Insense" → support email template
3. Email found PDFs to the ingestion address — no manual uploads
4. Unresolvable (all sources checked) → batch table to Noa via Slack DM at session end
5. Amount mismatch → never upload; flag for Noa with both amounts

## Card Reference

`**5435` = Airwallex USD · `**7476` = Airwallex SGD
