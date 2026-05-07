import { fetchBotUserId, fetchThreadReactions } from './slack-report.mjs';

const APPROVE_REACTIONS = new Set(['white_check_mark', 'heavy_check_mark', '+1']);
const REJECT_REACTIONS = new Set(['x', 'no_entry_sign', 'negative_squared_cross_mark', '-1']);

function decideFromReactions(reactions, operatorUserId, ignoreUserIds = new Set()) {
  let approved = false;
  let rejected = false;

  for (const reaction of reactions) {
    const users = Array.isArray(reaction.users) ? reaction.users : [];
    const filtered = users.filter((u) => !ignoreUserIds.has(u));

    if (operatorUserId) {
      if (!filtered.includes(operatorUserId)) continue;
    } else if (filtered.length === 0) {
      continue;
    }

    if (APPROVE_REACTIONS.has(reaction.name)) approved = true;
    if (REJECT_REACTIONS.has(reaction.name)) rejected = true;
  }

  if (approved && !rejected) return 'approve';
  if (rejected && !approved) return 'reject';
  return 'pending';
}

export function applyReactionsToRecords({
  records,
  replyTsByCreator,
  threadMessages,
  operatorUserId = '',
  ignoreUserIds = [],
}) {
  const reactionsByTs = new Map();
  for (const message of threadMessages) {
    reactionsByTs.set(message.ts, message.reactions || []);
  }

  const ignoreSet = new Set(ignoreUserIds);

  let approved = 0;
  let rejected = 0;
  let pending = 0;

  const updated = records.map((record) => {
    if (record.invite !== 'pending') {
      return record;
    }
    const ts = replyTsByCreator[record.creatorKey];
    if (!ts) {
      pending += 1;
      return record;
    }
    const decision = decideFromReactions(
      reactionsByTs.get(ts) || [],
      operatorUserId,
      ignoreSet,
    );
    if (decision === 'approve') {
      approved += 1;
      return { ...record, invite: true, blockReason: '' };
    }
    if (decision === 'reject') {
      rejected += 1;
      return { ...record, invite: false, blockReason: 'Operator rejected' };
    }
    pending += 1;
    return record;
  });

  return { records: updated, counts: { approved, rejected, pending } };
}

export async function collectApprovalsFromSlack({
  channelId,
  threadTs,
  records,
  replyTsByCreator,
  slackConfig,
  operatorUserId = '',
  fetchImpl = fetch,
}) {
  const [threadMessages, botUserId] = await Promise.all([
    fetchThreadReactions({ channelId, threadTs, slackConfig, fetchImpl }),
    fetchBotUserId({ slackConfig, fetchImpl }),
  ]);
  return applyReactionsToRecords({
    records,
    replyTsByCreator,
    threadMessages,
    operatorUserId,
    ignoreUserIds: botUserId ? [botUserId] : [],
  });
}
