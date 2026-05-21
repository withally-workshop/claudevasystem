'use strict';

const https = require('https');

function slackGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.get(`https://slack.com/api${path}`, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({ ok: false, body }); } });
    });
    req.on('error', reject);
  });
}

function slackPost(apiPath, payload) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(JSON.stringify(payload));
    const req = https.request({
      hostname: 'slack.com',
      path: `/api${apiPath}`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': buf.length,
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({ ok: false, body }); } });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

async function getChannelHistory({ channel, limit = 20 }) {
  const res = await slackGet(`/conversations.history?channel=${channel}&limit=${limit}`);
  if (!res.ok) return { error: res.error };
  return { messages: (res.messages || []).map((m) => ({ ts: m.ts, user: m.user, text: m.text })) };
}

async function postMessage({ channel, text, thread_ts }) {
  const payload = { channel, text };
  if (thread_ts) payload.thread_ts = thread_ts;
  const res = await slackPost('/chat.postMessage', payload);
  return res.ok ? { ok: true, ts: res.ts } : { error: res.error };
}

async function searchSlack({ query, count = 10 }) {
  const res = await slackGet(`/search.messages?query=${encodeURIComponent(query)}&count=${count}`);
  if (!res.ok) return { error: res.error };
  const matches = (res.messages && res.messages.matches) || [];
  return { results: matches.map((m) => ({ channel: m.channel && m.channel.name, text: m.text, ts: m.ts })) };
}

async function listChannels() {
  const res = await slackGet('/conversations.list?types=public_channel,private_channel&limit=100&exclude_archived=true');
  if (!res.ok) return { error: res.error };
  return { channels: (res.channels || []).map((c) => ({ id: c.id, name: c.name, is_private: c.is_private })) };
}

module.exports = {
  definitions: [
    {
      name: 'slack_get_channel_history',
      description: 'Read recent messages from a Slack channel by channel ID.',
      input_schema: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: 'Slack channel ID (e.g. C09HN2EBPR7)' },
          limit: { type: 'number', description: 'Number of messages to fetch (default 20)' },
        },
        required: ['channel'],
      },
    },
    {
      name: 'slack_post_message',
      description: 'Post a message to a Slack channel or thread.',
      input_schema: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: 'Channel ID or DM user ID' },
          text: { type: 'string', description: 'Message text (supports Slack mrkdwn)' },
          thread_ts: { type: 'string', description: 'Thread timestamp to reply in a thread' },
        },
        required: ['channel', 'text'],
      },
    },
    {
      name: 'slack_search',
      description: 'Search Slack messages across the workspace.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query string' },
          count: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'slack_list_channels',
      description: 'List all Slack channels the bot has access to.',
      input_schema: { type: 'object', properties: {} },
    },
  ],
  handlers: { slack_get_channel_history: getChannelHistory, slack_post_message: postMessage, slack_search: searchSlack, slack_list_channels: listChannels },
};
