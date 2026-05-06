# Krave Ops Dashboard

Internal live visibility surface for the Krave invoice automation system.

## Run

```powershell
cd projects/ops-dashboard
node server.js
```

Open `http://localhost:3000`.

## Env Vars

| Var | Required | Where used | Description |
|-----|----------|-----------|-------------|
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | local | local | Path to service account JSON (`C:\Users\jopso\Downloads\krave-ea-4ceace6542ec.json`) |
| `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` | render | render | Raw JSON contents of the service account key (paste in Render dashboard) |
| `N8N_API_KEY` | Yes | both | n8n public API key |
| `SLACK_BOT_TOKEN` | Yes | both | Krave Slack bot token |
| `GOOGLE_OAUTH_CLIENT_ID` | Yes (prod) | both | OAuth client ID from Google Cloud Console |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Yes (prod) | both | OAuth client secret |
| `SESSION_SECRET` | Yes (prod) | both | Random string for HMAC cookie signing (Render auto-generates) |
| `BASE_URL` | No | local | Override the auto-derived base URL (Render injects `RENDER_EXTERNAL_URL`) |
| `DISABLE_AUTH` | No | local | Set to `1` to bypass Google login for local dev |
| `PORT` | No | both | Defaults to 3000 |
| `HOST` | No | both | Defaults to `0.0.0.0` (was `127.0.0.1` in v1) |

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

Google login + email allowlist (hardcoded in `server.js`). For local dev set `DISABLE_AUTH=1` to bypass.

The allowlist:

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
- No historical metrics store

## Deploy to Render

`render.yaml` in this folder declares the service. One-time setup:

1. Push the repo (or just this folder + repo root) to GitHub.
2. In Render → **New +** → **Blueprint** → point at the repo. It reads `projects/ops-dashboard/render.yaml`.
3. Fill in the env vars in the Render dashboard:
   - `N8N_API_KEY` — from `.env`
   - `SLACK_BOT_TOKEN` — from `.env`
   - `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` — paste full JSON contents of `krave-ea-4ceace6542ec.json`
   - `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` — create in [Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID](https://console.cloud.google.com/apis/credentials) → application type "Web application" → authorized redirect URI: `https://krave-ops-dashboard.onrender.com/auth/callback` (replace with your final URL)
   - `SESSION_SECRET` — Render auto-generates
4. After first deploy, copy the live URL and add it as the OAuth client's authorized redirect URI if it differs from the placeholder.

Subsequent deploys: push to the linked branch, Render redeploys automatically.
