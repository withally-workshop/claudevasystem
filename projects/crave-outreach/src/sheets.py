import json
import os

import gspread
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials

load_dotenv()

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

COLUMNS = [
    "handle",
    "profile_url",
    "email",
    "first_name",
    "followers",
    "following",
    "bio",
    "niche",
    "niche_confidence",
    "region_signal",
    "last_3_captions",
    "link_in_bio",
    "role_based_email",
    "scraped_at",
    "status",
    "notes",
    "outreach_sent_at",
    "replied_at",
    "bounced",
]


def _get_sheet(sheet_id: str | None = None) -> gspread.Worksheet:
    sa_path = os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"]
    creds = Credentials.from_service_account_file(sa_path, scopes=SCOPES)
    gc = gspread.authorize(creds)
    sheet_id = sheet_id or os.environ["SHEET_ID"]
    spreadsheet = gc.open_by_key(sheet_id)
    return spreadsheet.sheet1


def _ensure_headers(ws: gspread.Worksheet):
    """Write header row if sheet is empty."""
    existing = ws.row_values(1)
    if not existing or existing[0] != "handle":
        ws.update("A1", [COLUMNS])
        print("[sheets] Header row written")


def _profile_to_row(profile: dict, status_default: str = "new") -> list:
    return [
        profile.get("handle") or "",
        profile.get("profile_url") or "",
        profile.get("email") or "",
        profile.get("first_name") or "",
        profile.get("followers") or 0,
        profile.get("following") or 0,
        (profile.get("bio") or "")[:500],  # cap bio length
        profile.get("niche") or "",
        profile.get("niche_confidence") or 0.0,
        profile.get("region_signal") or "",
        (profile.get("last_3_captions") or "")[:1000],
        profile.get("link_in_bio") or "",
        "TRUE" if profile.get("role_based_email") else "FALSE",
        profile.get("scraped_at") or "",
        status_default,
        "",  # notes
        "",  # outreach_sent_at
        "",  # replied_at
        "",  # bounced
    ]


def upsert_profiles(profiles: list[dict], cfg: dict, sheet_id: str | None = None):
    """
    Idempotent upsert: if handle already exists, update the row.
    If not, append. Never duplicates.
    """
    status_default = cfg.get("sheets", {}).get("status_default", "new")

    ws = _get_sheet(sheet_id)
    _ensure_headers(ws)

    all_records = ws.get_all_values()
    if len(all_records) <= 1:
        existing_handles: dict[str, int] = {}
    else:
        header = all_records[0]
        handle_col = header.index("handle") if "handle" in header else 0
        # Row index in sheet is 1-based; row 1 is header, so data starts at row 2
        existing_handles = {
            row[handle_col].lower(): idx + 2
            for idx, row in enumerate(all_records[1:])
            if row and row[handle_col]
        }

    updates: list[tuple[int, list]] = []
    appends: list[list] = []

    for profile in profiles:
        handle = (profile.get("handle") or "").lower()
        row_data = _profile_to_row(profile, status_default)

        if handle in existing_handles:
            sheet_row = existing_handles[handle]
            # Preserve status/notes/outreach columns — only update pipeline-generated cols
            updates.append((sheet_row, row_data[:14]))  # cols A–N (everything before status)
        else:
            appends.append(row_data)

    # Batch update existing rows
    if updates:
        col_end = "N"  # column 14
        requests = []
        for sheet_row, data in updates:
            range_notation = f"A{sheet_row}:{col_end}{sheet_row}"
            requests.append({"range": range_notation, "values": [data]})
        ws.batch_update(requests)
        print(f"[sheets] Updated {len(updates)} existing rows")

    # Append new rows
    if appends:
        ws.append_rows(appends, value_input_option="USER_ENTERED")
        print(f"[sheets] Appended {len(appends)} new rows")

    print(f"[sheets] Upsert complete: {len(updates)} updated, {len(appends)} new")
