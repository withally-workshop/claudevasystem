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
  - **Round-based deals:** `projects/contract-generation/generate-contract.js` + `deals/<slug>.json` (Appendix A packages, e.g. Zyg Brands)
  - **Month-to-month deals:** `projects/contract-generation/mtm-retainer.js` (no Rounds, no Appendix A; FluffCo/Zenwise-style — per-client configs live inside the script; emits `output/<slug>-mtm-retainer-<YYYYMMDD>.docx`)
  - Deal inputs: `projects/contract-generation/deals/<slug>.json` (gitignored)
  - Outputs: `projects/contract-generation/output/*.docx` (gitignored)
- **Drive review folder:** "Client Contracts & Invoices" — `1jPHJmiIdTrzLSAhwHLxeVZrr7XxfFiGm` (Agency Work > Finance). John drag-drops the verified `.docx` here for Noa's inline comments.
- **Agency entity:** Eclipse Ventures PTE LTD (Krave Media), UEN 2024040972, signatory Noa Nederpelt, Director.

### Fields — all optional; blank renders a fill-in line for Noa

| JSON key | Default | Notes |
|---|---|---|
| `effectiveDate` | **blank** | Leave blank — Noa fills the Term date. Only set it to pre-fill. |
| `numRounds` | **blank** | Leave blank — Noa fills "deliver ___ Rounds". |
| `initialPackage` | **blank** | Section 1.1. Blank by default; optionally set the Appendix A package per contract, or `"Custom Package — see Section 2.1a"` for custom deals. |
| `isCustom` | `false` | `true` = adds the "2.1a Custom Package Pricing" section (Appendix A still kept). |
| `monthlyFee` / `deliverables[]` | — | required when `isCustom: true` |
| `performanceTiers[]` | `[]` | optional when custom — omit for fixed-fee deals; the performance section is skipped entirely |
| `terminationNotice` | `thirty (30) days’` | optional — overrides the T&C 5.1 notice period, e.g. `"seven (7) days’"` |

Anything omitted renders as a blank fill-in line, matching the master PDF. Both shapes keep the full **Appendix A** pricing tables and Terms & Conditions. Party/signature fields (brand name, BR number, signatory name/position, sign dates) are **not placeholders** — they're blank underlines John fills in PandaDoc. Full schema in `projects/contract-generation/README.md`.

> The template is **re-authored from the start PDF** (`reconstruct-template.js`) — a legal document. The wording must be reviewed in Word before real use; check against `master/MASTER CONTRACT - reference (start PDF).pdf`.

---

## Core Logic

### Step 1 — Parse Noa's terms
Read the full Slack message/thread from Noa. Extract: effective/kickoff date, number of rounds (default `3`), and the package.

- **Never ask for information already in the thread.** Read everything first, then ask only for what is genuinely missing — and only the commercial terms (never ask for client legal name, BR number, or signatory details; those are left blank).
- **Standard deal** = pick a package from Appendix A. Set `isCustom: false`, `initialPackage` = the package name (e.g. "Growth Pack — Creator Led Direct Response").
- **Custom deal** = base fee + optional performance incentives (e.g. "2K base + 1x in-platform ROAS", or a fixed-fee multi-brand package). Set `isCustom: true`, `initialPackage: "Custom Package — see Section 2.1a"`, and capture `monthlyFee`, `deliverables[]`, and `performanceTiers[]` if the deal has a performance component (omit for fixed-fee).

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

### Step 3 — Generate the `.docx`, then verify it
After John confirms, pick the generator by deal shape and run from `projects/contract-generation/`:
- **Round-based deal** → write `deals/<slug>.json` (schema in the project README), then `node generate-contract.js --deal deals/<slug>.json`.
- **Month-to-month deal** (FluffCo/Zenwise-style) → add/adjust the client config inside `mtm-retainer.js`, then `node mtm-retainer.js` (writes all configured contracts).

Both print the absolute path(s) of the generated `.docx`. `generate-contract.js` fails loudly (no file) if a custom deal lacks `monthlyFee` — fix the JSON and re-run.

**Always verify before handing over:** extract the docx text (unzip `word/document.xml`, strip tags) and confirm the commercial terms read correctly, AND that any table has an explicit column grid (`tblGrid`) — a percentage-only table renders fine in Word but collapses to an empty box in Google Drive's preview.

> Setup: if `template/retainer-template.docx` doesn't exist yet, run `node reconstruct-template.js`. If `node_modules` is missing, run `npm install` in the project folder.

### Step 4 — Hand the file to John → Drive → Noa approval loop
Give John the verified output `.docx` path. **John drag-drops it into the Drive review folder** ("Client Contracts & Invoices", id `1jPHJmiIdTrzLSAhwHLxeVZrr7XxfFiGm`) for Noa's inline comments — or straight to PandaDoc if no review needed. The skill never sends to the client and never auto-uploads.

> **Drive upload is manual.** Do NOT try to push the docx through the claude.ai Drive connector — it only accepts inline base64, and routing file bytes through model output corrupts them (2026-06-12 incident: 3 corrupted FluffCo uploads). A parked `upload-to-drive.js` (service-account, disk→API, hash-verified) exists but is blocked on Drive storage quota; it only works once the folder lives on a Workspace **Shared Drive** with the `krave-ea@krave-ea.iam.gserviceaccount.com` SA added. Until then John drag-drops.

- **Approved:** John uploads the `.docx` to PandaDoc, sets the party + signature fields, and sends it from there.
- **Not approved:** John relays Noa's feedback → iterate. Round-based data changes → edit `deals/<slug>.json` and regenerate. Month-to-month changes → edit the client config in `mtm-retainer.js` and rerun. Clause-wording changes → edit `reconstruct-template.js` (round-based template) or the relevant authoring script, rerun, then regenerate. Never hand-edit the generated `.docx` (the next render overwrites it).

---

## Output Format

- **To John (Step 2):** the terms-confirmation summary above.
- **To John (Step 4):** the verified `.docx` absolute path + the "drag into the Drive review folder for Noa, or to PandaDoc" reminder.
- **Artifacts:** for round-based deals one deal JSON in `deals/`; one contract `.docx` in `output/` (both gitignored, local-only).

---

## Guardrails

- Reference PDF and `master/` are read-only — never edit them.
- Fill commercial terms only. Never fill or fabricate brand name, BR Number, signatory name/position, or sign dates — those are left blank for Noa / John's PandaDoc setup.
- Custom deals must have `monthlyFee` or the generator refuses; `performanceTiers` is optional (fixed-fee deals omit it).
- The template is re-authored from the PDF — if a clause looks wrong, fix the wording in `reconstruct-template.js` and rebuild, never hand-edit the generated `.docx`.
- Approval gate is non-negotiable for a legal document — John reviews, Noa approves, then PandaDoc. The skill never uploads or sends.
- Deal terms and generated contracts are local-only artifacts — do not commit `deals/` or `output/`.
- **Never route file bytes through model output** — Drive uploads are manual drag-drop until the Shared-Drive uploader is wired up. Verify generated docx by extracting its XML, never by trusting the render blindly.

## Deferred (Phase 2)
- **Shared-Drive auto-upload:** move the review folder to a Workspace Shared Drive, add the `krave-ea` service account as Content Manager, then `upload-to-drive.js` does step 4's upload (hash-verified) instead of John drag-dropping.
- PandaDoc API draft-creation (reuses the same deal JSON; needs an API key + a PandaDoc-side template).
- Baking PandaDoc signature/date tokens into the template so sig fields auto-detect on upload.
