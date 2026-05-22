import json
import os
import re
import time
from datetime import datetime, timezone

import requests
import yaml
from dotenv import load_dotenv

load_dotenv()

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
ROLE_PREFIXES = {"info", "contact", "hello", "support", "admin", "team", "pr", "business", "collab"}
LINKTREE_RE = re.compile(r"https?://(linktr\.ee|beacons\.ai|bio\.link|linkinbio\.com)/\S+", re.IGNORECASE)
US_SIGNALS = {
    "united states", "usa", "u.s.a", "u.s.",
    # states (full)
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
    "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
    "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana",
    "maine", "maryland", "massachusetts", "michigan", "minnesota",
    "mississippi", "missouri", "montana", "nebraska", "nevada",
    "new hampshire", "new jersey", "new mexico", "new york",
    "north carolina", "north dakota", "ohio", "oklahoma", "oregon",
    "pennsylvania", "rhode island", "south carolina", "south dakota",
    "tennessee", "texas", "utah", "vermont", "virginia", "washington",
    "west virginia", "wisconsin", "wyoming",
    # major cities
    "los angeles", "chicago", "houston", "phoenix", "philadelphia",
    "san antonio", "san diego", "dallas", "san jose", "austin",
    "jacksonville", "san francisco", "columbus", "charlotte", "fort worth",
    "indianapolis", "seattle", "denver", "nashville", "portland",
    "las vegas", "memphis", "louisville", "baltimore", "milwaukee",
    "albuquerque", "tucson", "fresno", "sacramento", "mesa",
    "miami", "atlanta", "minneapolis", "boston", "raleigh",
    "new orleans", "cleveland", "tampa", "pittsburgh", "cincinnati",
}

NL_SIGNALS = {
    "netherlands", "nederland", "holland", "nl",
    # provinces
    "noord-holland", "zuid-holland", "utrecht", "gelderland", "overijssel",
    "friesland", "groningen", "drenthe", "zeeland", "limburg", "flevoland",
    "noord-brabant",
    # major cities
    "amsterdam", "rotterdam", "den haag", "the hague", "eindhoven",
    "groningen", "tilburg", "almere", "breda", "nijmegen", "enschede",
    "haarlem", "arnhem", "zaanstad", "amersfoort", "apeldoorn",
    "s-hertogenbosch", "maastricht", "leiden", "dordrecht", "zoetermeer",
}

# Pattern: "City, ST" — two uppercase letters after a comma (US city/state format)
US_STATE_ABBR_RE = re.compile(r",\s*[A-Z]{2}\b")


def load_config(config_path="config.yaml"):
    with open(config_path) as f:
        return yaml.safe_load(f)


def _extract_email(bio: str) -> tuple[str | None, bool]:
    """Returns (email, is_role_based). Returns (None, False) if no email found."""
    if not bio:
        return None, False
    match = EMAIL_RE.search(bio)
    if not match:
        return None, False
    email = match.group(0).lower()
    local = email.split("@")[0]
    is_role = local in ROLE_PREFIXES
    return email, is_role


def _extract_link_in_bio(bio: str) -> str | None:
    if not bio:
        return None
    match = LINKTREE_RE.search(bio)
    return match.group(0) if match else None


def _region_signal(profile: dict) -> str | None:
    """Best-effort region detection (US or NL) from location fields + bio text."""
    location = (profile.get("location") or profile.get("region") or "").lower()
    bio = (profile.get("signature") or profile.get("bio") or "").lower()
    combined = f"{location} {bio}"
    for sig in US_SIGNALS:
        if sig in combined:
            return "US"
    # Catch "City, ST" abbreviation pattern (e.g. "Denver, CO", "Austin, TX")
    if US_STATE_ABBR_RE.search(profile.get("signature") or profile.get("bio") or ""):
        return "US"
    for sig in NL_SIGNALS:
        if sig in combined:
            return "NL"
    return None


def _last_3_captions(profile: dict) -> str | None:
    videos = profile.get("latestVideos") or profile.get("videos") or []
    captions = [v.get("text") or v.get("desc") or "" for v in videos[:3] if isinstance(v, dict)]
    captions = [c for c in captions if c]
    return " | ".join(captions) if captions else None


def _normalise_profile(raw: dict, actor_id: str) -> dict:
    """Map raw Apify item to a normalised internal schema.

    Handles two layouts:
    - Profile-first (apidojo): top-level fields like uniqueId, fans, signature
    - Video-first (clockworks): top-level video fields with authorMeta sub-object
    """
    # clockworks returns video items with authorMeta containing the creator profile
    author = raw.get("authorMeta") or {}
    is_video_layout = bool(author)

    if is_video_layout:
        bio = author.get("signature") or ""
        handle = author.get("name") or author.get("uniqueId") or ""
        followers = author.get("fans") or author.get("followerCount") or 0
        following = author.get("following") or 0
        profile_url = author.get("profileUrl") or (f"https://www.tiktok.com/@{handle}" if handle else "")
        region_src = author
        # Captions come from the video text field (one per item — caller dedupes by author)
        captions_raw = [raw.get("text") or ""]
    else:
        bio = raw.get("signature") or raw.get("bioLink") or raw.get("bio") or ""
        handle = raw.get("uniqueId") or raw.get("username") or raw.get("handle") or ""
        followers = raw.get("fans") or raw.get("followerCount") or raw.get("followers") or 0
        following = raw.get("following") or raw.get("followingCount") or 0
        profile_url = (f"https://www.tiktok.com/@{handle}" if handle else
                       raw.get("url") or raw.get("profileUrl") or "")
        region_src = raw
        captions_raw = []

    email, role_based = _extract_email(bio)
    link_in_bio = _extract_link_in_bio(bio)
    region_signal = _region_signal(region_src)

    return {
        "handle": handle,
        "profile_url": profile_url,
        "email": email,
        "followers": followers,
        "following": following,
        "bio": bio,
        "region_signal": region_signal,
        "last_3_captions": " | ".join(c for c in captions_raw if c) or None,
        "link_in_bio": link_in_bio,
        "role_based_email": role_based,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "_actor": actor_id,
        "_raw": raw,
    }


def _build_run_input(actor_id: str, search_term: str, max_results: int, cfg: dict, proxy_country: str = "US") -> dict:
    """Build actor-specific run input. Adapt as schemas differ."""
    if "clockworks" in actor_id:
        return {
            "searchQueries": [search_term],
            "maxProfilesPerQuery": max_results,
            "resultsPerPage": max_results,       # must be set explicitly; default is 1
            "shouldDownloadVideos": False,
            "shouldDownloadCovers": False,
            "shouldDownloadAvatars": False,
            "proxyCountryCode": proxy_country,
            "videoSearchSorting": "MOST_RELEVANT",
        }
    elif "apidojo" in actor_id:
        return {
            "keywords": [search_term],
            "maxItems": max_results,
            "proxyCountryCode": proxy_country,
        }
    else:
        return {
            "searchQueries": [search_term],
            "maxProfilesPerQuery": max_results,
        }


APIFY_BASE = "https://api.apify.com/v2"
POLL_INTERVAL = 10  # seconds between status checks
TERMINAL_STATUSES = {"SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"}


def _apify_post(path: str, token: str, body: dict) -> dict:
    resp = requests.post(
        f"{APIFY_BASE}{path}",
        params={"token": token},
        json=body,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def _apify_get(path: str, token: str, params: dict | None = None) -> dict:
    resp = requests.get(
        f"{APIFY_BASE}{path}",
        params={"token": token, **(params or {})},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def _wait_for_run(run_id: str, token: str) -> dict:
    while True:
        data = _apify_get(f"/actor-runs/{run_id}", token)
        run = data.get("data", {})
        status = run.get("status", "")
        print(f"[scrape] Run {run_id} status: {status}")
        if status in TERMINAL_STATUSES:
            return run
        time.sleep(POLL_INTERVAL)


def _get_dataset_items(dataset_id: str, token: str, limit: int = 1000) -> list[dict]:
    items = []
    offset = 0
    while True:
        data = _apify_get(
            f"/datasets/{dataset_id}/items",
            token,
            params={"limit": min(limit - offset, 1000), "offset": offset},
        )
        chunk = data if isinstance(data, list) else data.get("items", [])
        items.extend(chunk)
        if len(chunk) < 1000 or len(items) >= limit:
            break
        offset += len(chunk)
    return items[:limit]


def run_actor(
    actor_id: str,
    search_term: str,
    max_results: int,
    cfg: dict,
    token: str | None = None,
    proxy_country: str = "US",
) -> list[dict]:
    """
    Run an Apify actor via REST API and return a list of normalised profile dicts.
    Uses requests directly to avoid apify-client SDK versioning issues.
    """
    token = token or os.environ["APIFY_TOKEN"]
    run_input = _build_run_input(actor_id, search_term, max_results, cfg, proxy_country=proxy_country)

    actor_slug = actor_id.replace("/", "~")
    print(f"[scrape] Starting actor {actor_id!r} | search={search_term!r} | max={max_results}")

    resp = _apify_post(f"/acts/{actor_slug}/runs", token, run_input)
    run_id = resp.get("data", {}).get("id")
    if not run_id:
        print(f"[scrape] ERROR: could not start actor {actor_id}: {resp}")
        return []

    run = _wait_for_run(run_id, token)
    if run.get("status") != "SUCCEEDED":
        print(f"[scrape] ERROR: actor finished with status {run.get('status')}")
        return []

    dataset_id = run.get("defaultDatasetId")
    if not dataset_id:
        print(f"[scrape] ERROR: no dataset ID in run result")
        return []

    raw_items = _get_dataset_items(dataset_id, token, limit=max_results * 5)
    print(f"[scrape] Got {len(raw_items)} raw items from {actor_id}")

    profiles = [_normalise_profile(item, actor_id) for item in raw_items]

    # Deduplicate by handle — video-layout actors return multiple rows per creator.
    # Keep the row with the highest follower count; merge captions across duplicates.
    seen: dict[str, dict] = {}
    for p in profiles:
        handle = (p.get("handle") or "").lower()
        if not handle:
            continue
        if handle not in seen or (p["followers"] or 0) > (seen[handle]["followers"] or 0):
            seen[handle] = p
        else:
            # Merge captions
            existing_caps = seen[handle].get("last_3_captions") or ""
            new_caps = p.get("last_3_captions") or ""
            if new_caps and new_caps not in existing_caps:
                parts = [c for c in [existing_caps, new_caps] if c]
                seen[handle]["last_3_captions"] = " | ".join(parts)[:1000]

    profiles = list(seen.values())
    print(f"[scrape] After dedup by handle: {len(profiles)} unique creators")

    cfg_apify = cfg.get("apify", {})
    min_f = cfg_apify.get("min_followers", 1000)
    max_f = cfg_apify.get("max_followers", 500000)
    before = len(profiles)
    profiles = [p for p in profiles if min_f <= (p["followers"] or 0) <= max_f]
    print(f"[scrape] After follower filter ({min_f}–{max_f}): {len(profiles)} / {before}")

    return profiles


def scrape_to_file(
    actor_id: str,
    search_term: str,
    max_results: int,
    out_path: str = "data/raw_profiles.json",
    cfg_path: str = "config.yaml",
) -> list[dict]:
    cfg = load_config(cfg_path)
    profiles = run_actor(actor_id, search_term, max_results, cfg)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(profiles, f, indent=2, default=str)
    print(f"[scrape] Saved {len(profiles)} profiles to {out_path}")
    return profiles


if __name__ == "__main__":
    import sys
    actor = sys.argv[1] if len(sys.argv) > 1 else "clockworks/tiktok-scraper"
    term = sys.argv[2] if len(sys.argv) > 2 else "UGC creator"
    n = int(sys.argv[3]) if len(sys.argv) > 3 else 50
    scrape_to_file(actor, term, n)
