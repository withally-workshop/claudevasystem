'use strict';

const https = require('https');
const fileCache = require('./file-cache');

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

async function postMessageAsJohn({ channel, text, thread_ts }) {
  const payload = { channel, text };
  if (thread_ts) payload.thread_ts = thread_ts;
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(JSON.stringify(payload));
    const req = https.request({
      hostname: 'slack.com',
      path: '/api/chat.postMessage',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SLACK_JOHN_USER_TOKEN}`,
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

async function downloadFile({ url_private }) {
  const cached = fileCache.retrieve(url_private);
  if (cached) return { base64: cached, size_bytes: Buffer.from(cached, 'base64').length };
  return new Promise((resolve, reject) => {
    const url = new URL(url_private);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` },
    };
    https.get(opts, (res) => {
      const follow = (res2) => {
        const chunks = [];
        res2.on('data', (c) => chunks.push(c));
        res2.on('end', () => {
          const buf = Buffer.concat(chunks);
          resolve({ base64: buf.toString('base64'), size_bytes: buf.length });
        });
      };
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, follow).on('error', reject);
      } else {
        follow(res);
      }
    }).on('error', reject);
  });
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
    {
      name: 'slack_post_message_as_john',
      description: 'Post a Slack message as John (personal account, not the bot). Use this when the user asks to send a message "from John" or "from my account". To DM someone, set channel to their Slack user ID.',
      input_schema: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: 'Channel ID or user ID for DMs (e.g. U07J8SRCPGU for Amanda)' },
          text: { type: 'string', description: 'Message text (supports Slack mrkdwn)' },
          thread_ts: { type: 'string', description: 'Thread timestamp to reply in a thread (optional)' },
        },
        required: ['channel', 'text'],
      },
    },
    {
      name: 'slack_download_file',
      description: 'Download a Slack-hosted file by its url_private and return it as base64. Use this before gmail_send when you need to attach a file that was shared in Slack.',
      input_schema: {
        type: 'object',
        properties: {
          url_private: { type: 'string', description: 'The url_private of the Slack file (from the file metadata in the message context)' },
        },
        required: ['url_private'],
      },
    },
  ],
  handlers: { slack_get_channel_history: getChannelHistory, slack_post_message: postMessage, slack_post_message_as_john: postMessageAsJohn, slack_search: searchSlack, slack_list_channels: listChannels, slack_download_file: downloadFile },
};
