import { buildSlackSummary } from './reporter.mjs';

const SLACK_API = 'https://slack.com/api';

async function callSlack(method, body, slackConfig, fetchImpl = fetch) {
  const token = String(slackConfig?.token || '');
  if (!token) {
    return { ok: false, skipped: true, error: 'Missing Slack bot token' };
  }
  const response = await fetchImpl(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || payload.ok !== true) {
    throw new Error(`Slack ${method} failed: ${payload.error || response.status || 'unknown'}`);
  }
  return payload;
}

function formatCandidateLine(record) {
  const score = Number(record.score || 0);
  const niches = Array.isArray(record.niches) && record.niches.length
    ? record.niches.join(', ')
    : 'unknown niche';
  const username = record.username || record.creatorKey;
  const profile = record.socialHref ? `\n${record.socialHref}` : '';
  return [
    `*${username}* · score ${score} · niches: ${niches}`,
    `${record.finishedDeals || 0} deals · ${record.engagementRate || 0}% ER · ${record.followersText || 'unknown followers'} · ${record.country || 'unknown'}${profile}`,
    'React :white_check_mark: to invite, :x: to skip',
  ].join('\n');
}

export async function postCandidateThread({
  campaign,
  records,
  slackConfig,
  fetchImpl = fetch,
}) {
  const channelId = String(slackConfig?.channelId || '');
  const token = String(slackConfig?.token || '');
  if (!token || !channelId) {
    return { delivered: false, skipped: true, reason: 'Missing Slack token or channel id' };
  }

  const pending = records.filter((record) => record.invite === 'pending');
  if (pending.length === 0) {
    return { delivered: false, skipped: true, reason: 'No pending candidates to post' };
  }

  const ranked = [...pending].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

  const parent = await callSlack(
    'chat.postMessage',
    {
      channel: channelId,
      text: `*Insense candidates — ${campaign} — ${ranked.length} pending review*\nReact :white_check_mark: to invite or :x: to skip on each candidate below.`,
      unfurl_links: false,
      unfurl_media: false,
    },
    slackConfig,
    fetchImpl,
  );

  const threadTs = parent.ts;
  const replies = [];

  for (const record of ranked) {
    const reply = await callSlack(
      'chat.postMessage',
      {
        channel: channelId,
        thread_ts: threadTs,
        text: formatCandidateLine(record),
        unfurl_links: false,
        unfurl_media: false,
      },
      slackConfig,
      fetchImpl,
    );

    const replyTs = reply.ts;
    for (const name of ['white_check_mark', 'x']) {
      try {
        await callSlack(
          'reactions.add',
          { channel: channelId, timestamp: replyTs, name },
          slackConfig,
          fetchImpl,
        );
      } catch {
        // already-reacted is non-fatal
      }
    }

    replies.push({ creatorKey: record.creatorKey, replyTs });
  }

  return {
    delivered: true,
    skipped: false,
    channelId,
    threadTs,
    replies,
  };
}

export async function fetchBotUserId({ slackConfig, fetchImpl = fetch }) {
  const token = String(slackConfig?.token || '');
  if (!token) return '';
  const response = await fetchImpl(`${SLACK_API}/auth.test`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json();
  if (!response.ok || payload.ok !== true) return '';
  return String(payload.user_id || '');
}

export async function fetchThreadReactions({
  channelId,
  threadTs,
  slackConfig,
  fetchImpl = fetch,
}) {
  const token = String(slackConfig?.token || '');
  if (!token) {
    throw new Error('Slack conversations.replies failed: missing bot token');
  }

  const params = new URLSearchParams({
    channel: channelId,
    ts: threadTs,
    limit: '200',
  });
  const response = await fetchImpl(`${SLACK_API}/conversations.replies?${params}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json();
  if (!response.ok || payload.ok !== true) {
    throw new Error(
      `Slack conversations.replies failed: ${payload.error || response.status || 'unknown'}`,
    );
  }

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  return messages.map((message) => ({
    ts: message.ts,
    reactions: Array.isArray(message.reactions) ? message.reactions : [],
  }));
}

export async function sendSlackText({
  text,
  slackConfig,
  threadTs = '',
  fetchImpl = fetch,
}) {
  const token = String(slackConfig?.token || '');
  const channelId = String(slackConfig?.channelId || '');

  if (!token) {
    return {
      delivered: false,
      skipped: true,
      reason: 'Missing Slack bot token',
    };
  }

  if (!channelId) {
    return {
      delivered: false,
      skipped: true,
      reason: 'Missing Slack channel id',
    };
  }

  const body = {
    channel: channelId,
    text,
    unfurl_links: false,
    unfurl_media: false,
  };
  if (threadTs) body.thread_ts = threadTs;

  const response = await fetchImpl('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });

  const payload = await response.json();
  if (!response.ok || payload.ok !== true) {
    throw new Error(
      `Slack delivery failed: ${payload.error || response.status || 'unknown error'}`,
    );
  }

  return {
    delivered: true,
    skipped: false,
    channelId,
    ts: payload.ts || '',
    text,
  };
}

export async function sendSlackSummary({
  campaign,
  mode,
  records,
  slackConfig,
  fetchImpl = fetch,
}) {
  return sendSlackText({
    text: buildSlackSummary(campaign, mode, records),
    slackConfig,
    fetchImpl,
  });
}
