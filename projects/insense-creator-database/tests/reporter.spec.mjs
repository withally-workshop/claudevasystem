import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDailySlackSummary,
  buildDailySummary,
  buildRunSummary,
  buildSlackSummary,
} from '../lib/reporter.mjs';

test('formats review summary counts', () => {
  const summary = buildRunSummary('Halo Home', 'review', [
    { status: 'qualified' },
    { status: 'skipped' },
    { status: 'skipped' },
  ]);

  assert.match(summary, /Halo Home/);
  assert.match(summary, /review/i);
  assert.match(summary, /Qualified: 1/);
  assert.match(summary, /Skipped: 2/);
});

test('builds a slack summary for review mode', () => {
  const summary = buildSlackSummary('Halo Home', 'review', [
    { status: 'qualified', invite: true, username: 'creator.one' },
    { status: 'qualified', invite: false, blockReason: 'Previous collaborator', username: 'creator.two' },
    { status: 'skipped', skipReason: 'No portfolio uploads', username: 'creator.three' },
  ]);

  assert.match(summary, /Insense Outreach Report/);
  assert.match(summary, /Halo Home/);
  assert.match(summary, /Mode: review/);
  assert.match(summary, /Qualified: 2/);
  assert.match(summary, /Auto-invite ready: 1/);
  assert.match(summary, /Blocklisted: 1/);
  assert.match(summary, /Skipped: 1/);
});

test('builds a slack summary for send mode', () => {
  const summary = buildSlackSummary('Halo Home', 'send', [
    { status: 'messaged', username: 'creator.one' },
    { status: 'already_messaged', username: 'creator.two' },
    { status: 'skipped', username: 'creator.three', blockReason: 'Previous collaborator' },
  ]);

  assert.match(summary, /Mode: send/);
  assert.match(summary, /Messaged: 1/);
  assert.match(summary, /Already Messaged: 1/);
  assert.match(summary, /Skipped: 1/);
});

test('builds a daily summary across campaigns', () => {
  const summary = buildDailySummary('2026-04-29', [
    {
      campaign: 'Halo Home',
      mode: 'review',
      records: [
        { status: 'qualified' },
        { status: 'skipped' },
      ],
    },
    {
      campaign: 'Halo Home',
      mode: 'send',
      records: [
        { status: 'messaged' },
      ],
    },
    {
      campaign: 'Little Saints',
      mode: 'send',
      records: [
        { status: 'already_messaged' },
      ],
    },
  ]);

  assert.equal(summary.date, '2026-04-29');
  assert.equal(summary.campaigns.length, 2);
  assert.equal(summary.totals.reviewed, 2);
  assert.equal(summary.totals.qualified, 1);
  assert.equal(summary.totals.skipped, 1);
  assert.equal(summary.totals.messaged, 1);
  assert.equal(summary.totals.alreadyMessaged, 1);
});

test('builds a daily slack summary', () => {
  const text = buildDailySlackSummary({
    date: '2026-04-29',
    campaigns: [
      {
        campaign: 'Halo Home',
        reviewed: 3,
        qualified: 2,
        skipped: 1,
        messaged: 1,
        alreadyMessaged: 0,
      },
    ],
    totals: {
      reviewed: 3,
      qualified: 2,
      skipped: 1,
      messaged: 1,
      alreadyMessaged: 0,
    },
  });

  assert.match(text, /Daily Insense Outreach Summary/);
  assert.match(text, /2026-04-29/);
  assert.match(text, /Campaigns touched: 1/);
  assert.match(text, /Halo Home/);
  assert.match(text, /Reviewed 3/);
});
