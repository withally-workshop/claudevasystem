'use strict';

/*
 * generate_contract — fills the Krave Media retainer template into a .docx and posts it
 * as a file in the current Slack thread.
 *
 * The fill logic mirrors projects/contract-generation/generate-contract.js (the local CLI
 * source of truth). The template (assets/retainer-template.docx) is regenerated alongside
 * the project copy by projects/contract-generation/reconstruct-template.js — keep both in
 * sync by rerunning that script; never hand-edit either .docx.
 *
 * Requires the Slack app to have the `files:write` scope.
 */

const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { WebClient } = require('@slack/web-api');

const TEMPLATE = path.join(__dirname, '..', 'assets', 'retainer-template.docx');

// Blank fill-in line per term field (used when no value is given) — Noa completes by hand.
const FILL_LINE = {
  effectiveDate: '_________________',
  numRounds: '______',
  initialPackage: '________________________________',
};
const TERM_FIELDS = ['effectiveDate', 'numRounds', 'initialPackage'];

function slugify(s) {
  return String(s || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function buildContext(deal) {
  const ctx = {};
  for (const f of TERM_FIELDS) {
    const v = deal[f];
    const blank = v === undefined || v === null || String(v).trim() === '' || v === 'BLANK';
    ctx[f] = blank ? FILL_LINE[f] : v;
  }
  ctx.isCustom = deal.isCustom === true;
  ctx.monthlyFee = deal.monthlyFee || '';
  ctx.deliverables = Array.isArray(deal.deliverables) ? deal.deliverables : [];
  ctx.performanceTiers = Array.isArray(deal.performanceTiers) ? deal.performanceTiers : [];
  return ctx;
}

function renderDocx(deal) {
  // Custom-deal coherence — the {#isCustom} block needs a fee + at least one tier.
  if (deal.isCustom === true) {
    if (!deal.monthlyFee || String(deal.monthlyFee).trim() === '') {
      throw new Error('Custom deal needs a monthlyFee.');
    }
    if (!Array.isArray(deal.performanceTiers) || deal.performanceTiers.length === 0) {
      throw new Error('Custom deal needs at least one performanceTier.');
    }
  }
  if (!fs.existsSync(TEMPLATE)) throw new Error('Contract template not found in bot deploy.');
  const zip = new PizZip(fs.readFileSync(TEMPLATE, 'binary'));
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, nullGetter: () => '' });
  doc.render(buildContext(deal));
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function generateContract(input) {
  const { channel, thread_ts, initial_comment, filename } = input;
  if (!channel) return { error: 'channel is required (the Slack channel ID to post the file in).' };

  let buffer;
  try {
    buffer = renderDocx(input);
  } catch (e) {
    return { error: e.message };
  }

  const name = filename || `${slugify(input.clientSlug)}-retainer.docx`;
  try {
    const web = new WebClient(process.env.SLACK_BOT_TOKEN);
    const res = await web.files.uploadV2({
      channel_id: channel,
      thread_ts,
      file: buffer,
      filename: name,
      title: name,
      initial_comment:
        initial_comment ||
        'Draft retainer contract. Review, then send to Noa for approval before uploading to PandaDoc.',
    });
    const file = res && res.files && res.files[0] && (res.files[0].files ? res.files[0].files[0] : res.files[0]);
    return { ok: true, filename: name, permalink: (file && file.permalink) || null };
  } catch (e) {
    const hint = /missing_scope|not_allowed|files:write/i.test(e.message)
      ? ' (the Slack app likely needs the files:write scope)'
      : '';
    return { error: `Upload failed: ${e.message}${hint}` };
  }
}

module.exports = {
  definitions: [
    {
      name: 'generate_contract',
      description:
        'Generate a Krave Media client retainer contract (.docx) and post it as a file in the current Slack thread. ' +
        'Use after John confirms the deal terms. Effective date and # Rounds are normally left blank for Noa to fill — only set them if John gives values. ' +
        'Never set brand name, BR number, or signatory details (left blank for PandaDoc). For a custom/performance deal set isCustom=true and provide monthlyFee + deliverables + performanceTiers. ' +
        'Pass channel and thread_ts from the message context so the file lands in the right thread.',
      input_schema: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: 'Slack channel ID to post the file in (from the [Slack Channel: ...] message context)' },
          thread_ts: { type: 'string', description: 'Thread timestamp to post the file into (from [Slack Thread TS: ...])' },
          clientSlug: { type: 'string', description: 'Short client name for the filename, e.g. "zenwise"' },
          isCustom: { type: 'boolean', description: 'true for a custom base-fee + performance deal; false for a standard Appendix A package' },
          initialPackage: { type: 'string', description: 'Section 1.1 Initial Selection — an Appendix A package name, or "Custom Package — see Section 2.1a". Leave empty for a blank fill-in line.' },
          effectiveDate: { type: 'string', description: 'Normally leave empty (Noa fills). Only set to pre-fill the Term date.' },
          numRounds: { type: 'string', description: 'Normally leave empty (Noa fills "deliver ___ Rounds").' },
          monthlyFee: { type: 'string', description: 'Custom deals only — e.g. "USD 2,000 base per month".' },
          deliverables: {
            type: 'array',
            description: 'Custom deals only — bulleted monthly deliverables.',
            items: { type: 'object', properties: { item: { type: 'string' } }, required: ['item'] },
          },
          performanceTiers: {
            type: 'array',
            description: 'Custom deals only — performance schedule rows.',
            items: {
              type: 'object',
              properties: { metric: { type: 'string' }, target: { type: 'string' }, fee: { type: 'string' } },
              required: ['metric', 'target', 'fee'],
            },
          },
          filename: { type: 'string', description: 'Optional output filename, e.g. "zenwise-retainer.docx".' },
          initial_comment: { type: 'string', description: 'Optional message posted with the file.' },
        },
        required: ['channel', 'isCustom'],
      },
    },
  ],
  handlers: { generate_contract: generateContract },
};
