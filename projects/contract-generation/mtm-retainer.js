#!/usr/bin/env node
/*
 * mtm-retainer.js
 *
 * Authors the month-to-month custom-package retainer agreements (FluffCo structure:
 * no Rounds commitment in the main agreement, no Appendix A). Final contracts, not
 * templates — party/signature fields stay blank for PandaDoc.
 *
 * Both client configs live below so the shared legal text is authored once and cannot
 * drift between contracts. Deltas per client: base fee, effective/start date, payment
 * terms, and whether the performance fee is payable ABOVE the base fee ('above-base',
 * FluffCo) or IN ADDITION to it ('on-top', Zenwise — Noa 2026-06-12).
 *
 * Per Noa 2026-06-12: the whitelisting block lives in the Terms & Conditions ONLY
 * (Section 3.2), not in the main agreement; tier basis is "monthly ad spend on
 * Krave-provided creatives"; tiers are flat-rate.
 *
 * Usage:  node mtm-retainer.js          (writes both contracts to output/)
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, AlignmentType, PageBreak,
  Table, TableRow, TableCell, WidthType, BorderStyle,
} = require('docx');

const OUTPUT_DIR = path.join(__dirname, 'output');
const BLANK = '________________________';

function todayStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

// ---- client configs ----------------------------------------------------------

const TIERS = [
  ['Up to US$50,000', '7.50%'],
  ['Up to US$150,000', '5.00%'],
  ['Up to US$250,000', '3.00%'],
  ['US$250,001 and above', '2.00%'],
];
const TIER_BASIS = 'monthly ad spend on Krave-provided creatives';

const CLIENTS = [
  {
    slug: 'fluffco-mtm',
    baseFee: 'US$2,500',
    effectiveDate: 'June 15, 2026',
    startDate: 'June 15, 2026',
    paymentTerms: 'fifteen (15) calendar days of the invoice date (net 15)',
    perfMode: 'above-base',
  },
  {
    slug: 'zenwise-mtm',
    baseFee: 'US$2,000',
    effectiveDate: BLANK,
    startDate: BLANK,
    paymentTerms: 'seven (7) business days',
    perfMode: 'on-top',
  },
];

// ---- paragraph helpers ---------------------------------------------------------

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

function clause(lead, body) {
  return new Paragraph({
    spacing: { after: 140 },
    children: [
      new TextRun({ text: lead + ' ', bold: true }),
      new TextRun({ text: body }),
    ],
  });
}

function p(text, opts = {}) {
  return new Paragraph({ spacing: { after: opts.after ?? 120 }, children: [new TextRun({ text, ...opts })] });
}

function bullet(text) {
  return new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text })] });
}

// Parties table. Explicit DXA column widths + grid are required: Word tolerates a
// percentage-only table, but Google Drive's docx preview collapses it to an empty box.
const COL_W = 4675; // half of the usable width on A4/Letter with 1" margins, in twips
const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'auto' };
function partiesTable() {
  const cell = (lines) => new TableCell({
    width: { size: COL_W, type: WidthType.DXA },
    borders: { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER },
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: lines.map(([text, bold]) => new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text, bold: !!bold })] })),
  });
  return new Table({
    columnWidths: [COL_W, COL_W],
    width: { size: COL_W * 2, type: WidthType.DXA },
    rows: [
      new TableRow({ children: [cell([['Agency:', true]]), cell([['Brand:', true]])] }),
      new TableRow({
        children: [
          cell([
            ['Eclipse Ventures PTE LTD (Krave Media)'],
            ['(hereinafter referred to as “Agency”)'],
            ['UEN: 2024040972'],
          ]),
          cell([
            [BLANK],
            ['(hereinafter referred to as “Brand”)'],
            ['BR Number: ' + BLANK],
          ]),
        ],
      }),
    ],
  });
}

// ---- the agreement -------------------------------------------------------------

function perfClosing(c) {
  return c.perfMode === 'above-base'
    ? `The performance-based fee shall be payable only to the extent that such fee exceeds the ${c.baseFee} monthly base fee in the applicable month.`
    : `The performance-based fee is payable in addition to the ${c.baseFee} monthly base fee.`;
}

function buildDoc(c) {
  const children = [
    title('RETAINER AGREEMENT'),
    p('This Retainer Agreement (“Agreement”) is entered into by and between:'),
    partiesTable(),
    p('', { after: 120 }),
    new Paragraph({
      spacing: { after: 160 },
      children: [
        new TextRun({ text: 'Term: ', bold: true }),
        new TextRun({ text: `This Agreement is effective ${c.effectiveDate} on a month-to-month basis unless terminated in accordance with Section 5 of the Terms and Conditions.` }),
      ],
    }),

    h('1. SERVICES & DELIVERABLES'),
    p('The Agency will provide the Services and Deliverables to the Brand on a monthly basis under a custom package arrangement. The monthly base fee includes whitelisting access for a minimum of two (2) content creators per month, together with the minimum monthly deliverables set out in this Section 1.'),
    clause('1.1 Monthly Deliverables:', 'At the monthly base fee level, the Agency will provide a minimum of six (6) concepts per month, being three (3) concepts per content creator, with three (3) variations per concept, for an estimated total of eighteen (18) ads per month.'),
    clause('1.2 Included Services:', 'The Services include creative research and strategy, ad concepting and scripting, edited creative assets, whitelisting access for the included content creators, and raw footage obtained from the content creators, which will also be handed over to the Brand’s internal team.'),
    clause('1.3 Output Flexibility:', 'The monthly deliverables set out in Sections 1.1 and 1.2 are minimum deliverables only. There shall be no fixed maximum number of concepts, variations, or creator resources, and the Agency may allocate additional concepts, variations, and creator resources as performance scales.'),
    clause('1.4 Custom Package:', 'The parties acknowledge that the Services and Deliverables under this Agreement are being provided under a custom package agreed in writing between the parties.'),
    clause('1.5 Start Date:', `The parties agree that work under this Agreement will commence on ${c.startDate}, or on such other date as the parties may agree in writing.`),

    h('2. PAYMENT TERMS'),
    clause('2.1 Base Fee:', `The Brand shall pay the Agency a monthly base fee of ${c.baseFee} for the Services and Deliverables set out in this Agreement.`),
    clause('2.2 Performance Fee:', `The performance-based fee shall be calculated in accordance with the Brand’s standard performance tiers, based on ${TIER_BASIS}, on a flat-rate basis (the rate of the tier in which the applicable month’s total falls applies to the full amount):`),
    ...TIERS.map(([t, f]) => bullet(`${t} — ${f}`)),
    p(perfClosing(c)),
    clause('2.3 Payment Schedule:', `The Agency will begin work when this Agreement has been signed by both parties. The Agency will invoice the Brand on a monthly basis for the base fee and any applicable performance-based fee. Invoices must be paid within ${c.paymentTerms}. A late charge of US$200 per month will be applied to invoices not paid on time.`),

    h('3. USAGE RIGHTS'),
    clause('3.1 Ad Usage Rights:', 'The Brand has full organic usage and global ad usage rights of the Work Product in perpetuity when running ads through its own social accounts. Whitelisting terms are set out in Section 3.2 of the Terms and Conditions.'),

    p('', { after: 200 }),
    p('Agency Signature:', { bold: true }),
    p('', { after: 200 }),
    p('Print Name: Noa Nederpelt'),
    p('Position: Director, Krave Media'),
    p('Date: ' + BLANK),
    p('', { after: 200 }),
    p('Brand Signature:', { bold: true }),
    p('', { after: 200 }),
    p('Print Name: ' + BLANK),
    p('Position: ' + BLANK),
    p('Date: ' + BLANK),

    new Paragraph({ children: [new PageBreak()] }),
    title('TERMS AND CONDITIONS'),

    h('1. WORK'),
    clause('1.1 Delivery Schedule:', 'The Agency will deliver the Work Product on a monthly basis. The Brand will be informed of the delivery date upon the start of each Round of Work Product.'),
    clause('1.2 Round Adjustment Notice:', 'The Brand may adjust the agreed Work Product package for any upcoming monthly Round by giving at least seven (7) calendar days’ written notice before that Round begins. Any Round that has already commenced cannot be changed mid-Round; adjustments apply to the next Round that has not yet started.'),
    clause('1.3 Performance Analytics:', 'The Brand agrees to provide the Agency with performance statistics and analytics related to the utilization of the Work Product on the last day of every month. The provided information will include relevant data on the spend allocated, usage, engagement, reach, and any other metrics deemed necessary for evaluating the effectiveness and impact of the Work Product. The Brand will make reasonable efforts to compile and present accurate and comprehensive data.'),
    clause('1.4 Product(s):', 'The Brand shall bear all costs related to product distribution, including but not limited to shipping fees. Creators employed on behalf of the Agency to execute the Work Product shall retain ownership of the product(s) and shall not be obliged to return them to the Brand. Prescription products will need to be returned after the Work Product has been delivered.'),
    clause('1.5 Work Repurposing:', 'If the Brand wishes to repurpose and/or re-edit the Work Product provided by the Agency, the Brand has the right to do so.'),

    h('2. PAYMENT'),
    clause('2.1 Expenses:', 'Any expenses incurred by the Agency or its Creators in producing the Work Product for the Brand shall be borne by the Agency with the exception of expenses related to product distribution.'),

    h('3. OWNERSHIP'),
    clause('3.1 Usage Rights:', 'The Brand has full organic usage and global ad usage rights of the Work Product in perpetuity when running ads through its own social accounts.'),
    clause('3.2 Whitelisting:', `The monthly base fee of ${c.baseFee} includes whitelisting access for a minimum of two (2) content creators for a period of thirty (30) days, covered by the Agency at no additional cost to the Brand. At this base level, the Agency will provide a minimum of six (6) concepts per month, being three (3) concepts per content creator, with three (3) variations per concept, for an estimated total of eighteen (18) ads per month. This is a minimum deliverable only, and additional concepts, variations, and creator resources may be allocated as performance scales. Raw footage obtained from the content creators will also be provided to the Brand’s internal team. If the Brand wishes to extend the whitelisting partnership beyond the initial thirty (30) day period, the applicable content creator fee shall apply on the same terms as the Agency’s other packages that include whitelisting, and shall be the Brand’s responsibility. Continued whitelisting fees shall not exceed US$150 per content creator per month, with typical fees averaging US$50 per creator per month. The applicable fee for each content creator will be set out in writing in the creator proposal before that creator is engaged. Any performance-based fees shall apply as set out in Section 2.2 of the main Agreement.`),
    clause('3.3 Ownership of Work Product:', 'The Brand shall have perpetual, irrevocable ownership of all Work Product, including raw footage, materials, and content created by the Agency in connection with the Services and Deliverables provided under this Agreement. The Agency hereby assigns and transfers to the Brand all rights, title, and interest in the Work Product, including any intellectual property rights therein.'),
    clause('3.4 Agency’s Use of Work Product:', 'The Brand gives permission for the Agency to use the Work Product as part of portfolios, websites, and other media, including social media, so long as it is to showcase the work and not for any other purpose.'),
    clause('3.5 Agency’s Help Securing Ownership:', 'The Agency will make reasonable efforts to assist the Brand in securing ownership of the Work Product, including signing documents, such as patent applications. The Brand will pay any required expenses.'),
    clause('3.6 Agency’s Right To Use Brand Intellectual Property:', 'The Agency may use the Brand’s intellectual property to the extent reasonably necessary to complete the Work Product. Beyond that, the Agency does not acquire any other intellectual property rights.'),

    h('4. REPRESENTATIONS'),
    clause('4.1 Authority To Sign:', 'Each party promises that it has the authority to enter into this Contract and perform all obligations under it.'),
    clause('4.2 Agency Has Right To Give The Brand Work Product:', 'The Agency promises that it owns the Work Product and that no other party will claim ownership.'),
    clause('4.3 Agency Will Comply With Laws:', 'The Agency promises that the manner in which it delivers the Work Product and any background intellectual property complies with local and foreign laws.'),
    clause('4.4 Brand Will Review Work:', 'The Brand agrees to review the Work Product and be reasonably available to provide timely feedback. The number of editing revisions per Round included shall be as agreed in writing between the parties for this custom package. Additional revisions beyond that number, and any filming revisions, are available upon request for an additional fee, unless the Agency is at fault.'),

    h('5. TERM AND TERMINATION'),
    clause('5.1 Termination for Convenience:', 'Either party may terminate this Agreement at any time, for any reason, with thirty (30) days’ written notice.'),
    clause('5.2 Effect of Termination:', 'The Brand shall only be responsible for payment for Work Product that has been fully delivered and accepted by the Brand prior to the effective termination date. No fees shall be owed for any Work Product that is incomplete, partially delivered, or in progress at the time of termination.'),
    clause('5.3 Early Termination of Discounted Commitment:', 'No penalties or additional fees shall apply upon termination, except as set out in this Section 5.3. Where the parties have agreed a six (6) Round discounted commitment and the Brand terminates this Agreement before the sixth Round has been completed, the fifteen percent (15%) discount previously applied to each Round already delivered shall be clawed back. The Brand shall pay the Agency, within seven (7) business days of the effective termination date, an amount equal to the total discount granted on all Rounds delivered under the discounted commitment (i.e. the difference between the full agreed custom package rate and the discounted rate charged for each such Round). For the avoidance of doubt, no clawback applies to the standard three (3) Round commitment, and no clawback applies in respect of Rounds that have not yet commenced.'),

    h('6. CONFIDENTIAL INFORMATION'),
    p('While working for the Brand, the Agency may encounter confidential information. The Agency agrees to treat this information as its own confidential information and promises not to share it with third parties without the Brand’s written permission. This obligation continues even after the Contract ends.'),

    h('7. GENERAL'),
    clause('7.1 Modification Waiver:', 'Changes to this Contract must be agreed upon in writing and signed by both parties. For the avoidance of doubt, a Round package change made in accordance with Section 1.2 of these Terms and Conditions does not require a full re-signature and is effective upon written acknowledgement by the Agency.'),
    clause('7.2 Severability:', 'If any portion of this Contract is found to be unenforceable, the rest of the Contract remains enforceable.'),
    clause('7.3 Signatures:', 'The Brand and the Agency will sign this document using an electronic signing platform. These electronic signatures count as originals for all purposes.'),
    clause('7.4 Governing Law:', 'The laws of Singapore govern the rights and obligations under this Contract.'),
    clause('7.5 Entire Contract:', 'This Contract represents the final and complete understanding of this job and supersedes all other contracts between the parties.'),
  ];

  return new Document({ sections: [{ children }] });
}

// ---- main ----------------------------------------------------------------------

(async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const c of CLIENTS) {
    const buf = await Packer.toBuffer(buildDoc(c));
    const out = path.join(OUTPUT_DIR, `${c.slug}-retainer-${todayStamp()}.docx`);
    fs.writeFileSync(out, buf);
    console.log(out);
  }
})();
