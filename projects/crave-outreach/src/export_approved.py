"""
export_approved.py — Phase 2 export for Base plan (no-API mode)

Reads approved rows from the Google Sheet and writes a Smartlead-ready CSV.
Marks each exported row as `outreach_queued` so the next export only picks up
newly-approved leads (no duplicates on re-import).

No Smartlead API needed — this only touches the Google Sheet via the service
account. You import the resulting CSV into the Smartlead campaign UI by hand.

Usage:
  python src/export_approved.py                 # -> data/approved_leads.csv
  python src/export_approved.py --dry-run       # preview only, no CSV, no Sheet write
  python src/export_approved.py --out leads.csv # custom output path
"""
import argparse
import csv
import os
from datetime import datetime, timezone

import gspread
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials

load_dotenv()

SHEETS_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# Column indexes (0-based) — must match sheets.py / smartlead.py
COL_HANDLE = 0
COL_EMAIL = 2
COL_FIRST_NAME = 3
COL_FOLLOWERS = 4
COL_NICHE = 7
COL_STATUS = 14

CSV_HEADERS = ["email", "first_name", "last_name", "handle", "niche", "followers"]


def _get_sheet():
    sa_path = os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"]
    sheet_id = os.environ["SHEET_ID"]
    creds = Credentials.from_service_account_file(sa_path, scopes=SHEETS_SCOPES)
    gc = gspread.authorize(creds)
    return gc.open_by_key(sheet_id).sheet1


def export_approved(out_path: str, dry_run: bool = False) -> int:
    ws = _get_sheet()
    rows = ws.get_all_values()
    if len(rows) <= 1:
        print("[export] Sheet is empty.")
        return 0

    leads = []
    row_map = []  # 1-based sheet row numbers, parallel to leads
    for i, row in enumerate(rows[1:]):
        def cell(idx, r=row):
            return r[idx].strip() if idx < len(r) else ""

        if cell(COL_STATUS) == "approved" and cell(COL_EMAIL):
            leads.append({
                "email": cell(COL_EMAIL),
                "first_name": cell(COL_FIRST_NAME) or cell(COL_HANDLE).lstrip("@"),
                "last_name": "",
                "handle": cell(COL_HANDLE),
                "niche": cell(COL_NICHE),
                "followers": cell(COL_FOLLOWERS),
            })
            row_map.append(i + 2)

    print(f"[export] Found {len(leads)} approved leads.")
    if not leads:
        return 0

    if dry_run:
        for lead in leads[:5]:
            print(f"  {lead['email']}  ({lead['first_name']}, {lead['niche']})")
        if len(leads) > 5:
            print(f"  ... and {len(leads) - 5} more")
        print("[export] DRY RUN — no CSV written, Sheet unchanged.")
        return len(leads)

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_HEADERS)
        writer.writeheader()
        writer.writerows(leads)
    print(f"[export] Wrote {len(leads)} leads to {out_path}")

    # Mark exported rows as queued (single batched write to avoid rate limits)
    now = datetime.now(timezone.utc).isoformat()
    updates = []
    for sheet_row in row_map:
        updates.append({"range": f"O{sheet_row}", "values": [["outreach_queued"]]})
        updates.append({"range": f"Q{sheet_row}", "values": [[now]]})
    ws.batch_update(updates)
    print(f"[export] Marked {len(row_map)} rows as outreach_queued in the Sheet.")
    return len(leads)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Export approved leads to a Smartlead CSV")
    p.add_argument("--out", default="data/approved_leads.csv")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    export_approved(args.out, dry_run=args.dry_run)
