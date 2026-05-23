const https = require('https');

const N8N_URL = 'https://noatakhel.app.n8n.cloud';
const API_KEY = process.env.N8N_API_KEY;

// Keys are injected from local .env at deploy time.
// n8n Starter does not support environment variables — values are baked into
// the workflow nodes when this script runs. Redeploy to rotate keys.
const APIFY_API_KEY = process.env.APIFY_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!APIFY_API_KEY) throw new Error('APIFY_API_KEY not set in local .env');
if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set in local .env');

// VERIFY before first deploy: confirm actor IDs at https://apify.com/store
const TIKTOK_ACTOR_ID = 'clockworks~tiktok-hashtag-scraper';
const INSTAGRAM_ACTOR_ID = 'apify~instagram-hashtag-scraper';

const SHEETS_CRED_ID = '83MQOm78gYDvziTO';
const SLACK_CRED_ID = 'Bn2U6Cwe1wdiCXzD';
const GMAIL_JOHN_CRED = 'vsDW3WpKXqS9HUs3';

// TESTING: using #airwallexdrafts (C0AQZGJDR38) — switch to C0A22NPLV38 (halo channel) once confirmed working
const SLACK_CHANNEL_ID = 'C0AQZGJDR38';
const GOOGLE_SHEET_ID = '1V_sjvMaCngWyB_5-ElMFdMetlsR2OdgD2QP42QQ5au4';
const GOOGLE_SHEET_NAME = 'Posts';
const REPORT_EMAILS = 'shin@kravemedia.co,noa@kravemedia.co,john@kravemedia.co,alleahvargas@gmail.com';

// Keeping to 8 high-signal hashtags per platform so the sync run completes
// within the 5-min window. Add more once we confirm run times are stable.
const HASHTAGS = [
  'sensitiveskin', 'eczema', 'hairloss', 'scalptok',
  'hardwater', 'showertok', 'cleanbeauty', 'skinbarrier',
];

// Static JSON bodies for Apify HTTP Request nodes — baked in at deploy time
const TIKTOK_APIFY_BODY = JSON.stringify({
  hashtags: HASHTAGS,
  resultsType: 'posts',
  maxPostsPerPage: 20,
  shouldDownloadVideos: false,
  shouldDownloadCovers: false,
  shouldDownloadMusicCovers: false,
});

const INSTAGRAM_APIFY_BODY = JSON.stringify({
  hashtags: HASHTAGS,
  resultsLimit: 20,
});

// ─── Code node: Score & Rank Posts ────────────────────────────────────────────
// Reads raw posts from the two upstream HTTP Request nodes (Fetch TikTok,
// Fetch Instagram). No HTTP calls here — pure scoring logic.
const SCORE_AND_RANK_CODE = `
const MIN_LIKES = 500;
const TOP_N = 10;
const MAX_PER_CREATOR = 2;

const ICP = {
  skinConditions: {
    label: 'Skin Conditions',
    keywords: [
      'eczema', 'rosacea', 'psoriasis', 'acne', 'sensitiveskin', 'sensitive skin',
      'skintok', 'skinbarrier', 'skin barrier', 'acneskin', 'skincondition',
      'dryskintok', 'dryskin',
    ],
  },
  hairScalp: {
    label: 'Hair & Scalp Conditions',
    keywords: [
      'hairloss', 'hair loss', 'dandruff', 'dryhair', 'dry hair', 'colortreated',
      'color treated', 'scalptok', 'hairgrowth', 'frizzy', 'thinning hair',
      'colortreatedhair', 'scalphealth', 'hairfall', 'thinninghair',
    ],
  },
  contextMindset: {
    label: 'Context & Mindset',
    keywords: [
      'hardwater', 'hard water', 'showertok', 'shower filter', 'cleanbeauty',
      'clean beauty', 'wellnesstok', 'nontoxic', 'non toxic', 'prevention',
      'chlorine', 'rituals', 'showerskincare', 'skinconsciousliving', 'nontoxicbeauty',
      'waterfiltration', 'mineralwater',
    ],
  },
};

const CONTENT_PILLARS = {
  problemSolution: {
    label: 'Problem/Solution',
    keywords: ['fix', 'solution', 'solved', 'finally', 'stopped', 'cleared', 'helped', 'changed'],
  },
  educational: {
    label: 'Educational',
    keywords: ['how to', 'why', 'what causes', 'science', 'explained', 'tips', 'guide', 'did you know'],
  },
  inspirational: {
    label: 'Inspirational',
    keywords: ['journey', 'transformation', 'progress', 'before after', 'glow up', 'confidence', 'months later'],
  },
  wellnessHack: {
    label: 'Wellness Hack',
    keywords: ['hack', 'routine', 'ritual', 'trick', 'secret', 'switch', 'game changer', 'swap'],
  },
};

const CATEGORY_HASHTAGS = {
  skin: ['eczema', 'rosacea', 'psoriasis', 'acneskin', 'sensitiveskin', 'skinbarrier', 'skintok', 'dryskin'],
  hair: ['hairloss', 'scalptok', 'dryhair', 'dandruff', 'colortreatedhair', 'hairgrowth', 'thinninghair'],
  shower: ['showertok', 'hardwater', 'showerskincare'],
  wellness: ['cleanbeauty', 'wellnesstok', 'skinconsciousliving', 'nontoxicbeauty', 'rituals'],
};

// Handle both n8n array-as-single-item and array-split-into-items behaviours
function extractPosts(nodeItems) {
  if (!nodeItems || nodeItems.length === 0) return [];
  if (nodeItems.length === 1) {
    const d = nodeItems[0].json;
    if (Array.isArray(d)) return d;
    if (d && Array.isArray(d.data)) return d.data;
    return d && typeof d === 'object' && Object.keys(d).length > 2 ? [d] : [];
  }
  return nodeItems.map(i => i.json).filter(Boolean);
}

function normalizePost(raw, platform) {
  const text = (raw.text || raw.caption || raw.edge_media_to_caption?.edges?.[0]?.node?.text || '').toLowerCase();
  const hashtags = (raw.hashtags || raw.hashtagNames || []).map(h =>
    (typeof h === 'string' ? h : (h.name || h.title || h.hashtagName || '')).toLowerCase().replace(/^#/, '')
  );
  const fullText = text + ' ' + hashtags.join(' ');

  return {
    platform,
    id: raw.id || raw.shortCode || String(Math.random()),
    url: raw.webVideoUrl || raw.url ||
      (platform === 'instagram' && raw.shortCode ? 'https://www.instagram.com/p/' + raw.shortCode + '/' : ''),
    creator: raw.authorMeta?.name || raw.ownerUsername || raw.username || raw.author?.uniqueId || '',
    creatorHandle: raw.authorMeta?.id || raw.ownerId || raw.authorId || raw.creator || '',
    createdAt: raw.createTime || raw.taken_at_timestamp || raw.timestamp || raw.createTimeISO || '',
    text: raw.text || raw.caption || '',
    hashtags,
    fullText,
    views: raw.playCount || raw.videoPlayCount || raw.video_view_count || raw.videoViewCount || raw.viewCount || 0,
    likes: raw.diggCount || raw.likesCount || raw.edge_media_preview_like?.count || raw.likes || 0,
    comments: raw.commentCount || raw.commentsCount || raw.edge_media_to_comment?.count || raw.commentsCount || raw.comments || 0,
    saves: raw.collectCount || raw.savedCount || raw.bookmarkCount || 0,
    shares: raw.shareCount || raw.shares || 0,
    isVideo: platform === 'tiktok' ? true :
      !!(raw.is_video || raw.mediaType === 'VIDEO' || raw.__typename === 'GraphVideo' ||
         raw.type === 'Video' || raw.type === 'Reel' || raw.productType === 'clips'),
  };
}

function categorize(post) {
  const cats = new Set();
  for (const [cat, tags] of Object.entries(CATEGORY_HASHTAGS)) {
    if (tags.some(t => post.hashtags.includes(t) || post.fullText.includes(t))) cats.add(cat);
  }
  if (cats.size === 0) cats.add('general');
  return [...cats];
}

function detectPillar(fullText) {
  for (const [, p] of Object.entries(CONTENT_PILLARS)) {
    if (p.keywords.some(kw => fullText.includes(kw))) return p.label;
  }
  return 'General';
}

function scorePost(post, maxViews) {
  const { views, likes, comments, saves, shares, fullText } = post;
  if (views === 0 && likes === 0) return null;
  const safeViews = views || 1;
  const engagementRate = (likes + comments) / safeViews;
  const savesSharesRate = (saves + shares) / safeViews;
  const viewsNorm = maxViews > 0 ? views / maxViews : 0;
  const matchedGroups = [];
  for (const [, group] of Object.entries(ICP)) {
    if (group.keywords.some(kw => fullText.includes(kw))) matchedGroups.push(group.label);
  }
  const relevanceMultiplier = 1.0 + (matchedGroups.length * 0.1);
  const rawScore = (engagementRate * 0.40) + (savesSharesRate * 0.35) + (viewsNorm * 0.25);
  return {
    ...post,
    engagementRate: Math.round(engagementRate * 10000) / 100,
    savesSharesRate: Math.round(savesSharesRate * 10000) / 100,
    matchedIcpGroups: matchedGroups,
    primaryIcp: matchedGroups[0] || 'General',
    relevanceMultiplier,
    contentPillar: detectPillar(fullText),
    categories: categorize(post),
    finalScore: rawScore * relevanceMultiplier,
    scoreDisplay: Math.round(rawScore * relevanceMultiplier * 10000),
  };
}

function filterAndRank(rawPosts, platform) {
  const normalized = rawPosts.map(p => normalizePost(p, platform));
  const filtered = normalized.filter(post => {
    if (post.likes < MIN_LIKES && post.comments < 50) return false;
    return true;
  });
  const maxViews = Math.max(...filtered.map(p => p.views), 1);
  const scored = filtered.map(p => scorePost(p, maxViews)).filter(Boolean);
  scored.sort((a, b) => b.finalScore - a.finalScore);
  const selected = [];
  const creatorCount = {};
  for (const post of scored) {
    if (selected.length >= 10) break;
    const key = post.creatorHandle || post.creator;
    const count = creatorCount[key] || 0;
    if (count >= 2) continue;
    creatorCount[key] = count + 1;
    selected.push(post);
  }
  return selected;
}

const tiktokPosts = extractPosts($('Fetch TikTok').all());
const instagramPosts = extractPosts($input.all());

const tiktokTop10 = filterAndRank(tiktokPosts, 'tiktok');
const instagramTop10 = filterAndRank(instagramPosts, 'instagram');

const weekLabel = new Date().toLocaleDateString('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila',
});

return [{
  json: {
    weekLabel,
    fetchedAt: new Date().toISOString(),
    tiktokTop10,
    instagramTop10,
    tiktokRaw: tiktokPosts.length,
    instagramRaw: instagramPosts.length,
    tiktokFiltered: tiktokTop10.length,
    instagramFiltered: instagramTop10.length,
    allPosts: [...tiktokTop10, ...instagramTop10],
  }
}];
`.trim();

// ─── Code node: Prepare Claude Request ────────────────────────────────────────
// Builds system prompt and user prompt from scored posts.
// Output feeds directly into the Claude Analysis HTTP Request node.
const PREPARE_CLAUDE_REQUEST_CODE = `
const { tiktokTop10, instagramTop10, weekLabel } = $json;

function summarize(post, index) {
  const caption = (post.text || '').slice(0, 280) + ((post.text || '').length > 280 ? '...' : '');
  const tags = (post.hashtags || []).slice(0, 8).join(', ');
  return [
    'Post ' + (index + 1) + ' (@' + post.creator + '):',
    'URL: ' + post.url,
    'Views: ' + (post.views || 0).toLocaleString() +
      ' | Likes: ' + (post.likes || 0).toLocaleString() +
      ' | Saves: ' + (post.saves || 0).toLocaleString() +
      ' | Shares: ' + (post.shares || 0).toLocaleString(),
    'Engagement: ' + post.engagementRate + '% | Score: ' + post.scoreDisplay,
    'ICP: ' + post.primaryIcp + ' | Pillar: ' + post.contentPillar,
    'Caption: ' + caption,
    'Hashtags: ' + tags,
  ].join('\\n');
}

const tiktokSection = (tiktokTop10 || []).map(summarize).join('\\n\\n');
const instagramSection = (instagramTop10 || []).map(summarize).join('\\n\\n');
const tiktokCount = (tiktokTop10 || []).length;
const instagramCount = (instagramTop10 || []).length;

const systemPrompt = 'You are a content intelligence analyst for Halo Home — a DTC shower filter brand entering the US market. Halo shower filters remove chlorine, heavy metals, and hard water minerals to protect skin and hair health.\\n\\nHalo ICP groups:\\n1. Skin Conditions (Eczema, Rosacea, Psoriasis, Acne-Prone, Sensitive Skin) — driver: pain, exhaustion, tried everything\\n2. Hair & Scalp Conditions (Hair Loss, Dandruff, Dry/Frizzy Hair, Color-Treated Hair) — driver: frustration, embarrassment, wasted money\\n3. Context & Mindset (Hard Water Refugee, Wellness-Burned, Prevention-Focused) — driver: attribution, skepticism, proactive protection\\n\\nContent pillars: Problem/Solution | Educational | Inspirational | Wellness Hack\\n\\nAnalyze the provided social content. For each post return a JSON object: { "hook": "opening line or first-2-seconds description", "whyItPerformed": "specific analysis — format, pacing, emotional angle", "icpMatch": "which ICP group and why", "contentPillar": "one of the four pillars", "haloAngle": "one sentence — how Halo owns a version of this" }\\n\\nFor trend synthesis: exactly 2 paragraphs. Paragraph 1: cross-platform patterns in format, emotion, and angle. Paragraph 2: what this means for Halo content strategy.';

const userPrompt = 'Week of ' + weekLabel + '\\n\\n=== TOP TIKTOK CONTENT ===\\n' + (tiktokSection || '(no posts)') + '\\n\\n=== TOP INSTAGRAM REELS ===\\n' + (instagramSection || '(no posts)') + '\\n\\nRespond with this JSON (no markdown, raw JSON only):\\n{\\n  "trendSynthesis": "paragraph 1\\\\n\\\\nparagraph 2",\\n  "tiktok": [array of ' + tiktokCount + ' analysis objects in order],\\n  "instagram": [array of ' + instagramCount + ' analysis objects in order]\\n}';

return [{
  json: {
    systemPrompt,
    userPrompt,
    weekLabel,
    tiktokTop10: tiktokTop10 || [],
    instagramTop10: instagramTop10 || [],
    allPosts: [...(tiktokTop10 || []), ...(instagramTop10 || [])],
  }
}];
`.trim();

// ─── Code node: Format Report ──────────────────────────────────────────────────
// Reads Claude API response from $json (HTTP Request output) and post data
// from the Prepare Claude Request node. Builds all output formats.
const FORMAT_REPORT_CODE = `
const claudeResp = $json;
const scoreData = $('Prepare Claude Request').first().json;
const { tiktokTop10, instagramTop10, weekLabel, allPosts } = scoreData;

let analysis = { trendSynthesis: '', tiktok: [], instagram: [] };
try {
  const raw = claudeResp.content?.[0]?.text || '';
  const match = raw.match(/\\{[\\s\\S]*\\}/);
  if (match) analysis = JSON.parse(match[0]);
} catch (e) {
  console.error('Claude parse error:', e.message);
}

const enrich = (posts, analysisArr) =>
  (posts || []).map((post, i) => ({ ...post, analysis: (analysisArr || [])[i] || {} }));

const tiktokEnriched = enrich(tiktokTop10, analysis.tiktok);
const instagramEnriched = enrich(instagramTop10, analysis.instagram);

function slackLine(post, rank) {
  const a = post.analysis || {};
  return [
    '*' + rank + '. @' + post.creator + '* | Score: ' + post.scoreDisplay +
      ' | ' + post.primaryIcp + ' | ' + post.contentPillar,
    '   Halo angle: ' + (a.haloAngle || '—'),
    '   ' + (post.url || ''),
  ].join('\\n');
}

const slackText = [
  '*Halo Weekly Intelligence — Week of ' + weekLabel + '*',
  '',
  '*TREND SYNTHESIS*',
  analysis.trendSynthesis || '—',
  '',
  '*TOP TIKTOK CONTENT* _(full analysis in email)_',
  tiktokEnriched.length ? tiktokEnriched.map((p, i) => slackLine(p, i + 1)).join('\\n\\n') : '_(no qualifying TikTok posts this week)_',
  '',
  '*TOP INSTAGRAM REELS*',
  instagramEnriched.length ? instagramEnriched.map((p, i) => slackLine(p, i + 1)).join('\\n\\n') : '_(no qualifying Instagram reels this week)_',
].join('\\n');

function emailPostHtml(post, rank) {
  const a = post.analysis || {};
  return '<div style="margin-bottom:20px;padding:16px;border:1px solid #e5e7eb;border-radius:8px;">' +
    '<h3 style="margin:0 0 6px;font-size:15px;">' + rank + '. @' + post.creator + '</h3>' +
    '<p style="margin:0 0 8px;color:#6b7280;font-size:12px;">Score: ' + post.scoreDisplay +
      ' &nbsp;|&nbsp; ICP: ' + post.primaryIcp +
      ' &nbsp;|&nbsp; ' + post.contentPillar +
      ' &nbsp;|&nbsp; Views: ' + (post.views || 0).toLocaleString() +
      ' &nbsp;|&nbsp; Likes: ' + (post.likes || 0).toLocaleString() + '</p>' +
    '<p style="margin:4px 0;"><strong>Hook:</strong> ' + (a.hook || '—') + '</p>' +
    '<p style="margin:4px 0;"><strong>Why it performed:</strong> ' + (a.whyItPerformed || '—') + '</p>' +
    '<p style="margin:4px 0;"><strong>ICP match:</strong> ' + (a.icpMatch || '—') + '</p>' +
    '<p style="margin:4px 0;"><strong>Halo angle:</strong> ' + (a.haloAngle || '—') + '</p>' +
    '<p style="margin:8px 0 0;"><a href="' + (post.url || '#') + '" style="color:#2563eb;">View post →</a></p>' +
    '</div>';
}

const trendHtml = (analysis.trendSynthesis || '').split('\\n\\n')
  .map(p => '<p style="line-height:1.7;margin:0 0 12px;">' + p + '</p>').join('');

const emailHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
  '<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:680px;margin:0 auto;padding:24px;color:#111;">' +
  '<h1 style="font-size:20px;margin-bottom:2px;">Halo Weekly Intelligence</h1>' +
  '<p style="color:#6b7280;margin-top:0;font-size:13px;">Week of ' + weekLabel + '</p>' +
  '<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;">' +
  '<h2 style="font-size:15px;margin-bottom:10px;">Trend Synthesis</h2>' +
  trendHtml +
  '<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">' +
  '<h2 style="font-size:15px;margin-bottom:12px;">Top TikTok Content</h2>' +
  (tiktokEnriched.length ? tiktokEnriched.map((p, i) => emailPostHtml(p, i + 1)).join('') : '<p style="color:#6b7280;">No qualifying TikTok posts this week.</p>') +
  '<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">' +
  '<h2 style="font-size:15px;margin-bottom:12px;">Top Instagram Reels</h2>' +
  (instagramEnriched.length ? instagramEnriched.map((p, i) => emailPostHtml(p, i + 1)).join('') : '<p style="color:#6b7280;">No qualifying Instagram reels this week.</p>') +
  '<hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">' +
  '<p style="color:#9ca3af;font-size:11px;">Halo Home Intelligence · Weekly automated delivery</p>' +
  '</body></html>';

const allEnriched = [...tiktokEnriched, ...instagramEnriched];
const sheetRows = allEnriched.map(post => {
  const a = post.analysis || {};
  return {
    'Week': weekLabel,
    'Platform': post.platform === 'tiktok' ? 'TikTok' : 'Instagram',
    'Creator': post.creator || '',
    'URL': post.url || '',
    'Likes': post.likes || 0,
    'Views': post.views || 0,
    'Saves': post.saves || 0,
    'Shares': post.shares || 0,
    'Engagement Rate (%)': post.engagementRate || 0,
    'ICP Group': post.primaryIcp || '',
    'Content Pillar': post.contentPillar || '',
    'Score': post.scoreDisplay || 0,
    'Hook': a.hook || '',
    'Why It Performed': a.whyItPerformed || '',
    'ICP Match Detail': a.icpMatch || '',
    'Halo Angle': a.haloAngle || '',
  };
});

return [{
  json: {
    weekLabel,
    slackText,
    emailHtml,
    emailSubject: 'Halo Weekly Intelligence — Week of ' + weekLabel,
    sheetRows,
    postCount: allEnriched.length,
  }
}];
`.trim();

// ─── Code node: Prepare Sheet Rows ────────────────────────────────────────────
const PREPARE_SHEET_ROWS_CODE = `
const rows = $json.sheetRows || [];
if (rows.length === 0) return [{ json: { _skip: true } }];
return rows.map(row => ({ json: row }));
`.trim();

// ─── Workflow definition ───────────────────────────────────────────────────────
// Architecture: all external HTTP calls use n8n HTTP Request nodes (not Code nodes).
// Code nodes handle pure JS: scoring, prompt building, response parsing, formatting.
//
// Flow:
//   Schedule → Fetch TikTok (HTTP) → Fetch Instagram (HTTP)
//            → Score & Rank (Code)
//            → Prepare Claude Request (Code)
//            → Claude Analysis (HTTP)
//            → Format Report (Code)
//            → Post to Slack (HTTP) → Send Email (Gmail) → Sheet rows
const workflow = {
  name: 'Halo - Weekly Intelligence Report',
  settings: {
    executionOrder: 'v1',
    saveManualExecutions: true,
    timezone: 'Asia/Manila',
  },
  nodes: [
    // ── 1. Schedule ──────────────────────────────────────────────────────────
    {
      id: 'n1',
      name: 'Schedule Trigger',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [240, 300],
      parameters: {
        rule: {
          interval: [{ field: 'weeks', weeksInterval: 1, triggerAtDay: [1], triggerAtHour: 7, triggerAtMinute: 0 }],
        },
      },
    },

    // ── 2. Fetch TikTok via Apify HTTP Request ────────────────────────────────
    {
      id: 'n2',
      name: 'Fetch TikTok',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [480, 300],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: `https://api.apify.com/v2/acts/${TIKTOK_ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_API_KEY}&timeout=300&memory=1024&limit=50`,
        sendBody: true,
        specifyBody: 'json',
        jsonBody: TIKTOK_APIFY_BODY,
        options: { timeout: 300000 },
      },
    },

    // ── 3. Fetch Instagram via Apify HTTP Request ─────────────────────────────
    {
      id: 'n3',
      name: 'Fetch Instagram',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [720, 300],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: `https://api.apify.com/v2/acts/${INSTAGRAM_ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_API_KEY}&timeout=300&memory=512&limit=50`,
        sendBody: true,
        specifyBody: 'json',
        jsonBody: INSTAGRAM_APIFY_BODY,
        options: { timeout: 300000 },
      },
    },

    // ── 4. Score & Rank Posts ─────────────────────────────────────────────────
    {
      id: 'n4',
      name: 'Score and Rank Posts',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [960, 300],
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: SCORE_AND_RANK_CODE,
      },
    },

    // ── 5. Prepare Claude Request ─────────────────────────────────────────────
    {
      id: 'n5',
      name: 'Prepare Claude Request',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1200, 300],
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: PREPARE_CLAUDE_REQUEST_CODE,
      },
    },

    // ── 6. Claude Analysis via Anthropic HTTP Request ─────────────────────────
    {
      id: 'n6',
      name: 'Claude Analysis',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1440, 300],
      continueOnFail: true,
      parameters: {
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'x-api-key', value: ANTHROPIC_API_KEY },
            { name: 'anthropic-version', value: '2023-06-01' },
            { name: 'content-type', value: 'application/json' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ { model: "claude-sonnet-4-6", max_tokens: 8000, system: $json.systemPrompt, messages: [{ role: "user", content: $json.userPrompt }] } }}`,
        options: {},
      },
    },

    // ── 7. Format Report ──────────────────────────────────────────────────────
    {
      id: 'n7',
      name: 'Format Report',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1680, 300],
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: FORMAT_REPORT_CODE,
      },
    },

    // ── 8. Post to Slack ──────────────────────────────────────────────────────
    {
      id: 'n8',
      name: 'Post to Slack',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1920, 300],
      credentials: { slackApi: { id: SLACK_CRED_ID, name: 'Krave Slack Bot' } },
      continueOnFail: true,
      parameters: {
        authentication: 'predefinedCredentialType',
        nodeCredentialType: 'slackApi',
        method: 'POST',
        url: 'https://slack.com/api/chat.postMessage',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ { channel: "${SLACK_CHANNEL_ID}", text: $json.slackText } }}`,
        options: {},
      },
    },

    // ── 9. Send Email ─────────────────────────────────────────────────────────
    {
      id: 'n9',
      name: 'Send Email',
      type: 'n8n-nodes-base.gmail',
      typeVersion: 2.1,
      position: [2160, 300],
      continueOnFail: true,
      credentials: { gmailOAuth2: { id: GMAIL_JOHN_CRED, name: 'Gmail account' } },
      parameters: {
        operation: 'send',
        sendTo: REPORT_EMAILS,
        subject: `={{ $('Format Report').first().json.emailSubject }}`,
        message: `={{ $('Format Report').first().json.emailHtml }}`,
        options: { appendAttribution: false },
      },
    },

    // ── 10. Prepare Sheet Rows ────────────────────────────────────────────────
    {
      id: 'n10',
      name: 'Prepare Sheet Rows',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [2400, 300],
      parameters: {
        mode: 'runOnceForAllItems',
        jsCode: PREPARE_SHEET_ROWS_CODE,
      },
    },

    // ── 11. Append Sheet Row ──────────────────────────────────────────────────
    {
      id: 'n11',
      name: 'Append Sheet Row',
      type: 'n8n-nodes-base.googleSheets',
      typeVersion: 4.5,
      position: [2640, 300],
      continueOnFail: true,
      credentials: { googleSheetsOAuth2Api: { id: SHEETS_CRED_ID, name: 'Google Sheets account' } },
      parameters: {
        resource: 'sheet',
        operation: 'append',
        documentId: { __rl: true, value: GOOGLE_SHEET_ID, mode: 'id' },
        sheetName: { __rl: true, value: GOOGLE_SHEET_NAME, mode: 'name' },
        columns: {
          mappingMode: 'defineBelow',
          value: {
            'Week': '={{ $json.Week }}',
            'Platform': '={{ $json.Platform }}',
            'Creator': '={{ $json.Creator }}',
            'URL': '={{ $json.URL }}',
            'Likes': '={{ $json.Likes }}',
            'Views': '={{ $json.Views }}',
            'Saves': '={{ $json.Saves }}',
            'Shares': '={{ $json.Shares }}',
            'Engagement Rate (%)': '={{ $json["Engagement Rate (%)"] }}',
            'ICP Group': '={{ $json["ICP Group"] }}',
            'Content Pillar': '={{ $json["Content Pillar"] }}',
            'Score': '={{ $json.Score }}',
            'Hook': '={{ $json.Hook }}',
            'Why It Performed': '={{ $json["Why It Performed"] }}',
            'ICP Match Detail': '={{ $json["ICP Match Detail"] }}',
            'Halo Angle': '={{ $json["Halo Angle"] }}',
          },
          schema: [],
        },
        options: {},
      },
    },
  ],

  connections: {
    'Schedule Trigger':      { main: [[{ node: 'Fetch TikTok',            type: 'main', index: 0 }]] },
    'Fetch TikTok':          { main: [[{ node: 'Fetch Instagram',          type: 'main', index: 0 }]] },
    'Fetch Instagram':       { main: [[{ node: 'Score and Rank Posts',     type: 'main', index: 0 }]] },
    'Score and Rank Posts':  { main: [[{ node: 'Prepare Claude Request',   type: 'main', index: 0 }]] },
    'Prepare Claude Request':{ main: [[{ node: 'Claude Analysis',          type: 'main', index: 0 }]] },
    'Claude Analysis':       { main: [[{ node: 'Format Report',            type: 'main', index: 0 }]] },
    'Format Report':         { main: [[{ node: 'Post to Slack',            type: 'main', index: 0 }]] },
    'Post to Slack':         { main: [[{ node: 'Send Email',               type: 'main', index: 0 }]] },
    'Send Email':            { main: [[{ node: 'Prepare Sheet Rows',       type: 'main', index: 0 }]] },
    'Prepare Sheet Rows':    { main: [[{ node: 'Append Sheet Row',         type: 'main', index: 0 }]] },
  },
};

// ─── Deploy ────────────────────────────────────────────────────────────────────
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

const WORKFLOW_ID = '5ZqTSaUEtxnAndiY';

async function deploy() {
  console.log('Deploying Halo Weekly Intelligence Report...');
  const result = await n8nRequest('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, workflow);
  if (!result.id) {
    console.error('ERROR updating workflow:', JSON.stringify(result, null, 2).substring(0, 1000));
    return;
  }

  await n8nRequest('POST', `/api/v1/workflows/${WORKFLOW_ID}/activate`);

  console.log('SUCCESS');
  console.log('Workflow ID:', result.id);
  console.log('URL: https://noatakhel.app.n8n.cloud/workflow/' + result.id);
  console.log('');
  console.log('Architecture: HTTP Request nodes for Apify + Anthropic (no Code node HTTP calls).');
  console.log('Run a manual test execution in n8n to verify.');
  console.log('');
  console.log('Note: API keys are baked into the workflow at deploy time (n8n Starter has no env vars).');
  console.log('To rotate keys: update .env and redeploy.');
}

if (require.main === module) {
  deploy().catch((e) => console.error('Deploy failed:', e.message));
}

module.exports = {
  TIKTOK_ACTOR_ID,
  INSTAGRAM_ACTOR_ID,
  GOOGLE_SHEET_ID,
  SLACK_CHANNEL_ID,
  REPORT_EMAILS,
  workflow,
};
