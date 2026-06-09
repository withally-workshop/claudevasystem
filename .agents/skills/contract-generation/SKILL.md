---
name: contract-generation
description: Use when Noa asks Codex to prepare a client retainer contract for PandaDoc. Parses the deal's commercial terms (effective date, rounds, selected Appendix A package, or a custom base-fee + performance structure), confirms with John, then runs the local generator to fill the retainer template into a new PandaDoc-ready .docx with full Appendix A. Party/signature fields are left blank by design. Triggers include "/contract-generation", "make a contract", "create a contract", "we need a contract for [client]", "prep the retainer", "contract for PandaDoc".
metadata:
  short-description: Fill the retainer contract from deal terms
---

# Contract Generation

Turn Noa's deal terms into a filled retainer `.docx` ready to upload to PandaDoc. The master file is never modified. **This is a legal document** — two human checkpoints are mandatory, and the skill never sends to a client or auto-uploads to PandaDoc.

**Scope:** the automation fills the **commercial terms** — effective date, rounds, the selected package, and (for custom deals) the base-fee + performance clauses. Both shapes keep the full Appendix A pricing tables and Terms & Conditions. The **party/signature fields** (brand name, BR Number, signatory name/position, sign dates) are **left blank by design** — John sets those up by hand in PandaDoc. Do not fill or fabricate them. The template is re-authored from the start PDF (`reconstruct-template.js`); fix clause wording there, never in the generated `.docx`.

## How to Trigger

**Manual skill run:** follow `.claude/skills/contract-generation/SKILL.md` step-by-step. There is no n8n workflow and no schedule — it runs on demand when Noa asks.

## Key References

- **Full SOP:** `.claude/skills/contract-generation/SKILL.md`
- **Generator project:** `projects/contract-generation/` (`generate-contract.js`, `README.md`)
- **Reference (source-of-record):** `projects/contract-generation/master/MASTER CONTRACT - reference (start PDF).pdf`
- **Template (placeholders):** `projects/contract-generation/template/retainer-template.docx` (authored by `reconstruct-template.js`)
- **John's private channel:** `C0AQZGJDR38`
- **Agency entity:** Eclipse Ventures PTE LTD (Krave Media), UEN 2024040972, signatory Noa Nederpelt, Director.

## What It Does

1. **Parse Noa's request** — the package (Appendix A name, or custom base-fee + performance). Effective date and # Rounds stay blank by default (Noa fills). Never ask for client legal name / BR number / signatory details (left blank).
2. **Confirm with John** — John runs the skill himself; show the parsed terms and wait for his "go" before generating.
3. **Generate** — write `projects/contract-generation/deals/<slug>.json`, run `node generate-contract.js --deal deals/<slug>.json`. Script prints the output `.docx` path; it fails loudly (no file) on an incoherent custom deal.
4. **Hand to John → Noa approval loop** — John sends the file to Noa. If approved, John uploads to PandaDoc (sets party/sig fields) and sends. If not, John relays feedback → iterate: data changes edit `deals/<slug>.json`; clause-wording changes edit `reconstruct-template.js` + rerun. Never hand-edit the generated `.docx`. The skill never uploads or sends.

## Deal JSON

All term fields are optional — anything omitted renders as a blank fill-in line for Noa (effective date and rounds are normally left blank). `initialPackage` is optional per contract. For custom deals set `isCustom: true` and provide `monthlyFee` + `deliverables[]` + `performanceTiers[]`. Party/signature fields are not placeholders (left blank for PandaDoc). Full schema in `projects/contract-generation/README.md`. Examples: `deals/example-standard.json` (standard), `deals/zenwise.json` (custom).

## Codex Invocation Notes

- Deal terms and generated contracts are local-only artifacts — `deals/` (except `example-standard.json`) and `output/` are gitignored; do not commit them.
- Setup: run `node reconstruct-template.js` to (re)build the template; run `npm install` if `node_modules` is missing. The template is re-authored from the start PDF — review wording in Word before real use.
- Deferred: PandaDoc API draft-creation (same deal JSON), and baking PandaDoc signature tokens into the template.
