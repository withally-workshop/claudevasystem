#!/usr/bin/env node
/*
 * reconstruct-template.js
 *
 * Authors the Krave Media retainer template (template/retainer-template.docx) from
 * scratch, faithful to the "MASTER CONTRACT - PANDADOC READY" start PDF (selection-based
 * contract: deliver {numRounds} Rounds + Initial Package selection + full Appendix A +
 * Terms & Conditions). Placeholders and the custom/performance conditional are baked in.
 *
 * Why reconstruct: the editable .docx that matched the start PDF was unavailable (the
 * same-named .docx had been customized for one client). John chose to rebuild it clean.
 * NOTE: this is a re-authoring of a legal document — wording is transcribed from the PDF;
 * John must review the rendered .docx before any real use.
 *
 * Output is the TEMPLATE (with placeholders). generate-contract.js fills it. The start
 * PDF in master/ is the visual source-of-record.
 *
 * Fields:
 *   {effectiveDate} {numRounds} {initialPackage}      — standard, always filled
 *   {#isCustom}...{/isCustom}                          — custom base-fee + performance block
 *     {monthlyFee}, {#deliverables}{item}{/deliverables}, {#performanceTiers}{metric}{target}{fee}{/performanceTiers}
 *   Party + signature fields are left as blank underlines (filled by hand in PandaDoc).
 *
 * Usage:  node reconstruct-template.js
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, HeadingLevel,
} = require('docx');

const OUT = path.join(__dirname, 'template', 'retainer-template.docx');
// Also bundle a copy into the Slack bot so its generate_contract tool ships the same
// template (the bot deploys separately on Render). Single authoring source → no drift.
const BOT_OUT = path.join(__dirname, '..', 'krave-bot', 'assets', 'retainer-template.docx');
const BLANK = '________________________';

// ---- paragraph helpers -------------------------------------------------------

function title(text) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [new TextRun({ text, bold: true, size: 32 })],
  });
}

function h(text) {
  return new Paragraph({
    spacing: { before: 200, after: 120 },
    children: [new TextRun({ text, bold: true, size: 24 })],
  });
}

// A numbered clause: bold "N.N Heading:" lead-in, then body (which may carry placeholders).
function clause(lead, body) {
  return new Paragraph({
    spacing: { after: 140 },
    children: [
      new TextRun({ text: lead + ' ', bold: true }),
      new TextRun({ text: body }),
    ],
  });
}

// Plain paragraph (also used for docxtemplater tag-only lines — paragraphLoop consumes them).
function p(text, opts = {}) {
  return new Paragraph({ spacing: { after: opts.after ?? 120 }, children: [new TextRun({ text, ...opts })] });
}

function bullet(text) {
  return new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text })] });
}

// ---- Appendix A pricing tables ----------------------------------------------

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
function packageCell(name, ads, lines, price) {
  return new TableCell({
    width: { size: 33, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: name, bold: true, color: '4F46E5' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: ads, bold: true })] }),
      ...lines.map((l) => new Paragraph({ spacing: { after: 30 }, children: [new TextRun({ text: '• ' + l, size: 18 })] })),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60 }, children: [new TextRun({ text: price, bold: true })] }),
    ],
  });
}
const CRS = 'Creative Research & Strategy (Competitor Landscape & Audience Research)';
const PGC = 'Perpetual global content rights';

function packageTable(cells) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: cells })],
  });
}

// ---- document ----------------------------------------------------------------

const partyTable = new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
  rows: [
    new TableRow({ children: [
      new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: 'Agency:', bold: true })] })] }),
      new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: 'Brand:', bold: true })] })] }),
    ] }),
    new TableRow({ children: [
      new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: [
        new Paragraph({ children: [new TextRun({ text: 'Eclipse Ventures PTE LTD (Krave Media)' })] }),
        new Paragraph({ children: [new TextRun({ text: '(hereinafter referred to as “Agency”)' })] }),
        new Paragraph({ children: [new TextRun({ text: 'UEN: 2024040972' })] }),
      ] }),
      new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: [
        new Paragraph({ children: [new TextRun({ text: BLANK })] }),
        new Paragraph({ children: [new TextRun({ text: '(hereinafter referred to as “Brand”)' })] }),
        new Paragraph({ children: [new TextRun({ text: 'BR Number: ' + BLANK })] }),
      ] }),
    ] }),
  ],
});

const children = [
  title('RETAINER AGREEMENT'),
  p('This Retainer Agreement (“Agreement”) is entered into by and between:'),
  partyTable,
  new Paragraph({ spacing: { before: 160, after: 160 }, children: [
    new TextRun({ text: 'Term: ', bold: true }),
    new TextRun({ text: 'This Agreement is effective ' }),
    new TextRun({ text: '{effectiveDate}' }),
    new TextRun({ text: ' on a month-to-month basis unless terminated in accordance with Section 5 of the Terms and Conditions.' }),
  ] }),

  h('1. SERVICES & DELIVERABLES'),
  new Paragraph({ spacing: { after: 140 }, children: [
    new TextRun({ text: 'The Agency will deliver ' }),
    new TextRun({ text: '{numRounds}' }),
    new TextRun({ text: ' Rounds of Work Product to the Brand. For each Round, the Brand may select any one of the Work Product packages set out in Appendix A (Work Product Options & Pricing).' }),
  ] }),
  new Paragraph({ spacing: { after: 140 }, children: [
    new TextRun({ text: '1.1 Initial Selection: ', bold: true }),
    new TextRun({ text: 'The Brand’s initial package selection for the first Round is: ' }),
    new TextRun({ text: '{initialPackage}' }),
    new TextRun({ text: ' (the “Initial Package”). Each subsequent Round will default to the Initial Package unless the Brand elects to change it in accordance with Section 1.2.' }),
  ] }),
  clause('1.2 Round-by-Round Flexibility:', 'The Brand may adjust and select a different Work Product package from Appendix A for any upcoming Round, provided that the Brand gives the Agency written notice of the change at least seven (7) calendar days before the start of the Round in question. Notice given less than seven (7) calendar days before the start of a Round will, at the Agency’s reasonable discretion, apply to the following Round instead.'),
  clause('1.3 Form of Notice:', 'Written notice for the purposes of Section 1.2 may be given by email to the Agency’s designated point of contact, or through any shared project management channel agreed between the parties. A change only takes effect once the Agency has acknowledged it in writing.'),
  clause('1.4 Standard Inclusions:', 'Every Work Product package includes, as a baseline: Creative Research & Strategy (Competitor Landscape & Audience Research), Ad Concepting & Scripting, the number of Video Ads, Content Creators or Custom Avatars set out for that package in Appendix A, Raw Footage (where applicable), the number of revisions after delivery specified for that package, and perpetual global content rights in accordance with Section 3 of the Terms and Conditions.'),
  clause('1.5 Custom Packages:', 'Custom packages may be tailored upon request and, once agreed in writing, will be treated as a validly selected package under this Agreement for the relevant Round(s).'),

  h('2. PAYMENT TERMS'),
  clause('2.1 Standard Fee:', 'The Brand shall compensate the Agency at the rate set out in Appendix A for the Work Product package selected for each Round. Where the selected package changes from one Round to another in accordance with Section 1.2, the fee for that Round shall automatically adjust to match the applicable Appendix A rate for the newly selected package.'),

  // ---- custom/performance conditional block (excluded for standard deals) ----
  p('{#isCustom}', { after: 0 }),
  new Paragraph({ spacing: { after: 120 }, children: [
    new TextRun({ text: '2.1a Custom Package Pricing: ', bold: true }),
    new TextRun({ text: 'Notwithstanding Section 2.1, the parties have agreed a custom package for this engagement. The Brand shall pay the Agency a monthly base fee of ' }),
    new TextRun({ text: '{monthlyFee}' }),
    new TextRun({ text: '. The custom package includes the following monthly deliverables:' }),
  ] }),
  new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text: '{#deliverables}{item}{/deliverables}' })] }),
  p('Performance Incentives apply as follows:'),
  new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text: '{#performanceTiers}{metric} — Target {target} — {fee}{/performanceTiers}' })] }),
  p('{/isCustom}', { after: 120 }),

  clause('2.2 Commitment & Discount:', 'The standard commitment under this Agreement is three (3) Rounds. If the parties agree in writing to a six (6) Round commitment, a fifteen percent (15%) discount shall be applied to the Appendix A rate of each Round covered by that commitment.'),
  clause('2.3 Payment Schedule:', 'The Agency will begin work when this Agreement has been signed by both parties. The Agency will invoice the Brand after delivery of each Round of Work Product. Invoices must be paid within seven (7) business days. A late charge of US$200 per month will be applied to invoices not paid on time.'),
  clause('2.4 Method of Payment:', 'Payments must be made to the Agency by credit card, bank transfer, or any other approved method of payment as indicated on the invoice.'),

  h('3. USAGE RIGHTS'),
  clause('3.1 Ad Usage Rights:', 'The Brand has full organic usage and global ad usage rights of the Work Product in perpetuity when running ads through its own social accounts.'),

  // signature block
  new Paragraph({ spacing: { before: 240, after: 60 }, children: [new TextRun({ text: 'Agency Signature:', bold: true })] }),
  p('Print Name: Noa Nederpelt', { after: 20 }),
  p('Position: Director, Krave Media', { after: 20 }),
  p('Date: ' + BLANK, { after: 160 }),
  new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: 'Brand Signature:', bold: true })] }),
  p('Print Name: ' + BLANK, { after: 20 }),
  p('Position: ' + BLANK, { after: 20 }),
  p('Date: ' + BLANK, { after: 20 }),
];

// ---- Terms and Conditions (new page) ----------------------------------------

const tc = [
  { lead: '1.1 Delivery Schedule:', body: 'The Agency will deliver the Work Product on a monthly basis. The Brand will be informed of the delivery date upon the start of each Round of Work Product.' },
  { lead: '1.2 Round Adjustment Notice:', body: 'As set out in Section 1.2 of the main Agreement, the Brand may adjust the Work Product package for any upcoming Round by giving at least seven (7) calendar days’ written notice before that Round begins. Any Round that has already commenced cannot be changed mid-Round; adjustments apply to the next Round that has not yet started.' },
  { lead: '1.3 Performance Analytics:', body: 'The Brand agrees to provide the Agency with performance statistics and analytics related to the utilization of the Work Product on the last day of every month. The provided information will include relevant data on the spend allocated, usage, engagement, reach, and any other metrics deemed necessary for evaluating the effectiveness and impact of the Work Product. The Brand will make reasonable efforts to compile and present accurate and comprehensive data.' },
  { lead: '1.4 Product(s):', body: 'The Brand shall bear all costs related to product distribution, including but not limited to shipping fees. Creators employed on behalf of the Agency to execute the Work Product shall retain ownership of the product(s) and shall not be obliged to return them to the Brand. Prescription products will need to be returned after the Work Product has been delivered.' },
  { lead: '1.5 Work Repurposing:', body: 'If the Brand wishes to repurpose and/or re-edit the Work Product provided by the Agency, the Brand has the right to do so.' },
  { h: '2. PAYMENT' },
  { lead: '2.1 Expenses:', body: 'Any expenses incurred by the Agency or its Creators in producing the Work Product for the Brand shall be borne by the Agency with the exception of expenses related to product distribution.' },
  { h: '3. OWNERSHIP' },
  { lead: '3.1 Usage Rights:', body: 'The Brand has full organic usage and global ad usage rights of the Work Product in perpetuity.' },
  { lead: '3.2 Ownership of Work Product:', body: 'The Brand shall have perpetual, irrevocable ownership of all Work Product, including raw footage, materials, and content created by the Agency in connection with the Services and Deliverables provided under this Agreement. The Agency hereby assigns and transfers to the Brand all rights, title, and interest in the Work Product, including any intellectual property rights therein.' },
  { lead: '3.3 Agency’s Use of Work Product:', body: 'The Brand gives permission for the Agency to use the Work Product as part of portfolios, websites, and other media, including social media, so long as it is to showcase the work and not for any other purpose.' },
  { lead: '3.4 Agency’s Help Securing Ownership:', body: 'The Agency will make reasonable efforts to assist the Brand in securing ownership of the Work Product, including signing documents, such as patent applications. The Brand will pay any required expenses.' },
  { lead: '3.5 Agency’s Right To Use Brand Intellectual Property:', body: 'The Agency may use the Brand’s intellectual property to the extent reasonably necessary to complete the Work Product. Beyond that, the Agency does not acquire any other intellectual property rights.' },
  { h: '4. REPRESENTATIONS' },
  { lead: '4.1 Authority To Sign:', body: 'Each party promises that it has the authority to enter into this Contract and perform all obligations under it.' },
  { lead: '4.2 Agency Has Right To Give The Brand Work Product:', body: 'The Agency promises that it owns the Work Product and that no other party will claim ownership.' },
  { lead: '4.3 Agency Will Comply With Laws:', body: 'The Agency promises that the manner in which it delivers the Work Product and any background intellectual property complies with local and foreign laws.' },
  { lead: '4.4 Brand Will Review Work:', body: 'The Brand agrees to review the Work Product and be reasonably available to provide timely feedback. The number of editing revisions per Round included is the number specified for the selected package in Appendix A. Additional revisions beyond that number, and any filming revisions, are available upon request for an additional fee, unless the Agency is at fault.' },
  { h: '5. TERM AND TERMINATION' },
  { lead: '5.1 Termination for Convenience:', body: 'Either party may terminate this Agreement at any time, for any reason, with thirty (30) days’ written notice.' },
  { lead: '5.2 Effect of Termination:', body: 'The Brand shall only be responsible for payment for Work Product that has been fully delivered and accepted by the Brand prior to the effective termination date. No fees shall be owed for any Work Product that is incomplete, partially delivered, or in progress at the time of termination.' },
  { lead: '5.3 Early Termination of Discounted Commitment:', body: 'No penalties or additional fees shall apply upon termination, except as set out in this Section 5.3. Where the parties have agreed a six (6) Round discounted commitment and the Brand terminates this Agreement before the sixth Round has been completed, the fifteen percent (15%) discount previously applied to each Round already delivered shall be clawed back. The Brand shall pay the Agency, within seven (7) business days of the effective termination date, an amount equal to the total discount granted on all Rounds delivered under the discounted commitment (i.e. the difference between the full Appendix A rate and the discounted rate charged for each such Round). For the avoidance of doubt, no clawback applies to the standard three (3) Round commitment, and no clawback applies in respect of Rounds that have not yet commenced.' },
  { h: '6. CONFIDENTIAL INFORMATION' },
  { plain: 'While working for the Brand, the Agency may encounter confidential information. The Agency agrees to treat this information as its own confidential information and promises not to share it with third parties without the Brand’s written permission. This obligation continues even after the Contract ends.' },
  { h: '7. GENERAL' },
  { lead: '7.1 Modification Waiver:', body: 'Changes to this Contract must be agreed upon in writing and signed by both parties. For the avoidance of doubt, a Round package change made in accordance with Section 1.2 of the main Agreement does not require a full re-signature and is effective upon written acknowledgement by the Agency.' },
  { lead: '7.2 Severability:', body: 'If any portion of this Contract is found to be unenforceable, the rest of the Contract remains enforceable.' },
  { lead: '7.3 Signatures:', body: 'The Brand and the Agency will sign this document using an electronic signing platform. These electronic signatures count as originals for all purposes.' },
  { lead: '7.4 Governing Law:', body: 'The laws of Singapore govern the rights and obligations under this Contract.' },
  { lead: '7.5 Entire Contract:', body: 'This Contract, together with Appendix A, represents the final and complete understanding of this job and supersedes all other contracts between the parties.' },
];

children.push(new Paragraph({ pageBreakBefore: true, children: [] }));
children.push(title('TERMS AND CONDITIONS'));
children.push(h('1. WORK'));
for (const item of tc) {
  if (item.h) children.push(h(item.h));
  else if (item.plain) children.push(p(item.plain));
  else children.push(clause(item.lead, item.body));
}

// ---- Appendix A (new page) ---------------------------------------------------

const creatorLines = (creators, rev) => ['12 Video Ads (4 Concepts x 3 Hook Variations)', creators, CRS, rev, PGC];
children.push(new Paragraph({ pageBreakBefore: true, children: [] }));
children.push(title('APPENDIX A'));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: 'Work Product Options & Pricing', bold: true })] }));
children.push(p('The following packages are available for selection on a Round-by-Round basis in accordance with Section 1 of the Agreement. All prices are in USD and apply per Round. All packages include Creative Research & Strategy (Competitor Landscape & Audience Research) and perpetual global content rights.'));

children.push(h('A.1 Creator Led Direct Response'));
children.push(p('High-performance creator-led UGC ads produced with real content creators across the Agency’s global network.'));
children.push(packageTable([
  packageCell('Starter Pack', '12 Ads in Total', ['12 Video Ads (4 Concepts x 3 Hook Variations)', '2 Content Creators', CRS, '1 Revision After Delivery', PGC], 'USD 4,600'),
  packageCell('Growth Pack', '18 Ads in Total', ['18 Video Ads (6 Concepts x 3 Hook Variations)', '3 Content Creators', CRS, '2 Revisions After Delivery', PGC], 'USD 6,200'),
  packageCell('Blitzscale Pack', '24 Ads in Total', ['24 Video Ads (8 Concepts x 3 Hook Variations)', '4 Content Creators', CRS, '3 Revisions After Delivery', PGC], 'USD 7,300'),
]));

children.push(h('A.2 Creator Led Direct Response — Scale Packs'));
children.push(p('For Brands scaling aggressively with larger creative volume requirements.'));
children.push(packageTable([
  packageCell('Rocket Fuel Pack', '36 Ads in Total', ['36 Video Ads (12 Concepts x 3 Hook Variations)', '6 Content Creators', CRS, '3 Revisions After Delivery', PGC], 'USD 10,300'),
  packageCell('Rocket Fuel Plus Pack', '48 Ads in Total', ['48 Video Ads (16 Concepts x 3 Hook Variations)', '8 Content Creators', CRS, '3 Revisions After Delivery', PGC], 'USD 12,800'),
]));

children.push(h('A.3 Remix / AI Led Direct Response'));
children.push(p('AI-led ad production using Custom Avatars in place of real creators, for faster turnaround and lower cost.'));
children.push(packageTable([
  packageCell('Starter Pack', '12 Ads in Total', ['12 Video Ads (4 Concepts x 3 Hook Variations)', '2 Custom Avatars', CRS, '1 Revision After Delivery', PGC], 'USD 3,200'),
  packageCell('Growth Pack', '18 Ads in Total', ['18 Video Ads (6 Concepts x 3 Hook Variations)', '3 Custom Avatars', CRS, '2 Revisions After Delivery', PGC], 'USD 4,300'),
  packageCell('Blitzscale Pack', '24 Ads in Total', ['24 Video Ads (8 Concepts x 3 Hook Variations)', '4 Custom Avatars', CRS, '3 Revisions After Delivery', PGC], 'USD 5,100'),
]));

children.push(new Paragraph({ spacing: { before: 160 }, children: [
  new TextRun({ text: 'Notes: ', bold: true }),
  new TextRun({ text: 'Custom packages can be tailored upon request. Standard commitment is three (3) Rounds. A 15% discount is applied to the per-Round rate where a six (6) Round commitment is agreed in writing. Package selection for any upcoming Round may be changed by the Brand with at least seven (7) calendar days’ written notice in accordance with Section 1.2 of the Agreement.' }),
] }));

const doc = new Document({ sections: [{ children }] });
Packer.toBuffer(doc).then((buf) => {
  for (const out of [OUT, BOT_OUT]) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, buf);
    console.log('Wrote', out);
  }
});
