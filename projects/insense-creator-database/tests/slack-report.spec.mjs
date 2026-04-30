import test from 'node:test';
import assert from 'node:assert/strict';
import { sendSlackSummary, sendSlackText } from '../lib/slack-report.mjs';

test('posts slack summary to the configured channel', async () => {
  const calls = [];

  const result = await sendSlackSummary({
    campaign: 'Halo Home',
    mode: 'review',
    records: [{ status: 'qualified', invite: true, username: 'creator.one' }],
    slackConfig: {
      token: 'xoxb-test',
      channelId: 'C0AQZGJDR38',
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { ok: true, channel: 'C0AQZGJDR38', ts: '123.456' };
        },
      };
    },
  });

  assert.equal(result.delivered, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://slack.com/api/chat.postMessage');
  assert.match(calls[0].options.headers.Authorization, /Bearer xoxb-test/);

  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.channel, 'C0AQZGJDR38');
  assert.match(payload.text, /Halo Home/);
});

test('skips slack delivery when token is unavailable', async () => {
  const result = await sendSlackSummary({
    campaign: 'Halo Home',
    mode: 'send',
    records: [{ status: 'messaged', username: 'creator.one' }],
    slackConfig: {
      token: '',
      channelId: 'C0AQZGJDR38',
    },
  });

  assert.equal(result.delivered, false);
  assert.equal(result.skipped, true);
  assert.match(result.reason, /token/i);
});

test('posts arbitrary slack text to the configured channel', async () => {
  const calls = [];

  const result = await sendSlackText({
    text: '*Daily Insense Outreach Summary*\nReviewed: 10',
    slackConfig: {
      token: 'xoxb-test',
      channelId: 'C0AQZGJDR38',
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return { ok: true, channel: 'C0AQZGJDR38', ts: '234.567' };
        },
      };
    },
  });

  assert.equal(result.delivered, true);
  assert.equal(calls.length, 1);

  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.channel, 'C0AQZGJDR38');
  assert.match(payload.text, /Daily Insense Outreach Summary/);
});
