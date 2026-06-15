#!/usr/bin/env node
/*
 * upload-to-drive.js
 *
 * Uploads a local file to Google Drive via the REST API using the krave-ea service
 * account (same key file as the google-sheets MCP). Bytes go disk -> Google directly —
 * never through model output — and the upload is hash-verified: Drive returns the
 * stored file's md5Checksum, which must match the local file's MD5 or this exits 1.
 *
 * Born from the 2026-06-12 incident: three Drive-connector uploads of the FluffCo
 * retainer corrupted in transit because file bytes were retyped as base64 text.
 *
 * Prereq: the target folder must be shared with the service account as Editor
 * (krave-ea@krave-ea.iam.gserviceaccount.com). Files are owned by the SA.
 *
 * Usage:
 *   node upload-to-drive.js --file output/foo.docx [--folder <driveFolderId>] [--name "Title.docx"] [--as <email>]
 *
 * --as <email>: impersonate a Workspace user via domain-wide delegation (same mechanism
 * as the gmail-john/gmail-noa MCPs). The upload then runs as that user — their ownership
 * and quota — which sidesteps Google's "service accounts have no storage quota" rule.
 * Requires the Drive scope to be authorized for this SA's client ID in the kravemedia.co
 * Admin console (Security > API Controls > Domain-wide Delegation).
 *
 * Credentials: GOOGLE_SERVICE_ACCOUNT_KEY_FILE env var (path to the SA JSON key) —
 * the same variable the google-sheets MCP uses. No secrets in this file.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Default review folder: "Client Contracts & Invoices" (Agency Work > Finance).
const DEFAULT_FOLDER = '1jPHJmiIdTrzLSAhwHLxeVZrr7XxfFiGm';

const MIME_BY_EXT = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

function fail(msg) {
  console.error(`\n[upload-to-drive] ERROR: ${msg}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { folder: DEFAULT_FOLDER };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') args.file = argv[++i];
    else if (a === '--folder') args.folder = argv[++i];
    else if (a === '--name') args.name = argv[++i];
    else if (a === '--as') args.as = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else fail(`unknown argument: ${a}`);
  }
  return args;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken(sa, impersonate) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimSet = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  };
  if (impersonate) claimSet.sub = impersonate;
  const claims = b64url(JSON.stringify(claimSet));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = b64url(signer.sign(sa.private_key));
  const jwt = `${header}.${claims}.${signature}`;

  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) fail(`token exchange failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.file) {
    console.log('Usage: node upload-to-drive.js --file <path> [--folder <driveFolderId>] [--name <title>]');
    process.exit(args.help ? 0 : 1);
  }

  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  if (!keyFile) fail('GOOGLE_SERVICE_ACCOUNT_KEY_FILE not set (same env var as the google-sheets MCP).');
  if (!fs.existsSync(keyFile)) fail(`key file not found: ${keyFile}`);
  const sa = JSON.parse(fs.readFileSync(keyFile, 'utf8'));

  const filePath = path.resolve(args.file);
  if (!fs.existsSync(filePath)) fail(`file not found: ${filePath}`);
  const bytes = fs.readFileSync(filePath);
  const localMd5 = crypto.createHash('md5').update(bytes).digest('hex');
  const name = args.name || path.basename(filePath);
  const mime = MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream';

  const token = await getAccessToken(sa, args.as);

  // Multipart upload: JSON metadata part + raw binary part.
  const boundary = 'krave-ea-' + crypto.randomBytes(12).toString('hex');
  const metadata = JSON.stringify({ name, parents: [args.folder] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,md5Checksum,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  const data = await res.json();
  if (!res.ok) fail(`upload failed (HTTP ${res.status}): ${JSON.stringify(data)}`);

  if (data.md5Checksum !== localMd5) {
    fail(`HASH MISMATCH — Drive stored a different file!\n  local:  ${localMd5}\n  drive:  ${data.md5Checksum}\nDelete ${data.webViewLink} and retry.`);
  }

  console.log(`Uploaded & verified (MD5 ${localMd5})`);
  console.log(`  name: ${data.name}`);
  console.log(`  id:   ${data.id}`);
  console.log(`  link: ${data.webViewLink}`);
}

main().catch((e) => fail(e.message));
