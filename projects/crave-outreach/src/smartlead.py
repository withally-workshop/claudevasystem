"""
smartlead.py — Smartlead campaign integration
Pushes approved rows from the Google Sheet into a Smartlead campaign as leads.
Syncs reply/bounce status back to the Sheet.

Usage:
  python src/smartlead.py --campaign-id 123 --push-leads
  python src/smartlead.py --campaign-id 123 --sync-status
  python src/smartlead.py --create-campaign --name "UGC Creator Outreach May 2026"
"""
import os
import time
import argparse
import requests
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

SMARTLEAD_BASE = "https://server.smartlead.ai/api/v1"
BATCH_SIZE = 100  # Smartlead max leads per request


def _api(method: str, path: str, **kwargs) -> dict:
    api_key = os.environ["SMARTLEAD_API_KEY"]
    url = f"{SMARTLEAD_BASE}{path}"
    params = kwargs.pop("params", {})
    params["api_key"] = api_key
    resp = requests.request(method, url, params=params, **kwargs)
    resp.raise_for_status()
    return resp.json()


# ── Campaign management ────────────────────────────────────────────────────────

def list_campaigns() -> list[dict]:
    return _api("GET", "/campaigns", params={"limit": 100, "offset": 0})


def create_campaign(name: str) -> dict:
    payload = {"name": name}
    result = _api("POST", "/campaigns/create", json=payload)
    print(f"[smartlead] Campaign created: {result.get('id')} — {name}")
    return result


def get_campaign(campaign_id: int) -> dict:
    return _api("GET", f"/campaigns/{campaign_id}")


# ── Email sequences ────────────────────────────────────────────────────────────

def add_email_sequence(campaign_id: int, subject: str, body: str, seq_number: int = 1, wait_days: int = 0) -> dict:
    payload = {
        "sequences": [
            {
                "seq_number": seq_number,
                "seq_delay_details": {"delay_in_days": wait_days},
                "subject": subject,
                "email_body": body,
            }
        ]
    }
    return _api("POST", f"/campaigns/{campaign_id}/sequences", json=payload)


# ── Sending account ────────────────────────────────────────────────────────────

def get_email_accounts() -> list[dict]:
    return _api("GET", "/email-accounts", params={"limit": 100, "offset": 0})


def assign_email_account(campaign_id: int, email_account_id: int) -> dict:
    payload = {"email_account_ids": [email_account_id]}
    return _api("POST", f"/campaigns/{campaign_id}/email-accounts", json=payload)


# ── Campaign analytics ────────────────────────────────────────────────────────

def get_campaign_stats(campaign_id: int) -> dict:
    """
    Return aggregate stats for a campaign: sent, opened, clicked, replied, bounced.
    Includes computed open_rate and reply_rate as percentages.
    """
    data = _api("GET", f"/campaigns/{campaign_id}/analytics")
    sent = data.get("sent_count") or 0
    opened = data.get("open_count") or data.get("unique_open_count") or 0
    clicked = data.get("click_count") or 0
    replied = data.get("reply_count") or 0
    bounced = data.get("bounce_count") or 0
    return {
        "sent": sent,
        "opened": opened,
        "clicked": clicked,
        "replied": replied,
        "bounced": bounced,
        "open_rate": round(opened / sent * 100, 1) if sent else 0.0,
        "reply_rate": round(replied / sent * 100, 1) if sent else 0.0,
        "bounce_rate": round(bounced / sent * 100, 1) if sent else 0.0,
    }


# ── Lead management ────────────────────────────────────────────────────────────

def push_leads(campaign_id: int, leads: list[dict]) -> dict:
    """
    Push a list of lead dicts to a Smartlead campaign.
    Each lead: {email, first_name, last_name, custom fields...}
    """
    payload = {
        "lead_list": leads,
        "settings": {
            "ignore_global_block_list": False,
            "ignore_unsubscribe_list": True,
            "ignore_community_bounce_list": False,
        },
    }
    return _api("POST", f"/campaigns/{campaign_id}/leads", json=payload)


def get_campaign_leads(campaign_id: int, limit: int = 100, offset: int = 0) -> list[dict]:
    return _api("GET", f"/campaigns/{campaign_id}/leads", params={"limit": limit, "offset": offset})


# ── Sheet integration ──────────────────────────────────────────────────────────

def _get_sheet():
    import json
    import gspread
    from google.oauth2.service_account import Credentials

    sa_path = os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"]
    sheet_id = os.environ["SHEET_ID"]
    scopes = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]
    creds = Credentials.from_service_account_file(sa_path, scopes=scopes)
    gc = gspread.authorize(creds)
    return gc.open_by_key(sheet_id).sheet1


# Column indexes (0-based)
COL_HANDLE = 0
COL_EMAIL = 2
COL_FIRST_NAME = 3
COL_FOLLOWERS = 4
COL_NICHE = 7
COL_STATUS = 14
COL_NOTES = 15
COL_OUTREACH_SENT_AT = 16
# col R = replied_at (17), col S = bounced (18), col T = opened_at (19)
COL_OPENED_AT = 19


def push_approved_leads(campaign_id: int, dry_run: bool = False) -> int:
    """
    Read approved rows from Sheet, push to Smartlead campaign as leads.
    Returns number of leads pushed.
    """
    ws = _get_sheet()
    all_rows = ws.get_all_values()
    if len(all_rows) <= 1:
        print("[smartlead] Sheet is empty.")
        return 0

    data_rows = all_rows[1:]
    leads = []
    row_map = []  # track sheet row numbers for status update

    for i, row in enumerate(data_rows):
        def cell(idx, r=row):
            return r[idx].strip() if idx < len(r) else ""

        status = cell(COL_STATUS)
        email = cell(COL_EMAIL)
        sent_at = cell(COL_OUTREACH_SENT_AT)

        if status == "approved" and email and not sent_at:
            first_name = cell(COL_FIRST_NAME) or cell(COL_HANDLE).lstrip("@")
            leads.append({
                "email": email,
                "first_name": first_name,
                "last_name": "",
                "custom_fields": {
                    "handle": cell(COL_HANDLE),
                    "niche": cell(COL_NICHE),
                    "followers": cell(COL_FOLLOWERS),
                },
            })
            row_map.append(i + 2)  # 1-based sheet row

    print(f"[smartlead] Found {len(leads)} approved leads to push")
    if not leads:
        return 0

    if dry_run:
        for lead in leads[:3]:
            print(f"  DRY RUN → {lead['email']} ({lead['first_name']})")
        if len(leads) > 3:
            print(f"  ... and {len(leads) - 3} more")
        return len(leads)

    # Push in batches
    pushed = 0
    for i in range(0, len(leads), BATCH_SIZE):
        batch = leads[i:i + BATCH_SIZE]
        result = push_leads(campaign_id, batch)
        pushed += len(batch)
        print(f"[smartlead] Pushed {pushed}/{len(leads)} leads")

    # Mark pushed rows in Sheet
    now_iso = datetime.now(timezone.utc).isoformat()
    for sheet_row in row_map:
        ws.update(f"O{sheet_row}", [["outreach_queued"]])
        ws.update(f"Q{sheet_row}", [[now_iso]])

    print(f"[smartlead] Done. {pushed} leads pushed, Sheet updated.")
    return pushed


def sync_lead_status(campaign_id: int) -> int:
    """
    Pull lead statuses from Smartlead and sync back to Sheet.
    Updates bounced / replied rows.
    """
    ws = _get_sheet()
    all_rows = ws.get_all_values()
    if len(all_rows) <= 1:
        return 0

    # Build email → sheet row map
    email_to_row = {}
    for i, row in enumerate(all_rows[1:]):
        email = row[COL_EMAIL].strip().lower() if COL_EMAIL < len(row) else ""
        if email:
            email_to_row[email] = i + 2

    # Pull all leads from campaign
    leads = get_campaign_leads(campaign_id, limit=500)
    updated = 0

    for lead in leads:
        email = (lead.get("email") or "").lower()
        sheet_row = email_to_row.get(email)
        if not sheet_row:
            continue

        sl_status = lead.get("lead_status") or ""
        now_iso = datetime.now(timezone.utc).isoformat()

        if sl_status in ("BOUNCED", "HARD_BOUNCED"):
            ws.update(f"O{sheet_row}", [["bounced"]])
            ws.update(f"S{sheet_row}", [["TRUE"]])
            updated += 1
        elif sl_status == "REPLIED":
            ws.update(f"O{sheet_row}", [["replied"]])
            ws.update(f"R{sheet_row}", [[now_iso]])
            updated += 1
        elif sl_status in ("OPENED", "CLICKED"):
            # Only update if not already at a terminal status
            current_row = all_rows[sheet_row - 2] if sheet_row - 2 < len(all_rows[1:]) else []
            current_status = current_row[COL_STATUS].strip() if COL_STATUS < len(current_row) else ""
            if current_status not in ("replied", "bounced"):
                ws.update(f"O{sheet_row}", [["opened"]])
                ws.update(f"T{sheet_row}", [[now_iso]])  # col T = opened_at
                updated += 1

    print(f"[smartlead] Synced {updated} lead statuses back to Sheet")
    return updated


# ── CLI ────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Smartlead campaign integration")
    p.add_argument("--list-campaigns", action="store_true")
    p.add_argument("--create-campaign", action="store_true")
    p.add_argument("--name", help="Campaign name (for --create-campaign)")
    p.add_argument("--campaign-id", type=int)
    p.add_argument("--push-leads", action="store_true")
    p.add_argument("--sync-status", action="store_true")
    p.add_argument("--stats", action="store_true", help="Print campaign open/reply/bounce rates")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    if args.list_campaigns:
        campaigns = list_campaigns()
        if not campaigns:
            print("No campaigns yet.")
        for c in campaigns:
            print(f"  ID {c['id']} — {c['name']} — status: {c.get('status')}")

    elif args.create_campaign:
        name = args.name or f"UGC Creator Outreach {datetime.now().strftime('%B %Y')}"
        result = create_campaign(name)
        print(f"Campaign ID: {result.get('id')}")

    elif args.push_leads:
        if not args.campaign_id:
            print("ERROR: --campaign-id required")
        else:
            push_approved_leads(args.campaign_id, dry_run=args.dry_run)

    elif args.sync_status:
        if not args.campaign_id:
            print("ERROR: --campaign-id required")
        else:
            sync_lead_status(args.campaign_id)

    elif args.stats:
        if not args.campaign_id:
            print("ERROR: --campaign-id required")
        else:
            s = get_campaign_stats(args.campaign_id)
            print(f"\n=== Campaign {args.campaign_id} Stats ===")
            print(f"  Sent:         {s['sent']}")
            print(f"  Opened:       {s['opened']}  ({s['open_rate']}%)")
            print(f"  Clicked:      {s['clicked']}")
            print(f"  Replied:      {s['replied']}  ({s['reply_rate']}%)")
            print(f"  Bounced:      {s['bounced']}  ({s['bounce_rate']}%)")
            if s['sent'] > 0 and s['open_rate'] < 20:
                print(f"\n  ⚠  Open rate below 20% — may be landing in spam.")
                print(f"     Check Smartlead deliverability dashboard and review subject line.")
