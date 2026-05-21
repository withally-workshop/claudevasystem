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
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sigInput = `${header}.${body}`;
  const sig = crypto.createSign('RSA-SHA256').update(sigInput).sign(sa.private_key, 'base64url');
  const jwt = `${sigInput}.${sig}`;

  const res = await drivePost('https://oauth2.googleapis.com/token',
    `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    { 'Content-Type': 'application/x-www-form-urlencoded' });
  _tokenCache[impersonate] = { token: res.access_token, exp: now + res.expires_in };
  return res.access_token;
}

function driveGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({ error: body }); } });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
  });
}

function drivePost(url, data, extraHeaders = {}) {
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

function resolveEmail(account) {
  if (!account || account === 'noa') return 'noa@kravemedia.co';
  if (account === 'john') return 'john@kravemedia.co';
  return account.includes('@') ? account : 'noa@kravemedia.co';
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function searchFiles({ account = 'noa', query, max_results = 20, file_type }) {
  const email = resolveEmail(account);
  const token = await getToken(email);

  let q = query ? `fullText contains '${query.replace(/'/g, "\\'")}' and trashed = false` : 'trashed = false';
  if (file_type) {
    const mimeMap = {
      video: 'video/',
      image: 'image/',
      pdf: 'application/pdf',
      doc: 'application/vnd.google-apps.document',
      sheet: 'application/vnd.google-apps.spreadsheet',
      folder: 'application/vnd.google-apps.folder',
    };
    const mime = mimeMap[file_type.toLowerCase()];
    if (mime) {
      q += mime.endsWith('/') ? ` and mimeType contains '${mime}'` : ` and mimeType = '${mime}'`;
    }
  }

  const fields = 'files(id,name,mimeType,size,modifiedTime,webViewLink,parents,owners)';
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=${Math.min(max_results, 50)}&fields=${encodeURIComponent(fields)}&orderBy=modifiedTime desc&includeItemsFromAllDrives=true&supportsAllDrives=true`;
  const res = await driveGet(url, { Authorization: `Bearer ${token}` });
  if (res.error) return { error: res.error };
  return {
    files: (res.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      type: f.mimeType,
      size: f.size ? `${Math.round(f.size / 1024)} KB` : null,
      modified: f.modifiedTime,
      link: f.webViewLink,
    })),
    total: (res.files || []).length,
  };
}

async function listFolder({ account = 'noa', folder_id = 'root', max_results = 30 }) {
  const email = resolveEmail(account);
  const token = await getToken(email);

  const q = `'${folder_id}' in parents and trashed = false`;
  const fields = 'files(id,name,mimeType,size,modifiedTime,webViewLink)';
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=${Math.min(max_results, 50)}&fields=${encodeURIComponent(fields)}&orderBy=folder,name&includeItemsFromAllDrives=true&supportsAllDrives=true`;
  const res = await driveGet(url, { Authorization: `Bearer ${token}` });
  if (res.error) return { error: res.error };
  return {
    items: (res.files || []).map((f) => ({
      id: f.id,
      name: f.name,
      type: f.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : f.mimeType,
      size: f.size ? `${Math.round(f.size / 1024)} KB` : null,
      modified: f.modifiedTime,
      link: f.webViewLink,
    })),
  };
}

async function getFileMeta({ account = 'noa', file_id }) {
  const email = resolveEmail(account);
  const token = await getToken(email);

  const fields = 'id,name,mimeType,size,modifiedTime,createdTime,webViewLink,description,parents,owners,shared';
  const url = `https://www.googleapis.com/drive/v3/files/${file_id}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`;
  const res = await driveGet(url, { Authorization: `Bearer ${token}` });
  if (res.error) return { error: res.error };
  return {
    id: res.id,
    name: res.name,
    type: res.mimeType,
    size: res.size ? `${Math.round(res.size / 1024)} KB` : null,
    created: res.createdTime,
    modified: res.modifiedTime,
    link: res.webViewLink,
    description: res.description || null,
    shared: res.shared,
    owners: (res.owners || []).map((o) => o.emailAddress),
  };
}

async function readFileContent({ account = 'noa', file_id, max_chars = 3000 }) {
  const email = resolveEmail(account);
  const token = await getToken(email);

  // First get the file metadata to know mimeType
  const meta = await getFileMeta({ account, file_id });
  if (meta.error) return { error: meta.error };

  const googleDocTypes = {
    'application/vnd.google-apps.document': 'text/plain',
    'application/vnd.google-apps.spreadsheet': 'text/csv',
    'application/vnd.google-apps.presentation': 'text/plain',
  };

  const exportMime = googleDocTypes[meta.type];
  let url;

  if (exportMime) {
    url = `https://www.googleapis.com/drive/v3/files/${file_id}/export?mimeType=${encodeURIComponent(exportMime)}`;
  } else if (meta.type && meta.type.startsWith('text/')) {
    url = `https://www.googleapis.com/drive/v3/files/${file_id}?alt=media`;
  } else {
    return { error: `Cannot read content of file type: ${meta.type}. Only Google Docs, Sheets, Presentations, and plain text files are readable.`, meta };
  }

  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ name: meta.name, type: meta.type, content: body.slice(0, max_chars), truncated: body.length > max_chars }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  definitions: [
    {
      name: 'drive_search',
      description: 'Search Google Drive for files by keyword. Can filter by file type (video, image, pdf, doc, sheet, folder). Searches across shared drives.',
      input_schema: {
        type: 'object',
        properties: {
          account: { type: 'string', description: '"noa" or "john" (default: noa)' },
          query: { type: 'string', description: 'Search keywords (full text search)' },
          file_type: { type: 'string', description: 'Optional filter: "video", "image", "pdf", "doc", "sheet", or "folder"' },
          max_results: { type: 'number', description: 'Max results (default 20, max 50)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'drive_list_folder',
      description: 'List contents of a Google Drive folder. Use folder_id "root" for the root drive.',
      input_schema: {
        type: 'object',
        properties: {
          account: { type: 'string', description: '"noa" or "john" (default: noa)' },
          folder_id: { type: 'string', description: 'Folder ID from drive_search, or "root" (default)' },
          max_results: { type: 'number', description: 'Max items to return (default 30)' },
        },
      },
    },
    {
      name: 'drive_get_file',
      description: 'Get metadata for a specific Google Drive file (name, type, size, link, owners).',
      input_schema: {
        type: 'object',
        properties: {
          account: { type: 'string', description: '"noa" or "john" (default: noa)' },
          file_id: { type: 'string', description: 'File ID from drive_search or drive_list_folder' },
        },
        required: ['file_id'],
      },
    },
    {
      name: 'drive_read_file',
      description: 'Read the text content of a Google Doc, Sheet, Presentation, or plain text file from Drive.',
      input_schema: {
        type: 'object',
        properties: {
          account: { type: 'string', description: '"noa" or "john" (default: noa)' },
          file_id: { type: 'string', description: 'File ID from drive_search' },
          max_chars: { type: 'number', description: 'Max characters to return (default 3000)' },
        },
        required: ['file_id'],
      },
    },
  ],
  handlers: {
    drive_search: searchFiles,
    drive_list_folder: listFolder,
    drive_get_file: getFileMeta,
    drive_read_file: readFileContent,
  },
};
