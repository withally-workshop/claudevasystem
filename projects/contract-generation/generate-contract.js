#!/usr/bin/env node
/*
 * generate-contract.js
 *
 * Fills the Krave Media retainer template (template/retainer-template.docx) from a
 * deal JSON and writes a new contract .docx to output/. The master file in master/
 * is never read or touched by this script.
 *
 * Usage:
 *   node generate-contract.js --deal deals/<slug>.json [--out output/<file>.docx]
 *
 * Design notes:
 *   - Offline + deterministic. No network, no MCP, no secrets. The skill resolves
 *     client contact details (Gmail) and writes them into the deal JSON BEFORE this runs.
 *   - The automation fills ONLY the commercial terms (effectiveDate, numRounds,
 *     initialPackage, and the custom performance regime). The party/signature fields
 *     (brandName, brNumber, signatory name/position/dates) are left blank by design —
 *     John sets those up by hand in PandaDoc. They default to empty if omitted, and any
 *     field passed as "BLANK" also renders empty.
 *   - Custom deals (isCustom: true) require monthlyFee; performanceTiers are optional
 *     (fixed-fee custom deals have none). The template's {#isCustom}...{/isCustom} section
 *     renders the custom pricing, and {#hasPerformanceTiers} gates the performance regime.
 *   - terminationNotice (optional) overrides T&C 5.1 notice period; defaults to
 *     "thirty (30) days'" when omitted.
 *   - Fails loudly (non-zero exit, no file written) on any validation or render error,
 *     rather than emitting a half-filled legal document.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_DIR = __dirname;
const TEMPLATE_PATH = path.join(PROJECT_DIR, 'template', 'retainer-template.docx');
const OUTPUT_DIR = path.join(PROJECT_DIR, 'output');

// Commercial-term fields. ALL OPTIONAL by design: anything not provided renders as a blank
// fill-in line for Noa to complete by hand (effective date, # Rounds) or to optionally
// define per contract (Initial Package). When a value IS provided, it's written in.
// Party/signature fields (brand name, BR number, signatory name/position/dates) are not
// placeholders — the template leaves them as blank lines too.
const TERM_FIELDS = ['effectiveDate', 'numRounds', 'initialPackage'];

// Blank fill-in line per field (used when no value is provided) — matches the master PDF.
const FILL_LINE = {
  effectiveDate: '_________________',
  numRounds: '______',
  initialPackage: '________________________________',
};

// Every always-present placeholder the template resolves.
const ALL_FIELDS = [...TERM_FIELDS];

function fail(msg) {
  console.error(`\n[contract-generation] ERROR: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--deal') args.deal = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else fail(`unknown argument: ${a}`);
  }
  return args;
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function todayStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function validateDeal(deal) {
  // Term fields are all optional (blank → fill-in line). Only the custom block must cohere:
  // the {#isCustom} section needs a fee. Performance tiers are optional — fixed-fee custom
  // deals (e.g. Zyg) have none, and the template skips the performance section entirely.
  if (deal.isCustom === true) {
    if (!deal.monthlyFee || String(deal.monthlyFee).trim() === '') {
      fail('isCustom is true but monthlyFee is missing.');
    }
  }
}

// Keep Section 1.1 consistent with the deal type so a contract never references a 2.1a
// block that wasn't rendered: custom → always point to 2.1a; standard → never claim custom.
function normalizeInitialPackage(deal) {
  if (deal.isCustom === true) return 'Custom Package — see Section 2.1a';
  if (deal.initialPackage && /2\.1a|custom package/i.test(String(deal.initialPackage))) return '';
  return deal.initialPackage;
}

/**
 * Prepare the render context. A field that's missing/empty/"BLANK" renders as its blank
 * fill-in line (Noa completes it by hand); a provided value is written in. Also normalizes
 * the custom-branch sections so the template's conditional + loops behave.
 */
function buildContext(deal) {
  const normalized = { ...deal, initialPackage: normalizeInitialPackage(deal) };
  const ctx = {};
  for (const f of ALL_FIELDS) {
    const v = normalized[f];
    const blank = v === undefined || v === null || String(v).trim() === '' || v === 'BLANK';
    ctx[f] = blank ? FILL_LINE[f] : v;
  }
  ctx.isCustom = deal.isCustom === true;
  ctx.monthlyFee = deal.monthlyFee || '';
  ctx.deliverables = Array.isArray(deal.deliverables) ? deal.deliverables : [];
  ctx.performanceTiers = Array.isArray(deal.performanceTiers) ? deal.performanceTiers : [];
  ctx.hasPerformanceTiers = ctx.performanceTiers.length > 0;
  // T&C 5.1 notice period — per-deal override (e.g. "seven (7) days’"); default 30 days.
  const tn = deal.terminationNotice && String(deal.terminationNotice).trim();
  ctx.terminationNotice = tn || 'thirty (30) days’';
  return ctx;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.deal) {
    console.log(
      'Usage: node generate-contract.js --deal deals/<slug>.json [--out output/<file>.docx]'
    );
    process.exit(args.help ? 0 : 1);
  }

  // Dependencies (scoped to this project — run `npm install` here first).
  let PizZip, Docxtemplater;
  try {
    PizZip = require('pizzip');
    Docxtemplater = require('docxtemplater');
  } catch (e) {
    fail(
      'missing dependencies. Run `npm install` in projects/contract-generation/ ' +
        '(needs docxtemplater + pizzip).'
    );
  }

  // Validate inputs FIRST (cheap, no template needed) so input errors surface clearly.
  const dealPath = path.resolve(args.deal);
  if (!fs.existsSync(dealPath)) fail(`deal file not found: ${dealPath}`);

  let deal;
  try {
    deal = JSON.parse(fs.readFileSync(dealPath, 'utf8'));
  } catch (e) {
    fail(`could not parse deal JSON: ${e.message}`);
  }

  validateDeal(deal);
  const context = buildContext(deal);

  if (!fs.existsSync(TEMPLATE_PATH)) {
    fail(
      `template not found at ${TEMPLATE_PATH}. ` +
        `Build it once by hand: copy the master .docx and replace the commercial-term ` +
        `blanks + payment section with placeholders (see README.md).`
    );
  }

  // Resolve output path.
  let outPath = args.out;
  if (!outPath) {
    const slug = slugify(deal.clientSlug || deal.brandName || 'client');
    outPath = path.join(OUTPUT_DIR, `${slug}-retainer-${todayStamp()}.docx`);
  }
  outPath = path.resolve(outPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  // Render. Read as binary; write as nodebuffer (never UTF-8) or Word can't open it.
  let buf;
  try {
    const content = fs.readFileSync(TEMPLATE_PATH, 'binary');
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      // Unresolved tags are a template-authoring error — surface them, don't mask.
      nullGetter() {
        throw new Error('unresolved template tag (a placeholder has no matching data field)');
      },
    });
    doc.render(context);
    buf = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  } catch (e) {
    // docxtemplater multi-error surfacing.
    if (e.properties && Array.isArray(e.properties.errors)) {
      const details = e.properties.errors
        .map((err) => `  - ${err.name}: ${err.message}`)
        .join('\n');
      fail(`template render failed:\n${details}`);
    }
    fail(`template render failed: ${e.message}`);
  }

  fs.writeFileSync(outPath, buf);
  console.log(outPath);
}

main();
