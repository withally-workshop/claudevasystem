#!/usr/bin/env node
'use strict';

/**
 * Doc-sync reminder hook (PostToolUse: Edit | Write | MultiEdit).
 *
 * Purpose: stop documentation drift. When a file that belongs to a "synced
 * family" is edited, this injects a reminder (additionalContext) listing the
 * sibling files that must be kept consistent — per .claude/rules/cross-cutting-fixes.md.
 *
 * It does NOT block. It only nudges, deterministically, on every relevant edit.
 * If the edited file isn't in any synced area, it exits silently (no noise).
 *
 * Reads the PostToolUse JSON payload on stdin; writes a JSON result on stdout.
 */

// ── Explicit synced families: edit any member → remember the rest ──────────────
const FAMILIES = [
  {
    name: 'Creator Invoice Processing',
    files: [
      'n8n-workflows/deploy-creator-invoice-email-scan.js',
      '.claude/skills/creator-invoice-processing/SKILL.md',
      '.agents/skills/creator-invoice-processing/SKILL.md',
      'references/sops/creator-invoice-management.md',
      'n8n-workflows/WORKFLOWS.md',
      'n8n-workflows/README.md',
    ],
  },
  // Add more families here as you formalize them, e.g. payment-detection,
  // client-invoice-creation, inbox-triage. Same shape: { name, files: [...] }.
];

function readStdin() {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.on('data', (c) => (raw += c));
    process.stdin.on('end', () => resolve(raw));
    // If nothing is piped, don't hang forever.
    setTimeout(() => resolve(raw), 2000);
  });
}

function emit(additionalContext) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext },
    suppressOutput: true,
  }));
  process.exit(0);
}

(async () => {
  let data = {};
  try { data = JSON.parse((await readStdin()) || '{}'); } catch (_) { process.exit(0); }

  const ti = data.tool_input || {};
  const tr = data.tool_response || {};
  let fp = ti.file_path || ti.filePath || tr.filePath || '';
  if (!fp) process.exit(0);

  const norm = String(fp).replace(/\\/g, '/');
  const lower = norm.toLowerCase();
  const endsWithRel = (rel) => lower.endsWith(rel.toLowerCase());

  const reminders = [];

  // 1) Explicit families
  for (const fam of FAMILIES) {
    if (fam.files.some(endsWithRel)) {
      const siblings = fam.files.filter((f) => !endsWithRel(f));
      reminders.push(
        `You edited a file in the "${fam.name}" synced set. ` +
        `Per .claude/rules/cross-cutting-fixes.md, the fix is not done until these agree — ` +
        `verify/update each:\n- ${siblings.join('\n- ')}`
      );
    }
  }

  // 2) Generic rules (only if no explicit family already matched)
  if (!reminders.length) {
    // Skill parity: .claude/skills/<name> <-> .agents/skills/<name>
    let m = norm.match(/\.claude\/skills\/([^/]+)\//i);
    if (m) reminders.push(`Skill edited. Keep Codex parity: update .agents/skills/${m[1]}/SKILL.md to match, and check the related SOP (references/sops/) + n8n deploy script + WORKFLOWS.md/README.md.`);
    m = norm.match(/\.agents\/skills\/([^/]+)\//i);
    if (m) reminders.push(`Codex skill edited. Keep Claude Code parity: update .claude/skills/${m[1]}/SKILL.md to match, and check the related SOP + n8n deploy script + WORKFLOWS.md/README.md.`);

    // n8n deploy script -> docs
    m = norm.match(/n8n-workflows\/deploy-([^/]+)\.js$/i);
    if (m) reminders.push(`n8n deploy script edited. Update n8n-workflows/WORKFLOWS.md + n8n-workflows/README.md, and the matching skill (.claude + .agents) + SOP. Re-validate node flow, schedule, and credential IDs against the script.`);

    // SOP -> skills + workflow docs
    m = norm.match(/references\/sops\/([^/]+)\.md$/i);
    if (m) reminders.push(`SOP edited. Reconcile the matching skill (.claude/skills + .agents/skills) and any n8n workflow docs (WORKFLOWS.md/README.md) so behavior descriptions match.`);

    // n8n registry docs -> implementation
    if (endsWithRel('n8n-workflows/workflows.md') || endsWithRel('n8n-workflows/readme.md'))
      reminders.push(`n8n workflow docs edited. Confirm the deploy script(s), the related skill (.claude + .agents), and the SOP describe the same behavior.`);

    // bot / dashboard behavior files (from the cross-cutting rule)
    if (endsWithRel('projects/krave-bot/system-prompt.js') || endsWithRel('projects/ops-dashboard/server.js'))
      reminders.push(`Bot/dashboard behavior edited. Per .claude/rules/cross-cutting-fixes.md, check the matching skill, SOP, and n8n deploy script for the same behavior.`);
  }

  if (!reminders.length) process.exit(0);
  emit('[doc-sync] ' + reminders.join('\n\n'));
})();
