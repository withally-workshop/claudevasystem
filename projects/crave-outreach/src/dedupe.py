def dedupe_profiles(profiles: list[dict]) -> list[dict]:
    """
    Deduplicate by handle (exact match), then by email.
    On email conflict, keep the profile with higher followers.
    Logs every dropped row.
    """
    # Pass 1: dedupe by handle (keep first occurrence)
    seen_handles: dict[str, dict] = {}
    for p in profiles:
        handle = (p.get("handle") or "").lower().strip()
        if not handle:
            continue
        if handle in seen_handles:
            print(f"[dedupe] DROP duplicate handle @{handle}")
        else:
            seen_handles[handle] = p

    after_handle = list(seen_handles.values())
    dropped_handle = len(profiles) - len(after_handle)
    print(f"[dedupe] Handle dedup: {len(profiles)} -> {len(after_handle)} (dropped {dropped_handle})")

    # Pass 2: dedupe by email (keep higher-follower profile)
    seen_emails: dict[str, dict] = {}
    no_email: list[dict] = []

    for p in after_handle:
        email = (p.get("email") or "").lower().strip()
        if not email:
            no_email.append(p)
            continue
        if email not in seen_emails:
            seen_emails[email] = p
        else:
            existing = seen_emails[email]
            existing_followers = existing.get("followers") or 0
            current_followers = p.get("followers") or 0
            if current_followers > existing_followers:
                print(
                    f"[dedupe] DROP @{existing.get('handle')} (email {email}, "
                    f"{existing_followers} followers) — kept @{p.get('handle')} ({current_followers} followers)"
                )
                seen_emails[email] = p
            else:
                print(
                    f"[dedupe] DROP @{p.get('handle')} (email {email}, "
                    f"{current_followers} followers) — kept @{existing.get('handle')} ({existing_followers} followers)"
                )

    after_email = list(seen_emails.values()) + no_email
    dropped_email = len(after_handle) - len(after_email)
    print(f"[dedupe] Email dedup: {len(after_handle)} -> {len(after_email)} (dropped {dropped_email})")
    print(f"[dedupe] Final: {len(after_email)} unique profiles")

    return after_email
