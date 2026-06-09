/**
 * Patch: Inbox Triage Daily v2 — fix merge deadlock
 *
 * Removes Merge Draft Branches, Restore After Draft, Merge Archive.
 * Wires Restore Email Metadata to fan out to Draft Needed?, Archive?,
 * and Build Slack Summary in parallel. Draft creation and archiving
 * become independent side-effect paths that terminate on their own.
 * Build Slack Summary receives directly from Restore Email Metadata —
 * no merge needed, always runs.
 *
 * Run: node patch-inbox-triage-merge-fix.js
 */

import fetch from 'node:https';

const WORKFLOW_ID = 'EuT6REDs5PUaoycE';
const N8N_BASE    = 'https://noatakhel.app.n8n.cloud';
const API_KEY     = process.env.N8N_API_KEY;

if (!API_KEY) {
  console.error('N8N_API_KEY env var is required');
  process.exit(1);
}

// ─── Nodes (remove: Merge Draft Branches, Restore After Draft, Merge Archive) ─

const REMOVE_IDS = new Set([
  'c5eaa5a4-a944-4732-8fed-0ea76d63bcae',     // Merge Draft Branches
  'restore-after-draft-1779759960925',          // Restore After Draft
  'ba7bc736-4531-4828-9bb0-7eee80d30aa2',      // Merge Archive
]);

// ─── New connections ──────────────────────────────────────────────────────────
// Restore Email Metadata fans out (output 0) to Draft Needed?, Archive?, AND
// Build Slack Summary simultaneously. Draft and archive paths terminate on
// their own — no merges needed anywhere in those branches.

const NEW_CONNECTIONS = {
  'Schedule 9am PHT Weekdays': {
    main: [[{ node: 'Search Unread Inbox', type: 'main', index: 0 }]],
  },
  'Manual Webhook Trigger': {
    main: [[{ node: 'Search Unread Inbox', type: 'main', index: 0 }]],
  },
  'Search Unread Inbox': {
    main: [[{ node: 'Get Message Details', type: 'main', index: 0 }]],
  },
  'Get Message Details': {
    main: [[{ node: 'Classify Email', type: 'main', index: 0 }]],
  },
  'Classify Email': {
    main: [[{ node: 'AI Needed?', type: 'main', index: 0 }]],
  },
  'AI Needed?': {
    main: [
      [{ node: 'AI Classify', type: 'main', index: 0 }],
      [{ node: 'Merge Classification', type: 'main', index: 1 }],
    ],
  },
  'AI Classify': {
    main: [[{ node: 'Merge Classification', type: 'main', index: 0 }]],
  },
  'Merge Classification': {
    main: [[{ node: 'Resolve Final Tier', type: 'main', index: 0 }]],
  },
  'Resolve Final Tier': {
    main: [[{ node: 'Apply EA Label', type: 'main', index: 0 }]],
  },
  'Apply EA Label': {
    main: [[{ node: 'Restore Email Metadata', type: 'main', index: 0 }]],
  },
  // Fan out to 3 parallel paths — no merge needed downstream
  'Restore Email Metadata': {
    main: [[
      { node: 'Draft Needed?',       type: 'main', index: 0 },
      { node: 'Archive?',            type: 'main', index: 0 },
      { node: 'Build Slack Summary', type: 'main', index: 0 },
    ]],
  },
  // Draft branch — side effect, terminates after draft creation
  'Draft Needed?': {
    main: [
      [{ node: 'Creator Inbound?', type: 'main', index: 0 }],
      [], // false branch terminates
    ],
  },
  'Creator Inbound?': {
    main: [
      [{ node: 'Draft: Creator Typeform', type: 'main', index: 0 }],
      [{ node: 'Generate AI Draft',       type: 'main', index: 0 }],
    ],
  },
  // Draft: Creator Typeform terminates (no downstream)
  'Generate AI Draft': {
    main: [[{ node: 'Create Draft', type: 'main', index: 0 }]],
  },
  // Create Draft terminates (no downstream)
  // Archive branch — side effect, terminates after removeLabels
  'Archive?': {
    main: [
      [{ node: 'Archive Email', type: 'main', index: 0 }],
      [], // false (Unsure) terminates — email stays in inbox
    ],
  },
  // Archive Email terminates (no downstream)
  // Summary — receives items directly from Restore Email Metadata
  'Build Slack Summary': {
    main: [[{ node: 'Post to #airwallex-drafts', type: 'main', index: 0 }]],
  },
};

// ─── Request helpers ──────────────────────────────────────────────────────────

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url  = new URL(N8N_BASE + path);
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method,
      headers: {
        'X-N8N-API-KEY':  API_KEY,
        'Content-Type':   'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    };
    const req = fetch.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(raw));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching current workflow…');
  const { workflow } = await apiRequest('GET', `/api/v1/workflows/${WORKFLOW_ID}`);

  // Filter out the 3 removed nodes
  const nodes = (workflow.nodes || []).filter(n => !REMOVE_IDS.has(n.id));
  console.log(`Nodes: ${workflow.nodes.length} → ${nodes.length} (removed ${workflow.nodes.length - nodes.length})`);

  const payload = {
    name:        workflow.name,
    nodes,
    connections: NEW_CONNECTIONS,
    settings:    workflow.settings,
    staticData:  workflow.staticData || null,
  };

  console.log('Patching workflow…');
  const result = await apiRequest('PUT', `/api/v1/workflows/${WORKFLOW_ID}`, payload);
  console.log('Done. Workflow updated:', result.name || result.id);
  console.log('versionId:', result.versionId);
}

main().catch(err => {
  console.error('Patch failed:', err.message);
  process.exit(1);
});
