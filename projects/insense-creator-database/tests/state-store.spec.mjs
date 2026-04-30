import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listRunArtifactsForLocalDate,
  readReviewHistory,
  writeDecisionSeed,
  writeDailySummaryArtifact,
  writeReviewHistory,
  writeReviewArtifact,
  writeSendArtifact,
} from '../lib/state-store.mjs';

test('writes review artifact and decision seed', () => {
  const root = mkdtempSync(join(tmpdir(), 'insense-state-'));
  const reviewPath = writeReviewArtifact(root, 'halo-home', [
    { creatorKey: 'one', passesQuality: true },
  ]);
  const decisionPath = writeDecisionSeed(root, 'halo-home', [
    { creatorKey: 'one', invite: null },
  ]);

  const review = JSON.parse(readFileSync(reviewPath, 'utf8'));
  const decision = JSON.parse(readFileSync(decisionPath, 'utf8'));

  assert.equal(review.records.length, 1);
  assert.equal(decision.records[0].invite, null);
});

test('decision seed preserves review context for approved candidates', () => {
  const root = mkdtempSync(join(tmpdir(), 'insense-state-'));
  const decisionPath = writeDecisionSeed(root, 'halo-home', [
    {
      creatorKey: 'one',
      campaign: 'Halo Home',
      username: 'creator.one',
      firstName: 'creator',
      invite: true,
      followersText: '1,000 followers',
      engagementText: '4.2% ER',
      previousCollaborator: false,
      blockReason: '',
    },
  ]);

  const decision = JSON.parse(readFileSync(decisionPath, 'utf8'));
  assert.equal(decision.records[0].campaign, 'Halo Home');
  assert.equal(decision.records[0].username, 'creator.one');
  assert.equal(decision.records[0].engagementText, '4.2% ER');
  assert.equal(decision.records[0].invite, true);
  assert.equal(decision.records[0].previousCollaborator, false);
});

test('writes send artifact records', () => {
  const root = mkdtempSync(join(tmpdir(), 'insense-state-'));
  const sendPath = writeSendArtifact(root, 'halo-home', [
    {
      creatorKey: 'one',
      status: 'messaged',
      messageSent: true,
    },
  ]);

  const send = JSON.parse(readFileSync(sendPath, 'utf8'));
  assert.equal(send.records.length, 1);
  assert.equal(send.records[0].status, 'messaged');
  assert.equal(send.records[0].messageSent, true);
});

test('writes a daily summary artifact', () => {
  const root = mkdtempSync(join(tmpdir(), 'insense-state-'));
  const summaryPath = writeDailySummaryArtifact(root, '2026-04-29', {
    date: '2026-04-29',
    campaigns: [],
    totals: { reviewed: 0, qualified: 0, skipped: 0, messaged: 0, alreadyMessaged: 0 },
  });

  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  assert.equal(summary.date, '2026-04-29');
});

test('lists run artifacts for a local machine date', () => {
  const root = mkdtempSync(join(tmpdir(), 'insense-state-'));
  const runsDir = join(root, 'runs');
  const reviewPath = writeReviewArtifact(root, 'halo-home', [{ creatorKey: 'one', status: 'qualified' }]);
  const sendPath = writeSendArtifact(root, 'halo-home', [{ creatorKey: 'one', status: 'messaged' }]);

  const localDate = new Date(2026, 3, 29, 10, 30, 0);
  const timestamp = localDate.getTime();
  utimesSync(reviewPath, timestamp / 1000, timestamp / 1000);
  utimesSync(sendPath, timestamp / 1000, timestamp / 1000);

  const artifacts = listRunArtifactsForLocalDate(root, localDate);
  assert.equal(artifacts.length, 2);
  assert.equal(artifacts.every((item) => item.path.includes(runsDir)), true);
});

test('persists review history across runs', () => {
  const root = mkdtempSync(join(tmpdir(), 'insense-state-'));

  writeReviewHistory(root, {
    campaigns: {
      'little-saints-us-based-creators': {
        creators: {
          'https://tiktok.com/@creator.one': {
            reviewedAt: '2026-04-29T10:00:00.000Z',
            username: 'creator.one',
          },
        },
      },
    },
  });

  const history = readReviewHistory(root);
  assert.equal(
    history.campaigns['little-saints-us-based-creators'].creators[
      'https://tiktok.com/@creator.one'
    ].username,
    'creator.one',
  );
});
