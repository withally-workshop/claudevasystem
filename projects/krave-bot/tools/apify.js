'use strict';

const https = require('https');

const APIFY_BASE = 'api.apify.com';
const ACTOR_ID = 'clockworks~tiktok-scraper';
const CAMPAIGN_ID = 3375376;

function apifyRequest(method, path, payload) {
  return new Promise((resolve, reject) => {
    const token = process.env.APIFY_TOKEN;
    const sep = path.includes('?') ? '&' : '?';
    const fullPath = `${path}${sep}token=${token}`;
    const buf = payload ? Buffer.from(JSON.stringify(payload)) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (buf) headers['Content-Length'] = buf.length;
    const req = https.request({ hostname: APIFY_BASE, path: fullPath, method, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 400, status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ ok: false, status: res.statusCode, body }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    if (buf) req.write(buf);
    req.end();
  });
}

async function triggerScrape({ search_term = 'UGC creator', region = 'US', max_results = 200 }) {
  const proxyCountry = region.toUpperCase() === 'NL' ? 'NL' : 'US';
  const input = {
    searchQueries: [search_term],
    maxProfilesPerQuery: max_results,
    resultsPerPage: max_results,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
    shouldDownloadAvatars: false,
    proxyCountryCode: proxyCountry,
    videoSearchSorting: 'MOST_RELEVANT',
  };
  const res = await apifyRequest('POST', `/v2/acts/${ACTOR_ID}/runs`, input);
  if (!res.ok) throw new Error(`Apify start failed: ${JSON.stringify(res.body)}`);
  const runId = res.body.data && res.body.data.id;
  return {
    run_id: runId,
    status: 'RUNNING',
    message: `Scrape started — run ID: ${runId}. Check status with apify_scrape_status.`,
    actor: 'clockworks/tiktok-scraper',
    search_term,
    region,
    max_results,
  };
}

async function scrapeStatus({ run_id }) {
  const res = await apifyRequest('GET', `/v2/actor-runs/${run_id}`, null);
  if (!res.ok) throw new Error(`Apify status failed: ${JSON.stringify(res.body)}`);
  const run = res.body.data || {};
  return {
    run_id,
    status: run.status,
    dataset_id: run.defaultDatasetId,
    finished_at: run.finishedAt,
    message: run.status === 'SUCCEEDED'
      ? `Scrape complete. Dataset ID: ${run.defaultDatasetId}. Use apify_scrape_results to fetch profiles.`
      : `Status: ${run.status}`,
  };
}

async function scrapeResults({ dataset_id, limit = 100 }) {
  const res = await apifyRequest('GET', `/v2/datasets/${dataset_id}/items?limit=${limit}&offset=0`, null);
  if (!res.ok) throw new Error(`Apify dataset failed: ${JSON.stringify(res.body)}`);
  const items = Array.isArray(res.body) ? res.body : (res.body.items || []);
  const profiles = items.map((raw) => {
    const author = raw.authorMeta || {};
    const isVideo = Object.keys(author).length > 0;
    const handle = isVideo ? (author.name || author.uniqueId || '') : (raw.uniqueId || raw.username || '');
    const followers = isVideo ? (author.fans || author.followerCount || 0) : (raw.fans || raw.followerCount || 0);
    const bio = isVideo ? (author.signature || '') : (raw.signature || raw.bio || '');
    const emailMatch = bio.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
    return { handle, followers, bio: bio.slice(0, 200), email: emailMatch ? emailMatch[0] : null };
  }).filter((p) => p.handle);
  return { total: profiles.length, profiles: profiles.slice(0, 20), dataset_id, note: profiles.length > 20 ? `Showing 20 of ${profiles.length}` : undefined };
}

module.exports = {
  definitions: [
    {
      name: 'apify_trigger_scrape',
      description: 'Trigger a TikTok UGC creator scrape via Apify. Returns a run_id — check status with apify_scrape_status.',
      input_schema: {
        type: 'object',
        properties: {
          search_term: { type: 'string', description: 'Search term e.g. "UGC creator" (default)' },
          region: { type: 'string', description: 'US or NL (default: US)' },
          max_results: { type: 'number', description: 'Max profiles to scrape (default: 200)' },
        },
      },
    },
    {
      name: 'apify_scrape_status',
      description: 'Check the status of an Apify scrape run.',
      input_schema: { type: 'object', properties: { run_id: { type: 'string' } }, required: ['run_id'] },
    },
    {
      name: 'apify_scrape_results',
      description: 'Fetch results from a completed Apify scrape dataset.',
      input_schema: {
        type: 'object',
        properties: {
          dataset_id: { type: 'string' },
          limit: { type: 'number', description: 'Max profiles to return (default 100)' },
        },
        required: ['dataset_id'],
      },
    },
  ],
  handlers: {
    apify_trigger_scrape: triggerScrape,
    apify_scrape_status: scrapeStatus,
    apify_scrape_results: scrapeResults,
  },
};
