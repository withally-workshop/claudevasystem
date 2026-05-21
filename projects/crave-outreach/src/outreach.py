"""
outreach.py — Phase 2 email sending module
Reads approved rows from the Sheet and sends personalized outreach emails via ivana@cravemedia.co.

Usage (standalone):
  python src/outreach.py --max-sends 100 [--dry-run]

Usage via main.py:
  python src/main.py --outreach-only --max-sends 100 [--dry-run]
"""
import os
import time
import base64
from datetime import datetime, timezone
from email.mime.text import MIMEText

import gspread
from dotenv import load_dotenv
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

load_dotenv()

GMAIL_SCOPES = [
    "https://mail.google.com/",
]
SHEETS_SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

FROM_EMAIL = "ivana@kravemedia.co"
SEND_DELAY_SECONDS = 30  # minimum gap between sends to avoid spam triggers

# Column indexes (0-based, matching COLUMNS in sheets.py)
COL_HANDLE = 0
COL_EMAIL = 2
COL_FIRST_NAME = 3
COL_NICHE = 7
COL_STATUS = 14
COL_NOTES = 15
COL_OUTREACH_SENT_AT = 16

DEFAULT_SUBJECT = "Collaboration opportunity with Krave Media"

DEFAULT_BODY = """\
Hi {first_name},

I came across your TikTok (@{handle}) and loved your content — your {niche} videos really stand out.

I'm Ivana from Krave Media. We work with brands to create authentic UGC content, and we think you'd be a great fit for some of our upcoming campaigns.

Would you be open to a quick chat about potential collaboration opportunities?

Looking forward to connecting!

Best,
Ivana
Krave Media
"""


def _get_sheet(sheet_id: str, sa_path: str) -> gspread.Worksheet:
    creds = Credentials.from_service_account_file(sa_path, scopes=SHEETS_SCOPES)
    gc = gspread.authorize(creds)
    return gc.open_by_key(sheet_id).sheet1


def _build_gmail_service(sa_path: str):
    creds = Credentials.from_service_account_file(
        sa_path,
        scopes=GMAIL_SCOPES,
        subject=FROM_EMAIL,  # domain-wide delegation to impersonate ivana@
    )
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def _make_message(to: str, body: str, subject: str) -> dict:
    msg = MIMEText(body, "plain")
    msg["to"] = to
    msg["from"] = FROM_EMAIL
    msg["subject"] = subject
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    return {"raw": raw}


def _send_email(service, to: str, body: str, subject: str) -> bool:
    try:
        message = _make_message(to, body, subject)
        service.users().messages().send(userId="me", body=message).execute()
        return True
    except Exception as e:
        print(f"[outreach] ERROR sending to {to}: {e}")
        return False


def _personalise(template: str, first_name: str | None, handle: str, niche: str) -> str:
    display_name = first_name or handle.lstrip("@")
    return template.format(
        first_name=display_name,
        handle=handle,
        niche=niche or "content",
    )


def run_outreach(
    max_sends: int = 100,
    dry_run: bool = False,
    sheet_id: str | None = None,
    sa_path: str | None = None,
    subject: str | None = None,
    body_template: str | None = None,
) -> dict:
    sa_path = sa_path or os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"]
    sheet_id = sheet_id or os.environ["SHEET_ID"]
    subject = subject or DEFAULT_SUBJECT
    body_template = body_template or DEFAULT_BODY

    ws = _get_sheet(sheet_id, sa_path)
    all_rows = ws.get_all_values()

    if len(all_rows) <= 1:
        print("[outreach] Sheet is empty.")
        return {"sent": 0, "skipped": 0, "errors": 0}

    data_rows = all_rows[1:]

    candidates = []
    for i, row in enumerate(data_rows):
        def cell(col_idx, r=row):
            return r[col_idx].strip() if col_idx < len(r) else ""

        status = cell(COL_STATUS)
        email = cell(COL_EMAIL)
        sent_at = cell(COL_OUTREACH_SENT_AT)

        if status == "approved" and email and not sent_at:
            candidates.append({
                "sheet_row": i + 2,
                "handle": cell(COL_HANDLE),
                "email": email,
                "first_name": cell(COL_FIRST_NAME) or None,
                "niche": cell(COL_NICHE),
            })

    print(f"[outreach] Found {len(candidates)} approved rows pending outreach")
    if not candidates:
        return {"sent": 0, "skipped": 0, "errors": 0}

    to_send = candidates[:max_sends]
    remaining = len(candidates) - len(to_send)
    if remaining > 0:
        print(f"[outreach] Capped at {max_sends}. {remaining} remain for next run.")

    sent = 0
    errors = 0
    gmail_service = None if dry_run else _build_gmail_service(sa_path)

    for idx, creator in enumerate(to_send):
        body = _personalise(body_template, creator["first_name"], creator["handle"], creator["niche"])
        now_iso = datetime.now(timezone.utc).isoformat()

        if dry_run:
            print(f"[outreach] DRY RUN → {creator['email']} (@{creator['handle']})")
            print(f"  Subject : {subject}")
            print(f"  Preview : {body[:120].strip()}...")
            sent += 1
            continue

        success = _send_email(gmail_service, creator["email"], body, subject)

        if success:
            ws.update(f"O{creator['sheet_row']}", [["outreach_sent"]])
            ws.update(f"Q{creator['sheet_row']}", [[now_iso]])
            sent += 1
            print(f"[outreach] {sent}/{len(to_send)} sent → {creator['email']} (@{creator['handle']})")
        else:
            ws.update(f"O{creator['sheet_row']}", [["error"]])
            ws.update(f"P{creator['sheet_row']}", [[f"send_error {now_iso}"]])
            errors += 1

        if idx < len(to_send) - 1:
            time.sleep(SEND_DELAY_SECONDS)

    summary = {"sent": sent, "skipped": remaining, "errors": errors}
    print(f"[outreach] Done. Sent: {sent} | Errors: {errors} | Remaining: {remaining}")
    return summary


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser(description="Send outreach emails to approved creators")
    p.add_argument("--max-sends", type=int, default=100)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    run_outreach(max_sends=args.max_sends, dry_run=args.dry_run)
