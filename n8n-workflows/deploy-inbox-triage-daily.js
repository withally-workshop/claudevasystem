/**
 * Krave — Inbox Triage Daily v2
 * Workflow ID: EuT6REDs5PUaoycE
 * https://noatakhel.app.n8n.cloud/workflow/EuT6REDs5PUaoycE
 *
 * Improvements over v1:
 * - Query: in:inbox is:unread (catches weekend backlog, not just last 24h)
 * - Osome/Compliance hardcoded as EA/Urgent
 * - Creators-Inbound gets typeform draft automatically
 * - AI bias strongly toward Needs-Reply for unknown humans
 * - Correct removeLabels for archiving (not modify)
 * - Updated known contacts from real inbox audit
 *
 * Deploy:
 *   node deploy-inbox-triage-daily.js
 *
 * Credentials required (set in n8n):
 *   Gmail account     → vxHex5lFrkakcsPi
 *   Krave Slack Bot   → Bn2U6Cwe1wdiCXzD
 *   OpenAi account    → UIREXIYn59JOH1zU
 */

import {
  workflow,
  node,
  trigger,
  newCredential,
  ifElse,
  merge,
  expr,
} from "@n8n/workflow-sdk";

// ─── Credentials ──────────────────────────────────────────────────────────────
const gmailCred  = { gmailOAuth2: newCredential("Gmail account") };
const slackCred  = { slackApi: newCredential("Krave Slack Bot") };
const openaiCred = { openAiApi: newCredential("OpenAi account") };

// ─── Label IDs (verified 2026-05-25) ─────────────────────────────────────────
const LABEL_URGENT      = "Label_3";
const LABEL_NEEDS_REPLY = "Label_4";
const LABEL_FYI         = "Label_5";
const LABEL_AUTO_SORTED = "Label_6";
const LABEL_UNSURE      = "Label_7";
const LABEL_COMPLIANCE  = "Label_14";
const LABEL_CREATORS    = "Label_16";
const LABEL_PAYMENT     = "Label_5194298534623747326";

// ─── Triggers ─────────────────────────────────────────────────────────────────

const scheduleTrigger = trigger({
  type: "n8n-nodes-base.scheduleTrigger",
  version: 1.3,
  config: {
    name: "Schedule 9am PHT Weekdays",
    position: [240, 200],
    parameters: {
      rule: {
        interval: [{ field: "cronExpression", expression: "0 9 * * 1-5" }],
      },
    },
  },
  output: [{}],
});

const webhookTrigger = trigger({
  type: "n8n-nodes-base.webhook",
  version: 2.1,
  config: {
    name: "Manual Webhook Trigger",
    position: [240, 400],
    parameters: {
      httpMethod: "POST",
      path: "krave-inbox-triage-v2",
      responseMode: "onReceived",
      options: {},
    },
  },
  output: [{}],
});

// ─── Fetch Emails ──────────────────────────────────────────────────────────────

const searchInbox = node({
  type: "n8n-nodes-base.gmail",
  version: 2.2,
  config: {
    name: "Search Unread Inbox",
    position: [500, 300],
    credentials: gmailCred,
    parameters: {
      resource: "message",
      operation: "getAll",
      returnAll: false,
      limit: 50,
      simple: true,
      filters: {
        q: "in:inbox is:unread -label:EA/Urgent -label:EA/Needs-Reply -label:EA/FYI -label:EA/Auto-Sorted -label:EA/Unsure",
      },
    },
  },
  output: [{ id: "msg123", subject: "Sample email", labelIds: [] }],
});

const getMessageDetails = node({
  type: "n8n-nodes-base.gmail",
  version: 2.2,
  config: {
    name: "Get Message Details",
    position: [740, 300],
    credentials: gmailCred,
    parameters: {
      resource: "message",
      operation: "get",
      messageId: expr("{{ $json.id }}"),
      simple: false,
    },
  },
  output: [{
    id: "msg123",
    threadId: "thread123",
    labelIds: [],
    snippet: "Sample snippet",
    textPlain: "Sample body text",
    subject: "Sample subject",
    from: "Sender Name <sender@example.com>",
  }],
});

// ─── Rules Classifier ─────────────────────────────────────────────────────────

const classifyEmail = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {
    name: "Classify Email",
    position: [980, 300],
    parameters: {
      mode: "runOnceForEachItem",
      jsCode: `
function headerVal(headers, name) {
  return (headers || []).find(h => String(h.name || '').toLowerCase() === name.toLowerCase())?.value || '';
}
function parseSender(raw) {
  const m = String(raw || '').match(/^(.*?)(?:\\s*<([^>]+)>)?$/);
  return {
    name: (m?.[1] || raw || '').replace(/["']/g, '').trim(),
    email: (m?.[2] || raw || '').toLowerCase().trim()
  };
}

const payload = $json.payload || {};
const headers = payload.headers || [];
const sender  = parseSender(headerVal(headers, 'From'));
const subject = headerVal(headers, 'Subject') || $json.subject || '';
const labelIds = $json.labelIds || [];
const bodyText = ($json.textPlain || $json.textHtml || '').replace(/\\s+/g, ' ').trim().slice(0, 800);
const haystack = [sender.name, sender.email, subject, $json.snippet || '', bodyText].join(' ').toLowerCase();

const base = {
  id: $json.id,
  threadId: $json.threadId || '',
  from_name: sender.name,
  from_email: sender.email,
  subject,
  snippet: $json.snippet || '',
  body_preview: bodyText,
  label_ids: labelIds,
};

// 1. Osome / Compliance — always Urgent
if (sender.email.includes('osome.com') || labelIds.includes('Label_14')) {
  return { json: { ...base, tier: 'EA/Urgent', tier_label_id: 'Label_3', draft_required: true, ai_needed: false, is_creator_inbound: false, summary_line: '[COMPLIANCE] Osome — action required' } };
}

// 2. Creator inbound — typeform draft
if (labelIds.includes('Label_16')) {
  return { json: { ...base, tier: 'EA/Needs-Reply', tier_label_id: 'Label_4', draft_required: true, ai_needed: false, is_creator_inbound: true, summary_line: 'Creator inbound — typeform reply drafted' } };
}

// 3. Client payment received — FYI
if (labelIds.includes('Label_5194298534623747326')) {
  return { json: { ...base, tier: 'EA/FYI', tier_label_id: 'Label_5', draft_required: false, ai_needed: false, is_creator_inbound: false, summary_line: 'Client payment received' } };
}

// 4. Known contacts — Needs-Reply
const KNOWN = ['amanda', 'shin', 'joshua', 'amy', 'lucas', 'ani hume', 'roshni', 'stashworks', 'nelly', 'welleco', 'clear aligners', 'root labs', 'zenwise', 'comrad', 'john@kravemedia.co', 'anteros'];
if (KNOWN.some(k => haystack.includes(k))) {
  return { json: { ...base, tier: 'EA/Needs-Reply', tier_label_id: 'Label_4', draft_required: true, ai_needed: false, is_creator_inbound: false, summary_line: 'Known contact — reply drafted' } };
}

// 5. PandaDoc contract completed
if (sender.email.includes('pandadoc.net') && haystack.includes('completed')) {
  return { json: { ...base, tier: 'EA/Needs-Reply', tier_label_id: 'Label_4', draft_required: false, ai_needed: false, is_creator_inbound: false, summary_line: 'Contract signed' } };
}

// 6. Auto-sort safety net (Gmail filters handle most)
const AUTO = [/noreply@/i, /no-reply@/i, /notifications@/i];
if (AUTO.some(p => p.test(sender.email))) {
  return { json: { ...base, tier: 'EA/Auto-Sorted', tier_label_id: 'Label_6', draft_required: false, ai_needed: false, is_creator_inbound: false, summary_line: 'Auto-sorted notification' } };
}

// 7. Unknown sender — needs AI
return { json: { ...base, tier: '', tier_label_id: '', draft_required: false, ai_needed: true, is_creator_inbound: false, summary_line: '' } };
      `.trim(),
    },
  },
  output: [{
    id: "msg123", threadId: "thread123",
    from_name: "Sender", from_email: "sender@example.com",
    subject: "Hello", snippet: "...", body_preview: "Body",
    tier: "EA/Needs-Reply", tier_label_id: "Label_4",
    draft_required: true, ai_needed: false,
    is_creator_inbound: false, summary_line: "Known contact",
  }],
});

// ─── AI Branch ────────────────────────────────────────────────────────────────

const checkAINeeded = ifElse({
  version: 2.3,
  config: {
    name: "AI Needed?",
    position: [1220, 300],
    parameters: {
      conditions: {
        combinator: "and",
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 1 },
        conditions: [{
          leftValue: expr("{{ $json.ai_needed }}"),
          rightValue: true,
          operator: { type: "boolean", operation: "equals" },
        }],
      },
    },
  },
});

const aiClassify = node({
  type: "@n8n/n8n-nodes-langchain.openAi",
  version: 2.3,
  config: {
    name: "AI Classify",
    position: [1460, 180],
    credentials: openaiCred,
    parameters: {
      resource: "text",
      operation: "response",
      modelId: { __rl: true, mode: "id", value: "gpt-4o-mini" },
      simplify: true,
      responses: {
        values: [
          {
            role: "system",
            content: "You classify emails for Noa Takhel, CEO of Krave Media (performance creative agency, Singapore). She manages 4 businesses: Krave Media, Halo Home, Skyvane, IM8.\n\nReturn ONLY valid JSON with keys: tier, tier_label_id, draft_required (boolean), summary_line (max 10 words).\n\nTiers:\n- EA/Urgent (Label_3): compliance deadlines, legal, payment disputes, emergencies\n- EA/Needs-Reply (Label_4): any real human email needing a response — leads, clients, partners, ops\n- EA/FYI (Label_5): useful info, no reply needed\n- EA/Auto-Sorted (Label_6): automated notifications that slipped through\n- EA/Unsure (Label_7): genuinely ambiguous\n\nBias STRONGLY toward EA/Needs-Reply for any real human sender. Only use EA/Unsure if truly impossible to classify. Set draft_required: true for Urgent and Needs-Reply.",
          },
          {
            role: "user",
            content: expr("{{ JSON.stringify({ from: $json.from_email, name: $json.from_name, subject: $json.subject, snippet: $json.snippet, body: $json.body_preview }) }}"),
          },
        ],
      },
      options: { temperature: 0.2 },
    },
  },
  output: [{ text: "{\"tier\":\"EA/Needs-Reply\",\"tier_label_id\":\"Label_4\",\"draft_required\":true,\"summary_line\":\"Lead follow-up needed\"}" }],
});

const mergeClassification = merge({
  version: 3.2,
  config: {
    name: "Merge Classification",
    position: [1700, 300],
    parameters: { mode: "append" },
  },
});

const resolveTier = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {
    name: "Resolve Final Tier",
    position: [1940, 300],
    parameters: {
      mode: "runOnceForEachItem",
      jsCode: `
// Rules-classified items have all fields set
if ($json.ai_needed === false) return { json: $json };

// AI-classified: parse response, recover original email fields
const original = $('Classify Email').item.json;
const raw = $json.text || $json.content || '';
let parsed = {};
try { parsed = JSON.parse(raw); } catch(e) { parsed = {}; }

const tier = parsed.tier || 'EA/Unsure';
const tierIds = { 'EA/Urgent': 'Label_3', 'EA/Needs-Reply': 'Label_4', 'EA/FYI': 'Label_5', 'EA/Auto-Sorted': 'Label_6', 'EA/Unsure': 'Label_7' };

return { json: {
  ...original,
  tier,
  tier_label_id: parsed.tier_label_id || tierIds[tier] || 'Label_7',
  draft_required: Boolean(parsed.draft_required),
  summary_line: parsed.summary_line || tier,
  ai_needed: false,
}};
      `.trim(),
    },
  },
  output: [{
    id: "msg123", threadId: "thread123",
    from_name: "Sender", from_email: "sender@example.com",
    subject: "Hello", body_preview: "Body",
    tier: "EA/Needs-Reply", tier_label_id: "Label_4",
    draft_required: true, ai_needed: false, summary_line: "Lead reply needed",
  }],
});

// ─── Apply Label ──────────────────────────────────────────────────────────────

const applyLabel = node({
  type: "n8n-nodes-base.gmail",
  version: 2.2,
  config: {
    name: "Apply EA Label",
    position: [2180, 300],
    credentials: gmailCred,
    parameters: {
      resource: "message",
      operation: "addLabels",
      messageId: expr("{{ $json.id }}"),
      labelIds: [expr("{{ $json.tier_label_id }}")],
    },
  },
  output: [{ id: "msg123", labelIds: ["Label_4"] }],
});

// ─── Draft Branch ─────────────────────────────────────────────────────────────

const checkDraftNeeded = ifElse({
  version: 2.3,
  config: {
    name: "Draft Needed?",
    position: [2420, 300],
    parameters: {
      conditions: {
        combinator: "and",
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 1 },
        conditions: [{
          leftValue: expr("{{ $json.draft_required }}"),
          rightValue: true,
          operator: { type: "boolean", operation: "equals" },
        }],
      },
    },
  },
});

const checkCreatorInbound = ifElse({
  version: 2.3,
  config: {
    name: "Creator Inbound?",
    position: [2660, 120],
    parameters: {
      conditions: {
        combinator: "and",
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 1 },
        conditions: [{
          leftValue: expr("{{ $json.is_creator_inbound }}"),
          rightValue: true,
          operator: { type: "boolean", operation: "equals" },
        }],
      },
    },
  },
});

const createCreatorDraft = node({
  type: "n8n-nodes-base.gmail",
  version: 2.2,
  config: {
    name: "Draft: Creator Typeform",
    position: [2900, 0],
    credentials: gmailCred,
    parameters: {
      resource: "draft",
      operation: "create",
      subject: expr("Re: {{ $json.subject }}"),
      emailType: "text",
      message: expr("Hi {{ $json.from_name }},\n\nThank you for reaching out!\n\nWe would love to learn more about you. Please sign up to our creator database here:\nhttps://form.typeform.com/to/lAPIxgqv\n\nLooking forward to connecting!\n\nBest,\nNoa"),
      options: {
        sendTo: expr("{{ $json.from_email }}"),
        threadId: expr("{{ $json.threadId }}"),
      },
    },
  },
  output: [{ id: "draft123", message: { id: "msg123" } }],
});

const generateAIDraft = node({
  type: "@n8n/n8n-nodes-langchain.openAi",
  version: 2.3,
  config: {
    name: "Generate AI Draft",
    position: [2900, 220],
    credentials: openaiCred,
    parameters: {
      resource: "text",
      operation: "response",
      modelId: { __rl: true, mode: "id", value: "gpt-4o-mini" },
      simplify: true,
      responses: {
        values: [
          {
            role: "system",
            content: "Write a Gmail reply draft in Noa Takhel's voice (CEO, Krave Media). Direct, outcome-oriented, zero filler. For decisions use 3-and-1: 3 options then 1 recommendation. Under 150 words unless context requires more. Output email body only — no subject, no sign-off.",
          },
          {
            role: "user",
            content: expr("Draft a reply to this email.\nFrom: {{ $json.from_name }} <{{ $json.from_email }}>\nSubject: {{ $json.subject }}\nBody: {{ $json.body_preview }}"),
          },
        ],
      },
      options: { temperature: 0.3 },
    },
  },
  output: [{ text: "Draft reply text here." }],
});

const createGeneralDraft = node({
  type: "n8n-nodes-base.gmail",
  version: 2.2,
  config: {
    name: "Create Draft",
    position: [3140, 220],
    credentials: gmailCred,
    parameters: {
      resource: "draft",
      operation: "create",
      subject: expr("Re: {{ $(\"Resolve Final Tier\").item.json.subject }}"),
      emailType: "text",
      message: expr("{{ $json.text || '' }}"),
      options: {
        sendTo: expr("{{ $(\"Resolve Final Tier\").item.json.from_email }}"),
        threadId: expr("{{ $(\"Resolve Final Tier\").item.json.threadId }}"),
      },
    },
  },
  output: [{ id: "draft123", message: { id: "msg123" } }],
});

const mergeDrafts = merge({
  version: 3.2,
  config: {
    name: "Merge Draft Branches",
    position: [3380, 300],
    parameters: { mode: "append" },
  },
});

// ─── Archive Branch ───────────────────────────────────────────────────────────

const checkArchive = ifElse({
  version: 2.3,
  config: {
    name: "Archive?",
    position: [3620, 300],
    parameters: {
      conditions: {
        combinator: "and",
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 1 },
        conditions: [{
          leftValue: expr("{{ $json.tier }}"),
          rightValue: "EA/Unsure",
          operator: { type: "string", operation: "notEquals" },
        }],
      },
    },
  },
});

const archiveEmail = node({
  type: "n8n-nodes-base.gmail",
  version: 2.2,
  config: {
    name: "Archive Email",
    position: [3860, 200],
    credentials: gmailCred,
    parameters: {
      resource: "message",
      operation: "removeLabels",
      messageId: expr("{{ $json.id }}"),
      labelIds: ["INBOX"],
    },
  },
  output: [{ id: "msg123", labelIds: ["Label_4"] }],
});

const mergeArchive = merge({
  version: 3.2,
  config: {
    name: "Merge Archive",
    position: [4100, 300],
    parameters: { mode: "append" },
  },
});

// ─── Slack Summary ────────────────────────────────────────────────────────────

const buildSummary = node({
  type: "n8n-nodes-base.code",
  version: 2,
  config: {
    name: "Build Slack Summary",
    position: [4340, 300],
    parameters: {
      mode: "runOnceForAllItems",
      jsCode: `
const rows = $input.all().map(i => i.json);

function linesFor(tier) {
  return rows.filter(r => r.tier === tier).map(r =>
    "• " + (r.from_name || r.from_email || "Unknown") +
    " — " + (r.subject || "(no subject)") +
    (r.summary_line ? " -> " + r.summary_line : "") +
    (r.draft_required ? " _(draft ready)_" : "")
  );
}

const urgent    = linesFor("EA/Urgent");
const reply     = linesFor("EA/Needs-Reply");
const fyi       = linesFor("EA/FYI");
const unsure    = linesFor("EA/Unsure");
const autoCount = rows.filter(r => r.tier === "EA/Auto-Sorted").length;

const date = new Date().toLocaleDateString("en-US", {
  timeZone: "Asia/Manila",
  weekday: "long", month: "long", day: "numeric"
});

const sections = ["*Morning Triage -- " + date + " (PHT)*"];

if (rows.length === 0) {
  sections.push("\\nInbox clear -- no new unread emails.");
} else {
  if (urgent.length)    sections.push("\\n*[URGENT] Act today (" + urgent.length + ")*\\n" + urgent.join("\\n"));
  if (reply.length)     sections.push("\\n*Needs Reply (" + reply.length + ")*\\n" + reply.join("\\n"));
  if (fyi.length)       sections.push("\\n*FYI (" + fyi.length + ")*\\n" + fyi.join("\\n"));
  if (unsure.length)    sections.push("\\n*Review These (" + unsure.length + ")*\\n" + unsure.join("\\n"));
  if (autoCount)        sections.push("\\n*Auto-Sorted: " + autoCount + "* -- no action needed");
}

return [{ json: { summary_text: sections.join("\\n"), total: rows.length } }];
      `.trim(),
    },
  },
  output: [{ summary_text: "*Morning Triage -- Monday, May 25 (PHT)*\n...", total: 3 }],
});

const postToChannel = node({
  type: "n8n-nodes-base.slack",
  version: 2.4,
  config: {
    name: "Post to #ops-command",
    position: [4580, 200],
    credentials: slackCred,
    parameters: {
      resource: "message",
      operation: "post",
      select: "channel",
      channelId: { __rl: true, mode: "id", value: "C0AQZGJDR38" },
      text: expr("{{ $json.summary_text }}"),
      otherOptions: { includeLinkToWorkflow: false },
    },
  },
  output: [{ ok: true }],
});


// ─── Compose ──────────────────────────────────────────────────────────────────

export default workflow("new", "Krave — Inbox Triage Daily v2")
  .add(scheduleTrigger)
  .to(searchInbox)
  .to(getMessageDetails)
  .to(classifyEmail)
  .to(
    checkAINeeded
      .onTrue(aiClassify.to(mergeClassification.input(0)))
      .onFalse(mergeClassification.input(1))
  )
  .add(mergeClassification)
  .to(resolveTier)
  .to(applyLabel)
  .to(
    checkDraftNeeded
      .onTrue(
        checkCreatorInbound
          .onTrue(createCreatorDraft.to(mergeDrafts.input(0)))
          .onFalse(generateAIDraft.to(createGeneralDraft.to(mergeDrafts.input(0))))
      )
      .onFalse(mergeDrafts.input(1))
  )
  .add(mergeDrafts)
  .to(
    checkArchive
      .onTrue(archiveEmail.to(mergeArchive.input(0)))
      .onFalse(mergeArchive.input(1))
  )
  .add(mergeArchive)
  .to(buildSummary)
  .to(postToChannel)
  .add(webhookTrigger)
  .to(searchInbox);
