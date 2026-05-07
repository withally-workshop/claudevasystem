import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProfileDrawerText,
  parseProfileStats,
} from '../lib/profile-parser.mjs';

test('parses visible profile stats into normalized numbers', () => {
  const result = parseProfileStats({
    displayName: 'Jane Doe',
    username: '@janedoeugc',
    uploadsText: '3 uploads in 2 categories',
    dealsText: '2 finished deals',
    engagementText: '1.8%',
  });

  assert.equal(result.displayName, 'Jane Doe');
  assert.equal(result.firstName, 'Jane');
  assert.equal(result.username, '@janedoeugc');
  assert.equal(result.portfolioUploads, 3);
  assert.equal(result.finishedDeals, 2);
  assert.equal(result.engagementRate, 1.8);
});

test('extracts niches from drawer text vocabulary', () => {
  const result = parseProfileDrawerText(`
    eduardo.lara
    Beauty, Skincare and Lifestyle creator
    5 finished deals
    3 uploads in 2 different categories
    4.2% Engagement rate
  `);

  assert.deepEqual(
    result.niches.sort(),
    ['beauty', 'lifestyle', 'skincare'].sort(),
  );
});

test('parses drawer text for finished deals and upload counts', () => {
  const result = parseProfileDrawerText(`
eduardo.lara
Vetted
5
(10 reviews)
View reviews
  .  16 finished deals
UGC Expert
Application
Profile
13,152
Followers
6.68%
Engagement rate
5 uploads in 5 different categories
  `);

  assert.equal(result.finishedDeals, 16);
  assert.equal(result.portfolioUploads, 5);
  assert.equal(result.engagementRate, 6.68);
});
