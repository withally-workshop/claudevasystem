"""
main.py — pipeline orchestrator
Usage:
  python src/main.py --search-term "UGC creator" --max-results 100 --dry-run
  python src/main.py --search-term "UGC creator" --max-results 500
  python src/main.py --hashtag ugcnederland --max-results 200 --region NL
"""
import argparse
import json
import os
import sys

import requests
import yaml
from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, os.path.dirname(__file__))

from dedupe import dedupe_profiles
from enrich import enrich_profiles
from outreach import run_outreach
from scrape import load_config, run_actor
from sheets import upsert_profiles


def parse_args():
    p = argparse.ArgumentParser(description="Crave Media TikTok creator pipeline")
    p.add_argument("--search-term", help='Search term, e.g. "UGC creator"')
    p.add_argument("--max-results", type=int, default=100)
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Skip Sheet write / email send; print results locally instead",
    )
    p.add_argument("--config", default="config.yaml")
    p.add_argument("--actor-id", default=None, help="Override actor_id from config.yaml")
    p.add_argument(
        "--outreach-only",
        action="store_true",
        help="Skip scrape/enrich; only send outreach to approved Sheet rows",
    )
    p.add_argument("--max-sends", type=int, default=100, help="Max emails to send per run (outreach mode)")
    p.add_argument(
        "--region",
        default="US",
        choices=["US", "NL"],
        help="Target region — sets proxy country and follower floor (default: US)",
    )
    p.add_argument(
        "--hashtag",
        default=None,
        help="Scrape by hashtag instead of keyword (e.g. ugcnederland). Uses clockworks/tiktok-hashtag-scraper.",
    )
    return p.parse_args()


def _slack_notify(text: str):
    """Post a message to #krave-creator-outreach. Silently skips if token not set."""
    token = os.environ.get("SLACK_BOT_TOKEN")
    channel = os.environ.get("SLACK_OUTREACH_CHANNEL", "C0B5MQF50RX")
    if not token:
        return
    try:
        requests.post(
            "https://slack.com/api/chat.postMessage",
            headers={"Authorization": f"Bearer {token}"},
            json={"channel": channel, "text": text},
            timeout=10,
        )
    except Exception:
        pass  # Never block the pipeline on a Slack failure


def main():
    args = parse_args()
    cfg = load_config(args.config)

    if args.outreach_only:
        print(f"\n[main] === Crave Outreach — Email Mode ===")
        print(f"[main] max_sends = {args.max_sends}")
        print(f"[main] dry_run   = {args.dry_run}")
        print()
        run_outreach(max_sends=args.max_sends, dry_run=args.dry_run)
        return

    # --hashtag mode: use clockworks/tiktok-hashtag-scraper
    if args.hashtag:
        actor_id = args.actor_id or "clockworks/tiktok-hashtag-scraper"
        search_term = args.hashtag.lstrip("#")
        label = f"#{search_term}"
    else:
        if not args.search_term:
            print("ERROR: --search-term or --hashtag is required unless --outreach-only is set.")
            sys.exit(1)
        actor_id = args.actor_id or cfg.get("apify", {}).get("actor_id") or ""
        if not actor_id:
            print("ERROR: actor_id is not set in config.yaml.")
            sys.exit(1)
        search_term = args.search_term
        label = f'"{search_term}"'

    region = args.region.upper()
    region_cfg = cfg.get("regions", {}).get(region, {})
    proxy_country = region_cfg.get("proxy_country", region)
    if region_cfg.get("min_followers"):
        cfg.setdefault("apify", {})["min_followers"] = region_cfg["min_followers"]
    if region_cfg.get("max_followers"):
        cfg.setdefault("apify", {})["max_followers"] = region_cfg["max_followers"]

    print(f"\n[main] === Crave Outreach Pipeline ===")
    print(f"[main] search      = {label}")
    print(f"[main] max_results = {args.max_results}")
    print(f"[main] actor_id    = {actor_id}")
    print(f"[main] region      = {region} (proxy: {proxy_country})")
    print(f"[main] dry_run     = {args.dry_run}")
    print()

    # Step 1: Scrape
    raw_profiles = run_actor(actor_id, search_term, args.max_results, cfg, proxy_country=proxy_country)
    if not raw_profiles:
        print("[main] No profiles returned. Exiting.")
        sys.exit(0)

    # Save raw to file for inspection
    os.makedirs("data", exist_ok=True)
    with open("data/raw_profiles.json", "w") as f:
        json.dump(raw_profiles, f, indent=2, default=str)
    print(f"[main] Raw profiles saved to data/raw_profiles.json ({len(raw_profiles)} items)")

    # Step 2: Enrich
    enriched = enrich_profiles(raw_profiles, cfg)

    # Step 3: Dedupe
    deduped = dedupe_profiles(enriched)

    # Step 4: Output
    if args.dry_run:
        print(f"\n[main] DRY RUN — Sheet write skipped. {len(deduped)} profiles ready.")
        print("\nSample output (first 3):")
        for p in deduped[:3]:
            display = {k: v for k, v in p.items() if k not in ("_raw", "_actor")}
            print(json.dumps(display, indent=2, default=str))
    else:
        upsert_profiles(deduped, cfg)
        with_email = sum(1 for p in deduped if p.get("email"))
        _slack_notify(
            f"*Scrape complete* — {label} ({region})\n"
            f"• {len(deduped)} creators scraped  |  {with_email} with email\n"
            f"• Review in <https://docs.google.com/spreadsheets/d/1eLQrDP3IX9ec9dtFN0UyRdlTplzkLfRG9Asyqj1gLrI/edit|Sheet> — flip `status` to `approved` to queue for outreach"
        )

    print(f"\n[main] Done. Final profile count: {len(deduped)}")


if __name__ == "__main__":
    main()
