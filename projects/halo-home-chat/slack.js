const { WebClient } = require('@slack/web-api');
const crypto = require('crypto');
const { getSession, setSlackThread, getSocketId, setOwner, appendHistory } = require('./session');

const SLACK_CHANNEL = process.env.SLACK_ESCALATION_CHANNEL;
const web = process.env.SLACK_BOT_TOKEN ? new WebClient(process.env.SLACK_BOT_TOKEN) : null;

async function notifyEscalation(sessionId, { email, transcript, isBusinessHours, triggeredBy }) {
  if (!web) {
    console.warn('[Slack] SLACK_BOT_TOKEN not set — skipping escalation notification');
    return;
  }
  const bhText = isBusinessHours ? 'Yes — team member being paged' : 'No — customer notified of 24h response window';
  const customerText = email || 'unknown';

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Customer needs help — Session #${sessionId}`, emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Customer:* ${customerText}\n*Trigger:* ${triggeredBy}\n*Business hours:* ${bhText}`,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Conversation transcript:*\n\`\`\`${transcript}\`\`\``,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: isBusinessHours
          ? `Reply: \`/reply ${sessionId} <message>\`   •   Release: \`/handback ${sessionId}\``
          : `Customer notified of 24h response window. When you're ready: \`/reply ${sessionId} <message>\``,
      },
    },
  ];

  try {
    const res = await web.chat.postMessage({ channel: SLACK_CHANNEL, blocks, text: `Customer needs help — Session #${sessionId}` });
    if (res.ok) {
      await setSlackThread(sessionId, { threadTs: res.ts, channel: res.channel });
    }
  } catch (err) {
    console.error('[Slack] escalation notification failed:', err.message);
  }
}

async function relayCustomerMessage(sessionId, { content, email }) {
  if (!web) return;
  const session = await getSession(sessionId);
  if (!session || !session.slackThreadTs) return;

  try {
    await web.chat.postMessage({
      channel: session.slackChannel,
      thread_ts: session.slackThreadTs,
      text: `*Customer${email ? ` (${email})` : ''}:* ${content}`,
    });
  } catch (err) {
    console.error('[Slack] relay failed:', err.message);
  }
}

function verifySlackSignature(req, res, next) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) return next();

  const timestamp = req.headers['x-slack-request-timestamp'];
  const signature = req.headers['x-slack-signature'];
  if (!timestamp || !signature) return res.status(400).send('Missing Slack headers');

  // Reject requests older than 5 minutes
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) {
    return res.status(400).send('Request timestamp too old');
  }

  const rawBody = req.rawBody || '';
  const baseString = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac('sha256', signingSecret).update(baseString).digest('hex');
  const computed = `v0=${hmac}`;

  if (!crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature))) {
    return res.status(401).send('Invalid signature');
  }
  next();
}

async function handleSlashReply(req, res, io) {
  const text = (req.body.text || '').trim();
  const spaceIdx = text.indexOf(' ');
  if (spaceIdx === -1) {
    return res.json({ response_type: 'ephemeral', text: 'Usage: `/reply SESSIONID message`' });
  }
  const sessionId = text.slice(0, spaceIdx);
  const message = text.slice(spaceIdx + 1).trim();
  if (!message) {
    return res.json({ response_type: 'ephemeral', text: 'Usage: `/reply SESSIONID message`' });
  }

  const session = await getSession(sessionId);
  if (!session) {
    return res.json({ response_type: 'ephemeral', text: `Session \`${sessionId}\` not found or expired.` });
  }
  if (session.owner !== 'human') {
    return res.json({ response_type: 'ephemeral', text: `Session \`${sessionId}\` is not in human mode.` });
  }

  await appendHistory(sessionId, { role: 'human_agent', content: message });

  const socketId = await getSocketId(sessionId);
  if (socketId && io) {
    io.to(socketId).emit('human_message', { content: message });
  }

  res.json({
    response_type: 'ephemeral',
    text: socketId
      ? `Sent to \`${sessionId}\`.`
      : `Message saved for \`${sessionId}\` — customer is not currently connected.`,
  });
}

async function handleSlashHandback(req, res, io) {
  const sessionId = (req.body.text || '').trim();
  if (!sessionId) {
    return res.json({ response_type: 'ephemeral', text: 'Usage: `/handback SESSIONID`' });
  }

  const session = await getSession(sessionId);
  if (!session) {
    return res.json({ response_type: 'ephemeral', text: `Session \`${sessionId}\` not found or expired.` });
  }

  await setOwner(sessionId, 'bot');

  const socketId = await getSocketId(sessionId);
  if (socketId && io) {
    io.to(socketId).emit('handback', { message: "You're back with Mimi. How else can I help?" });
  }

  // Post to Slack thread
  if (web && session.slackThreadTs) {
    try {
      await web.chat.postMessage({
        channel: session.slackChannel,
        thread_ts: session.slackThreadTs,
        text: `Session \`${sessionId}\` handed back to bot.`,
      });
    } catch (err) {
      console.error('[Slack] handback thread reply failed:', err.message);
    }
  }

  res.json({ response_type: 'ephemeral', text: `Handback complete for \`${sessionId}\`.` });
}

module.exports = { notifyEscalation, relayCustomerMessage, verifySlackSignature, handleSlashReply, handleSlashHandback };
