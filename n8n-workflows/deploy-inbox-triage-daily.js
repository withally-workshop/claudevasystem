const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiMTkwMWE5My02ZjJjLTRlNzEtOWI4ZC02ZjlhMzVhMjU4NzUiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiZjBlZjk1YTYtYzc2MS00Zjc2LWJkZTgtMWU1Y2FiN2UxMjcxIiwiaWF0IjoxNzc2NjY1NjMxfQ.uBo2H0dzui9S0_MktoRxdodKzzE58vcQtXSlu8VpcEY';
const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD';
const OPENAI_CRED_ID = 'UIREXIYn59JOH1zU';
const AIRWALLEX_DRAFTS = 'C0AQZGJDR38';
const NOA_USER_ID = 'U06TBGX9L93';
const TIMEZONE = 'Asia/Manila';
const TIER_URGENT = 'EA/Urgent';
const TIER_NEEDS_REPLY = 'EA/Needs-Reply';
const TIER_FYI = 'EA/FYI';
const TIER_AUTO_SORTED = 'EA/Auto-Sorted';
const TIER_UNSURE = 'EA/Unsure';

const BUILD_QUERY_CODE = `
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const parts = formatter.formatToParts(new Date());
const year = parts.find((part) => part.type === 'year')?.value;
const month = parts.find((part) => part.type === 'month')?.value;
const day = parts.find((part) => part.type === 'day')?.value;
const todayIso = year + '-' + month + '-' + day;

const todayUtc = new Date(todayIso + 'T00:00:00Z');
todayUtc.setUTCDate(todayUtc.getUTCDate() - 1);
const y = todayUtc.getUTCFullYear();
const m = String(todayUtc.getUTCMonth() + 1).padStart(2, '0');
const d = String(todayUtc.getUTCDate()).padStart(2, '0');

return [{
  json: {
    query: 'in:inbox after:' + y + '/' + m + '/' + d,
    today_iso: todayIso,
    after_date: y + '/' + m + '/' + d
  }
}];
`.trim();

const NORMALIZE_EMAIL_CODE = `
function headerValue(headers, name) {
  return (headers || []).find((header) => String(header.name || '').toLowerCase() === name.toLowerCase())?.value || '';
}

function parseSender(raw) {
  const match = String(raw || '').match(/^(.*?)(?:\\s*<([^>]+)>)?$/);
  return {
    from_name: (match?.[1] || raw || '').replace(/["']/g, '').trim(),
    from_email: (match?.[2] || raw || '').trim()
  };
}

const payload = $json.payload || {};
const sender = parseSender(headerValue(payload.headers, 'From'));

return {
  json: {
    message_id: $json.id || 'gmail-message-id',
    thread_id: $json.threadId || '',
    from_name: sender.from_name,
    from_email: sender.from_email,
    subject: headerValue(payload.headers, 'Subject'),
    snippet: $json.snippet || '',
    body_preview: ($json.textPlain || $json.textHtml || '').replace(/\\s+/g, ' ').trim().slice(0, 800),
    received_at: headerValue(payload.headers, 'Date') || ''
  }
};
`.trim();

const RULES_CLASSIFIER_CODE = `
const KNOWN_CONTACT_MARKERS = [
  'amanda',
  'shin',
  'joshua',
  'amy',
  'shuo shimpa',
  'im8',
  'krave',
];

const URGENT_PATTERNS = [
  /legal/i,
  /contract/i,
  /overdue/i,
  /deadline today/i,
  /payment risk/i,
];

const AUTO_SORT_PATTERNS = [
  /newsletter/i,
  /receipt/i,
  /noreply@/i,
  /no-reply@/i,
];

const haystack = [
  $json.from_name,
  $json.from_email,
  $json.subject,
  $json.snippet,
  $json.body_preview
].join(' ');

const knownContact = KNOWN_CONTACT_MARKERS.some((marker) => haystack.toLowerCase().includes(marker));
const urgentMatch = URGENT_PATTERNS.some((pattern) => pattern.test(haystack));
const autoSortMatch = AUTO_SORT_PATTERNS.some((pattern) => pattern.test(haystack));

if (urgentMatch) {
  return { json: { ...$json, tier: 'EA/Urgent', context_label: '', reason: 'Matched urgent rules', ai_needed: false, draft_required: true } };
}

if (knownContact) {
  return { json: { ...$json, tier: 'EA/Needs-Reply', context_label: '', reason: 'Matched known-contact rules', ai_needed: false, draft_required: true } };
}

// Never auto-sort known contacts even if notification language is present.
if (autoSortMatch && !knownContact) {
  return { json: { ...$json, tier: 'EA/Auto-Sorted', context_label: 'Receipts', reason: 'Matched auto-sort rules', ai_needed: false, draft_required: false } };
}

return { json: { ...$json, tier: '', context_label: '', reason: 'Needs AI review', ai_needed: true, draft_required: false, allowed_tiers: ['EA/Urgent', 'EA/Needs-Reply', 'EA/FYI', 'EA/Auto-Sorted', 'EA/Unsure'] } };
`.trim();

const workflow = {
  name: 'Krave - Inbox Triage Daily',
  settings: { executionOrder: 'v1', saveManualExecutions: true },
  nodes: [
    {
      id: 'n1',
      name: 'Schedule 9am ICT Weekdays',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [240, 180],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: '0 1 * * 1-5' }] } },
    },
    {
      id: 'n2',
      name: 'Webhook Trigger',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [240, 340],
      webhookId: 'krave-inbox-triage-daily',
      parameters: { httpMethod: 'POST', path: 'krave-inbox-triage-daily', responseMode: 'onReceived', options: {} },
    },
    {
      id: 'n3',
      name: 'Build Gmail Query',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [460, 260],
      parameters: { mode: 'runOnceForAllItems', jsCode: BUILD_QUERY_CODE },
    },
    {
      id: 'n4',
      name: 'Search Inbox',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [680, 260],
      parameters: {
        operation: 'getAll',
        limit: 50,
        filters: {
          q: '={{ $json.query || "in:inbox after:1970/01/01" }}',
        },
      },
    },
    {
      id: 'n5',
      name: 'Fetch Message Details',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [900, 260],
      parameters: {
        operation: 'get',
        messageId: '={{ $json.id }}',
        simple: false,
      },
    },
    {
      id: 'n6',
      name: 'Normalize Email',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1120, 260],
      parameters: { mode: 'runOnceForEachItem', jsCode: NORMALIZE_EMAIL_CODE },
    },
    {
      id: 'n7',
      name: 'Rules Classifier',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1340, 260],
      parameters: { mode: 'runOnceForEachItem', jsCode: RULES_CLASSIFIER_CODE },
    },
    {
      id: 'n8',
      name: 'Build Slack Summary',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1560, 260],
      parameters: {
        jsCode: `return [{ json: { timezone: '${TIMEZONE}', openAiCredentialId: '${OPENAI_CRED_ID}', tiers: ['${TIER_URGENT}', '${TIER_NEEDS_REPLY}', '${TIER_FYI}', '${TIER_AUTO_SORTED}', '${TIER_UNSURE}'] } }];`,
      },
    },
    {
      id: 'n9',
      name: 'Post to Airwallex Drafts',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [1780, 200],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: { channel: AIRWALLEX_DRAFTS },
    },
    {
      id: 'n10',
      name: 'DM Noa Summary',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [1780, 320],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: { channel: NOA_USER_ID },
    },
  ],
  connections: {
    'Schedule 9am ICT Weekdays': { main: [[{ node: 'Build Gmail Query', type: 'main', index: 0 }]] },
    'Webhook Trigger': { main: [[{ node: 'Build Gmail Query', type: 'main', index: 0 }]] },
    'Build Gmail Query': { main: [[{ node: 'Search Inbox', type: 'main', index: 0 }]] },
    'Search Inbox': { main: [[{ node: 'Fetch Message Details', type: 'main', index: 0 }]] },
    'Fetch Message Details': { main: [[{ node: 'Normalize Email', type: 'main', index: 0 }]] },
    'Normalize Email': { main: [[{ node: 'Rules Classifier', type: 'main', index: 0 }]] },
    'Rules Classifier': { main: [[{ node: 'Build Slack Summary', type: 'main', index: 0 }]] },
  },
};

module.exports = { workflow };
