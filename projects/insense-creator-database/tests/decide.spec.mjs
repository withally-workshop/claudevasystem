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
