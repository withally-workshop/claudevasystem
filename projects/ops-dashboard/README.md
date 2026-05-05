# Krave Ops Dashboard

Internal live visibility surface for the Krave invoice automation system.

## Run

```powershell
cd projects/ops-dashboard
node server.js
```

Open `http://localhost:3000`.

## Env Vars

| Var | Required | Description |
|-----|----------|-------------|
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | Yes | Path to the service account JSON — same file the MCP servers use: `C:\Users\jopso\Downloads\krave-ea-4ceace6542ec.json` |
| `N8N_API_KEY` | Yes | n8n public API key — get from n8n account settings |
| `SLACK_BOT_TOKEN` | Yes | Krave Slack bot token — already set in your shell from MCP config |
| `PORT` | No | Override default port 3000 |

All keys except `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` are already in the repo's `.env`. Run from the repo root:

```powershell
# From c:\Users\jopso\Desktop\claude-ea
Get-Content .env | ForEach-Object { if ($_ -match '^([^#=]+)=(.+)$') { [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2]) } }
$env:GOOGLE_SERVICE_ACCOUNT_KEY_FILE = "C:\Users\jopso\Downloads\krave-ea-4ceace6542ec.json"
node projects/ops-dashboard/server.js
```

Or add them to a `.env.local` file (not committed) and source it.

## Cache

Data is cached server-side for 5 minutes. Click **↻ Refresh** to force a live fetch.

## Access

v1 is localhost-only. The allowlist (for future hosted deployment with Google OAuth) is hardcoded in `server.js`:

- noa@kravemedia.co
- john@kravemedia.co
- amanda@kravemedia.co
- jeneena@kravemedia.co
- sybil@kravemedia.co
- shin@kravemedia.co

## Dashboard Sections

1. **At a Glance** — scorecard row: drafts, sent/awaiting, reminders, replies, paid-after-follow-up, complete, overdue, collections
2. **Next Follow-Ups Queue** — top 10 open invoices with next reminder date, late-fee date, and owner
3. **Workflow Health** — n8n execution totals, failed workflows, stale active workflows
4. **Action Queue** — invoices needing manual intervention
5. **Tracker Status Breakdown** — counts by payment status + data quality flags
6. **Source Links** — direct links to Google Sheets, n8n, and Slack channels

## Non-Goals (v1)

- No write-back to Sheets, Slack, or n8n
- No deep-link invoice drilldowns (v2)
- No hosted deployment / Google OAuth (v2)
- No historical metrics store
