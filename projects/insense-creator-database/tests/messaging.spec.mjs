import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderInviteMessage,
  validateDecisionRecord,
} from '../lib/messaging.mjs';

test('renders first-name message', () => {
  const text = renderInviteMessage({ firstName: 'Jane', username: '@janedoe' });

  assert.match(text, /^Hey Jane,/);
  assert.match(text, /form\.typeform\.com\/to\/lAPIxgqv/);
});

test('requires explicit invite true or false', () => {
  assert.throws(
    () => validateDecisionRecord({ creatorKey: 'one', invite: null }),
    /invite/i,
  );
});
