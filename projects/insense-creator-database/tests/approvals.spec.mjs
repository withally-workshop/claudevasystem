import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReactionsToRecords } from '../lib/approvals.mjs';

test('approves on white_check_mark from operator', () => {
  const result = applyReactionsToRecords({
    records: [
      { creatorKey: 'a', invite: 'pending' },
      { creatorKey: 'b', invite: 'pending' },
    ],
    replyTsByCreator: { a: '111.1', b: '222.2' },
    threadMessages: [
      { ts: '111.1', reactions: [{ name: 'white_check_mark', users: ['UOPERATOR'] }] },
      { ts: '222.2', reactions: [{ name: 'x', users: ['UOPERATOR'] }] },
    ],
    operatorUserId: 'UOPERATOR',
  });

  assert.equal(result.records[0].invite, true);
  assert.equal(result.records[1].invite, false);
  assert.match(result.records[1].blockReason, /operator rejected/i);
  assert.deepEqual(result.counts, { approved: 1, rejected: 1, pending: 0 });
});

test('leaves invite as pending when no decisive reaction is present', () => {
  const result = applyReactionsToRecords({
    records: [{ creatorKey: 'a', invite: 'pending' }],
    replyTsByCreator: { a: '111.1' },
    threadMessages: [
      {
        ts: '111.1',
        reactions: [
          { name: 'white_check_mark', users: ['UOPERATOR'] },
          { name: 'x', users: ['UOPERATOR'] },
        ],
      },
    ],
    operatorUserId: 'UOPERATOR',
  });

  assert.equal(result.records[0].invite, 'pending');
  assert.deepEqual(result.counts, { approved: 0, rejected: 0, pending: 1 });
});

test('ignores reactions from non-operator users when operator id is provided', () => {
  const result = applyReactionsToRecords({
    records: [{ creatorKey: 'a', invite: 'pending' }],
    replyTsByCreator: { a: '111.1' },
    threadMessages: [
      { ts: '111.1', reactions: [{ name: 'white_check_mark', users: ['USOMEONEELSE'] }] },
    ],
    operatorUserId: 'UOPERATOR',
  });

  assert.equal(result.records[0].invite, 'pending');
});

test('accepts any user when operator id is empty', () => {
  const result = applyReactionsToRecords({
    records: [{ creatorKey: 'a', invite: 'pending' }],
    replyTsByCreator: { a: '111.1' },
    threadMessages: [
      { ts: '111.1', reactions: [{ name: 'white_check_mark', users: ['UANYONE'] }] },
    ],
    operatorUserId: '',
  });

  assert.equal(result.records[0].invite, true);
});

test('ignores bot-pre-stamped reactions when ignoreUserIds is set', () => {
  const result = applyReactionsToRecords({
    records: [
      { creatorKey: 'a', invite: 'pending' },
      { creatorKey: 'b', invite: 'pending' },
    ],
    replyTsByCreator: { a: '111.1', b: '222.2' },
    threadMessages: [
      {
        ts: '111.1',
        reactions: [
          { name: 'white_check_mark', users: ['UBOT', 'UOPERATOR'] },
          { name: 'x', users: ['UBOT'] },
        ],
      },
      {
        ts: '222.2',
        reactions: [
          { name: 'white_check_mark', users: ['UBOT'] },
          { name: 'x', users: ['UBOT', 'UOPERATOR'] },
        ],
      },
    ],
    ignoreUserIds: ['UBOT'],
  });

  assert.equal(result.records[0].invite, true);
  assert.equal(result.records[1].invite, false);
  assert.deepEqual(result.counts, { approved: 1, rejected: 1, pending: 0 });
});

test('does not overwrite existing true/false invite states', () => {
  const result = applyReactionsToRecords({
    records: [
      { creatorKey: 'a', invite: true },
      { creatorKey: 'b', invite: false, blockReason: 'Previous collaborator' },
    ],
    replyTsByCreator: { a: '111.1', b: '222.2' },
    threadMessages: [
      { ts: '111.1', reactions: [{ name: 'x', users: ['UOPERATOR'] }] },
      { ts: '222.2', reactions: [{ name: 'white_check_mark', users: ['UOPERATOR'] }] },
    ],
    operatorUserId: 'UOPERATOR',
  });

  assert.equal(result.records[0].invite, true);
  assert.equal(result.records[1].invite, false);
  assert.equal(result.records[1].blockReason, 'Previous collaborator');
});
