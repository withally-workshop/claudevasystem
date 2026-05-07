import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreProfile } from '../lib/scoring.mjs';

test('scores a top creator near 100', () => {
  const score = scoreProfile({
    engagementRate: 9,
    finishedDeals: 18,
    portfolioUploads: 10,
    followersText: '450k',
  });

  assert.ok(score >= 85, `expected >= 85, got ${score}`);
});

test('scores a low creator near 0', () => {
  const score = scoreProfile({
    engagementRate: 0,
    finishedDeals: 0,
    portfolioUploads: 0,
    followersText: '0',
  });

  assert.equal(score, 0);
});

test('scores a mid creator in the middle band', () => {
  const score = scoreProfile({
    engagementRate: 3,
    finishedDeals: 3,
    portfolioUploads: 4,
    followersText: '20k',
  });

  assert.ok(score >= 30 && score <= 70, `expected mid-band, got ${score}`);
});

test('parses follower suffixes (k, m) and integers', () => {
  const a = scoreProfile({ engagementRate: 0, finishedDeals: 0, portfolioUploads: 0, followersText: '1.5m' });
  const b = scoreProfile({ engagementRate: 0, finishedDeals: 0, portfolioUploads: 0, followers: 25000 });
  assert.ok(a > 0);
  assert.ok(b > 0);
});
