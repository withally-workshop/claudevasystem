'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Auto-load .env from repo root (two levels up from projects/ops-dashboard/)
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^([^#=\s][^=]*)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
}

const PORT = process.env.PORT || 3000;
const N8N_BASE = 'https://noatakhel.app.n8n.cloud';
const SHEET_ID = '1u5InkNpdLhgfFnE-a1bRRlEOFZ2oJf6EOG1y42_Th50';
const PAYMENTS_CHANNEL = 'C09HN2EBPR7';
const DRAFTS_CHANNEL = 'C0AQZGJDR38';
const CACHE_TTL_MS = 5 * 60 * 1000;

const ALLOWLIST = new Set([
  'noa@kravemedia.co',
  'john@kravemedia.co',
  'amanda@kravemedia.co',
  'jeneena@kravemedia.co',
  'sybil@kravemedia.co',
  'shin@kravemedia.co',
]);

let cache = { data: null, ts: 0 };

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 400, status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ ok: false, status: res.statusCode, body }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('timeout')); });
  });
}

function post(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const buf = Buffer.from(data);
    const options = {
      hostname: parsed.hostname, path: parsed.pathname, method: 'POST',
      headers: { 'Content-Length': buf.length, ...headers },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve({ ok: res.statusCode < 400, status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ ok: false, status: res.statusCode, body }); }
      });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Data sources
// ---------------------------------------------------------------------------

async function fetchN8n() {
  const key = process.env.N8N_API_KEY;
  if (!key) return { ok: false, reason: 'N8N_API_KEY not set', executions: [], workflows: [] };
  try {
    const [exRes, wfRes] = await Promise.all([
      get(`${N8N_BASE}/api/v1/executions?limit=200`, { 'X-N8N-API-KEY': key }),
      get(`${N8N_BASE}/api/v1/workflows?limit=100`, { 'X-N8N-API-KEY': key }),
    ]);
    return {
      ok: exRes.ok && wfRes.ok,
      executions: exRes.ok ? (exRes.body.data || []) : [],
      workflows: wfRes.ok ? (wfRes.body.data || []) : [],
      reason: (!exRes.ok || !wfRes.ok) ? `n8n API returned ${exRes.status}/${wfRes.status}` : null,
    };
  } catch (e) {
    return { ok: false, reason: e.message, executions: [], workflows: [] };
  }
}

// Build a signed JWT and exchange it for a Google OAuth2 access token
// using the same service account JSON file the MCP servers use.
let _sheetsTokenCache = { token: null, exp: 0 };

async function getServiceAccountToken() {
  if (_sheetsTokenCache.token && Date.now() < _sheetsTokenCache.exp - 60000) {
    return _sheetsTokenCache.token;
  }

  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  if (!keyFile) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY_FILE not set');

  const sa = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sigInput = `${header}.${body}`;
  const sig = crypto.createSign('RSA-SHA256').update(sigInput).sign(sa.private_key, 'base64url');
  const jwt = `${sigInput}.${sig}`;

  const tokenRes = await post('https://oauth2.googleapis.com/token',
    `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    { 'Content-Type': 'application/x-www-form-urlencoded' });

  if (!tokenRes.ok) throw new Error(`Token exchange failed: ${JSON.stringify(tokenRes.body)}`);
  _sheetsTokenCache = { token: tokenRes.body.access_token, exp: now + tokenRes.body.expires_in };
  return _sheetsTokenCache.token;
}

async function fetchSheets() {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  if (!keyFile) return { ok: false, reason: 'GOOGLE_SERVICE_ACCOUNT_KEY_FILE not set', rows: [] };
  try {
    const token = await getServiceAccountToken();
    const range = encodeURIComponent('Invoices!A:Z');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`;
    const res = await get(url, { Authorization: `Bearer ${token}` });
    if (!res.ok) return { ok: false, reason: `Sheets API ${res.status}: ${JSON.stringify(res.body)}`, rows: [] };
    const [headers, ...rows] = res.body.values || [];
    const mapped = rows.map((r) => {
      const obj = {};
      (headers || []).forEach((h, i) => { obj[h] = r[i] || ''; });
      return obj;
    });
    return { ok: true, rows: mapped };
  } catch (e) {
    return { ok: false, reason: e.message, rows: [] };
  }
}

async function fetchSlack(channel) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { ok: false, reason: 'SLACK_BOT_TOKEN not set', messages: [] };
  try {
    const url = `https://slack.com/api/conversations.history?channel=${channel}&limit=100`;
    const res = await get(url, { Authorization: `Bearer ${token}` });
    if (!res.ok || !res.body.ok) return { ok: false, reason: res.body.error || 'Slack error', messages: [] };
    return { ok: true, messages: res.body.messages || [] };
  } catch (e) {
    return { ok: false, reason: e.message, messages: [] };
  }
}

// ---------------------------------------------------------------------------
// Data computation
// ---------------------------------------------------------------------------

function computeTrackerStats(rows) {
  const stats = {
    draftPendingJohn: 0,
    sentAwaiting: 0,
    partialPayment: 0,
    paymentComplete: 0,
    overdue: 0,
    collections: 0,
    missingEmail: 0,
    missingInvoiceUrl: 0,
    totalAR: {},
    remindersTotal: 0,
    repliesConfirmed: 0,
    paidAfterFollowUp: 0,
    actionItems: [],
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const row of rows) {
    const status = (row['Status'] || '').trim();
    const payStatus = (row['Payment Status'] || '').trim();
    const invoiceNum = (row['Invoice #'] || '').trim();
    const amount = parseFloat((row['Amount'] || '0').replace(/[^0-9.]/g, '')) || 0;
    const currency = (row['Currency'] || 'USD').trim();
    const dueStr = (row['Due Date'] || '').trim();
    const email = (row['Email Address'] || '').trim();
    const invoiceUrl = (row['Invoice URL'] || '').trim();
    const remindersLog = (row['Reminders Sent'] || '').trim();
    const replyStatus = (row['Client Reply Status'] || '').trim();
    const lastFollowUp = (row['Last Follow-Up Sent'] || '').trim();
    const payConfirmed = (row['Payment Confirmed Date'] || '').trim();

    if (!invoiceNum) continue;

    // Categorize by status
    if (payStatus === 'Payment Complete' || status === 'Paid' || status === 'Payment Complete') {
      stats.paymentComplete++;
      if (lastFollowUp && payConfirmed) {
        const followDate = new Date(lastFollowUp);
        const payDate = new Date(payConfirmed);
        if (!isNaN(followDate) && !isNaN(payDate)) {
          const diffDays = (payDate - followDate) / 86400000;
          if (diffDays >= 0 && diffDays <= 14) stats.paidAfterFollowUp++;
        }
      }
    } else if (payStatus === 'Collections') {
      stats.collections++;
    } else if (payStatus === 'Partial Payment') {
      stats.partialPayment++;
    } else if (payStatus.startsWith('Draft')) {
      stats.draftPendingJohn++;
    } else if (payStatus === 'Sent' || payStatus === 'Awaiting Payment' || payStatus === 'Invoice Sent') {
      stats.sentAwaiting++;
      if (amount > 0) {
        stats.totalAR[currency] = (stats.totalAR[currency] || 0) + amount;
      }
      // Check overdue
      if (dueStr) {
        const due = new Date(dueStr);
        if (!isNaN(due) && due < today) stats.overdue++;
      }
    }

    // Reminders count
    if (remindersLog) {
      const count = (remindersLog.match(/\|/g) || []).length + 1;
      stats.remindersTotal += count;
    }

    // Replies
    if (replyStatus && replyStatus !== 'No Reply Found' && replyStatus !== '') {
      stats.repliesConfirmed++;
    }

    // Missing data risks
    if (!email && payStatus !== 'Payment Complete') stats.missingEmail++;
    if (!invoiceUrl && (payStatus === 'Sent' || payStatus === 'Invoice Sent')) stats.missingInvoiceUrl++;

    // Action items
    if (payStatus === 'Collections') {
      stats.actionItems.push({ invoice: invoiceNum, client: row['Client Name'] || '', action: 'Collections — manual escalation needed' });
    } else if (payStatus === 'Needs Human') {
      stats.actionItems.push({ invoice: invoiceNum, client: row['Client Name'] || '', action: 'Reply needs human review' });
    } else if (!email && payStatus !== 'Payment Complete' && payStatus !== '') {
      stats.actionItems.push({ invoice: invoiceNum, client: row['Client Name'] || '', action: 'Missing client email — reminders blocked' });
    }
  }

  return stats;
}

function computeN8nStats(executions, workflows, rangeMs) {
  const cutoff = Date.now() - rangeMs;
  const recent = executions.filter((e) => new Date(e.startedAt || e.stoppedAt || 0).getTime() > cutoff);
  const total = recent.length;
  const success = recent.filter((e) => e.status === 'success').length;
  const failed = recent.filter((e) => e.status === 'error' || e.status === 'crashed').length;
  const failedNames = [...new Set(
    recent.filter((e) => e.status === 'error' || e.status === 'crashed')
      .map((e) => e.workflowData?.name || e.workflowId || 'unknown')
  )];
  const activeIds = new Set(workflows.filter((w) => w.active).map((w) => w.id));
  const executedIds = new Set(recent.map((e) => e.workflowId));
  const stale = [...activeIds].filter((id) => !executedIds.has(id))
    .map((id) => workflows.find((w) => w.id === id)?.name || id);
  return { total, success, failed, failedNames, stale };
}

function computeNextFollowUps(rows) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const msDay = 86400000;
  const TIERS = [7, 5, 3, 1, 0, -1, -6, -7, -59];
  const results = [];

  for (const row of rows) {
    const payStatus = (row['Payment Status'] || '').trim();
    const invoiceNum = (row['Invoice #'] || '').trim();
    if (!invoiceNum) continue;
    if (['Payment Complete', 'Collections', 'Paid'].includes(payStatus) || payStatus.startsWith('Draft')) continue;

    const dueStr = (row['Due Date'] || '').trim();
    if (!dueStr) continue;
    const due = new Date(dueStr);
    if (isNaN(due.getTime())) continue;

    const daysDiff = Math.round((due.getTime() - today.getTime()) / msDay);
    const lastSent = (row['Last Follow-Up Sent'] || '').trim();
    const owner = (row['Requested By'] || '').trim() || 'Unassigned';
    const client = (row['Client Name'] || '').trim();
    const email = (row['Email Address'] || '').trim();

    let nextDays = null;
    for (const t of TIERS) {
      if (daysDiff <= t + 1 && daysDiff >= t) { nextDays = t; break; }
    }
    if (nextDays === null) nextDays = daysDiff > 7 ? 7 : daysDiff;

    const nextDate = new Date(today.getTime() + nextDays * msDay);
    const lateFeeDate = new Date(due.getTime() - 7 * msDay);
    const collectionsDate = new Date(due.getTime() - 60 * msDay);
    const blocked = !email;

    results.push({
      invoice: invoiceNum,
      client,
      owner,
      daysUntilDue: daysDiff,
      nextFollowUp: nextDate.toISOString().split('T')[0],
      lateFeeDate: lateFeeDate.toISOString().split('T')[0],
      collectionsDate: collectionsDate.toISOString().split('T')[0],
      lastSent,
      blocked,
    });
  }

  results.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  return results.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Gather all data
// ---------------------------------------------------------------------------

async function gatherData(forceRefresh = false) {
  if (!forceRefresh && cache.data && Date.now() - cache.ts < CACHE_TTL_MS) {
    return { ...cache.data, cached: true, cacheAge: Math.round((Date.now() - cache.ts) / 1000) };
  }

  const rangeMs = 7 * 24 * 60 * 60 * 1000; // week-to-date default
  const [n8nRaw, sheetsRaw, paymentsRaw, draftsRaw] = await Promise.all([
    fetchN8n(),
    fetchSheets(),
    fetchSlack(PAYMENTS_CHANNEL),
    fetchSlack(DRAFTS_CHANNEL),
  ]);

  const trackerStats = sheetsRaw.ok ? computeTrackerStats(sheetsRaw.rows) : null;
  const n8nStats = n8nRaw.ok ? computeN8nStats(n8nRaw.executions, n8nRaw.workflows, rangeMs) : null;
  const nextFollowUps = sheetsRaw.ok ? computeNextFollowUps(sheetsRaw.rows) : [];

  const caveats = [];
  if (!n8nRaw.ok) caveats.push(`n8n execution history unavailable: ${n8nRaw.reason}`);
  if (!sheetsRaw.ok) caveats.push(`Invoice tracker unavailable: ${sheetsRaw.reason}`);
  if (!paymentsRaw.ok) caveats.push(`#payments-invoices-updates unavailable: ${paymentsRaw.reason}`);
  if (!draftsRaw.ok) caveats.push(`#airwallexdrafts unavailable: ${draftsRaw.reason}`);

  const data = {
    generatedAt: new Date().toISOString(),
    caveats,
    trackerStats,
    n8nStats,
    nextFollowUps,
    slackPaymentsCount: paymentsRaw.ok ? paymentsRaw.messages.length : null,
    slackDraftsCount: draftsRaw.ok ? draftsRaw.messages.length : null,
    cached: false,
    cacheAge: 0,
  };

  cache = { data, ts: Date.now() };
  return data;
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

function scorecard(label, value, sub = '') {
  const display = value === null ? '<span class="unavailable">–</span>' : `<strong>${value}</strong>`;
  return `
    <div class="card">
      <div class="card-label">${label}</div>
      <div class="card-value">${display}</div>
      ${sub ? `<div class="card-sub">${sub}</div>` : ''}
    </div>`;
}

function statusDot(ok) {
  return ok ? '<span class="dot dot-ok">●</span>' : '<span class="dot dot-fail">●</span>';
}

function renderDashboard(d) {
  const ts = d.trackerStats;
  const n8n = d.n8nStats;
  const arStr = ts ? Object.entries(ts.totalAR).map(([c, v]) => `${c} ${v.toLocaleString()}`).join(' · ') || '—' : '—';
  const generatedTime = new Date(d.generatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', hour12: false });
  const cacheNote = d.cached ? `<span class="cache-note">Cached · ${Math.round(d.cacheAge / 60)}m old</span>` : '<span class="cache-note fresh">Live</span>';

  const caveatHtml = d.caveats.length
    ? `<div class="caveats"><strong>Source caveats:</strong><ul>${d.caveats.map((c) => `<li>${c}</li>`).join('')}</ul></div>`
    : '';

  const actionRows = ts && ts.actionItems.length
    ? ts.actionItems.map((a) => `<tr><td>${a.invoice}</td><td>${a.client}</td><td>${a.action}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty">No action items</td></tr>';

  const followUpRows = d.nextFollowUps.length
    ? d.nextFollowUps.map((f) => `
        <tr class="${f.blocked ? 'blocked-row' : ''}">
          <td>${f.invoice}</td>
          <td>${f.client}</td>
          <td>${f.daysUntilDue > 0 ? `+${f.daysUntilDue}d` : `${f.daysUntilDue}d`}</td>
          <td>${f.nextFollowUp}</td>
          <td>${f.lateFeeDate}</td>
          <td>${f.owner}</td>
          <td>${f.blocked ? '⚠ Missing email' : f.lastSent || '—'}</td>
        </tr>`).join('')
    : '<tr><td colspan="7" class="empty">No open invoices</td></tr>';

  const failedWfHtml = n8n && n8n.failedNames.length
    ? n8n.failedNames.map((n) => `<li>${n}</li>`).join('')
    : '<li class="empty">None</li>';

  const staleWfHtml = n8n && n8n.stale.length
    ? n8n.stale.map((n) => `<li>${n}</li>`).join('')
    : '<li class="empty">None</li>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Krave Ops Dashboard</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #e2e8f0; font-size: 14px; line-height: 1.5; }
  a { color: #60a5fa; text-decoration: none; } a:hover { text-decoration: underline; }
  .header { display: flex; align-items: center; justify-content: space-between; padding: 20px 32px 16px; border-bottom: 1px solid #1e293b; }
  .header h1 { font-size: 18px; font-weight: 600; color: #f8fafc; }
  .header-meta { display: flex; align-items: center; gap: 16px; font-size: 12px; color: #64748b; }
  .btn { background: #1e40af; color: #fff; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; }
  .btn:hover { background: #1d4ed8; }
  .btn-ghost { background: transparent; border: 1px solid #334155; color: #94a3b8; }
  .btn-ghost:hover { border-color: #475569; color: #e2e8f0; }
  .cache-note { font-size: 11px; padding: 3px 8px; border-radius: 4px; background: #1e293b; }
  .cache-note.fresh { color: #34d399; background: #064e3b22; }
  main { padding: 24px 32px; max-width: 1400px; }
  .section { margin-bottom: 32px; }
  .section-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin-bottom: 12px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
  .card { background: #1e293b; border-radius: 10px; padding: 16px; border: 1px solid #334155; }
  .card-label { font-size: 11px; color: #64748b; margin-bottom: 6px; }
  .card-value { font-size: 28px; font-weight: 700; color: #f1f5f9; }
  .card-sub { font-size: 11px; color: #475569; margin-top: 4px; }
  .unavailable { font-size: 20px; color: #475569; }
  table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 10px; overflow: hidden; border: 1px solid #334155; }
  th { text-align: left; padding: 10px 14px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; border-bottom: 1px solid #334155; background: #162032; }
  td { padding: 10px 14px; border-bottom: 1px solid #1e293b; font-size: 13px; color: #cbd5e1; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #1e293b88; }
  .blocked-row td { color: #f87171; }
  .empty { color: #475569; font-style: italic; }
  .dot { font-size: 10px; margin-right: 4px; }
  .dot-ok { color: #34d399; }
  .dot-fail { color: #f87171; }
  .health-row { display: flex; gap: 24px; align-items: flex-start; }
  .health-col { flex: 1; background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 16px; }
  .health-col h4 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; margin-bottom: 10px; }
  .health-col ul { list-style: none; }
  .health-col li { padding: 4px 0; font-size: 13px; color: #cbd5e1; border-bottom: 1px solid #1e293b11; }
  .caveats { background: #1c1a12; border: 1px solid #92400e55; border-radius: 8px; padding: 14px 18px; margin-bottom: 24px; }
  .caveats strong { color: #fbbf24; font-size: 12px; }
  .caveats ul { margin-top: 6px; padding-left: 18px; }
  .caveats li { font-size: 12px; color: #d97706; }
  .links { display: flex; gap: 12px; flex-wrap: wrap; }
  .links a { font-size: 12px; padding: 5px 12px; border: 1px solid #334155; border-radius: 6px; color: #94a3b8; }
  .links a:hover { border-color: #60a5fa; color: #60a5fa; text-decoration: none; }
  .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 700px) { main { padding: 16px; } .cards { grid-template-columns: 1fr 1fr; } .health-row { flex-direction: column; } .stat-grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="header">
  <h1>Krave Ops Dashboard</h1>
  <div class="header-meta">
    <span>${generatedTime} ICT</span>
    ${cacheNote}
    <form method="get" style="display:inline">
      <button class="btn" name="refresh" value="1" type="submit">↻ Refresh</button>
    </form>
  </div>
</div>

<main>
  ${caveatHtml}

  <div class="section">
    <div class="section-title">This Week — At a Glance</div>
    <div class="cards">
      ${scorecard('Drafts Pending', ts ? ts.draftPendingJohn : null, 'Awaiting John')}
      ${scorecard('Sent / Awaiting', ts ? ts.sentAwaiting : null, arStr)}
      ${scorecard('Reminders Sent', ts ? ts.remindersTotal : null)}
      ${scorecard('Replies Confirmed', ts ? ts.repliesConfirmed : null, 'John inbox only')}
      ${scorecard('Paid After Follow-Up', ts ? ts.paidAfterFollowUp : null, '14-day window')}
      ${scorecard('Payment Complete', ts ? ts.paymentComplete : null)}
      ${scorecard('Overdue', ts ? ts.overdue : null)}
      ${scorecard('Collections', ts ? ts.collections : null)}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Next Follow-Ups Queue</div>
    <table>
      <thead><tr>
        <th>Invoice</th><th>Client</th><th>Days to Due</th>
        <th>Next Follow-Up</th><th>Late Fee Date</th><th>Owner</th><th>Last Sent / Note</th>
      </tr></thead>
      <tbody>${followUpRows}</tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Workflow Health</div>
    <div class="health-row">
      <div class="health-col">
        <h4>Executions (WTD)</h4>
        ${n8n ? `
          <div style="margin-bottom:10px">
            ${statusDot(n8n.failed === 0)} ${n8n.total} total &nbsp;·&nbsp; ${n8n.success} ok &nbsp;·&nbsp; ${n8n.failed} failed
          </div>` : '<div class="empty" style="font-size:12px">Unavailable</div>'}
      </div>
      <div class="health-col">
        <h4>Failed Workflows</h4>
        <ul>${failedWfHtml}</ul>
      </div>
      <div class="health-col">
        <h4>Stale (Active, No Runs)</h4>
        <ul>${staleWfHtml}</ul>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Action Queue</div>
    <table>
      <thead><tr><th>Invoice</th><th>Client</th><th>Action Required</th></tr></thead>
      <tbody>${actionRows}</tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Tracker Status Breakdown</div>
    <div class="stat-grid">
      <table>
        <thead><tr><th>Status</th><th>Count</th></tr></thead>
        <tbody>
          <tr><td>Draft (Pending John)</td><td>${ts ? ts.draftPendingJohn : '—'}</td></tr>
          <tr><td>Sent / Awaiting Payment</td><td>${ts ? ts.sentAwaiting : '—'}</td></tr>
          <tr><td>Partial Payment</td><td>${ts ? ts.partialPayment : '—'}</td></tr>
          <tr><td>Payment Complete</td><td>${ts ? ts.paymentComplete : '—'}</td></tr>
          <tr><td>Overdue</td><td>${ts ? ts.overdue : '—'}</td></tr>
          <tr><td>Collections</td><td>${ts ? ts.collections : '—'}</td></tr>
        </tbody>
      </table>
      <table>
        <thead><tr><th>Data Quality</th><th>Count</th></tr></thead>
        <tbody>
          <tr><td>Missing Client Email</td><td>${ts ? ts.missingEmail : '—'}</td></tr>
          <tr><td>Missing Invoice URL</td><td>${ts ? ts.missingInvoiceUrl : '—'}</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Source Links</div>
    <div class="links">
      <a href="https://docs.google.com/spreadsheets/d/${SHEET_ID}" target="_blank">📊 Invoice Tracker</a>
      <a href="${N8N_BASE}/workflows" target="_blank">⚙️ n8n Workflows</a>
      <a href="https://slack.com/app_redirect?channel=${PAYMENTS_CHANNEL}" target="_blank">💬 #payments-invoices-updates</a>
      <a href="https://slack.com/app_redirect?channel=${DRAFTS_CHANNEL}" target="_blank">💬 #airwallexdrafts</a>
    </div>
  </div>
</main>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }

  const forceRefresh = req.url.includes('refresh=1');
  try {
    const data = await gatherData(forceRefresh);
    const html = renderDashboard(data);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Dashboard error: ${e.message}`);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Krave Ops Dashboard → http://localhost:${PORT}`);
  console.log(`Env: N8N_API_KEY=${process.env.N8N_API_KEY ? 'set' : 'MISSING'} | GOOGLE_SERVICE_ACCOUNT_KEY_FILE=${process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE ? 'set' : 'MISSING'} | SLACK_BOT_TOKEN=${process.env.SLACK_BOT_TOKEN ? 'set' : 'MISSING'}`);
});
