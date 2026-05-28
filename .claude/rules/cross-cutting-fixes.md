# Rule: Cross-Cutting Fix Consistency

## The Rule

When you fix a behavior in any skill, workflow, SOP, or bot prompt, you must identify every other file that contains or describes the same behavior and update them in the same round.

A fix is not complete until all related files agree.

## Where to Check

For any change to invoice, triage, or ops behavior, check all of the following that are relevant:

| Location | What lives there |
|----------|-----------------|
| `.claude/skills/[name]/SKILL.md` | Claude Code skill — step-by-step logic |
| `.agents/skills/[name]/SKILL.md` | Codex skill — same skill, agent-facing |
| `references/sops/[name].md` | SOP — operational source of truth |
| `n8n-workflows/deploy-[name].js` | n8n deploy script — live workflow code |
| `n8n-workflows/WORKFLOWS.md` | Workflow registry docs |
| `n8n-workflows/README.md` | Workflow index |
| `projects/krave-bot/system-prompt.js` | Slack bot behavior |
| `projects/ops-dashboard/server.js` | Ops dashboard API behavior |

## How to Apply

1. Before marking a fix done, ask: "Is this behavior described or implemented anywhere else?"
2. Search for related logic — by function name, behavior keyword, or channel/sheet reference.
3. Update every file where the old behavior exists — not just the one you were asked about.
4. If a file references the behavior but doesn't need changing, verify it and note it explicitly.

## Example

Fixing email CC recipients (noa + requester, never john):
- `.claude/skills/client-invoice-creation/SKILL.md` — manual fallback CC line
- `.agents/skills/client-invoice-creation/SKILL.md` — same
- `n8n-workflows/deploy-invoice-approval-polling.js` — `ccList` construction + requester sanitization
- `projects/krave-bot/system-prompt.js` — "Always CC" instruction
- `projects/ops-dashboard/server.js` — confirm `cc` field passthrough

All five must be consistent before the fix is considered done.
