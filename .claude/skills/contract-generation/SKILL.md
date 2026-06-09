# Skill: Contract Generation

**Trigger:** Run this skill when Noa asks for a client retainer contract to be prepared for PandaDoc.
**Manual invoke:** `/contract-generation`
**Trigger phrases:** "make a contract", "create a contract", "we need a contract for [client]", "prep the retainer", "contract for PandaDoc".

**What it replaces:** the fully manual flow where Noa pings John with deal terms and someone hand-fills the master retainer `.docx` and uploads to PandaDoc.

**What it does:** parses Noa's deal terms, posts a confirmation summary to John, then (after John confirms) runs the local generator to produce a new filled `.docx` ready to upload to PandaDoc. **The master file is never modified.**

**Scope of automation — read this first.** The skill fills only the **commercial terms** (effective date, number of rounds, the selected package, and any custom base-fee + performance clauses). The **party/signature fields** (client/brand name, BR Number, signatory name, position, sign dates) are **left blank by design** — John sets those up by hand in PandaDoc. Do not fill them and do not fabricate them.

**This is a legal document.** Two human checkpoints are mandatory. The skill never sends a contract to a client and never auto-uploads to PandaDoc.

---

## Key Data

- John's Slack ID: `@U0AM5EGRVTP`
- Noa's Slack ID: `@U06TBGX9L93`
- John's private channel: `C0AQZGJDR38`
- **Generator project:** `projects/contract-generation/`
  - Reference (source-of-record): `projects/contract-generation/master/MASTER CONTRACT - reference (start PDF).pdf`
  - Template (placeholders): `projects/contract-generation/template/retainer-template.docx` (authored by `reconstruct-template.js`)
  - Fill script: `projects/contract-generation/generate-contract.js`
  - Deal inputs: `projects/contract-generation/deals/<slug>.json` (gitignored)
  - Outputs: `projects/contract-generation/output/<slug>-retainer-<YYYYMMDD>.docx` (gitignored)
- **Agency entity:** Eclipse Ventures PTE LTD (Krave Media), UEN 2024040972, signatory Noa Nederpelt, Director.

### Fields — all optional; blank renders a fill-in line for Noa

| JSON key | Default | Notes |
|---|---|---|
| `effectiveDate` | **blank** | Leave blank — Noa fills the Term date. Only set it to pre-fill. |
| `numRounds` | **blank** | Leave blank — Noa fills "deliver ___ Rounds". |
| `initialPackage` | **blank** | Section 1.1. Blank by default; optionally set the Appendix A package per contract, or `"Custom Package — see Section 2.1a"` for custom deals. |
| `isCustom` | `false` | `true` = adds the "2.1a Custom Package Pricing" section (Appendix A still kept). |
| `monthlyFee` / `deliverables[]` / `performanceTiers[]` | — | required when `isCustom: true` |

Anything omitted renders as a blank fill-in line, matching the master PDF. Both shapes keep the full **Appendix A** pricing tables and Terms & Conditions. Party/signature fields (brand name, BR number, signatory name/position, sign dates) are **not placeholders** — they're blank underlines John fills in PandaDoc. Full schema in `projects/contract-generation/README.md`.

> The template is **re-authored from the start PDF** (`reconstruct-template.js`) — a legal document. The wording must be reviewed in Word before real use; check against `master/MASTER CONTRACT - reference (start PDF).pdf`.

---

## Core Logic

### Step 1 — Parse Noa's terms
Read the full Slack message/thread from Noa. Extract: effective/kickoff date, number of rounds (default `3`), and the package.

- **Never ask for information already in the thread.** Read everything first, then ask only for what is genuinely missing — and only the commercial terms (never ask for client legal name, BR number, or signatory details; those are left blank).
- **Standard deal** = pick a package from Appendix A. Set `isCustom: false`, `initialPackage` = the package name (e.g. "Growth Pack — Creator Led Direct Response").
- **Custom deal** = base fee + performance incentives (e.g. "2K base + 1x in-platform ROAS"). Set `isCustom: true`, `initialPackage: "Custom Package — see Section 2.1a"`, and capture `monthlyFee`, `deliverables[]`, `performanceTiers[]`.

> Optional context: if it helps identify the deal, you may note the client's contact from Noa's Gmail (`mcp__gmail-noa__gmail_search_messages` → `gmail_get_message`). This is reference only — it is **not** written into the contract.

### Step 2 — Confirm terms with John (he's running the skill)
John runs this skill himself after Noa asks for a contract. Show him the terms you parsed and wait for his "go" before generating:
```
Contract terms — confirm before I build it:
Package: <initialPackage, or "Custom — see 2.1a">
[If custom] Monthly fee: <monthlyFee> · Deliverables: <list> · Performance: <tiers>
Left blank for Noa to fill: effective date, # Rounds, brand name, BR number, signatures.
Reply "go" to generate, or send corrections.
```
**No generation until John confirms.** Effective date and # Rounds stay blank by default (Noa fills) unless John explicitly gives values.

### Step 3 — Write the deal JSON and run the generator
After John confirms, write `projects/contract-generation/deals/<slug>.json` (schema in the project README), then run from `projects/contract-generation/`:
```
node generate-contract.js --deal deals/<slug>.json
```
The script prints the absolute path of the generated `.docx`. It fails loudly (no file) if a custom deal lacks `monthlyFee` / `performanceTiers` — fix the JSON and re-run.

> Setup: if `template/retainer-template.docx` doesn't exist yet, run `node reconstruct-template.js`. If `node_modules` is missing, run `npm install` in the project folder.

### Step 4 — Hand the file to John → Noa approval loop
Give John the output `.docx` path. **John sends it to Noa for approval.** The skill never sends to the client and never uploads to PandaDoc.
- **Approved:** John uploads the `.docx` to PandaDoc, sets the party + signature fields, and sends it from there.
- **Not approved:** John relays Noa's feedback → iterate. Data changes (fee, deliverables, package) → edit `deals/<slug>.json` and regenerate. Clause-wording changes → edit `reconstruct-template.js`, rerun it, then regenerate. Never hand-edit the generated `.docx` (the next render overwrites it).

---

## Output Format

- **To John (Step 2):** the terms-confirmation summary above.
- **To John (Step 4):** the generated `.docx` absolute path + the "send to Noa for approval" reminder.
- **Artifacts:** one deal JSON in `deals/`, one contract `.docx` in `output/` (both gitignored, local-only).

---

## Guardrails

- Reference PDF and `master/` are read-only — never edit them.
- Fill commercial terms only. Never fill or fabricate brand name, BR Number, signatory name/position, or sign dates — those are left blank for Noa / John's PandaDoc setup.
- Custom deals must have `monthlyFee` + ≥1 `performanceTiers` or the generator refuses.
- The template is re-authored from the PDF — if a clause looks wrong, fix the wording in `reconstruct-template.js` and rebuild, never hand-edit the generated `.docx`.
- Approval gate is non-negotiable for a legal document — John reviews, Noa approves, then PandaDoc. The skill never uploads or sends.
- Deal terms and generated contracts are local-only artifacts — do not commit `deals/` or `output/`.

## Deferred (Phase 2)
- PandaDoc API draft-creation (reuses the same deal JSON; needs an API key + a PandaDoc-side template).
- Baking PandaDoc signature/date tokens into the template so sig fields auto-detect on upload.
