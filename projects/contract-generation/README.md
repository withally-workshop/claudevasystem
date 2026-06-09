# Contract Generation

Fills the Krave Media retainer **template** `.docx` from a **deal JSON** and writes a new
contract ready to upload to PandaDoc. The template is never edited by the fill step — the
generator only reads it and writes to `output/`.

This is the local generator. The operator-facing playbook (parse Noa's ping, John
confirmation) is the **`contract-generation` skill** (`.claude/skills/contract-generation/SKILL.md`).

**Both contract shapes work end-to-end:**
- **Standard** — pick a package from Appendix A (`isCustom: false`).
- **Custom/performance** — monthly base fee + performance schedule (`isCustom: true`); adds a
  "2.1a Custom Package Pricing" section and keeps Appendix A as reference.

---

## The template is reconstructed (important context)

The editable `.docx` that matched the original "PANDADOC READY" PDF (selection-based:
deliver _N_ Rounds + Initial Package selection + full Appendix A + Terms & Conditions) was
not available, so the template is **re-authored from that PDF** by `reconstruct-template.js`,
with placeholders + the custom conditional baked in.

Because it's a re-authored **legal document**, the wording is transcribed from the PDF and
**must be reviewed in Word before any real use**. `master/MASTER CONTRACT - reference (start
PDF).pdf` is the visual source-of-record to check against.

---

## Layout

```
contract-generation/
├── master/    MASTER CONTRACT - reference (start PDF).pdf   # visual source-of-record
├── template/  retainer-template.docx                        # produced by reconstruct-template.js
├── reconstruct-template.js                                  # authors the template from the PDF content
├── generate-contract.js                                     # fills the template from a deal JSON
├── deals/     <slug>.json                                    # inputs (gitignored; example-standard.json committed)
├── output/    <slug>-retainer-<YYYYMMDD>.docx                # generated (gitignored)
└── package.json
```

`deals/` (except `example-standard.json`) and `output/` are gitignored — real client deal
terms and generated legal docs are local-only artifacts.

---

## Setup

```powershell
cd projects/contract-generation
npm install
node reconstruct-template.js     # (re)builds template/retainer-template.docx
```
Re-run `reconstruct-template.js` whenever the contract wording in it changes. To change a
clause, edit the text in `reconstruct-template.js` and rebuild — that keeps the legal text
in one reviewable place.

---

## Generate a contract

```powershell
node generate-contract.js --deal deals/example-standard.json
# → prints the absolute path of the generated .docx (default: output/<slug>-retainer-<YYYYMMDD>.docx)

# explicit output path:
node generate-contract.js --deal deals/example-standard.json --out output/acme-retainer-20260615.docx
```

The script **fails loudly (non-zero exit, no file written)** if a commercial-term field is
missing, or if a custom deal lacks `monthlyFee` / `performanceTiers`.

---

## Deal JSON schema

**All term fields are optional.** Anything you omit (or set to `""` / `"BLANK"`) renders as a
**blank fill-in line** for Noa to complete by hand — matching the master PDF. A value is only
written in when you deliberately provide one.

| Field | Notes |
|---|---|
| `clientSlug` | Default output filename (not a contract field). |
| `effectiveDate` | Normally left blank — Noa fills it. Provide e.g. `"2026-06-15"` only if you want it pre-filled. |
| `numRounds` | Normally left blank — Noa fills it. |
| `initialPackage` | Section 1.1 Initial Selection. Blank by default; optionally set to an Appendix A package name per contract, or `"Custom Package — see Section 2.1a"` for custom deals. |
| `isCustom` | `false` = standard. `true` = adds the "2.1a Custom Package Pricing" section; requires `monthlyFee` + ≥1 `performanceTiers`. |
| `monthlyFee` | if custom — e.g. `"USD 2,000 base per month"`. |
| `deliverables` | if custom — `[{ "item": "..." }]` → bulleted monthly deliverables. |
| `performanceTiers` | if custom — `[{ "metric": "...", "target": "...", "fee": "..." }]` → "metric — Target … — fee". |

**Party + signature fields are not placeholders.** Brand name, BR number, signatory
name/position, and sign dates are blank underlines; John fills them in PandaDoc.

Examples: `deals/example-standard.json` (standard — everything blank for Noa) and
`deals/zenwise.json` (custom — pricing block filled, date/rounds blank).
