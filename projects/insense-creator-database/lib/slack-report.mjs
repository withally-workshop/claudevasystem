import { buildSlackSummary } from './reporter.mjs';

export async function sendSlackText({
  text,
  slackConfig,
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

  const response = await fetchImpl('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: channelId,
      text,
      unfurl_links: false,
      unfurl_media: false,
    }),
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
