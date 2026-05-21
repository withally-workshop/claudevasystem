# Crave Media — TikTok Creator Outreach Pipeline

## Overview

Two-phase pipeline: TikTok creator discovery → niche classification → Google Sheet (Phase 1), then email outreach via `ivana@kravemedia.co` (Phase 2).

**Sheet:** [Crave Creator Outreach](https://docs.google.com/spreadsheets/d/1eLQrDP3IX9ec9dtFN0UyRdlTplzkLfRG9Asyqj1gLrI/edit)

## Actor Selection

**Chosen: `clockworks/tiktok-scraper`**

Compared against `apidojo/tiktok-scraper` on 2026-05-21:
- clockworks: 78 profiles returned, real emails found, correct schema
- apidojo: 0 results (search API returned `noResults: true`)

**Key note:** clockworks returns video items, not profile items. Each video's `authorMeta` sub-object contains the full creator profile (handle, bio, followers, etc.). The pipeline deduplicates by handle and merges captions across multiple videos from the same creator.

**Input quirk:** `resultsPerPage` must be set explicitly — the actor's default is 1. The pipeline sets it to `max_results`.

## Setup

1. Copy `.env.example` to `.env` and fill in all values.
2. Ensure Google service account JSON is at the path in `GOOGLE_SERVICE_ACCOUNT_JSON`.
3. Share the Sheet with `krave-ea@krave-ea.iam.gserviceaccount.com` (Editor).
4. Install dependencies: `pip install -r requirements.txt`
5. `actor_id` is already set in `config.yaml` — no further setup needed.

## Usage

```bash
# Phase 1 — Scrape → Enrich → Sheet
python src/main.py --search-term "UGC creator" --max-results 500

# Phase 1 dry run (no Sheet write)
python src/main.py --search-term "UGC creator" --max-results 100 --dry-run

# Phase 2 — Send outreach emails to approved rows (100/day cap)
python src/main.py --outreach-only --max-sends 100

# Phase 2 dry run (prints emails, no sending)
python src/main.py --outreach-only --max-sends 10 --dry-run
```

## Pipeline Steps

### Phase 1 — Discovery

1. **Scrape** — Apify `clockworks/tiktok-scraper` fetches TikTok videos matching search term via US residential proxy. `authorMeta` extracted per video, deduped by handle in-memory.
2. **Enrich** — Claude Haiku classifies niche + extracts first name (file-cached by handle to avoid redundant API calls).
3. **Dedupe** — dedup by handle, then by email; keep higher-follower row on email conflict.
4. **Sheet upsert** — idempotent write to Google Sheet; existing handles are updated (cols A–N only), new handles are appended.

### Phase 2 — Outreach

5. **Outreach** — `outreach.py` reads Sheet rows where `status=approved` and `outreach_sent_at` is blank. Sends personalised email via `ivana@kravemedia.co` Gmail API (service account domain-wide delegation). 30s delay between sends, 100/day cap. On success: writes `outreach_sent_at`, sets `status=outreach_sent`. On error: sets `status=error`, logs in `notes`.

## Validation Gate

Noa manually reviews the Sheet and flips `status: new` → `status: approved` on rows to contact. The pipeline never auto-approves rows.

## Email Template

Default template in `src/outreach.py` (`DEFAULT_BODY`). Edit to match Noa's approved copy once received. Personalised by `{first_name}`, `{handle}`, `{niche}`.

## Search Terms

Configured in `config.yaml`. Current set:
- `"UGC creator"` — primary
- `"content creator"`, `"UGC"` — supplementary (run separately)

## Sheet Columns

`handle` | `profile_url` | `email` | `first_name` | `followers` | `following` | `bio` | `niche` | `niche_confidence` | `region_signal` | `last_3_captions` | `link_in_bio` | `role_based_email` | `scraped_at` | `status` | `notes` | `outreach_sent_at` | `replied_at` | `bounced`

## Costs

- **Apify:** ~$0.005 per 100 profiles scraped (clockworks actor, free tier $5/month credit)
- **Claude Haiku:** ~$0.001 per 100 profiles enriched (cached — re-runs only for new handles)
- **Gmail sending:** free via Google Workspace service account impersonation
