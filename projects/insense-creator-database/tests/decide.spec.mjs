import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateInvitePolicy,
  evaluateProfile,
} from '../lib/decide.mjs';

test('passes when all thresholds are met', () => {
  const result = evaluateProfile({
    portfolioUploads: 1,
    finishedDeals: 1,
    engagementRate: 1.0,
  });

  assert.equal(result.passesQuality, true);
  assert.equal(result.skipReason, '');
  assert.equal(result.requiresOperatorDecision, true);
});

test('fails when portfolio uploads are missing', () => {
  const result = evaluateProfile({
    portfolioUploads: 0,
    finishedDeals: 2,
    engagementRate: 2.1,
  });

  assert.equal(result.passesQuality, false);
  assert.match(result.skipReason, /portfolio/i);
  assert.equal(result.requiresOperatorDecision, false);
});

test('auto-invites qualified creators who are not blocklisted', () => {
  const result = evaluateInvitePolicy({
    passesQuality: true,
    previousCollaborator: false,
  });

  assert.equal(result.invite, true);
  assert.equal(result.blockReason, '');
});

test('blocks previous collaborators from auto-invite', () => {
  const result = evaluateInvitePolicy({
    passesQuality: true,
    previousCollaborator: true,
  });

  assert.equal(result.invite, false);
  assert.match(result.blockReason, /previous collaborator/i);
});

test('returns pending when approval gate is enabled', () => {
  const result = evaluateInvitePolicy(
    {
      passesQuality: true,
      previousCollaborator: false,
    },
    { useApprovalGate: true },
  );

  assert.equal(result.invite, 'pending');
  assert.equal(result.blockReason, '');
});

test('blocks creators already invited from another campaign', () => {
  const cache = {
    creators: {
      'creator-a': { status: 'messaged', campaign: 'Halo Home' },
    },
  };

  const result = evaluateInvitePolicy(
    {
      passesQuality: true,
      previousCollaborator: false,
    },
    {
      cache,
      creatorKey: 'creator-a',
      campaign: 'Little Saints',
      useApprovalGate: true,
    },
  );

  assert.equal(result.invite, false);
  assert.match(result.blockReason, /already invited from halo home/i);
});

test('cross-campaign dedup falls back when prior campaign is unknown', () => {
  const cache = {
    creators: {
      'creator-b': { status: 'messaged' },
    },
  };

  const result = evaluateInvitePolicy(
    {
      passesQuality: true,
      previousCollaborator: false,
    },
    {
      cache,
      creatorKey: 'creator-b',
      campaign: 'Little Saints',
      useApprovalGate: true,
    },
  );

  assert.equal(result.invite, false);
  assert.match(result.blockReason, /prior campaign/i);
});
