const https = require('https');
const fs = require('fs');

fs.readFileSync('C:/Users/jopso/Desktop/claude-ea/.env', 'utf8').split('\n').forEach(line => {
  const m = line.match(/^([^#=\s][^=]*)=(.+)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
});

const key = process.env.N8N_API_KEY;
const id = 'EuT6REDs5PUaoycE';

function req(method, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const opts = {
      hostname: 'noatakhel.app.n8n.cloud',
      path: '/api/v1/workflows/' + id,
      method,
      headers: { 'X-N8N-API-KEY': key, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': data.length } : {}) }
    };
    const r = https.request(opts, res => {
      let b = ''; res.on('data', c => b += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, body: b }); } });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

// Fix 1: robust extractFrom that handles mailparser array format
const CLASSIFY_CODE = `function headerVal(headers, name) {
  return (headers || []).find(h => String(h.name || '').toLowerCase() === name.toLowerCase())?.value || '';
}
function extractFrom(json, headers) {
  // Try payload.headers first (Gmail API raw format)
  const h = (headers || []).find(h => String(h?.name || '').toLowerCase() === 'from');
  if (h?.value) return h.value;
  // Try top-level From — handles string, {value: string}, {value: [{name, address}], text}
  const f = json.From || json.from;
  if (!f) return '';
  if (typeof f === 'string') return f;
  if (typeof f === 'object') {
    if (f.text && typeof f.text === 'string') return f.text;
    if (typeof f.value === 'string') return f.value;
    if (Array.isArray(f.value) && f.value.length > 0) {
      const v = f.value[0];
      if (v.name && v.address) return v.name + ' <' + v.address + '>';
      if (v.address) return v.address;
    }
  }
  return '';
}
function parseSender(raw) {
  raw = String(raw || '');
  const m = raw.match(/^(.*?)(?:\\s*<([^>]+)>)?$/);
  return {
    name: (m?.[1] || raw || '').replace(/["']/g, '').trim(),
    email: (m?.[2] || raw || '').toLowerCase().trim()
  };
}

const payload  = $json.payload || {};
const headers  = payload.headers || [];
const sender   = parseSender(extractFrom($json, headers));
const subject  = headerVal(headers, 'Subject') || $json.Subject || $json.subject || '';
const labelIds = $json.labelIds || [];
const bodyText = ($json.textPlain || $json.textHtml || $json.snippet || '').replace(/\\s+/g, ' ').trim().slice(0, 800);
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

if (sender.email.includes('osome.com') || labelIds.includes('Label_14')) {
  return { json: { ...base, tier: 'EA/Urgent', tier_label_id: 'Label_3', draft_required: true, ai_needed: false, is_creator_inbound: false, summary_line: '[COMPLIANCE] Osome — action required' } };
}
if (labelIds.includes('Label_16')) {
  return { json: { ...base, tier: 'EA/Needs-Reply', tier_label_id: 'Label_4', draft_required: true, ai_needed: false, is_creator_inbound: true, summary_line: 'Creator inbound — typeform reply drafted' } };
}
if (labelIds.includes('Label_5194298534623747326')) {
  return { json: { ...base, tier: 'EA/FYI', tier_label_id: 'Label_5', draft_required: false, ai_needed: false, is_creator_inbound: false, summary_line: 'Client payment received' } };
}
const KNOWN = ['amanda', 'shin', 'joshua', 'amy', 'lucas', 'ani mishra', 'ani hume', 'roshni', 'stashworks', 'nelly', 'welleco', 'clear aligners', 'root labs', 'zenwise', 'comrad', 'john@kravemedia.co', 'anteros', 'joseph', 'cody', 'cashew'];
if (KNOWN.some(k => haystack.includes(k))) {
  return { json: { ...base, tier: 'EA/Needs-Reply', tier_label_id: 'Label_4', draft_required: true, ai_needed: false, is_creator_inbound: false, summary_line: 'Known contact — reply drafted' } };
}
if (sender.email.includes('pandadoc.net') && haystack.includes('completed')) {
  return { json: { ...base, tier: 'EA/Needs-Reply', tier_label_id: 'Label_4', draft_required: false, ai_needed: false, is_creator_inbound: false, summary_line: 'Contract signed' } };
}
const AUTO = [/noreply@/i, /no-reply@/i, /notifications@/i];
if (AUTO.some(p => p.test(sender.email))) {
  return { json: { ...base, tier: 'EA/Auto-Sorted', tier_label_id: 'Label_6', draft_required: false, ai_needed: false, is_creator_inbound: false, summary_line: 'Auto-sorted notification' } };
}
if (sender.email === 'john@kravemedia.co' && (haystack.includes('invoice') || haystack.includes('fya'))) {
  return { json: { ...base, tier: 'EA/FYI', tier_label_id: 'Label_5', draft_required: false, ai_needed: false, is_creator_inbound: false, summary_line: 'Internal invoice update' } };
}
return { json: { ...base, tier: '', tier_label_id: '', draft_required: false, ai_needed: true, is_creator_inbound: false, summary_line: '' } };`;

// Fix 2: Restore After Draft node — re-attaches email metadata after draft branch wipes it
const RESTORE_AFTER_DRAFT_CODE = `// Draft nodes return draft objects, losing all email metadata.
// Re-attach from Restore Email Metadata (which has the full classified email).
const orig = $('Restore Email Metadata').item.json;
return { json: orig };`;

(async () => {
  const { body: wf } = await req('GET');

  // Apply Fix 1
  const classifyNode = wf.nodes.find(n => n.name === 'Classify Email');
  classifyNode.parameters.jsCode = CLASSIFY_CODE;
  console.log('Fix 1: Classify Email updated (robust extractFrom)');

  // Apply Fix 2: insert Restore After Draft node if not already there
  let restoreAfterDraft = wf.nodes.find(n => n.name === 'Restore After Draft');
  if (!restoreAfterDraft) {
    const mergeNode = wf.nodes.find(n => n.name === 'Merge Draft Branches');
    const archiveCheck = wf.nodes.find(n => n.name === 'Archive?');

    restoreAfterDraft = {
      id: 'restore-after-draft-' + Date.now(),
      name: 'Restore After Draft',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [
        Math.round((mergeNode.position[0] + archiveCheck.position[0]) / 2),
        mergeNode.position[1]
      ],
      parameters: {
        mode: 'runOnceForEachItem',
        jsCode: RESTORE_AFTER_DRAFT_CODE
      }
    };
    wf.nodes.push(restoreAfterDraft);
    console.log('Fix 2: Restore After Draft node added');

    // Rewire: Merge Draft Branches → Restore After Draft → Archive?
    // Find current connection from Merge Draft Branches to Archive?
    const mergeConns = wf.connections['Merge Draft Branches'];
    if (mergeConns?.main?.[0]) {
      // Save old target (Archive?)
      const oldTarget = mergeConns.main[0];
      // Merge Draft Branches → Restore After Draft
      wf.connections['Merge Draft Branches'] = { main: [[{ node: 'Restore After Draft', type: 'main', index: 0 }]] };
      // Restore After Draft → Archive?
      wf.connections['Restore After Draft'] = { main: [oldTarget] };
      console.log('Fix 2: Connections rewired');
    }
  } else {
    restoreAfterDraft.parameters.jsCode = RESTORE_AFTER_DRAFT_CODE;
    console.log('Fix 2: Restore After Draft updated');
  }

  const { executionOrder, availableInMCP } = wf.settings || {};
  const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: { executionOrder, availableInMCP }, staticData: wf.staticData ?? null };
  const { status, body } = await req('PUT', payload);
  console.log('\nPUT status:', status);
  if (status !== 200) console.log('Error:', JSON.stringify(body).slice(0, 500));
  else console.log('Both fixes deployed.');
})().catch(e => console.error(e.message));
