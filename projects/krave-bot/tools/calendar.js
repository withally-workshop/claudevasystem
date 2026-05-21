'use strict';

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

let _tokenCache = {};

function loadServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
  if (raw) return JSON.parse(raw);
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  throw new Error('Google service account not configured');
}

async function getToken(impersonate) {
  const cached = _tokenCache[impersonate];
  if (cached && Date.now() < cached.exp - 60000) return cached.token;

  const sa = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    sub: impersonate,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sigInput = `${header}.${body}`;
  const sig = crypto.createSign('RSA-SHA256').update(sigInput).sign(sa.private_key, 'base64url');
  const jwt = `${sigInput}.${sig}`;

  const res = await calPost('https://oauth2.googleapis.com/token',
    `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    { 'Content-Type': 'application/x-www-form-urlencoded' });
  _tokenCache[impersonate] = { token: res.access_token, exp: now + res.expires_in };
  return res.access_token;
}

function calGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({ error: body }); } });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

function calPost(url, data, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const buf = Buffer.from(data);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers: { 'Content-Length': buf.length, ...extraHeaders },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({ error: body }); } });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

function calRequest(url, method, data, token) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const buf = data ? Buffer.from(JSON.stringify(data)) : null;
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + (parsed.search || ''),
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(buf ? { 'Content-Length': buf.length } : {}),
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({ error: body }); } });
    });
    req.on('error', reject);
    if (buf) req.write(buf);
    req.end();
  });
}

function resolveEmail(account) {
  if (!account || account === 'noa') return 'noa@kravemedia.co';
  if (account === 'john') return 'john@kravemedia.co';
  return account.includes('@') ? account : 'noa@kravemedia.co';
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function listEvents({ account = 'noa', calendar_id = 'primary', days_ahead = 7, max_results = 20 }) {
  const email = resolveEmail(account);
  const token = await getToken(email);
  const now = new Date().toISOString();
  const until = new Date(Date.now() + days_ahead * 86400000).toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar_id)}/events?timeMin=${now}&timeMax=${until}&maxResults=${max_results}&singleEvents=true&orderBy=startTime`;
  const res = await calGet(url, { Authorization: `Bearer ${token}` });
  if (res.error) return { error: res.error };
  return {
    events: (res.items || []).map((e) => ({
      id: e.id,
      summary: e.summary || '(no title)',
      start: e.start && (e.start.dateTime || e.start.date),
      end: e.end && (e.end.dateTime || e.end.date),
      location: e.location || null,
      attendees: (e.attendees || []).map((a) => a.email),
      description: (e.description || '').slice(0, 300),
      htmlLink: e.htmlLink,
    })),
  };
}

async function createEvent({ account = 'noa', calendar_id = 'primary', summary, start, end, attendees = [], description = '', location = '' }) {
  const email = resolveEmail(account);
  const token = await getToken(email);
  const event = {
    summary,
    description,
    location,
    start: start.includes('T') ? { dateTime: start, timeZone: 'Asia/Bangkok' } : { date: start },
    end: end.includes('T') ? { dateTime: end, timeZone: 'Asia/Bangkok' } : { date: end },
    attendees: attendees.map((e) => ({ email: e })),
  };
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar_id)}/events`;
  const res = await calRequest(url, 'POST', event, token);
  if (res.error) return { error: res.error };
  return { id: res.id, summary: res.summary, htmlLink: res.htmlLink, status: 'created' };
}

async function deleteEvent({ account = 'noa', calendar_id = 'primary', event_id }) {
  const email = resolveEmail(account);
  const token = await getToken(email);
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar_id)}/events/${event_id}`;
  await calRequest(url, 'DELETE', null, token);
  return { status: 'deleted', event_id };
}

async function findAvailability({ account = 'noa', days_ahead = 5 }) {
  const email = resolveEmail(account);
  const token = await getToken(email);
  const now = new Date();
  const until = new Date(Date.now() + days_ahead * 86400000).toISOString();
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now.toISOString()}&timeMax=${until}&singleEvents=true&orderBy=startTime&maxResults=50`;
  const res = await calGet(url, { Authorization: `Bearer ${token}` });
  const busy = (res.items || []).map((e) => ({
    start: e.start && (e.start.dateTime || e.start.date),
    end: e.end && (e.end.dateTime || e.end.date),
    summary: e.summary || '(busy)',
  }));
  return { account: email, busy_slots: busy, checked_days: days_ahead };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  definitions: [
    {
      name: 'calendar_list_events',
      description: 'List upcoming calendar events for Noa or John.',
      input_schema: {
        type: 'object',
        properties: {
          account: { type: 'string', description: '"noa" or "john" (default: noa)' },
          calendar_id: { type: 'string', description: 'Calendar ID (default: primary)' },
          days_ahead: { type: 'number', description: 'How many days ahead to look (default: 7)' },
          max_results: { type: 'number', description: 'Max events to return (default: 20)' },
        },
      },
    },
    {
      name: 'calendar_create_event',
      description: 'Create a calendar event for Noa or John. Use ISO 8601 for start/end (e.g. 2026-05-21T14:00:00).',
      input_schema: {
        type: 'object',
        properties: {
          account: { type: 'string', description: '"noa" or "john" (default: noa)' },
          summary: { type: 'string', description: 'Event title' },
          start: { type: 'string', description: 'Start datetime ISO 8601 or date (YYYY-MM-DD)' },
          end: { type: 'string', description: 'End datetime ISO 8601 or date' },
          attendees: { type: 'array', items: { type: 'string' }, description: 'List of attendee emails' },
          description: { type: 'string', description: 'Event description (optional)' },
          location: { type: 'string', description: 'Location (optional)' },
        },
        required: ['summary', 'start', 'end'],
      },
    },
    {
      name: 'calendar_delete_event',
      description: 'Delete a calendar event by ID.',
      input_schema: {
        type: 'object',
        properties: {
          account: { type: 'string', description: '"noa" or "john" (default: noa)' },
          event_id: { type: 'string', description: 'Event ID from calendar_list_events' },
          calendar_id: { type: 'string', description: 'Calendar ID (default: primary)' },
        },
        required: ['event_id'],
      },
    },
    {
      name: 'calendar_find_availability',
      description: 'Find busy slots on Noa or John\'s calendar to determine availability.',
      input_schema: {
        type: 'object',
        properties: {
          account: { type: 'string', description: '"noa" or "john" (default: noa)' },
          days_ahead: { type: 'number', description: 'Days ahead to check (default: 5)' },
        },
      },
    },
  ],
  handlers: {
    calendar_list_events: listEvents,
    calendar_create_event: createEvent,
    calendar_delete_event: deleteEvent,
    calendar_find_availability: findAvailability,
  },
};
