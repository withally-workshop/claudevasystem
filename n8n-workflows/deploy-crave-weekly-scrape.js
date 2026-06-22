// deploy-crave-weekly-scrape.js
// Crave - Weekly Creator Scrape (n8n cloud)
//
// Weekly TikTok UGC-creator discovery, ported from projects/crave-outreach (Python).
// Schedule: Mondays 11:00 AM PHT. Scrapes US + NL (all configured search terms),
// enriches NEW creators via Claude Haiku, dedupes, upserts the master Sheet, and
// posts a report to #krave-creator-outreach + a summary to #ops-command.
//
// CORRECTNESS CONTRACT (mirrors projects/crave-outreach/src/sheets.py upsert):
//   - Existing handles: refresh ONLY cols A–N (handle..scraped_at). status/notes/
//     outreach_sent_at/replied_at/bounced/opened_at are PRESERVED — never reset.
//     niche/first_name for existing rows are carried over from the Sheet (not re-enriched).
//   - New handles: appended with status='new'.
//   This prevents already-contacted creators (approved/outreach_queued) from being
//   re-surfaced for outreach.
//
// Apify + Anthropic keys live in n8n STORED CREDENTIALS (httpQueryAuth / httpHeaderAuth),
// referenced by ID below — NOT baked into the workflow JSON. Slack + Sheets likewise.
// Only N8N_API_KEY is needed to deploy. Run with the repo-root .env sourced:
//   set -a && source ./.env && set +a && node n8n-workflows/deploy-crave-weekly-scrape.js

const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;

if (!API_KEY) throw new Error('N8N_API_KEY not set in env (source ./.env)');

// ─── Constants ──────────────────────────────────────────────────────────────
const ACTOR_ID = 'clockworks~tiktok-scraper';            // keyword/search scraper (NOT the hashtag one)
const ENRICH_MODEL = 'claude-haiku-4-5-20251001';
const SHEET_ID = '1eLQrDP3IX9ec9dtFN0UyRdlTplzkLfRG9Asyqj1gLrI';
const SHEET_NAME = 'Sheet1';

const SHEETS_CRED_ID = '83MQOm78gYDvziTO';               // "Google Sheets account" (reused from Halo intel)
const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD';                // "Krave Slack Bot" (reused from Halo intel)
const APIFY_CRED_ID = 'q05geHfB0qtHthav';                // httpQueryAuth: Apify token (scoped to api.apify.com)
const ANTHROPIC_CRED_ID = 'LY6gYSrbEouJMpsb';            // httpHeaderAuth: Anthropic x-api-key (scoped to api.anthropic.com)

const OUTREACH_CHANNEL = 'C0B5MQF50RX';                  // #krave-creator-outreach (detailed report)
const OPS_CHANNEL = 'C0AQZGJDR38';                       // #ops-command (summary)
const ENRICH_BATCH = 40;                                 // creators per Claude call

// Per-region scrape config. perQuery × #terms ≈ region target; totalLimit hard-caps returned items.
// NOTE: volumes are kept modest because n8n Cloud Starter retains every node's output in
// memory for the whole run and OOMs above ~a few hundred items. For a weekly incremental
// scrape this is plenty. Tune up cautiously and re-test if you want more per run.
const REGIONS = {
  US: {
    terms: ['UGC creator', 'content creator', 'UGC'],
    proxy: 'US', perQuery: 40, totalLimit: 120, minFollowers: 1000, maxFollowers: 500000,
  },
  NL: {
    terms: ['UGC creator', 'content creator', 'ugc nederland', 'ugc maker'],
    proxy: 'NL', perQuery: 20, totalLimit: 80, minFollowers: 500, maxFollowers: 500000,
  },
};

function apifyBody(region) {
  const r = REGIONS[region];
  return JSON.stringify({
    searchQueries: r.terms,
    maxProfilesPerQuery: r.perQuery,
    resultsPerPage: r.perQuery,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadAvatars: false,
    proxyCountryCode: r.proxy,
    videoSearchSorting: 'MOST_RELEVANT',
  });
}

function apifyUrl(region) {
  const r = REGIONS[region];
  // token injected by the httpQueryAuth credential — never in the URL/workflow JSON.
  // fields=authorMeta,text projects the dataset down to ONLY what Normalize reads —
  // clockworks returns large full-video objects; without this n8n Starter OOMs holding them.
  return `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items`
    + `?timeout=300&memory=2048&limit=${r.totalLimit}&fields=authorMeta,text&clean=true`;
}

// ─── Code: Normalize (per region) ─────────────────────────────────────────────
// Ports scrape.py _normalise_profile + in-run dedupe-by-handle + follower filter.
// Region floor + _region tag are baked per branch.
function normalizeCode(region) {
  const r = REGIONS[region];
  return `
const REGION = ${JSON.stringify(region)};
const MIN_F = ${r.minFollowers}, MAX_F = ${r.maxFollowers};
const EMAIL_RE = /[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}/;
const ROLE = new Set(['info','contact','hello','support','admin','team','pr','business','collab']);
const LINK_RE = /https?:\\/\\/(linktr\\.ee|beacons\\.ai|bio\\.link|linkinbio\\.com)\\/\\S+/i;
const US_ABBR = /,\\s*[A-Z]{2}\\b/;
const US_SIGNALS = ['united states','usa','u.s.a','u.s.','california','texas','florida','new york','los angeles','chicago','houston','miami','atlanta','seattle','denver','austin','boston','nashville','las vegas','san francisco','san diego','dallas','phoenix','portland'];
const NL_SIGNALS = ['netherlands','nederland','holland','noord-holland','zuid-holland','utrecht','gelderland','amsterdam','rotterdam','den haag','the hague','eindhoven','groningen','tilburg','breda','nijmegen','haarlem','arnhem','maastricht','leiden'];
function regionSignal(bio){
  const c = (bio||'').toLowerCase();
  for (const s of US_SIGNALS) if (c.includes(s)) return 'US';
  if (US_ABBR.test(bio||'')) return 'US';
  for (const s of NL_SIGNALS) if (c.includes(s)) return 'NL';
  return '';
}
const items = $input.all();
const seen = {};
for (const it of items) {
  const raw = it.json || {};
  const a = raw.authorMeta || {};
  if (!a || Object.keys(a).length === 0) continue;
  const handle = a.name || a.uniqueId || '';
  if (!handle) continue;
  const key = handle.toLowerCase();
  const bio = a.signature || '';
  const followers = a.fans || a.followerCount || 0;
  const cap = raw.text || '';
  const em = (bio.match(EMAIL_RE) || [])[0];
  const email = em ? em.toLowerCase() : '';
  const rec = {
    handle,
    profile_url: a.profileUrl || ('https://www.tiktok.com/@' + handle),
    email,
    followers,
    following: a.following || 0,
    bio: bio.slice(0, 500),
    region_signal: regionSignal(bio),
    last_3_captions: cap,
    link_in_bio: (bio.match(LINK_RE) || [])[0] || '',
    role_based_email: email ? ROLE.has(email.split('@')[0]) : false,
    _region: REGION,
  };
  if (!(key in seen)) {
    seen[key] = rec;
  } else {
    const ex = seen[key];
    // merge captions
    if (cap && !(ex.last_3_captions || '').includes(cap)) {
      ex.last_3_captions = [ex.last_3_captions, cap].filter(Boolean).join(' | ').slice(0, 1000);
    }
    // keep higher-follower core fields
    if (followers > (ex.followers || 0)) {
      const caps = ex.last_3_captions;
      seen[key] = { ...rec, last_3_captions: caps };
    }
  }
}
const out = Object.values(seen).filter(p => (p.followers || 0) >= MIN_F && (p.followers || 0) <= MAX_F);
return out.map(p => ({ json: p }));
`.trim();
}

// ─── Code: Dedupe (global, across regions) ────────────────────────────────────
// Ports dedupe.py: by handle (keep first), then by email (keep higher followers).
const DEDUPE_CODE = `
const items = $input.all().map(i => i.json);
const byHandle = {};
for (const p of items) {
  const h = (p.handle || '').toLowerCase().trim();
  if (!h) continue;
  if (!(h in byHandle)) byHandle[h] = p;
}
let arr = Object.values(byHandle);
const byEmail = {};
const noEmail = [];
for (const p of arr) {
  const e = (p.email || '').toLowerCase().trim();
  if (!e) { noEmail.push(p); continue; }
  if (!(e in byEmail)) byEmail[e] = p;
  else if ((p.followers || 0) > (byEmail[e].followers || 0)) byEmail[e] = p;
}
const final = [...Object.values(byEmail), ...noEmail];
return final.map(p => ({ json: p }));
`.trim();

// ─── Code: Prepare Enrich (NEW handles only, batched) ─────────────────────────
// Only NEW creators are sent to Claude — existing rows carry over their saved
// niche/first_name (mirrors the Python enrichment cache).
const PREPARE_ENRICH_CODE = `
const existing = new Set($('Read Sheet').all().map(i => (i.json.handle || '').toLowerCase()).filter(Boolean));
const creators = $('Dedupe').all().map(i => i.json).filter(c => !existing.has((c.handle || '').toLowerCase()));
const BATCH = ${ENRICH_BATCH};
const batches = [];
for (let i = 0; i < creators.length; i += BATCH) batches.push(creators.slice(i, i + BATCH));
if (batches.length === 0) {
  // No new creators — emit one no-op so the chain continues to upsert + reports.
  return [{ json: { noop: true, system: 'Return [].', user: 'Return an empty JSON array: []' } }];
}
const system = 'You are a TikTok creator classification assistant. Niches: beauty, fashion, fitness, food, tech, lifestyle, parenting, business, other.';
return batches.map((b, idx) => ({ json: {
  batchIndex: idx,
  system,
  user: 'For each creator below, return ONLY a JSON array (no prose), one object per creator IN THE SAME ORDER, each: {"handle": string, "niche": one of [beauty,fashion,fitness,food,tech,lifestyle,parenting,business,other], "niche_confidence": number 0..1, "first_name": string or null (from handle/bio, e.g. CharlotteUGC -> Charlotte)}.\\n\\nCreators:\\n' +
    JSON.stringify(b.map(c => ({ handle: c.handle, bio: (c.bio || '').slice(0, 300), captions: (c.last_3_captions || '').slice(0, 300) })))
}}));
`.trim();

// ─── Code: Apply Enrich + build upsert rows ───────────────────────────────────
// Merges Claude enrichment (new) with preserved Sheet enrichment (existing),
// computes status (new -> 'new'; existing -> preserve), and emits final rows.
const APPLY_ENRICH_CODE = `
const NICHES = new Set(['beauty','fashion','fitness','food','tech','lifestyle','parenting','business','other']);
const creators = $('Dedupe').all().map(i => i.json);

// Claude enrichment for NEW creators, keyed by handle
const enrich = {};
for (const r of $('Claude Enrich').all()) {
  try {
    const txt = (r.json.content && r.json.content[0] && r.json.content[0].text) || '';
    const m = txt.match(/\\[[\\s\\S]*\\]/);
    if (!m) continue;
    const arr = JSON.parse(m[0]);
    for (const o of arr) {
      if (o && o.handle) enrich[String(o.handle).toLowerCase()] = o;
    }
  } catch (e) { /* tolerate bad batch */ }
}

// Existing Sheet rows keyed by handle (preserve status + enrichment)
const existing = {};
for (const row of $('Read Sheet').all()) {
  const j = row.json; const h = (j.handle || '').toLowerCase();
  if (h) existing[h] = j;
}

const now = new Date().toISOString();
const out = creators.map(c => {
  const h = (c.handle || '').toLowerCase();
  const ex = existing[h];
  let niche, conf, fname, status;
  if (ex) {                                   // EXISTING — preserve enrichment + status
    niche = ex.niche || '';
    conf = (ex.niche_confidence !== undefined && ex.niche_confidence !== '') ? ex.niche_confidence : '';
    fname = ex.first_name || '';
    status = ex.status || 'new';
  } else {                                    // NEW — use Claude enrichment
    const e = enrich[h] || {};
    niche = NICHES.has(e.niche) ? e.niche : 'other';
    conf = (e.niche_confidence != null) ? e.niche_confidence : 0;
    fname = e.first_name || '';
    status = 'new';
  }
  return { json: {
    handle: c.handle,
    profile_url: c.profile_url || '',
    email: c.email || '',
    first_name: fname,
    followers: c.followers || 0,
    following: c.following || 0,
    bio: (c.bio || '').slice(0, 500),
    niche: niche,
    niche_confidence: conf,
    region_signal: c.region_signal || '',
    last_3_captions: (c.last_3_captions || '').slice(0, 1000),
    link_in_bio: c.link_in_bio || '',
    role_based_email: c.role_based_email ? 'TRUE' : 'FALSE',
    scraped_at: now,
    status: status,
    _isNew: !ex,
    _region: c._region || '',
    _hasEmail: !!c.email,
  }};
});
return out;
`.trim();

// ─── Code: Build Reports ───────────────────────────────────────────────────────
const BUILD_REPORTS_CODE = `
const rows = $('Apply Enrich').all().map(i => i.json);
const existingRows = $('Read Sheet').all().map(i => i.json);
const agg = (a) => ({
  total: a.length,
  fresh: a.filter(r => r._isNew).length,
  updated: a.filter(r => !r._isNew).length,
  newWithEmail: a.filter(r => r._isNew && r._hasEmail).length,
});
const U = agg(rows.filter(r => r._region === 'US'));
const N = agg(rows.filter(r => r._region === 'NL'));
const existingNew = existingRows.filter(r => (r.status || '') === 'new').length;
const newThisWeek = rows.filter(r => r._isNew).length;
const awaiting = existingNew + newThisWeek;
const wk = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
const SHEET = 'https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit';

const detailed = [
  '*Crave Weekly Creator Scrape — ' + wk + '*',
  '',
  '*US:* +' + U.fresh + ' new (' + U.newWithEmail + ' w/ email) · ' + U.updated + ' refreshed',
  '*NL:* +' + N.fresh + ' new (' + N.newWithEmail + ' w/ email) · ' + N.updated + ' refreshed',
  '',
  ':eyes: ' + awaiting + ' creators awaiting review (status \`new\`).',
  'Flip \`status\` to \`approved\` to queue for outreach → <' + SHEET + '|open the sheet>',
].join('\\n');

const ops = '*Crave weekly scrape — ' + wk + ':* US +' + U.fresh + ' new, NL +' + N.fresh +
  ' new (' + (U.newWithEmail + N.newWithEmail) + ' w/ email). ' + awaiting +
  " awaiting Noa's review → <" + SHEET + '|sheet>';

return [{ json: { detailed, ops, wk } }];
`.trim();

// ─── Workflow definition ───────────────────────────────────────────────────────
const workflow = {
  name: 'Crave - Weekly Creator Scrape',
  settings: { executionOrder: 'v1', saveManualExecutions: true, timezone: 'Asia/Manila' },
  nodes: [
    {
      id: 'n1', name: 'Schedule Trigger', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
      position: [220, 300],
      parameters: { rule: { interval: [{ field: 'weeks', weeksInterval: 1, triggerAtDay: [1], triggerAtHour: 11, triggerAtMinute: 0 }] } },
    },
    {
      id: 'n2', name: 'Fetch US', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [440, 180], continueOnFail: true,
      credentials: { httpQueryAuth: { id: APIFY_CRED_ID, name: 'Apify Token (query)' } },
      parameters: { authentication: 'genericCredentialType', genericAuthType: 'httpQueryAuth', method: 'POST', url: apifyUrl('US'), sendBody: true, specifyBody: 'json', jsonBody: apifyBody('US'), options: { timeout: 300000 } },
    },
    {
      id: 'n3', name: 'Fetch NL', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [440, 420], continueOnFail: true,
      credentials: { httpQueryAuth: { id: APIFY_CRED_ID, name: 'Apify Token (query)' } },
      parameters: { authentication: 'genericCredentialType', genericAuthType: 'httpQueryAuth', method: 'POST', url: apifyUrl('NL'), sendBody: true, specifyBody: 'json', jsonBody: apifyBody('NL'), options: { timeout: 300000 } },
    },
    {
      id: 'n4', name: 'Normalize US', type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [660, 180], parameters: { mode: 'runOnceForAllItems', jsCode: normalizeCode('US') },
    },
    {
      id: 'n5', name: 'Normalize NL', type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [660, 420], parameters: { mode: 'runOnceForAllItems', jsCode: normalizeCode('NL') },
    },
    {
      id: 'n6', name: 'Merge', type: 'n8n-nodes-base.merge', typeVersion: 3,
      position: [880, 300], parameters: { mode: 'append' },
    },
    {
      id: 'n7', name: 'Dedupe', type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1100, 300], parameters: { mode: 'runOnceForAllItems', jsCode: DEDUPE_CODE },
    },
    {
      id: 'n8', name: 'Read Sheet', type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [1320, 300], continueOnFail: true,
      credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet', operation: 'read',
        documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
        sheetName: { __rl: true, value: SHEET_NAME, mode: 'name' },
        options: {},
      },
    },
    {
      id: 'n9', name: 'Prepare Enrich', type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1540, 300], parameters: { mode: 'runOnceForAllItems', jsCode: PREPARE_ENRICH_CODE },
    },
    {
      id: 'n10', name: 'Claude Enrich', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [1760, 300], continueOnFail: true,
      credentials: { httpHeaderAuth: { id: ANTHROPIC_CRED_ID, name: 'Anthropic API Key (header)' } },
      parameters: {
        authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
        method: 'POST', url: 'https://api.anthropic.com/v1/messages',
        sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'anthropic-version', value: '2023-06-01' },
          { name: 'content-type', value: 'application/json' },
        ] },
        sendBody: true, specifyBody: 'json',
        jsonBody: `={{ { model: "${ENRICH_MODEL}", max_tokens: 4000, system: $json.system, messages: [{ role: "user", content: $json.user }] } }}`,
        options: { timeout: 120000 },
      },
    },
    {
      id: 'n11', name: 'Apply Enrich', type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [1980, 300], parameters: { mode: 'runOnceForAllItems', jsCode: APPLY_ENRICH_CODE },
    },
    {
      id: 'n12', name: 'Upsert Sheet', type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5,
      position: [2200, 300], continueOnFail: true,
      credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet', operation: 'appendOrUpdate',
        documentId: { __rl: true, value: SHEET_ID, mode: 'id' },
        sheetName: { __rl: true, value: SHEET_NAME, mode: 'name' },
        columns: {
          mappingMode: 'defineBelow',
          matchingColumns: ['handle'],
          // Map ONLY cols A–N + status. notes/outreach_sent_at/replied_at/bounced/opened_at
          // are intentionally unmapped so appendOrUpdate leaves them untouched on existing rows.
          value: {
            handle: '={{ $json.handle }}',
            profile_url: '={{ $json.profile_url }}',
            email: '={{ $json.email }}',
            first_name: '={{ $json.first_name }}',
            followers: '={{ $json.followers }}',
            following: '={{ $json.following }}',
            bio: '={{ $json.bio }}',
            niche: '={{ $json.niche }}',
            niche_confidence: '={{ $json.niche_confidence }}',
            region_signal: '={{ $json.region_signal }}',
            last_3_captions: '={{ $json.last_3_captions }}',
            link_in_bio: '={{ $json.link_in_bio }}',
            role_based_email: '={{ $json.role_based_email }}',
            scraped_at: '={{ $json.scraped_at }}',
            status: '={{ $json.status }}',
          },
          schema: [],
        },
        options: {},
      },
    },
    {
      id: 'n13', name: 'Build Reports', type: 'n8n-nodes-base.code', typeVersion: 2,
      position: [2420, 300], parameters: { mode: 'runOnceForAllItems', jsCode: BUILD_REPORTS_CODE },
    },
    {
      id: 'n14', name: 'Post Outreach Report', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [2640, 180], continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        authentication: 'predefinedCredentialType', nodeCredentialType: 'slackApi',
        method: 'POST', url: 'https://slack.com/api/chat.postMessage',
        sendBody: true, specifyBody: 'json',
        jsonBody: `={{ { channel: "${OUTREACH_CHANNEL}", text: $json.detailed } }}`,
        options: {},
      },
    },
    {
      id: 'n15', name: 'Post Ops Summary', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2,
      position: [2860, 300], continueOnFail: true,
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      parameters: {
        authentication: 'predefinedCredentialType', nodeCredentialType: 'slackApi',
        method: 'POST', url: 'https://slack.com/api/chat.postMessage',
        sendBody: true, specifyBody: 'json',
        jsonBody: `={{ { channel: "${OPS_CHANNEL}", text: $('Build Reports').first().json.ops } }}`,
        options: {},
      },
    },
  ],
  connections: {
    'Schedule Trigger': { main: [[{ node: 'Fetch US', type: 'main', index: 0 }, { node: 'Fetch NL', type: 'main', index: 0 }]] },
    'Fetch US': { main: [[{ node: 'Normalize US', type: 'main', index: 0 }]] },
    'Fetch NL': { main: [[{ node: 'Normalize NL', type: 'main', index: 0 }]] },
    'Normalize US': { main: [[{ node: 'Merge', type: 'main', index: 0 }]] },
    'Normalize NL': { main: [[{ node: 'Merge', type: 'main', index: 1 }]] },
    'Merge': { main: [[{ node: 'Dedupe', type: 'main', index: 0 }]] },
    'Dedupe': { main: [[{ node: 'Read Sheet', type: 'main', index: 0 }]] },
    'Read Sheet': { main: [[{ node: 'Prepare Enrich', type: 'main', index: 0 }]] },
    'Prepare Enrich': { main: [[{ node: 'Claude Enrich', type: 'main', index: 0 }]] },
    'Claude Enrich': { main: [[{ node: 'Apply Enrich', type: 'main', index: 0 }]] },
    'Apply Enrich': { main: [[{ node: 'Upsert Sheet', type: 'main', index: 0 }]] },
    'Upsert Sheet': { main: [[{ node: 'Build Reports', type: 'main', index: 0 }]] },
    'Build Reports': { main: [[{ node: 'Post Outreach Report', type: 'main', index: 0 }]] },
    'Post Outreach Report': { main: [[{ node: 'Post Ops Summary', type: 'main', index: 0 }]] },
  },
};

// ─── Deploy ────────────────────────────────────────────────────────────────────
function n8nRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const u = new URL(N8N_URL + path);
    const opts = {
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: {
        'X-N8N-API-KEY': API_KEY, 'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({ raw: data }); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Existing workflow ID (set after first create so re-runs update in place).
const WORKFLOW_ID = process.env.CRAVE_SCRAPE_WF_ID || '';

async function deploy() {
  let id = WORKFLOW_ID;
  if (id) {
    console.log('Updating existing workflow', id, '...');
    const r = await n8nRequest('PUT', `/api/v1/workflows/${id}`, workflow);
    if (!r.id) { console.error('ERROR updating:', JSON.stringify(r).slice(0, 800)); return; }
  } else {
    console.log('Creating new workflow...');
    const r = await n8nRequest('POST', '/api/v1/workflows', workflow);
    if (!r.id) { console.error('ERROR creating:', JSON.stringify(r).slice(0, 800)); return; }
    id = r.id;
  }
  console.log('SUCCESS — workflow id:', id);
  console.log('URL: ' + N8N_URL + '/workflow/' + id);
  console.log('Left INACTIVE on purpose. Run a manual test execution in n8n, verify the');
  console.log('Sheet upsert + both Slack posts, then activate:');
  console.log('  curl -X POST -H "X-N8N-API-KEY: $N8N_API_KEY" ' + N8N_URL + '/api/v1/workflows/' + id + '/activate');
  console.log('Set CRAVE_SCRAPE_WF_ID=' + id + ' to update-in-place on the next deploy.');
}

if (require.main === module) deploy().catch((e) => console.error('Deploy failed:', e.message));

module.exports = { workflow, SHEET_ID, OUTREACH_CHANNEL, OPS_CHANNEL, REGIONS };
