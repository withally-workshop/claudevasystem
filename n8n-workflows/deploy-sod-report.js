const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiMTkwMWE5My02ZjJjLTRlNzEtOWI4ZC02ZjlhMzVhMjU4NzUiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiZjBlZjk1YTYtYzc2MS00Zjc2LWJkZTgtMWU1Y2FiN2UxMjcxIiwiaWF0IjoxNzc2NjY1NjMxfQ.uBo2H0dzui9S0_MktoRxdodKzzE58vcQtXSlu8VpcEY';

const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD';
const OPENAI_CRED_ID = 'UIREXIYn59JOH1zU';
const WORKFLOW_ID = 'vUunl0NuBA6t4Gw4';

const NOA_USER_ID = 'U06TBGX9L93';
const AIRWALLEX_DRAFTS = 'C0AQZGJDR38';
const JOHN_USER_ID = 'U0AM5EGRVTP';
const TIMEZONE = 'Asia/Manila';

const EXTRACT_SOD_INPUTS_CODE = `
const TIMEZONE = 'Asia/Manila';
const JOHN_USER_ID = 'U0AM5EGRVTP';

function cleanText(value) {
  return String(value || '')
    .replace(/<#[A-Z0-9]+\\|([^>]+)>/g, '#$1')
    .replace(/<@[A-Z0-9]+>/g, '@user')
    .replace(/<([^|>]+)\\|([^>]+)>/g, '$2')
    .replace(/<([^>]+)>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\r\\n/g, '\\n')
    .split(/\\n/)
    .map((line) => line.replace(/[ \\t]+/g, ' ').trimEnd())
    .join('\\n')
    .trim();
}

function toLocalDate(tsSeconds) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(tsSeconds * 1000));
}

function normalizeMessages(items) {
  const flattened = [];

  for (const item of items) {
    const payload = item.json || {};
    if (Array.isArray(payload.messages)) {
      for (const message of payload.messages) {
        flattened.push(message || {});
      }
      continue;
    }

    flattened.push(payload);
  }

  return flattened
    .map((msg) => {
      const ts = Number(msg.ts || 0);
      const text = cleanText(msg.text || '');

      return {
        ts,
        rawTs: msg.ts || '',
        date: ts ? toLocalDate(ts) : '',
        user: msg.user || '',
        subtype: msg.subtype || '',
        botId: msg.bot_id || '',
        username: msg.username || '',
        text,
        threadTs: msg.thread_ts || '',
      };
    })
    .filter((msg) => msg.ts && msg.text)
    .sort((a, b) => a.ts - b.ts);
}

function extractSectionItems(text, headings) {
  if (!text) return [];

  function normalizeHeading(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/^#+\\s*/, '')
      .replace(/^\\*+\\s*/, '')
      .replace(/\\*+$/, '')
      .replace(/^[^a-z0-9\\[]+/, '')
      .replace(/\\s*\\(\\d+\\)\\s*$/g, '')
      .replace(/\\s+/g, ' ')
      .trim();
  }

  const lines = text
    .split(/\\r?\\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const headingSet = new Set(headings.map((heading) => normalizeHeading(heading)));
  const items = [];
  let active = false;

  for (const line of lines) {
    const normalizedLine = normalizeHeading(line);

    if (headingSet.has(normalizedLine)) {
      active = true;
      continue;
    }

    if (active && /^(#+\\s|\\*+.+\\*+$)/.test(line)) {
      break;
    }

    if (active && /^[-*]\\s+/.test(line)) {
      items.push(line.replace(/^[-*]\\s+/, '').trim());
    }
  }

  return items;
}

function uniqueItems(values) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function classifyJohnLine(line) {
  const lower = line.toLowerCase();

  if (lower.includes('blocker') || lower.includes('waiting on') || lower.includes('need from')) {
    return 'blockers';
  }

  if (
    lower.includes('focus') ||
    lower.includes('goal') ||
    lower.includes('priority') ||
    lower.includes('today') ||
    lower.includes('must') ||
    lower.includes('follow up')
  ) {
    return 'focusGoals';
  }

  return 'notes';
}

const now = new Date();
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(now);
const yesterdayDate = new Date(now.getTime() - (24 * 60 * 60 * 1000));
const yesterday = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(yesterdayDate);

const messages = normalizeMessages($input.all());
const previousDayMessages = messages.filter((msg) => msg.date === yesterday);

function isLikelyArchivedBotMessage(msg) {
  return Boolean(
    msg.botId ||
    msg.subtype === 'bot_message' ||
    String(msg.username || '').toLowerCase().includes('bot')
  );
}

function isEodWrapUpMessage(msg) {
  return /today['’]s wrap-up|wrap-up/i.test(msg.text || '');
}

const eodMessage =
  [...previousDayMessages].reverse().find((msg) =>
    isLikelyArchivedBotMessage(msg) && isEodWrapUpMessage(msg)
  ) ||
  [...previousDayMessages].reverse().find((msg) =>
    isEodWrapUpMessage(msg)
  );

const johnMessages = messages.filter((msg) =>
  msg.date === today &&
  msg.user === JOHN_USER_ID
);

const morningTriageMessage = [...messages].reverse().find((msg) =>
  msg.date === today &&
  msg.text.includes('Morning Triage')
);

const johnLines = johnMessages
  .flatMap((msg) => msg.text.split(/\\r?\\n/))
  .map((line) => line.trim())
  .filter((line) => /^[-*]/.test(line))
  .map((line) => line.replace(/^[-*]\\s*/, '').trim());

const johnBuckets = {
  focusGoals: [],
  blockers: [],
  notes: [],
};

for (const line of johnLines) {
  johnBuckets[classifyJohnLine(line)].push(line);
}

const carryOverItems = uniqueItems([
  ...extractSectionItems(eodMessage?.text || '', ['Not Completed / Needs More Work / Planned Next Steps']),
  ...extractSectionItems(eodMessage?.text || '', ['Carry-over from Yesterday']),
]);

const eodBlockers = uniqueItems([
  ...extractSectionItems(eodMessage?.text || '', ['Blocker / Input Needed']),
]);

const morningUrgent = uniqueItems([
  ...extractSectionItems(morningTriageMessage?.text || '', ['[URGENT] - Action today', '[URGENT]']),
]);

const morningNeedsReply = uniqueItems([
  ...extractSectionItems(morningTriageMessage?.text || '', ['Needs Your Reply']),
]);

const morningReviewThese = uniqueItems([
  ...extractSectionItems(morningTriageMessage?.text || '', ['Review These']),
]);

const morningBau = uniqueItems([
  ...extractSectionItems(morningTriageMessage?.text || '', ['FYI']),
  ...extractSectionItems(morningTriageMessage?.text || '', ['Auto-Sorted']),
]);

return [{
  json: {
    date: today,
    timezone: TIMEZONE,
    sourceChannelId: 'C0AQZGJDR38',
    sourceMessageCount: messages.length,
    eod: eodMessage ? {
      messageTs: eodMessage.rawTs,
      sourceText: eodMessage.text,
      carryOverItems,
      blockers: eodBlockers,
    } : null,
    johnMorning: {
      messageCount: johnMessages.length,
      sourceTexts: johnMessages.map((msg) => msg.text),
      focusGoals: uniqueItems(johnBuckets.focusGoals),
      blockers: uniqueItems(johnBuckets.blockers),
      notes: uniqueItems(johnBuckets.notes),
      rawTexts: johnMessages.map((msg) => msg.text).filter(Boolean),
    },
    morningTriage: morningTriageMessage ? {
      messageTs: morningTriageMessage.rawTs,
      sourceText: morningTriageMessage.text,
      urgent: morningUrgent,
      needsReply: morningNeedsReply,
      reviewThese: morningReviewThese,
      bauFollowUps: morningBau,
    } : null,
  }
}];
`.trim();

const VALIDATE_REQUIRED_INPUTS_CODE = `
const payload = $input.first().json;
const missing = [];

if (!payload.eod || !payload.eod.sourceText) {
  missing.push("Yesterday's EOD (Today's Wrap-up)");
}

if (!payload.johnMorning || !payload.johnMorning.messageCount) {
  missing.push('John morning dump');
}

return [{
  json: {
    ...payload,
    validationPassed: missing.length === 0,
    missingSources: missing,
    validationMessage: missing.length === 0
      ? 'All required SOD inputs found.'
      : 'Missing required inputs: ' + missing.join(', '),
  }
}];
`.trim();

const BUILD_SOD_PROMPT_CODE = `
const payload = $input.first().json;

function bulletList(items) {
  const safeItems = (items || []).filter(Boolean);
  if (!safeItems.length) return '- None';
  return safeItems.map((item) => '- ' + item).join('\\n');
}

const johnHasStructuredContext =
  (payload.johnMorning?.focusGoals || []).length ||
  (payload.johnMorning?.blockers || []).length ||
  (payload.johnMorning?.notes || []).length;
const johnRawFallback = (payload.johnMorning?.rawTexts || []).join('\\n\\n');
const johnContextSection = johnHasStructuredContext
  ? []
  : [
      '',
      'John Raw Context',
      johnRawFallback || 'none',
    ];

const prompt = [
  "You are Noa Takhel's executive assistant.",
  'Generate a Slack-ready Start of Day report from validated Slack inputs.',
  'Return markdown only.',
  'Use this exact structure when sections have content:',
  "### Today's Goals",
  '',
  '**Focus Goals**',
  '- [item]',
  '',
  '**Carry-over from Yesterday**',
  '- [item]',
  '',
  '**Blocker / Input Needed**',
  '- [item]',
  '',
  '**BAU / Follow-ups (Business As Usual)**',
  '- [item]',
  '',
  'Rules:',
  '- Bullets only. No paragraphs.',
  '- Use only the validated Slack inputs below.',
  '- Do not invent tasks or deadlines.',
  '- Preserve urgency labels and deadlines inline when present.',
  '- Omit truly empty sections.',
  '',
  'Validated input payload:',
  '',
  'Focus Goals',
  bulletList(payload.johnMorning?.focusGoals),
  ...johnContextSection,
  '',
  'Carry-over from Yesterday',
  bulletList(payload.eod?.carryOverItems),
  '',
  'Blocker / Input Needed',
  bulletList([
    ...(payload.eod?.blockers || []),
    ...(payload.johnMorning?.blockers || []),
  ]),
  '',
  'BAU / Follow-ups (Business As Usual)',
  bulletList([
    ...(payload.johnMorning?.notes || []),
    ...(payload.morningTriage?.urgent || []),
    ...(payload.morningTriage?.needsReply || []),
    ...(payload.morningTriage?.reviewThese || []),
    ...(payload.morningTriage?.bauFollowUps || []),
  ]),
].join('\\n');

return [{
  json: {
    ...payload,
    prompt,
  }
}];
`.trim();

const workflow = {
  name: 'Krave - Start Of Day Report',
  settings: { executionOrder: 'v1', saveManualExecutions: true },
  nodes: [
    {
      id: 'n1',
      name: 'Manual Trigger',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [240, 220],
      parameters: {},
    },
    {
      id: 'n2',
      name: 'Webhook Trigger',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [240, 420],
      webhookId: 'krave-sod-report',
      parameters: {
        httpMethod: 'POST',
        path: 'krave-sod-report',
        responseMode: 'onReceived',
        options: {},
      },
    },
    {
      id: 'n3',
      name: 'Prepare Drafts Channel',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [480, 320],
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: `return [{ json: { channel: '${AIRWALLEX_DRAFTS}' } }];`,
      },
    },
    {
      id: 'n3b',
      name: 'Fetch Airwallex Drafts History',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [720, 320],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        resource: 'channel',
        operation: 'history',
        channelId: {
          __rl: true,
          value: AIRWALLEX_DRAFTS,
          mode: 'list',
          cachedResultName: 'airwallexdrafts',
        },
        returnAll: true,
        filters: {},
      },
    },
    {
      id: 'n4',
      name: 'Extract SOD Inputs',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [940, 320],
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: EXTRACT_SOD_INPUTS_CODE,
      },
    },
    {
      id: 'n5',
      name: 'Validate Required Inputs',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1160, 320],
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: VALIDATE_REQUIRED_INPUTS_CODE,
      },
    },
    {
      id: 'n6',
      name: 'Are Inputs Complete?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.1,
      position: [1380, 320],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 1 },
          conditions: [{
            id: 'sod-inputs-complete',
            leftValue: '={{ $json.validationPassed }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'equals' },
          }],
          combinator: 'and',
        },
        options: {},
      },
    },
    {
      id: 'n7',
      name: 'Build SOD Prompt',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1380, 220],
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: BUILD_SOD_PROMPT_CODE,
      },
    },
    {
      id: 'n8',
      name: 'Generate SOD Report',
      type: '@n8n/n8n-nodes-langchain.openAi',
      typeVersion: 1.8,
      position: [1600, 220],
      credentials: { openAiApi: { id: OPENAI_CRED_ID, name: 'OpenAI account' } },
      parameters: {
        modelId: {
          __rl: true,
          mode: 'list',
          value: 'gpt-4o-mini',
          cachedResultName: 'GPT-4O-MINI',
        },
        options: {
          temperature: 0.2,
        },
        messages: {
          values: [
            {
              role: 'system',
              content: "You are Noa Takhel's executive assistant. Write a concise, accurate Slack start-of-day report using only the validated Slack inputs.",
            },
            {
              content: '={{ $json.prompt }}',
            },
          ],
        },
      },
    },
    {
      id: 'n9',
      name: 'Post to Airwallex Drafts',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [1820, 220],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        select: 'channel',
        channelId: { __rl: true, value: AIRWALLEX_DRAFTS, mode: 'id' },
        text: '={{ $json.message.content }}',
        otherOptions: {},
      },
    },
    {
      id: 'n10',
      name: 'Did Channel Send Fail?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.1,
      position: [2040, 220],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 1 },
          conditions: [{
            id: 'sod-channel-failed',
            leftValue: '={{ !!$json.error }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'equals' },
          }],
          combinator: 'and',
        },
        options: {},
      },
    },
    {
      id: 'n11',
      name: 'Send SOD to Noa',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [2260, 180],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        select: 'channel',
        channelId: { __rl: true, value: NOA_USER_ID, mode: 'id' },
        text: '={{ $("Generate SOD Report").item.json.message.content }}',
        otherOptions: {},
      },
    },
    {
      id: 'n12',
      name: 'Did Noa DM Fail?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.1,
      position: [2480, 180],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 1 },
          conditions: [{
            id: 'sod-dm-failed',
            leftValue: '={{ !!$json.error }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'equals' },
          }],
          combinator: 'and',
        },
        options: {},
      },
    },
    {
      id: 'n13',
      name: 'Post Failure Alert',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [2920, 420],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        select: 'channel',
        channelId: { __rl: true, value: AIRWALLEX_DRAFTS, mode: 'id' },
        text: '={{ $json.validationPassed === false ? "SOD report blocked. " + $json.validationMessage : "SOD report delivery needs manual follow-up. " + ($json.error?.message || $json.error || "Unknown Slack delivery failure.") }}',
        otherOptions: {},
      },
    },
    {
      id: 'n14',
      name: 'Retry Noa DM',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [2700, 180],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        select: 'channel',
        channelId: { __rl: true, value: NOA_USER_ID, mode: 'id' },
        text: '={{ $("Generate SOD Report").item.json.message.content }}',
        otherOptions: {},
      },
    },
    {
      id: 'n15',
      name: 'Did Retry DM Fail?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.1,
      position: [2920, 180],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 1 },
          conditions: [{
            id: 'sod-dm-retry-failed',
            leftValue: '={{ !!$json.error }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'equals' },
          }],
          combinator: 'and',
        },
        options: {},
      },
    },
  ],
  connections: {
    'Manual Trigger': { main: [[{ node: 'Prepare Drafts Channel', type: 'main', index: 0 }]] },
    'Webhook Trigger': { main: [[{ node: 'Prepare Drafts Channel', type: 'main', index: 0 }]] },
    'Prepare Drafts Channel': { main: [[{ node: 'Fetch Airwallex Drafts History', type: 'main', index: 0 }]] },
    'Fetch Airwallex Drafts History': { main: [[{ node: 'Extract SOD Inputs', type: 'main', index: 0 }]] },
    'Extract SOD Inputs': { main: [[{ node: 'Validate Required Inputs', type: 'main', index: 0 }]] },
    'Validate Required Inputs': { main: [[{ node: 'Are Inputs Complete?', type: 'main', index: 0 }]] },
    'Are Inputs Complete?': {
      main: [
        [{ node: 'Build SOD Prompt', type: 'main', index: 0 }],
        [{ node: 'Post Failure Alert', type: 'main', index: 0 }],
      ],
    },
    'Build SOD Prompt': { main: [[{ node: 'Generate SOD Report', type: 'main', index: 0 }]] },
    'Generate SOD Report': { main: [[{ node: 'Post to Airwallex Drafts', type: 'main', index: 0 }]] },
    'Post to Airwallex Drafts': { main: [[{ node: 'Did Channel Send Fail?', type: 'main', index: 0 }]] },
    'Did Channel Send Fail?': {
      main: [
        [{ node: 'Post Failure Alert', type: 'main', index: 0 }],
        [{ node: 'Send SOD to Noa', type: 'main', index: 0 }],
      ],
    },
    'Send SOD to Noa': { main: [[{ node: 'Did Noa DM Fail?', type: 'main', index: 0 }]] },
    'Did Noa DM Fail?': {
      main: [
        [{ node: 'Retry Noa DM', type: 'main', index: 0 }],
        [],
      ],
    },
    'Retry Noa DM': { main: [[{ node: 'Did Retry DM Fail?', type: 'main', index: 0 }]] },
    'Did Retry DM Fail?': {
      main: [
        [{ node: 'Post Failure Alert', type: 'main', index: 0 }],
        [],
      ],
    },
  },
};

function n8nRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const u = new URL(N8N_URL + path);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        'X-N8N-API-KEY': API_KEY,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function deploy() {
  const existing = await n8nRequest('GET', `/api/v1/workflows/${WORKFLOW_ID}`);
  let result;
  if (existing && existing.id === WORKFLOW_ID) {
    result = await n8nRequest('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, workflow);
    if (!result.id) {
      // n8n can accept the update but return a body without the workflow id.
      // Re-read the canonical workflow before falling back to creating a new copy.
      const refreshed = await n8nRequest('GET', `/api/v1/workflows/${WORKFLOW_ID}`);
      if (refreshed && refreshed.id === WORKFLOW_ID) {
        result = refreshed;
      } else {
        result = await n8nRequest('POST', '/api/v1/workflows', workflow);
      }
    }
  } else {
    result = await n8nRequest('POST', '/api/v1/workflows', workflow);
  }
  if (!result.id) {
    console.log('ERROR:', JSON.stringify(result, null, 2).substring(0, 2000));
    return;
  }
  await n8nRequest('POST', `/api/v1/workflows/${result.id}/activate`);
  console.log('SUCCESS');
  console.log('Workflow ID:', result.id);
  console.log('Name:', result.name);
  console.log('URL: https://noatakhel.app.n8n.cloud/workflow/' + result.id);
  console.log('\nManual test via:');
  console.log('POST https://noatakhel.app.n8n.cloud/webhook/krave-sod-report');
}

if (require.main === module) {
  deploy().catch((e) => console.error('Deploy failed:', e.message));
}

module.exports = { workflow };
