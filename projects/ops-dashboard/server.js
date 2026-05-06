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

const RANGE_DAYS = { '24h': 1, '7d': 7, '30d': 30 };
let cache = {}; // keyed by range

// Canonical Krave/Claude EA workflow IDs from n8n-workflows/WORKFLOWS.md.
// All other workflows in the n8n workspace are filtered out of dashboard stats.
const KRAVE_WORKFLOW_IDS = new Set([
  'NurOLZkg3J6rur5Q', // Payment Detection
  'Q3IqqLvmX9H49NdE', // Invoice Reminder Cron
  'omNFmRcDeiByLOzS', // Invoice Reminder Reply Detection
  '3YyEjk1e6oZV786T', // Inbox Triage Daily
  't7MMhlUo5H4HQmgL', // Slack Invoice Handler
  '5XHxhQ7wB2rxE3qz', // Invoice Request Intake
  'uCS9lzHtVKWlqYlk', // Invoice Approval Polling
  'WX1hHek0cNTyZXkS', // Weekly Invoice Summary
]);

// ---------------------------------------------------------------------------
// Service account loader — supports JSON-in-env (Render) or file path (local)
// ---------------------------------------------------------------------------

function hasServiceAccount() {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE);
}

function loadServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
  if (raw) return JSON.parse(raw);
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  throw new Error('Google service account not configured');
}

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
    const allExecutions = exRes.ok ? (exRes.body.data || []) : [];
    const allWorkflows = wfRes.ok ? (wfRes.body.data || []) : [];
    return {
      ok: exRes.ok && wfRes.ok,
      executions: allExecutions.filter((e) => KRAVE_WORKFLOW_IDS.has(e.workflowId)),
      workflows: allWorkflows.filter((w) => KRAVE_WORKFLOW_IDS.has(w.id)),
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

  const sa = loadServiceAccount();
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
  if (!hasServiceAccount()) return { ok: false, reason: 'Google service account not configured (set GOOGLE_SERVICE_ACCOUNT_KEY_JSON or GOOGLE_SERVICE_ACCOUNT_KEY_FILE)', rows: [] };
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

    // Action items — categories ordered by priority
    const client = (row['Client Name'] || '').trim();
    const dueDate = dueStr ? new Date(dueStr) : null;
    const overdueDays = (dueDate && !isNaN(dueDate)) ? Math.floor((today - dueDate) / 86400000) : null;
    const dateCreatedStr = (row['Date Created'] || '').trim();
    const dateCreated = dateCreatedStr ? new Date(dateCreatedStr) : null;
    const draftAgeDays = (dateCreated && !isNaN(dateCreated)) ? Math.floor((today - dateCreated) / 86400000) : null;

    if (payStatus === 'Collections') {
      stats.actionItems.push({ invoice: invoiceNum, client, action: 'Collections — manual escalation needed' });
    } else if (replyStatus === 'Needs Human' || replyStatus === 'Question/Dispute') {
      stats.actionItems.push({ invoice: invoiceNum, client, action: `Client reply needs human review (${replyStatus})` });
    } else if (overdueDays !== null && overdueDays > 60 && ['Sent', 'Awaiting Payment', 'Invoice Sent'].includes(payStatus)) {
      stats.actionItems.push({ invoice: invoiceNum, client, action: `${overdueDays}d overdue — past late-fee window, consider escalation` });
    } else if (payStatus === 'Partial Payment' && overdueDays !== null && overdueDays > 14) {
      stats.actionItems.push({ invoice: invoiceNum, client, action: `Partial payment, ${overdueDays}d overdue — chase remaining balance` });
    } else if (payStatus.startsWith('Draft') && draftAgeDays !== null && draftAgeDays > 3) {
      stats.actionItems.push({ invoice: invoiceNum, client, action: `Draft pending John for ${draftAgeDays} days` });
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

function computeAgingBuckets(rows) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const buckets = [
    { label: 'Current', amount: 0, count: 0 },
    { label: '1–30d overdue', amount: 0, count: 0 },
    { label: '31–60d overdue', amount: 0, count: 0 },
    { label: '61–90d overdue', amount: 0, count: 0 },
    { label: '90+d overdue', amount: 0, count: 0 },
  ];
  for (const row of rows) {
    const payStatus = (row['Payment Status'] || '').trim();
    if (!['Sent', 'Awaiting Payment', 'Invoice Sent', 'Partial Payment'].includes(payStatus)) continue;
    const amount = parseFloat((row['Amount'] || '0').replace(/[^0-9.]/g, '')) || 0;
    const paid = parseFloat((row['Amount Paid'] || '0').replace(/[^0-9.]/g, '')) || 0;
    const remaining = Math.max(0, amount - paid);
    if (remaining <= 0) continue;
    const dueStr = (row['Due Date'] || '').trim();
    if (!dueStr) continue;
    const due = new Date(dueStr);
    if (isNaN(due)) continue;
    const overdueDays = Math.floor((today - due) / 86400000);
    let i;
    if (overdueDays <= 0) i = 0;
    else if (overdueDays <= 30) i = 1;
    else if (overdueDays <= 60) i = 2;
    else if (overdueDays <= 90) i = 3;
    else i = 4;
    buckets[i].amount += remaining;
    buckets[i].count += 1;
  }
  const total = buckets.reduce((s, b) => s + b.amount, 0);
  return { buckets, total };
}

function computeStatusDonut(rows) {
  const counts = { Draft: 0, Sent: 0, Partial: 0, Paid: 0, Overdue: 0, Collections: 0 };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (const row of rows) {
    if (!(row['Invoice #'] || '').trim()) continue;
    const payStatus = (row['Payment Status'] || '').trim();
    if (payStatus === 'Collections') counts.Collections++;
    else if (payStatus === 'Partial Payment') counts.Partial++;
    else if (payStatus.startsWith('Draft')) counts.Draft++;
    else if (payStatus === 'Payment Complete' || payStatus === 'Paid') counts.Paid++;
    else if (['Sent', 'Awaiting Payment', 'Invoice Sent'].includes(payStatus)) {
      const dueStr = (row['Due Date'] || '').trim();
      const due = dueStr ? new Date(dueStr) : null;
      if (due && !isNaN(due) && due < today) counts.Overdue++;
      else counts.Sent++;
    }
  }
  return counts;
}

function computeWorkflowSparklines(executions, workflows, days) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ms = 86400000;
  const dayKeys = [];
  for (let i = days - 1; i >= 0; i--) {
    dayKeys.push(new Date(today.getTime() - i * ms).toISOString().slice(0, 10));
  }
  const dayIndex = new Map(dayKeys.map((k, i) => [k, i]));
  const byWorkflow = {};
  const nameById = {};
  for (const wf of workflows) nameById[wf.id] = wf.name;
  for (const e of executions) {
    const startedAt = e.startedAt || e.stoppedAt;
    if (!startedAt) continue;
    const k = new Date(startedAt).toISOString().slice(0, 10);
    if (!dayIndex.has(k)) continue;
    const name = e.workflowData?.name || nameById[e.workflowId] || 'unknown';
    if (!byWorkflow[name]) {
      byWorkflow[name] = { name, runs: dayKeys.map(() => 0), fails: dayKeys.map(() => 0), total: 0, failed: 0 };
    }
    const idx = dayIndex.get(k);
    byWorkflow[name].runs[idx]++;
    byWorkflow[name].total++;
    if (e.status === 'error' || e.status === 'crashed') {
      byWorkflow[name].fails[idx]++;
      byWorkflow[name].failed++;
    }
  }
  return Object.values(byWorkflow).sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------------------
// Gather all data
// ---------------------------------------------------------------------------

async function gatherData(range = '7d', forceRefresh = false) {
  const days = RANGE_DAYS[range] || 7;
  const cached = cache[range];
  if (!forceRefresh && cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { ...cached.data, cached: true, cacheAge: Math.round((Date.now() - cached.ts) / 1000) };
  }

  const rangeMs = days * 86400000;
  const [n8nRaw, sheetsRaw, paymentsRaw, draftsRaw] = await Promise.all([
    fetchN8n(),
    fetchSheets(),
    fetchSlack(PAYMENTS_CHANNEL),
    fetchSlack(DRAFTS_CHANNEL),
  ]);

  const trackerStats = sheetsRaw.ok ? computeTrackerStats(sheetsRaw.rows) : null;
  const n8nStats = n8nRaw.ok ? computeN8nStats(n8nRaw.executions, n8nRaw.workflows, rangeMs) : null;
  const nextFollowUps = sheetsRaw.ok ? computeNextFollowUps(sheetsRaw.rows) : [];
  const aging = sheetsRaw.ok ? computeAgingBuckets(sheetsRaw.rows) : null;
  const donut = sheetsRaw.ok ? computeStatusDonut(sheetsRaw.rows) : null;
  const sparklines = n8nRaw.ok ? computeWorkflowSparklines(n8nRaw.executions, n8nRaw.workflows, Math.min(days, 14)) : [];

  const caveats = [];
  if (!n8nRaw.ok) caveats.push(`n8n execution history unavailable: ${n8nRaw.reason}`);
  if (!sheetsRaw.ok) caveats.push(`Invoice tracker unavailable: ${sheetsRaw.reason}`);
  if (!paymentsRaw.ok) caveats.push(`#payments-invoices-updates unavailable: ${paymentsRaw.reason}`);
  if (!draftsRaw.ok) caveats.push(`#airwallexdrafts unavailable: ${draftsRaw.reason}`);

  const data = {
    generatedAt: new Date().toISOString(),
    range, days,
    caveats,
    trackerStats,
    n8nStats,
    nextFollowUps,
    aging,
    donut,
    sparklines,
    slackPaymentsCount: paymentsRaw.ok ? paymentsRaw.messages.length : null,
    slackDraftsCount: draftsRaw.ok ? draftsRaw.messages.length : null,
    cached: false,
    cacheAge: 0,
  };

  cache[range] = { data, ts: Date.now() };
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

function renderFunnelSvg(sent, replies, paid) {
  const items = [
    { label: 'Reminders sent', value: sent, color: '#60a5fa' },
    { label: 'Replies confirmed', value: replies, color: '#fbbf24' },
    { label: 'Paid after follow-up', value: paid, color: '#34d399' },
  ];
  const max = Math.max(sent, replies, paid, 1);
  const w = 600, barH = 36, gap = 16, labelW = 180;
  const h = items.length * (barH + gap);
  let svg = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMinYMin meet" style="width:100%;height:auto;max-width:${w}px;">`;
  items.forEach((it, i) => {
    const y = i * (barH + gap);
    const barW = ((w - labelW - 60) * it.value) / max;
    svg += `<text x="0" y="${y + 22}" fill="#94a3b8" font-size="13">${it.label}</text>`;
    svg += `<rect x="${labelW}" y="${y}" width="${Math.max(2, barW)}" height="${barH}" rx="4" fill="${it.color}" opacity="0.85"/>`;
    svg += `<text x="${labelW + Math.max(2, barW) + 10}" y="${y + 22}" fill="#f1f5f9" font-size="14" font-weight="600">${it.value}</text>`;
  });
  return svg + '</svg>';
}

function renderAgingSvg(aging) {
  if (!aging || aging.total === 0) return '<div class="empty" style="padding:20px">No outstanding amounts</div>';
  const colors = ['#34d399', '#fbbf24', '#fb923c', '#f87171', '#dc2626'];
  const w = 600, barH = 28;
  let svg = `<svg viewBox="0 0 ${w} ${barH + 90}" style="width:100%;height:auto;">`;
  let x = 0;
  aging.buckets.forEach((b, i) => {
    const segW = (b.amount / aging.total) * w;
    if (segW > 0) {
      svg += `<rect x="${x}" y="0" width="${segW}" height="${barH}" fill="${colors[i]}" opacity="0.9"/>`;
      if (segW > 60) svg += `<text x="${x + segW / 2}" y="${barH / 2 + 4}" fill="#0f1117" font-size="12" font-weight="600" text-anchor="middle">$${Math.round(b.amount).toLocaleString()}</text>`;
    }
    x += segW;
  });
  aging.buckets.forEach((b, i) => {
    const col = i % 3;
    const rowI = Math.floor(i / 3);
    const cx = col * (w / 3);
    const cy = barH + 24 + rowI * 22;
    svg += `<rect x="${cx}" y="${cy - 10}" width="10" height="10" fill="${colors[i]}"/>`;
    svg += `<text x="${cx + 16}" y="${cy}" fill="#94a3b8" font-size="11">${b.label}: $${Math.round(b.amount).toLocaleString()} (${b.count})</text>`;
  });
  return svg + '</svg>';
}

function renderDonutSvg(counts) {
  const items = [
    { label: 'Draft', value: counts.Draft, color: '#94a3b8' },
    { label: 'Sent', value: counts.Sent, color: '#60a5fa' },
    { label: 'Partial', value: counts.Partial, color: '#a78bfa' },
    { label: 'Paid', value: counts.Paid, color: '#34d399' },
    { label: 'Overdue', value: counts.Overdue, color: '#fb923c' },
    { label: 'Collections', value: counts.Collections, color: '#dc2626' },
  ];
  const total = items.reduce((s, it) => s + it.value, 0);
  if (total === 0) return '<div class="empty" style="padding:20px">No invoices</div>';
  const cx = 100, cy = 100, r = 80, ri = 50;
  let angle = -Math.PI / 2;
  let svg = `<svg viewBox="0 0 400 200" style="width:100%;max-width:400px;height:auto;">`;
  items.forEach((it) => {
    if (it.value === 0) return;
    const slice = (it.value / total) * Math.PI * 2;
    const a2 = angle + slice;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    const xi1 = cx + ri * Math.cos(angle), yi1 = cy + ri * Math.sin(angle);
    const xi2 = cx + ri * Math.cos(a2), yi2 = cy + ri * Math.sin(a2);
    const large = slice > Math.PI ? 1 : 0;
    svg += `<path d="M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${ri} ${ri} 0 ${large} 0 ${xi1} ${yi1} Z" fill="${it.color}" opacity="0.9"/>`;
    angle = a2;
  });
  svg += `<text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="#f1f5f9" font-size="22" font-weight="700">${total}</text>`;
  svg += `<text x="${cx}" y="${cy + 14}" text-anchor="middle" fill="#64748b" font-size="11">invoices</text>`;
  let ly = 16;
  items.forEach((it) => {
    if (it.value === 0) return;
    svg += `<rect x="220" y="${ly}" width="10" height="10" fill="${it.color}"/>`;
    svg += `<text x="236" y="${ly + 9}" fill="#cbd5e1" font-size="12">${it.label} (${it.value})</text>`;
    ly += 20;
  });
  return svg + '</svg>';
}

function renderSparklineSvg(runs, fails) {
  const w = 120, h = 32;
  const max = Math.max(...runs, 1);
  const stepX = runs.length > 1 ? w / (runs.length - 1) : 0;
  let svg = `<svg viewBox="0 0 ${w} ${h}" style="width:${w}px;height:${h}px;">`;
  let path = '';
  runs.forEach((v, i) => {
    const x = i * stepX;
    const y = h - (v / max) * (h - 4) - 2;
    path += (i === 0 ? 'M' : 'L') + ` ${x} ${y} `;
  });
  svg += `<path d="${path}" fill="none" stroke="#60a5fa" stroke-width="1.5"/>`;
  fails.forEach((f, i) => {
    if (f === 0) return;
    const x = i * stepX;
    const y = h - (runs[i] / max) * (h - 4) - 2;
    svg += `<circle cx="${x}" cy="${y}" r="2.5" fill="#f87171"/>`;
  });
  return svg + '</svg>';
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

  const sparkRows = (d.sparklines || []).length
    ? d.sparklines.map((wf) => `
        <tr>
          <td>${wf.name}</td>
          <td style="text-align:right">${wf.total}</td>
          <td style="text-align:right;color:${wf.failed ? '#f87171' : '#475569'}">${wf.failed}</td>
          <td>${renderSparklineSvg(wf.runs, wf.fails)}</td>
        </tr>`).join('')
    : '<tr><td colspan="4" class="empty">No executions in range</td></tr>';

  const range = d.range || '7d';
  const rangeLabel = { '24h': 'last 24 hours', '7d': 'last 7 days', '30d': 'last 30 days' }[range];
  const rangeToggle = ['24h', '7d', '30d'].map((r) => {
    const active = r === range ? ' active' : '';
    return `<a class="range-btn${active}" href="?range=${r}">${r}</a>`;
  }).join('');

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
  .chart-row { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }
  .chart-card { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 20px; }
  .chart-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; margin-bottom: 14px; }
  .range-toggle { display: inline-flex; gap: 0; border: 1px solid #334155; border-radius: 6px; overflow: hidden; }
  .range-btn { font-size: 12px; padding: 5px 12px; color: #94a3b8; background: transparent; border-right: 1px solid #334155; }
  .range-btn:last-child { border-right: none; }
  .range-btn:hover { color: #e2e8f0; text-decoration: none; }
  .range-btn.active { background: #1e40af; color: #fff; }
  .scope-line { font-size: 12px; color: #64748b; padding: 0 32px 12px; border-bottom: 1px solid #1e293b; }
  .scope-line strong { color: #94a3b8; font-weight: 600; }
  @media (max-width: 700px) { main { padding: 16px; } .cards { grid-template-columns: 1fr 1fr; } .health-row { flex-direction: column; } .stat-grid { grid-template-columns: 1fr; } .chart-row { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="header">
  <h1>Krave Ops Dashboard</h1>
  <div class="header-meta">
    <span class="range-toggle">${rangeToggle}</span>
    <span>${generatedTime} ICT</span>
    ${cacheNote}
    <form method="get" style="display:inline">
      <input type="hidden" name="range" value="${range}">
      <button class="btn" name="refresh" value="1" type="submit">↻ Refresh</button>
    </form>
  </div>
</div>

<div class="scope-line">
  <strong>Snapshot:</strong> invoice state at ${generatedTime} ICT &nbsp;·&nbsp;
  <strong>Range:</strong> workflow stats and reminder activity over the ${rangeLabel}
</div>

<main>
  ${caveatHtml}

  <div class="section">
    <div class="chart-row">
      <div class="chart-card">
        <div class="chart-title">Reminder → Reply → Payment funnel (lifetime)</div>
        ${ts ? renderFunnelSvg(ts.remindersTotal, ts.repliesConfirmed, ts.paidAfterFollowUp) : '<div class="empty">Tracker unavailable</div>'}
      </div>
      <div class="chart-card">
        <div class="chart-title">Invoice status breakdown (current)</div>
        ${d.donut ? renderDonutSvg(d.donut) : '<div class="empty">Tracker unavailable</div>'}
      </div>
    </div>
  </div>

  <div class="section">
    <div class="chart-card">
      <div class="chart-title">AR aging — outstanding amounts by overdue bucket</div>
      ${renderAgingSvg(d.aging)}
    </div>
  </div>

  <div class="section">
    <div class="section-title">At a Glance — current state &amp; ${rangeLabel}</div>
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
    <div class="section-title">Workflow runs — last ${Math.min(d.days || 7, 14)} days</div>
    <table>
      <thead><tr><th>Workflow</th><th style="text-align:right">Runs</th><th style="text-align:right">Failed</th><th>Trend (red dot = failure)</th></tr></thead>
      <tbody>${sparkRows}</tbody>
    </table>
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
// Auth — Google OAuth + signed cookie session, no external deps
// ---------------------------------------------------------------------------

const SESSION_COOKIE = 'kos_sess';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const AUTH_DISABLED = process.env.DISABLE_AUTH === '1';

function baseUrl(req) {
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL;
  if (process.env.BASE_URL) return process.env.BASE_URL;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function sign(value) {
  const secret = process.env.SESSION_SECRET || 'dev-only-not-for-prod';
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function makeSessionCookie(email) {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${email}|${exp}`;
  const token = `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}

function readSession(req) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!match) return null;
  const token = match.slice(SESSION_COOKIE.length + 1);
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  let payload;
  try { payload = Buffer.from(b64, 'base64url').toString('utf8'); } catch { return null; }
  if (sign(payload) !== sig) return null;
  const [email, expStr] = payload.split('|');
  const exp = parseInt(expStr, 10);
  if (!email || !exp || Date.now() > exp) return null;
  if (!ALLOWLIST.has(email.toLowerCase())) return null;
  return { email, exp };
}

function redirect(res, location, setCookie) {
  const headers = { Location: location };
  if (setCookie) headers['Set-Cookie'] = setCookie;
  res.writeHead(302, headers);
  res.end();
}

function htmlResponse(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

async function handleAuthLogin(req, res) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) return htmlResponse(res, 500, 'GOOGLE_OAUTH_CLIENT_ID not set');
  const url = new URL(req.url, baseUrl(req));
  const next = url.searchParams.get('next') || '/';
  const state = `${crypto.randomBytes(16).toString('hex')}|${Buffer.from(next).toString('base64url')}`;
  const stateCookie = `kos_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${baseUrl(req)}/auth/callback`,
    response_type: 'code',
    scope: 'openid email',
    state,
    prompt: 'select_account',
  });
  redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${params}`, stateCookie);
}

async function handleAuthCallback(req, res) {
  const url = new URL(req.url, baseUrl(req));
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieHeader = req.headers.cookie || '';
  const stateCookie = cookieHeader.split(';').map((c) => c.trim()).find((c) => c.startsWith('kos_state='));
  if (!code || !state || !stateCookie || stateCookie.slice(10) !== state) {
    return htmlResponse(res, 400, 'Invalid auth state. <a href="/auth/login">Try again</a>');
  }

  const tokenRes = await post('https://oauth2.googleapis.com/token', new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirect_uri: `${baseUrl(req)}/auth/callback`,
    grant_type: 'authorization_code',
  }).toString(), { 'Content-Type': 'application/x-www-form-urlencoded' });

  if (!tokenRes.ok || !tokenRes.body.id_token) {
    return htmlResponse(res, 502, 'Token exchange failed.');
  }
  const idPayload = JSON.parse(Buffer.from(tokenRes.body.id_token.split('.')[1], 'base64url').toString('utf8'));
  const email = (idPayload.email || '').toLowerCase();
  if (!email || !ALLOWLIST.has(email)) {
    return htmlResponse(res, 403, `<p>Access denied for <code>${email || 'unknown'}</code>.</p><p>This dashboard is restricted to the Krave team. <a href="/auth/login">Try a different account</a>.</p>`);
  }

  const next = state.split('|')[1] ? Buffer.from(state.split('|')[1], 'base64url').toString('utf8') : '/';
  redirect(res, next, makeSessionCookie(email));
}

function handleAuthLogout(_req, res) {
  res.writeHead(302, {
    Location: '/auth/login',
    'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  });
  res.end();
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }

  if (req.url.startsWith('/auth/login')) return handleAuthLogin(req, res);
  if (req.url.startsWith('/auth/callback')) return handleAuthCallback(req, res);
  if (req.url.startsWith('/auth/logout')) return handleAuthLogout(req, res);

  if (!AUTH_DISABLED) {
    const session = readSession(req);
    if (!session) {
      const next = encodeURIComponent(req.url || '/');
      return redirect(res, `/auth/login?next=${next}`);
    }
  }

  const url = new URL(req.url, baseUrl(req));
  const forceRefresh = url.searchParams.get('refresh') === '1';
  const range = RANGE_DAYS[url.searchParams.get('range')] ? url.searchParams.get('range') : '7d';
  try {
    const data = await gatherData(range, forceRefresh);
    const html = renderDashboard(data);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Dashboard error: ${e.message}`);
  }
});

const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`Krave Ops Dashboard → http://${HOST}:${PORT}`);
  console.log(`Env: N8N_API_KEY=${process.env.N8N_API_KEY ? 'set' : 'MISSING'} | GoogleSA=${hasServiceAccount() ? 'set' : 'MISSING'} | SLACK_BOT_TOKEN=${process.env.SLACK_BOT_TOKEN ? 'set' : 'MISSING'} | OAUTH=${process.env.GOOGLE_OAUTH_CLIENT_ID ? 'set' : 'MISSING'} | AUTH=${AUTH_DISABLED ? 'DISABLED' : 'enabled'}`);
});
