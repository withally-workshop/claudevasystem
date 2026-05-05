# Rule: Skill and Workflow Creation Checklist

## When This Applies
Any time you create a new Claude skill or n8n workflow for this project — including new automations, new trigger skills, and new reporting/summary workflows.

---

## Required Actions for Every New n8n Workflow

### 1. Deploy script
Create `n8n-workflows/deploy-[name].js`. Follow the credential ID pattern from existing deploy scripts (same `SHEETS_CRED_ID`, `SLACK_CRED_ID`, etc.). No secrets as string literals — all API keys via `process.env`.

### 2. `n8n-workflows/WORKFLOWS.md`
Follow the template in `.claude/rules/n8n-workflow-documentation.md` exactly:
- Add row to the Workflow Index table
- Add full `## Workflow N — [Name]` section
- Add runbook entry under "Common Scenarios"
- Add deploy script line to "Redeploy workflows from scratch"
- Add credential row(s) to Credential Reference if new credentials used

### 3. `n8n-workflows/README.md`
- Add row to the Workflows table
- Add a `##` section with: purpose, webhook URL, deploy command, credentials required, workflow ID

### 4. Claude Code skill — `.claude/skills/[name]/SKILL.md`
Create the skill file. Required sections:
- Trigger phrases and manual invocation commands
- Purpose (what it replaces, what it does)
- Key data (sheet IDs, channel IDs, schedule, webhook URL)
- Core logic (buckets, rules, dedup, etc.)
- Output format

### 5. Codex skill — `.agents/skills/[name]/SKILL.md`
Create the codex skill file with frontmatter:
```yaml
---
name: [name]
description: [trigger phrases and what it does — this is what the agent uses for routing]
metadata:
  short-description: [5-word summary]
---
```
Content should cover: how to trigger (webhook URL or MCP calls), what it outputs, and link back to the Claude Code skill and deploy script.

### 6. `.agents/skills/claude-ea-workflows/SKILL.md`
Register the new skill in both tables:
- **Project Skill Map** — add row with trigger phrases, skill file paths (both `.claude/` and `.agents/`), and description
- **n8n Automation Map** — add row with automation name, related skills, and trigger pattern

---

## Required Actions for Every New Claude Skill (no workflow)

Steps 4, 5, and 6 above. Plus: if the skill reads from or writes to the tracker, document the relevant columns.

---

## Invocation Parity Rule

Every skill in this project must be invocable from **both** Claude Code and Codex:
- Claude Code: `.claude/skills/[name]/SKILL.md`
- Codex: `.agents/skills/[name]/SKILL.md`
- Registered in: `.agents/skills/claude-ea-workflows/SKILL.md`

If you create one without the other, the checklist is incomplete.

---

## After Deploy

Update the workflow ID placeholder in WORKFLOWS.md and README.md with the real ID returned by the deploy script. Never leave `TBD` in production docs.
