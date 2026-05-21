import json
import os
from pathlib import Path

import anthropic
from dotenv import load_dotenv

load_dotenv()

NICHES = ["beauty", "fashion", "fitness", "food", "tech", "lifestyle", "parenting", "business", "other"]

SYSTEM_PROMPT = """You are a TikTok creator classification assistant. For each creator, return JSON with exactly these fields:
- niche: one of beauty, fashion, fitness, food, tech, lifestyle, parenting, business, other
- niche_confidence: float 0.0 to 1.0
- first_name: string or null (extract from handle or bio, e.g. CharlotteUGC → Charlotte, "content by maya" → Maya)

Respond ONLY with valid JSON. No explanation."""

USER_TEMPLATE = """Handle: {handle}
Bio: {bio}
Recent captions: {captions}"""


def _load_cache(cache_path: str) -> dict:
    p = Path(cache_path)
    if p.exists():
        try:
            return json.loads(p.read_text())
        except json.JSONDecodeError:
            return {}
    return {}


def _save_cache(cache: dict, cache_path: str):
    Path(cache_path).parent.mkdir(parents=True, exist_ok=True)
    Path(cache_path).write_text(json.dumps(cache, indent=2))


def _call_haiku(client: anthropic.Anthropic, handle: str, bio: str, captions: str | None, model: str) -> dict:
    user_msg = USER_TEMPLATE.format(
        handle=handle,
        bio=bio or "(no bio)",
        captions=captions or "(none)",
    )
    response = client.messages.create(
        model=model,
        max_tokens=200,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_msg}],
    )
    raw = response.content[0].text.strip()
    # Strip markdown code fences if present (```json ... ``` or ``` ... ```)
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        result = {"niche": "other", "niche_confidence": 0.0, "first_name": None}

    # Validate niche
    if result.get("niche") not in NICHES:
        result["niche"] = "other"
    result["niche_confidence"] = float(result.get("niche_confidence") or 0.0)
    result["first_name"] = result.get("first_name") or None
    return result


def enrich_profiles(profiles: list[dict], cfg: dict) -> list[dict]:
    """
    Add niche, niche_confidence, first_name to each profile.
    Reads/writes a file cache keyed by handle to avoid redundant API calls.
    """
    enrichment_cfg = cfg.get("enrichment", {})
    model = enrichment_cfg.get("model", "claude-haiku-4-5-20251001")
    cache_path = enrichment_cfg.get("cache_path", "data/cache/enrichment_cache.json")

    cache = _load_cache(cache_path)
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    new_calls = 0
    cache_hits = 0

    for profile in profiles:
        handle = profile.get("handle") or ""
        if handle in cache:
            cached = cache[handle]
            profile["niche"] = cached.get("niche", "other")
            profile["niche_confidence"] = cached.get("niche_confidence", 0.0)
            profile["first_name"] = cached.get("first_name")
            cache_hits += 1
            continue

        try:
            result = _call_haiku(
                client,
                handle=handle,
                bio=profile.get("bio") or "",
                captions=profile.get("last_3_captions"),
                model=model,
            )
        except Exception as e:
            print(f"[enrich] ERROR on @{handle}: {e}")
            result = {"niche": "other", "niche_confidence": 0.0, "first_name": None}

        profile["niche"] = result["niche"]
        profile["niche_confidence"] = result["niche_confidence"]
        profile["first_name"] = result["first_name"]
        cache[handle] = result
        new_calls += 1

        if new_calls % 50 == 0:
            _save_cache(cache, cache_path)
            print(f"[enrich] {new_calls} API calls made, cache flushed")

    _save_cache(cache, cache_path)
    print(f"[enrich] Done. API calls: {new_calls} | Cache hits: {cache_hits}")
    return profiles
