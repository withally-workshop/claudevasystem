# KM-SOP-008 — Client Contract Generation

**Frequency:** Ad hoc, when Noa asks for a client retainer contract | **Owner:** John (operator) / Noa (approver) | **Updated:** June 2026

## Overview

When Noa needs a client retainer contract, she pings John with the deal specifics. John runs the `contract-generation` skill, which fills the Krave Media retainer template (selection-based contract with full Appendix A) into a new `.docx` and hands it back. John sends it to Noa for approval; once approved, John uploads it to PandaDoc, sets the signature fields, and sends it from there.

**The master/reference is never modified.** The contract template is re-authored from the original "PANDADOC READY" PDF and lives in code (`reconstruct-template.js`) so the legal wording stays in one reviewable place.

## Key Rules

- **John is the operator; Noa is the approver.** The skill never uploads to PandaDoc and never sends anything to a client.
- **This is a legal document.** John reviews the generated file; Noa approves before it goes anywhere.
- **Commercial terms only.** The automation fills the package and (for custom deals) the base-fee + performance clauses. Effective date, # Rounds, brand name, BR number, and all signatures are **left as blank fill-in lines** — Noa/the client complete them, or John sets them as fields in PandaDoc.
- **Never hand-edit the generated `.docx`.** Data changes → edit the deal JSON. Clause-wording changes → edit `reconstruct-template.js` and rebuild. Hand-edits are overwritten on the next render.
- **Two contract shapes:** standard (pick an Appendix A package) and custom/performance (monthly base fee + performance schedule, e.g. Zenwise "2K base + 1× ROAS"). Both keep the full Appendix A + Terms & Conditions.

## Tools / Files

| Item | Detail |
|------|--------|
| Skill | `.claude/skills/contract-generation/SKILL.md` (Codex: `.agents/skills/contract-generation/SKILL.md`) |
| Project | `projects/contract-generation/` |
| Template (placeholders) | `projects/contract-generation/template/retainer-template.docx` — built by `reconstruct-template.js` |
| Reference (source-of-record) | `projects/contract-generation/master/MASTER CONTRACT - reference (start PDF).pdf` |
| Generator | `projects/contract-generation/generate-contract.js` |
| Deal inputs | `projects/contract-generation/deals/<slug>.json` (gitignored — local-only) |
| Outputs | `projects/contract-generation/output/<slug>-retainer-<YYYYMMDD>.docx` (gitignored — local-only) |
| PandaDoc | Manual upload + send (see API note below) |

## Steps

### Step 1 — Receive request
Noa pings John with the deal specifics (client, package or custom terms). John runs `/contract-generation`. The skill parses the terms; it asks only for genuinely missing commercial terms (never for client legal name, BR number, or signatory details — those are blank).

### Step 2 — Confirm terms with John
The skill shows John the parsed terms and the fields it will leave blank, and waits for his "go". Effective date and # Rounds stay blank by default unless John gives values.

### Step 3 — Generate
The skill writes `deals/<slug>.json` and runs `node generate-contract.js --deal deals/<slug>.json`, producing a new `.docx` in `output/`. It fails loudly (no file) if a custom deal is missing its fee or performance tiers.

### Step 4 — Approval loop
John opens the file in Word, sanity-checks it (especially Section 2.1a for custom deals), and **sends it to Noa for approval**.
- **Approved** → John uploads the `.docx` to PandaDoc, sets the party + signature fields, and sends.
- **Not approved** → John relays Noa's feedback. Data change → edit `deals/<slug>.json` and regenerate. Wording change → edit `reconstruct-template.js`, rerun it, regenerate. Repeat until approved.

## First-time / maintenance setup

```powershell
cd projects/contract-generation
npm install
node reconstruct-template.js     # (re)build the template; rerun after any clause edit
```

## PandaDoc API — why we stay manual (researched June 2026)

John asked whether the PandaDoc step can be automated via API. Findings:

- **API is not on Noa's current plan.** To use the API inside the team's existing PandaDoc workspace (so docs land in Noa's account with the team templates), PandaDoc requires the **Enterprise** plan (custom pricing). That's the "top tier" Noa doesn't want.
- **A standalone API plan exists but is a separate silo.** PandaDoc sells a separate **API Developer plan at ~$40/month** (≈40 documents/month) plus a **free developer sandbox** (≈60 documents/year, testing only). Documents created through this live in a separate API workspace, not Noa's normal sending workspace — so it doesn't actually remove the manual step for her.
- **Volume doesn't justify it.** Contract volume is low and ad hoc; the manual "generate `.docx` → upload to PandaDoc" step is cheap and keeps Noa in full control of the final send.

**Decision:** keep the manual upload flow. Revisit only if (a) contract volume grows materially, or (b) Krave moves to PandaDoc Enterprise for other reasons — at which point the same deal-JSON model can feed a PandaDoc API call with no rework.

Sources: PandaDoc API pricing (`pandadoc.com/api/pricing`), PandaDoc pricing (`pandadoc.com/pricing`).
