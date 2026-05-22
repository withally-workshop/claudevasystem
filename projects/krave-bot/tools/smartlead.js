'use strict';

const https = require('https');

const SL_BASE = 'server.smartlead.ai';
const DEFAULT_CAMPAIGN_ID = 3375376;
const CRAVE_SHEET_ID = '1eLQrDP3IX9ec9dtFN0UyRdlTplzkLfRG9Asyqj1gLrI';

function slRequest(method, path, payload) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.SMARTLEAD_API_KEY;
    const sep = path.includes('?') ? '&' : '?';
    const fullPath = `/api/v1${path}${sep}api_key=${apiKey}`;
    const buf = payload ? Buffer.from(JSON.stringify(payload)) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (buf) headers['Content-Length'] = buf.length;
    const req = https.request({ hostname: SL_BASE, path: fullPath, method, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 400, status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ ok: false, status: res.statusCode, body }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    if (buf) req.write(buf);
    req.end();
  });
}

async function sl(method, path, payload) {
  const res = await slRequest(method, path, payload);
  if (!res.ok) throw new Error(`Smartlead ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function getCampaignStats({ campaign_id = DEFAULT_CAMPAIGN_ID }) {
  const data = await sl('GET', `/campaigns/${campaign_id}/analytics`);
  const sent = data.sent_count || 0;
  const opened = data.open_count || data.unique_open_count || 0;
  const replied = data.reply_count || 0;
  const bounced = data.bounce_count || 0;
  return {
    campaign_id,
    sent,
    opened,
    replied,
    bounced,
    open_rate: sent ? `${(opened / sent * 100).toFixed(1)}%` : '0%',
    reply_rate: sent ? `${(replied / sent * 100).toFixed(1)}%` : '0%',
    bounce_rate: sent ? `${(bounced / sent * 100).toFixed(1)}%` : '0%',
    health: sent && (opened / sent) < 0.2 ? 'WARNING: open rate below 20% — may be going to spam' : 'OK',
  };
}

async function listCampaigns() {
  const data = await sl('GET', '/campaigns?limit=20&offset=0');
  const items = Array.isArray(data) ? data : (data.data || data.campaigns || []);
  return { campaigns: items.map((c) => ({ id: c.id, name: c.name, status: c.status })) };
}

async function pushLeads({ campaign_id = DEFAULT_CAMPAIGN_ID, leads }) {
  const payload = {
    lead_list: leads,
    settings: {
      ignore_global_block_list: false,
      ignore_unsubscribe_list: true,
      ignore_community_bounce_list: false,
    },
  };
  const res = await sl('POST', `/campaigns/${campaign_id}/leads`, payload);
  return { pushed: leads.length, campaign_id, result: res };
}

async function syncStatus({ campaign_id = DEFAULT_CAMPAIGN_ID }) {
  const data = await sl('GET', `/campaigns/${campaign_id}/leads?limit=500&offset=0`);
  const leads = Array.isArray(data) ? data : (data.data || data.leads || []);
  const summary = { replied: 0, bounced: 0, opened: 0, total: leads.length };
  leads.forEach((l) => {
    const s = l.lead_status || '';
    if (s === 'REPLIED') summary.replied++;
    else if (s === 'BOUNCED' || s === 'HARD_BOUNCED') summary.bounced++;
    else if (s === 'OPENED' || s === 'CLICKED') summary.opened++;
  });
  return { campaign_id, ...summary, note: 'Use sheets tools to update the creator sheet manually if needed.' };
}

module.exports = {
  definitions: [
    {
      name: 'smartlead_campaign_stats',
      description: 'Get open rate, reply rate, bounce rate for the Crave creator outreach Smartlead campaign.',
      input_schema: {
        type: 'object',
        properties: { campaign_id: { type: 'number', description: `Default: ${DEFAULT_CAMPAIGN_ID}` } },
      },
    },
    {
      name: 'smartlead_list_campaigns',
      description: 'List all Smartlead campaigns.',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'smartlead_push_leads',
      description: 'Push a list of leads to a Smartlead campaign. Each lead needs email and first_name.',
      input_schema: {
        type: 'object',
        properties: {
          campaign_id: { type: 'number', description: `Default: ${DEFAULT_CAMPAIGN_ID}` },
          leads: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                email: { type: 'string' },
                first_name: { type: 'string' },
                last_name: { type: 'string' },
              },
              required: ['email', 'first_name'],
            },
          },
        },
        required: ['leads'],
      },
    },
    {
      name: 'smartlead_sync_status',
      description: 'Check how many leads have replied, bounced, or opened in the Smartlead campaign.',
      input_schema: {
        type: 'object',
        properties: { campaign_id: { type: 'number', description: `Default: ${DEFAULT_CAMPAIGN_ID}` } },
      },
    },
  ],
  handlers: {
    smartlead_campaign_stats: getCampaignStats,
    smartlead_list_campaigns: listCampaigns,
    smartlead_push_leads: pushLeads,
    smartlead_sync_status: syncStatus,
  },
};
