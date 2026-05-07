import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../lib/cli.mjs';

test('requires mode and campaign', () => {
  assert.throws(() => parseArgs([]), /mode/i);
  assert.throws(() => parseArgs(['--mode', 'review']), /campaign/i);
  assert.deepEqual(parseArgs(['--mode', 'review', '--campaign', 'Halo Home']), {
    mode: 'review',
    campaign: 'Halo Home',
    headless: true,
    limit: 10,
    resetReviewHistory: false,
  });
});

test('parses optional review limit', () => {
  assert.deepEqual(
    parseArgs(['--mode', 'review', '--campaign', 'Halo Home', '--limit', '3']),
    {
      mode: 'review',
      campaign: 'Halo Home',
      headless: true,
      limit: 3,
      resetReviewHistory: false,
    },
  );
});

test('accepts daily-summary mode without a campaign', () => {
  assert.deepEqual(
    parseArgs(['--mode', 'daily-summary']),
    {
      mode: 'daily-summary',
      headless: true,
      limit: 10,
      resetReviewHistory: false,
    },
  );
});

test('accepts approve mode with a campaign', () => {
  assert.deepEqual(
    parseArgs(['--mode', 'approve', '--campaign', 'Halo Home']),
    {
      mode: 'approve',
      campaign: 'Halo Home',
      headless: true,
      limit: 10,
      resetReviewHistory: false,
    },
  );
});

test('parses reset-review-history flag for review mode', () => {
  assert.deepEqual(
    parseArgs([
      '--mode',
      'review',
      '--campaign',
      'Halo Home',
      '--reset-review-history',
    ]),
    {
      mode: 'review',
      campaign: 'Halo Home',
      headless: true,
      limit: 10,
      resetReviewHistory: true,
    },
  );
});
