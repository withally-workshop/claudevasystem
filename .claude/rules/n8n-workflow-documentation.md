# Rule: n8n Workflow Documentation

## When This Applies
Any time you create, deploy, or significantly modify an n8n workflow on `noatakhel.app.n8n.cloud`.

## Required Actions

### 1. Update `n8n-workflows/WORKFLOWS.md`
Add or update the workflow's section following the exact structure below. Never remove existing workflow sections — append or update only.

**Required sections for every workflow:**
- Row in the Workflow Index table (Name, ID, Status, Schedule, Purpose)
- `## Workflow N — [Name]` section containing:
  - n8n URL + deploy script path
  - Purpose (1–2 sentence plain English description)
  - Triggers table (schedule cron + webhook URL)
  - Node Flow (ASCII diagram matching actual node names in n8n)
  - Key logic explanation (matching, filtering, dedup — whatever applies)
  - Outputs table (scenario → what happens)
  - Error Handling table (failure point → behaviour)
- Row(s) in the Credential Reference table for any new credentials used

### 2. Update `n8n-workflows/README.md`
Add a row to the Workflows table and a `##` section with: purpose, webhook URL, deploy command, credentials required, workflow ID.

### 3. Update the deploy script
Ensure `GMAIL_CRED_ID`, `SHEETS_CRED_ID`, `SLACK_CRED_ID`, and any other credential IDs in the deploy script match what's documented in WORKFLOWS.md.

---

## WORKFLOWS.md Section Template

```markdown
## Workflow N — [Workflow Name]

**n8n URL:** `https://noatakhel.app.n8n.cloud/workflow/[ID]`
**Deploy script:** `n8n-workflows/deploy-[name].js`

### Purpose
[One or two sentences. Who it helps, what manual task it replaces, what it produces.]

### Triggers
| Type | Details |
|------|---------|
| Schedule | `[cron]` — [human-readable time in ICT] |
| Webhook | `POST https://noatakhel.app.n8n.cloud/webhook/[path]` |

### Node Flow
[ASCII diagram using actual node names as they appear in n8n]

### [Key Logic Section — name it appropriately]
[Explain the core logic: matching, filtering, classification, deduplication, etc.]

### Outputs
| Scenario | Action |
|----------|--------|
| [outcome] | [what happens] |

### Error Handling
| Failure | Behaviour |
|---------|-----------|
| [failure point] | [behaviour — note continueOnFail nodes] |
```

---

## Credential Documentation Rule
Any credential used in a new workflow must be added to the Credential Reference table in WORKFLOWS.md with: Name, Type, n8n ID, which workflow(s) use it, and which account/service it belongs to.

If Airwallex credentials are hardcoded (not stored as n8n credentials), note this explicitly with the rotation warning.

---

## Runbook Rule
If the new workflow introduces a new failure mode or operational scenario not already covered in the Runbook section, add a new entry describing: the symptom, the cause, and the resolution steps.

---

## Handover Checklist Rule
If the new workflow introduces a new access requirement (new credential type, new external service, new sheet/channel), add a checklist item to the Handover Checklist section in WORKFLOWS.md.
