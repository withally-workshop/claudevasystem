const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_ID = '3YyEjk1e6oZV786T';
const GMAIL_CRED_ID = 'vxHex5lFrkakcsPi';
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
    query: 'in:inbox newer_than:1d',
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
    label_ids: Array.isArray($json.labelIds) ? $json.labelIds : [],
    label_names: Array.isArray($json.labelNames) ? $json.labelNames : [],
    from_name: sender.from_name,
    from_email: sender.from_email,
    subject: headerValue(payload.headers, 'Subject'),
    snippet: $json.snippet || '',
    body_preview: ($json.textPlain || $json.textHtml || '').replace(/\\s+/g, ' ').trim().slice(0, 800),
    received_at: headerValue(payload.headers, 'Date') || ''
  }
};
`.trim();

const DETECT_EXISTING_HANDLING_CODE = `
const labelNames = ($json.label_names || $json.labelNames || []).map((value) => String(value || '').trim());
const alreadyLabeled = labelNames.some((name) => /^EA\\//.test(name));
const draftExists = Boolean($json.draft_exists || false);
const alreadyReplied = Boolean($json.already_replied || false);

const reasons = [];
if (alreadyReplied) reasons.push('already replied');
if (draftExists) reasons.push('draft exists');
if (alreadyLabeled) reasons.push('already labeled');

const statusNote = reasons.join(', ') || 'action-state unknown';

return {
  json: {
    ...$json,
    already_labeled: alreadyLabeled,
    draft_exists: draftExists,
    already_replied: alreadyReplied,
    already_actioned: reasons.length > 0,
    already_actioned_reason: reasons.join(', '),
    summary_status_note: statusNote
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

// Never auto-sort a known contact even if the message looks like an automated notification.
if (autoSortMatch && !knownContact) {
  return { json: { ...$json, tier: 'EA/Auto-Sorted', context_label: 'Receipts', reason: 'Matched auto-sort rules', ai_needed: false, draft_required: false } };
}

return { json: { ...$json, tier: '', context_label: '', reason: 'Needs AI review', ai_needed: true, draft_required: false, allowed_tiers: ['EA/Urgent', 'EA/Needs-Reply', 'EA/FYI', 'EA/Auto-Sorted', 'EA/Unsure'] } };
`.trim();

const AI_CLASSIFIER_PROMPT = [
  'You are classifying one email for Noa Takhel.',
  'Return JSON only with keys: tier, context_label, reason, draft_required, summary_line.',
  'Allowed tiers: EA/Urgent, EA/Needs-Reply, EA/FYI, EA/Auto-Sorted, EA/Unsure.',
  'Allowed context labels: Krave, IM8, Halo-Home, Skyvane, Invoices, Contracts, Receipts, Suppliers, blank.',
  'Choose EA/Needs-Reply instead of EA/FYI if action is ambiguous.',
  'Never auto-sort known contacts.',
  'Use summary wording that can mention Draft ready in Gmail when drafting is required.',
].join('\n');

const DRAFT_PROMPT_PREFIX = [
  'Write a Gmail draft in Noa Takhel\'s voice.',
  'Be direct and outcome-oriented.',
  'No filler.',
  'Use the 3-and-1 Framework if the email asks for a decision.',
  'Do not send. Draft only.',
].join('\n');

const MERGE_FINAL_CLASSIFICATION_CODE = `
function parseAiPayload(json) {
  const candidates = [
    json.message?.content,
    json.content,
    json.text,
    json.output_text,
    json.response?.text,
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {}
  }

  return null;
}

const aiPayload = parseAiPayload($json);
const finalTier = aiPayload?.tier || $json.tier || 'EA/Unsure';
const finalContextLabel = aiPayload?.context_label || $json.context_label || '';
const finalReason = aiPayload?.reason || $json.reason || 'Classification merged without AI output';
const finalDraftRequired = typeof aiPayload?.draft_required === 'boolean'
  ? aiPayload.draft_required
  : Boolean($json.draft_required);
const finalSummaryLine = aiPayload?.summary_line || $json.summary_line || finalReason;

return {
  json: {
    ...$json,
    tier: finalTier,
    context_label: finalContextLabel,
    reason: finalReason,
    draft_required: finalDraftRequired,
    summary_line: finalSummaryLine
  }
};
`.trim();

const PREPARE_GMAIL_MUTATION_CODE = `
const labels = $("Get Gmail Labels").all().flatMap((item) => {
  const json = item.json || {};
  if (Array.isArray(json.labels)) return json.labels;
  return [json];
});

const labelIdByName = Object.fromEntries(
  labels
    .map((label) => [String(label.name || '').trim(), String(label.id || '').trim()])
    .filter(([name, id]) => name && id)
);

return {
  json: {
    ...$json,
    tier_label_name: $json.tier,
    context_label_name: $json.context_label || '',
    tier_label_id: labelIdByName[$json.tier] || '',
    context_label_id: labelIdByName[$json.context_label || ''] || '',
    archive_after_triage: $json.tier !== 'EA/Unsure',
    draft_subject: 'Re: ' + ($json.subject || ''),
    summary_draft_note: $json.draft_required ? 'Draft ready in Gmail' : ''
  }
};
`.trim();

const ARCHIVE_DECISION_CODE = `
// EA/Unsure stays in inbox so human review can happen after triage.
if ($json.tier === 'EA/Unsure') {
  return {
    json: {
      ...$json,
      archive_after_triage: false,
      removeLabelIds: [],
      inbox_retention_reason: 'EA/Unsure remain in inbox for manual review'
    }
  };
}

return {
  json: {
    ...$json,
    archive_after_triage: true,
    removeLabelIds: ['INBOX']
  }
};
`.trim();

const BUILD_SUMMARY_CODE = `
const rows = $input.all().map((item) => item.json);

function linesFor(tier) {
  return rows
    .filter((row) => row.tier === tier)
    .map((row) => {
      const statusSuffix = row.summary_status_note ? ' [' + row.summary_status_note + ']' : '';
      return '- ' + row.from_name + ' | ' + row.subject + ' - ' + (row.summary_line || row.reason || '') + statusSuffix + (row.summary_draft_note ? ' -> ' + row.summary_draft_note : '');
    });
}

const urgent = linesFor('EA/Urgent');
const reply = linesFor('EA/Needs-Reply');
const fyi = linesFor('EA/FYI');
const unsure = linesFor('EA/Unsure');
const autoSortedCount = rows.filter((row) => row.tier === 'EA/Auto-Sorted').length;

const sections = ['*Morning Triage - ' + new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric' }) + ' (ICT)*'];
if (urgent.length) sections.push('\\n*[URGENT] - Action today (' + urgent.length + ')*\\n' + urgent.join('\\n'));
if (reply.length) sections.push('\\n*Needs Your Reply (' + reply.length + ')*\\n' + reply.join('\\n'));
if (fyi.length) sections.push('\\n*FYI (' + fyi.length + ')*\\n' + fyi.join('\\n'));
if (unsure.length) sections.push('\\n*Review These (' + unsure.length + ')*\\n' + unsure.join('\\n'));
sections.push('\\n*Auto-Sorted (' + autoSortedCount + ')* - newsletters, receipts, notifications');
sections.push('\\nInbox: ' + unsure.length);

return [{ json: { summary_text: sections.join('\\n') } }];
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
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'getAll',
        limit: 50,
        filters: {
          q: '={{ $(\'Build Gmail Query\').first().json.query || "in:inbox after:1970/01/01" }}',
        },
      },
    },
    {
      id: 'n4b',
      name: 'Get Gmail Labels',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [680, 120],
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'label',
        operation: 'getAll',
        returnAll: true,
      },
    },
    {
      id: 'n5',
      name: 'Fetch Message Details',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [900, 260],
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
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
      name: 'Detect Existing Handling',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1340, 260],
      parameters: { mode: 'runOnceForEachItem', jsCode: DETECT_EXISTING_HANDLING_CODE },
    },
    {
      id: 'n7b',
      name: 'Rules Classifier',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1560, 260],
      parameters: { mode: 'runOnceForEachItem', jsCode: RULES_CLASSIFIER_CODE },
    },
    {
      id: 'n8',
      name: 'Need AI?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.1,
      position: [1780, 260],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 1 },
          conditions: [{
            leftValue: '={{ $json.ai_needed }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'equals' },
          }],
          combinator: 'and',
        },
      },
    },
    {
      id: 'n8b',
      name: 'AI Classifier',
      type: '@n8n/n8n-nodes-langchain.openAi',
      typeVersion: 1.8,
      position: [2000, 160],
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
              content: AI_CLASSIFIER_PROMPT,
            },
            {
              role: 'user',
              content: '={{ JSON.stringify($json) }}',
            },
          ],
        },
      },
    },
    {
      id: 'n9',
      name: 'Merge Final Classification',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [2220, 260],
      parameters: { mode: 'runOnceForEachItem', jsCode: MERGE_FINAL_CLASSIFICATION_CODE },
    },
    {
      id: 'n9b',
      name: 'Should Draft?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.1,
      position: [2440, 260],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 1 },
          conditions: [
            {
              leftValue: '={{ $json.draft_required }}',
              rightValue: true,
              operator: { type: 'boolean', operation: 'equals' },
            },
            {
              leftValue: '={{ $json.already_actioned }}',
              rightValue: false,
              operator: { type: 'boolean', operation: 'equals' },
            }
          ],
          combinator: 'and',
        },
      },
    },
    {
      id: 'n9c',
      name: 'Draft Reply',
      type: '@n8n/n8n-nodes-langchain.openAi',
      typeVersion: 1.8,
      position: [2660, 160],
      credentials: { openAiApi: { id: OPENAI_CRED_ID, name: 'OpenAI account' } },
      parameters: {
        modelId: {
          __rl: true,
          mode: 'list',
          value: 'gpt-4o-mini',
          cachedResultName: 'GPT-4O-MINI',
        },
        options: {
          temperature: 0.3,
        },
        messages: {
          values: [
            {
              role: 'system',
              content: DRAFT_PROMPT_PREFIX,
            },
            {
              role: 'user',
              content: '={{ "Draft a reply for this email context: " + JSON.stringify($json) }}',
            },
          ],
        },
      },
    },
    {
      id: 'n10',
      name: 'Prepare Gmail Mutation',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [2880, 260],
      parameters: { mode: 'runOnceForEachItem', jsCode: PREPARE_GMAIL_MUTATION_CODE },
    },
    {
      id: 'n11',
      name: 'Create Gmail Draft',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [3100, 80],
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'draft',
        operation: 'create',
        subject: '={{ $json.draft_subject }}',
        message: '={{ $json.message?.content || "" }}',
        emailType: 'text',
      },
    },
    {
      id: 'n12',
      name: 'Apply Tier Label',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [3100, 180],
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'addLabels',
        messageId: '={{ $json.message_id }}',
        labelIds: '={{ $json.tier_label_id ? [$json.tier_label_id] : [] }}',
      },
    },
    {
      id: 'n13',
      name: 'Apply Context Label',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [3100, 280],
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'addLabels',
        messageId: '={{ $json.message_id }}',
        labelIds: '={{ $json.context_label_id ? [$json.context_label_id] : [] }}',
      },
    },
    {
      id: 'n14',
      name: 'Archive Decision',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [3320, 280],
      parameters: { mode: 'runOnceForEachItem', jsCode: ARCHIVE_DECISION_CODE },
    },
    {
      id: 'n15',
      name: 'Archive Non-Unsure',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [3540, 280],
      credentials: { gmailOAuth2: { id: GMAIL_CRED_ID, name: 'Gmail account' } },
      parameters: {
        resource: 'message',
        operation: 'modify',
        messageId: '={{ $json.message_id }}',
        removeLabelIds: '={{ $json.removeLabelIds || ["INBOX"] }}',
      },
    },
    {
      id: 'n16',
      name: 'Build Slack Summary',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [3760, 260],
      parameters: {
        jsCode: BUILD_SUMMARY_CODE,
      },
    },
    {
      id: 'n17',
      name: 'Post to Airwallex Drafts',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [3980, 200],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      continueOnFail: true,
      parameters: {
        select: 'channel',
        channelId: { __rl: true, value: AIRWALLEX_DRAFTS, mode: 'id' },
        text: '={{ $json.summary_text }}',
        otherOptions: {},
      },
    },
    {
      id: 'n18',
      name: 'DM Noa Summary',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [3980, 320],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      continueOnFail: true,
      parameters: {
        select: 'channel',
        channelId: { __rl: true, value: NOA_USER_ID, mode: 'id' },
        text: '={{ $json.summary_text }}',
        otherOptions: {},
      },
    },
    {
      id: 'n19',
      name: 'Did Channel Send Fail?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.1,
      position: [4200, 200],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 1 },
          conditions: [{
            id: 'channel-fail',
            leftValue: '={{ !!$json.error }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'equals' },
          }],
          combinator: 'and',
        },
      },
    },
    {
      id: 'n20',
      name: 'Retry Channel Send',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [4420, 140],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        select: 'channel',
        channelId: { __rl: true, value: AIRWALLEX_DRAFTS, mode: 'id' },
        text: '={{ $json.summary_text }}',
        otherOptions: {},
      },
    },
    {
      id: 'n21',
      name: 'Did Noa DM Fail?',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.1,
      position: [4200, 320],
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 1 },
          conditions: [{
            id: 'dm-fail',
            leftValue: '={{ !!$json.error }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'equals' },
          }],
          combinator: 'and',
        },
      },
    },
    {
      id: 'n22',
      name: 'Retry Noa DM',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [4420, 320],
      continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        select: 'channel',
        channelId: { __rl: true, value: NOA_USER_ID, mode: 'id' },
        text: '={{ $json.summary_text }}',
        otherOptions: {},
      },
    },
    {
      id: 'n23',
      name: 'Post Failure Alert',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.3,
      position: [4640, 230],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        select: 'channel',
        channelId: { __rl: true, value: AIRWALLEX_DRAFTS, mode: 'id' },
        text: 'Inbox triage Slack delivery needs manual follow-up. Channel: #airwallexdrafts DM: Noa Takhel',
        otherOptions: {},
      },
    },
  ],
  connections: {
    'Schedule 9am ICT Weekdays': { main: [[{ node: 'Build Gmail Query', type: 'main', index: 0 }]] },
    'Webhook Trigger': { main: [[{ node: 'Build Gmail Query', type: 'main', index: 0 }]] },
    'Build Gmail Query': {
      main: [
        [{ node: 'Get Gmail Labels', type: 'main', index: 0 }],
      ],
    },
    'Get Gmail Labels': { main: [[{ node: 'Search Inbox', type: 'main', index: 0 }]] },
    'Search Inbox': { main: [[{ node: 'Fetch Message Details', type: 'main', index: 0 }]] },
    'Fetch Message Details': { main: [[{ node: 'Normalize Email', type: 'main', index: 0 }]] },
    'Normalize Email': { main: [[{ node: 'Detect Existing Handling', type: 'main', index: 0 }]] },
    'Detect Existing Handling': { main: [[{ node: 'Rules Classifier', type: 'main', index: 0 }]] },
    'Rules Classifier': { main: [[{ node: 'Need AI?', type: 'main', index: 0 }]] },
    'Need AI?': {
      main: [
        [{ node: 'AI Classifier', type: 'main', index: 0 }],
        [{ node: 'Merge Final Classification', type: 'main', index: 0 }],
      ],
    },
    'AI Classifier': { main: [[{ node: 'Merge Final Classification', type: 'main', index: 0 }]] },
    'Merge Final Classification': { main: [[{ node: 'Should Draft?', type: 'main', index: 0 }]] },
    'Should Draft?': {
      main: [
        [{ node: 'Draft Reply', type: 'main', index: 0 }],
        [{ node: 'Prepare Gmail Mutation', type: 'main', index: 0 }],
      ],
    },
    'Draft Reply': { main: [[{ node: 'Prepare Gmail Mutation', type: 'main', index: 0 }]] },
    'Prepare Gmail Mutation': {
      main: [
        [{ node: 'Create Gmail Draft', type: 'main', index: 0 }],
        [{ node: 'Apply Tier Label', type: 'main', index: 0 }],
      ],
    },
    'Create Gmail Draft': { main: [[{ node: 'Apply Context Label', type: 'main', index: 0 }]] },
    'Apply Tier Label': { main: [[{ node: 'Apply Context Label', type: 'main', index: 0 }]] },
    'Apply Context Label': { main: [[{ node: 'Archive Decision', type: 'main', index: 0 }]] },
    'Archive Decision': { main: [[{ node: 'Archive Non-Unsure', type: 'main', index: 0 }]] },
    'Archive Non-Unsure': { main: [[{ node: 'Build Slack Summary', type: 'main', index: 0 }]] },
    'Build Slack Summary': {
      main: [
        [{ node: 'Post to Airwallex Drafts', type: 'main', index: 0 }],
        [{ node: 'DM Noa Summary', type: 'main', index: 0 }],
      ],
    },
    'Post to Airwallex Drafts': { main: [[{ node: 'Did Channel Send Fail?', type: 'main', index: 0 }]] },
    'DM Noa Summary': { main: [[{ node: 'Did Noa DM Fail?', type: 'main', index: 0 }]] },
    'Did Channel Send Fail?': { main: [[{ node: 'Retry Channel Send', type: 'main', index: 0 }], []] },
    'Retry Channel Send': { main: [[{ node: 'Post Failure Alert', type: 'main', index: 0 }]] },
    'Did Noa DM Fail?': { main: [[{ node: 'Retry Noa DM', type: 'main', index: 0 }], []] },
    'Retry Noa DM': { main: [[{ node: 'Post Failure Alert', type: 'main', index: 0 }]] },
  },
};

function n8nRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const url = new URL(N8N_URL + path);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'X-N8N-API-KEY': API_KEY,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data || '{}')); } catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function deploy() {
  let result = await n8nRequest('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, workflow);
  if (!result.id) {
    const refreshed = await n8nRequest('GET', `/api/v1/workflows/${WORKFLOW_ID}`);
    result = refreshed && refreshed.id ? refreshed : result;
  }
  if (!result.id) {
    console.log('ERROR:', JSON.stringify(result, null, 2).substring(0, 2000));
    return;
  }
  await n8nRequest('POST', `/api/v1/workflows/${WORKFLOW_ID}/activate`);
  console.log('SUCCESS');
  console.log('Workflow ID:', result.id);
  console.log('Name:', result.name);
  console.log('URL: https://noatakhel.app.n8n.cloud/workflow/' + result.id);
  console.log('\nManual test via:');
  console.log('POST https://noatakhel.app.n8n.cloud/webhook/krave-inbox-triage-daily');
}

if (require.main === module) {
  deploy().catch((e) => console.error('Deploy failed:', e.message));
}

module.exports = { WORKFLOW_ID, workflow };
