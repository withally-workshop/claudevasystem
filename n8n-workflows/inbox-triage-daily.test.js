const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// Contract check for the LIVE Inbox Triage Daily v2 workflow (EuT6REDs5PUaoycE).
// Rewritten 2026-06-15: the previous version asserted a v1 design (Noa-DM, context
// labels, 'Build Gmail Query', workflow 3YyEjk1e6oZV786T) that never shipped and had
// been failing. This asserts the deployed v2 script + the inbox-as-actionable-queue
// archive rule and sender-only KNOWN-contact matching.

const deployPath = path.join(__dirname, 'deploy-inbox-triage-daily.js');
const workflowsDocPath = path.join(__dirname, 'WORKFLOWS.md');
const readmePath = path.join(__dirname, 'README.md');

assert.ok(fs.existsSync(deployPath), 'Expected deploy-inbox-triage-daily.js to exist');

const deploySource = fs.readFileSync(deployPath, 'utf8');
const workflowsDoc = fs.readFileSync(workflowsDocPath, 'utf8');
const readmeDoc = fs.readFileSync(readmePath, 'utf8');

// ─── Identity ────────────────────────────────────────────────────────────────
assert.match(deploySource, /Krave .* Inbox Triage Daily v2/, 'Expected v2 workflow name');
assert.match(deploySource, /workflow\("new", "Krave .* Inbox Triage Daily v2"\)/, 'Expected workflow() export with v2 name');
assert.match(deploySource, /EuT6REDs5PUaoycE/, 'Expected live v2 workflow id in header');

// ─── Credentials (newCredential by display name, no string-literal secrets) ────
assert.match(deploySource, /newCredential\("Gmail account"\)/, 'Expected Gmail credential by name');
assert.match(deploySource, /newCredential\("Krave Slack Bot"\)/, 'Expected Slack credential by name');
assert.match(deploySource, /newCredential\("OpenAi account"\)/, 'Expected OpenAI credential by name');
assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(deploySource), 'Expected no hardcoded API key literals');

// ─── Triggers ──────────────────────────────────────────────────────────────────
assert.match(deploySource, /"0 9 \* \* 1-5"/, 'Expected 9am weekday cron');
assert.match(deploySource, /path:\s*"krave-inbox-triage-v2"/, 'Expected v2 manual webhook path');

// ─── Node names that actually exist in v2 ──────────────────────────────────────
for (const nodeName of [
  'Search Unread Inbox',
  'Get Message Details',
  'Classify Email',
  'AI Classify',
  'Resolve Final Tier',
  'Apply EA Label',
  'Restore Email Metadata',
  'Create Draft',
  'Archive Email',
  'Build Slack Summary',
  'Post to #ops-command',
]) {
  assert.ok(deploySource.includes(`name: "${nodeName}"`), `Expected node "${nodeName}" in deploy script`);
}

// ─── Tier model ────────────────────────────────────────────────────────────────
assert.match(deploySource, /EA\/Urgent/, 'Expected urgent tier');
assert.match(deploySource, /EA\/Needs-Reply/, 'Expected needs-reply tier');
assert.match(deploySource, /EA\/FYI/, 'Expected FYI tier');
assert.match(deploySource, /EA\/Auto-Sorted/, 'Expected auto-sorted tier');
assert.match(deploySource, /EA\/Unsure/, 'Expected unsure tier');
assert.match(deploySource, /Return ONLY valid JSON/i, 'Expected structured AI classify instructions');

// ─── Mis-tiering fix: KNOWN contacts match the SENDER only, never the body ─────
assert.match(deploySource, /const senderHay = \(sender\.name \+ ' ' \+ sender\.email\)\.toLowerCase\(\);/, 'Expected sender-only haystack');
assert.match(deploySource, /KNOWN\.some\(k => senderHay\.includes\(k\)\)/, 'Expected KNOWN check to use senderHay, not the body haystack');
assert.ok(!/KNOWN\.some\(k => haystack\.includes\(k\)\)/.test(deploySource), 'Expected KNOWN check to NOT match against the full body haystack');
assert.match(deploySource, /'amanda', 'shin'/, 'Expected known-contact protection list');

// ─── Over-archiving fix: archive ONLY EA/FYI + EA/Auto-Sorted, never payments ──
assert.match(deploySource, /const ARCHIVABLE = \['EA\/FYI', 'EA\/Auto-Sorted'\];/, 'Expected archivable tiers limited to FYI + Auto-Sorted');
assert.match(deploySource, /const archive_ok = ARCHIVABLE\.includes\(orig\.tier\) && !isPayment;/, 'Expected archive_ok to gate on tier + payment exclusion');
assert.match(deploySource, /Label_5194298534623747326/, 'Expected client-payment label kept out of archiving');
assert.match(deploySource, /\{\{ \$json\.archive_ok \}\}/, 'Expected Archive? gate to test archive_ok');
assert.match(deploySource, /operation:\s*"removeLabels"[\s\S]*labelIds:\s*\["INBOX"\]/, 'Expected archive to remove INBOX label');

// ─── Output destination: audit summary to #ops-command, no Noa DM ──────────────
assert.match(deploySource, /value:\s*"C0AQZGJDR38"/, 'Expected #ops-command channel id');
assert.ok(!deploySource.includes('U06TBGX9L93'), 'Expected v2 to NOT DM Noa (no Noa user id in deploy script)');

// ─── Docs agree (cross-cutting) ────────────────────────────────────────────────
assert.match(workflowsDoc, /Inbox Triage Daily v2/, 'Expected workflow in WORKFLOWS.md');
assert.match(workflowsDoc, /EuT6REDs5PUaoycE/, 'Expected v2 id in WORKFLOWS.md');
assert.match(workflowsDoc, /archives only the noise tiers|EA\/FYI` \+ `EA\/Auto-Sorted/, 'Expected WORKFLOWS.md to document noise-only archiving');
assert.match(workflowsDoc, /does \*\*not\*\* DM Noa/, 'Expected WORKFLOWS.md to state no Noa DM');
assert.match(workflowsDoc, /actionable queue/i, 'Expected WORKFLOWS.md to document inbox-as-actionable-queue');

assert.match(readmeDoc, /Inbox Triage Daily v2/, 'Expected workflow in README');
assert.match(readmeDoc, /EuT6REDs5PUaoycE/, 'Expected v2 id in README');
assert.match(readmeDoc, /krave-inbox-triage-v2/, 'Expected v2 webhook path in README');
assert.match(readmeDoc, /archives \*\*only\*\* `EA\/FYI` \+ `EA\/Auto-Sorted`/, 'Expected README to document noise-only archiving');
assert.match(readmeDoc, /does \*\*not\*\* DM Noa/, 'Expected README to state no Noa DM');

console.log('Inbox triage daily v2 workflow contract check passed.');
