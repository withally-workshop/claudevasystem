"""
Step 3: Actor comparison test.
Runs both Apify actors with 50 profiles each, search "UGC creator".
Prints schema comparison to help pick the better actor.
Run from the crave-outreach/ root: python tests/compare_actors.py
"""
import json
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv()

from src.scrape import load_config, run_actor

ACTORS = [
    "clockworks/tiktok-scraper",
    "apidojo/tiktok-scraper",
]
SEARCH_TERM = "UGC creator"
MAX_RESULTS = 50


def analyse(profiles: list[dict], actor_id: str):
    total = len(profiles)
    with_email = sum(1 for p in profiles if p.get("email"))
    with_link = sum(1 for p in profiles if p.get("link_in_bio"))
    us_signal = sum(1 for p in profiles if p.get("region_signal") == "US")
    role_based = sum(1 for p in profiles if p.get("role_based_email"))
    with_captions = sum(1 for p in profiles if p.get("last_3_captions"))

    raw_keys: Counter = Counter()
    for p in profiles:
        raw_keys.update(p.get("_raw", {}).keys())

    print(f"\n{'='*60}")
    print(f"Actor: {actor_id}")
    print(f"{'='*60}")
    print(f"  Profiles returned : {total}")
    print(f"  Has email in bio  : {with_email} ({with_email/total*100:.0f}%)" if total else "  n/a")
    print(f"  Has link-in-bio   : {with_link} ({with_link/total*100:.0f}%)" if total else "  n/a")
    print(f"  US region signal  : {us_signal} ({us_signal/total*100:.0f}%)" if total else "  n/a")
    print(f"  Role-based email  : {role_based}")
    print(f"  Has captions      : {with_captions} ({with_captions/total*100:.0f}%)" if total else "  n/a")
    print(f"\n  Raw schema keys (top 20):")
    for key, count in raw_keys.most_common(20):
        print(f"    {key}: {count}/{total}")

    sample = next((p for p in profiles if p.get("email")), profiles[0] if profiles else {})
    print(f"\n  Sample normalised profile:")
    sample_display = {k: v for k, v in sample.items() if k != "_raw"}
    print(json.dumps(sample_display, indent=4, default=str))

    return {
        "actor": actor_id,
        "total": total,
        "email_rate": with_email / total if total else 0,
        "us_rate": us_signal / total if total else 0,
        "caption_rate": with_captions / total if total else 0,
    }


def main():
    cfg = load_config("config.yaml")
    results = []

    for actor_id in ACTORS:
        try:
            profiles = run_actor(actor_id, SEARCH_TERM, MAX_RESULTS, cfg)
            out_path = f"data/raw_{actor_id.replace('/', '_')}.json"
            os.makedirs("data", exist_ok=True)
            with open(out_path, "w") as f:
                json.dump(profiles, f, indent=2, default=str)
            print(f"[compare] Saved raw output to {out_path}")
            stats = analyse(profiles, actor_id)
            results.append(stats)
        except Exception as e:
            print(f"[compare] ERROR running {actor_id}: {e}")
            results.append({"actor": actor_id, "error": str(e)})

    print(f"\n{'='*60}")
    print("COMPARISON SUMMARY")
    print(f"{'='*60}")
    for r in results:
        if "error" in r:
            print(f"  {r['actor']}: FAILED — {r['error']}")
        else:
            print(f"  {r['actor']}:")
            print(f"    email rate  = {r['email_rate']*100:.0f}%")
            print(f"    US signal   = {r['us_rate']*100:.0f}%")
            print(f"    captions    = {r['caption_rate']*100:.0f}%")

    print("\nReview the output above, pick the actor, then:")
    print("  1. Set actor_id in config.yaml")
    print("  2. Update README.md with the choice and rationale")


if __name__ == "__main__":
    main()
