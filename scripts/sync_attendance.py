#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "google-auth",
#   "google-api-python-client",
# ]
# ///

"""
Attendance sync (optional): copy "attending" rows from one Google Sheet tab to another.

Reads the source tab of the attendance spreadsheet (a Google Form response sheet),
keeps rows where STATUS_COLUMN equals STATUS_VALUE, and writes them to the target
tab. Safe to re-run. Edit COLUMN_MAP, STATUS_COLUMN and STATUS_VALUE below to match
your sheet's headers.

Usage:
    uv run scripts/sync_attendance.py           # dry run: prints what it would write, writes nothing
    uv run scripts/sync_attendance.py --commit  # WRITES: clears the target tab, then rewrites it

Sheet settings come from site.config.json (sheets.attendance: spreadsheetId, sourceTab,
targetTab, statusColumn). The service-account key GOOGLE_SA_KEY is a secret: process env,
.env.ops, or src/server/.dev.vars. Share the spreadsheet with the service account's email.
The sheet is not tied to stg or prod, so this script takes no --env.
"""

import argparse
import base64
import json
import sys

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from ops_common import fail, load_secrets, site_value
from site_config import try_get

# ── Configuration ────────────────────────────────────────────────────────────

# Sheet settings come from site.config.json (sheets.attendance).
SPREADSHEET_ID = try_get("attendanceSpreadsheetId") or ""  # checked in load_sa_credentials

# Source sheet (where registration data lives)
SOURCE_SHEET = site_value("attendanceSourceTab")

# Target sheet (where confirmed attendees go)
TARGET_SHEET = site_value("attendanceTargetTab")

# Columns to copy from source → target (source_header → target_header)
COLUMN_MAP = {
    "Name": "Name",
    "Registered": "Registered",
}

# The column + value that marks someone as "attending"
STATUS_COLUMN = site_value("attendanceStatusColumn")
STATUS_VALUE = "Yes"  # Case-insensitive check

# ── Helpers ──────────────────────────────────────────────────────────────────


def load_sa_credentials() -> service_account.Credentials:
    """Load the Google service account credentials (GOOGLE_SA_KEY)."""
    site_value("attendanceSpreadsheetId")  # exits naming site.config.json when it is empty
    env = load_secrets("GOOGLE_SA_KEY")
    sa_key_b64 = env["GOOGLE_SA_KEY"]

    # Decode base64 → JSON → service account info
    sa_json = json.loads(base64.b64decode(sa_key_b64).decode("utf-8"))

    return service_account.Credentials.from_service_account_info(
        sa_json,
        scopes=["https://www.googleapis.com/auth/spreadsheets"],
    )


def get_sheets_service():
    """Build and return an authorized Sheets API service."""
    creds = load_sa_credentials()
    return build("sheets", "v4", credentials=creds)


def get_sheet_names(service) -> list[str]:
    """List all sheet (tab) names in the spreadsheet."""
    meta = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
    return [s["properties"]["title"] for s in meta.get("sheets", [])]


def get_headers(service, sheet_name: str) -> list[str]:
    """Read the first row of a sheet as headers."""
    try:
        result = (
            service.spreadsheets()
            .values()
            .get(
                spreadsheetId=SPREADSHEET_ID,
                range=f"'{sheet_name}'!1:1",
            )
            .execute()
        )
        rows = result.get("values", [])
        return rows[0] if rows else []
    except HttpError as e:
        print(f"  Error reading '{sheet_name}': {e}", file=sys.stderr)
        return []


def get_all_rows(service, sheet_name: str) -> list[list[str]]:
    """Read all rows (including header) from a sheet."""
    try:
        result = (
            service.spreadsheets()
            .values()
            .get(
                spreadsheetId=SPREADSHEET_ID,
                range=f"'{sheet_name}'!A:ZZ",
            )
            .execute()
        )
        return result.get("values", [])
    except HttpError as e:
        print(f"  Error reading '{sheet_name}': {e}", file=sys.stderr)
        return []


def get_sheet_id(service, sheet_name: str) -> int | None:
    """Get the internal sheetId for a given title."""
    meta = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
    for s in meta.get("sheets", []):
        if s["properties"]["title"] == sheet_name:
            return s["properties"]["sheetId"]
    return None


def clear_sheet(service, sheet_name: str) -> None:
    """Clear all content from a sheet (preserves formatting/headers if any)."""
    sheet_id = get_sheet_id(service, sheet_name)
    if sheet_id is None:
        print(f"  Sheet '{sheet_name}' does not exist — creating it...")
        create_sheet(service, sheet_name)
        return

    # Clear everything
    service.spreadsheets().values().clear(
        spreadsheetId=SPREADSHEET_ID,
        range=f"'{sheet_name}'!A:ZZ",
        body={},
    ).execute()
    print(f"  Cleared '{sheet_name}'")


def create_sheet(service, sheet_name: str) -> None:
    """Create a new sheet if it doesn't exist."""
    try:
        service.spreadsheets().batchUpdate(
            spreadsheetId=SPREADSHEET_ID,
            body={
                "requests": [
                    {
                        "addSheet": {
                            "properties": {
                                "title": sheet_name,
                            }
                        }
                    }
                ]
            },
        ).execute()
        print(f"  Created sheet '{sheet_name}'")
    except HttpError:
        pass  # Sheet already exists


# ── Core logic ───────────────────────────────────────────────────────────────


def find_status_column(headers: list[str]) -> str | None:
    """Heuristic: find the column that indicates attendance status."""
    # Look for columns containing "attending" in name
    for h in headers:
        if "attending" in h.lower():
            return h
    # Fallback: look for "status" or "confirmation"
    for h in headers:
        if "status" in h.lower() or "confirm" in h.lower():
            return h
    return None


def is_attending(row_dict: dict[str, str], status_col: str) -> bool:
    """Check if a row is marked as attending."""
    value = row_dict.get(status_col, "").strip().lower()
    return value in ("yes", "true", "1", "attending", "confirmed", "y")


def explore(service) -> None:
    """Spike mode: explore spreadsheet structure."""
    print("=" * 70)
    print("SPIKE MODE — Exploring spreadsheet structure")
    print("=" * 70)

    sheets = get_sheet_names(service)
    print(f"\nSheets found ({len(sheets)}):")
    for i, name in enumerate(sheets, 1):
        print(f"  {i}. '{name}'")

    print(f"\n--- Reading headers for each sheet ---")
    for name in sheets:
        headers = get_headers(service, name)
        print(f"\n'{name}' — {len(headers)} columns:")
        for i, h in enumerate(headers):
            # Mark likely status column
            status_marker = ""
            if "attending" in h.lower():
                status_marker = " ★ (STATUS?)"
            elif "status" in h.lower() or "confirm" in h.lower():
                status_marker = " ?"
            elif "name" in h.lower():
                status_marker = " (name?)"
            elif "email" in h.lower():
                status_marker = " (email?)"
            print(f"    [{i}] {h}{status_marker}")

    # Read full data from source sheet
    if SOURCE_SHEET in sheets:
        print(f"\n\n--- Full data from '{SOURCE_SHEET}' ---")
        rows = get_all_rows(service, SOURCE_SHEET)
        print(f"  Total rows (including header): {len(rows)}")

        if len(rows) > 1:
            headers = rows[0]
            status_col = find_status_column(headers)
            print(f"  Detected status column: {status_col}")

            # Show data rows
            data_rows = rows[1:]
            print(f"\n  Data rows ({len(data_rows)}):")
            for i, row in enumerate(data_rows[:10]):  # First 10 rows
                row_dict = dict(zip(headers, row + [""] * (len(headers) - len(row))))
                status_val = (
                    row_dict.get(status_col, "N/A") if status_col else "N/A"
                )
                attending = "YES" if (status_col and is_attending(row_dict, status_col)) else "no"
                name = row_dict.get("Name", row_dict.get("Full Name", "?"))
                email = row_dict.get("Email", row_dict.get("Email Address", "?"))
                print(f"    [{i}] {name} <{email}>  attending={status_val} → {attending}")

            if len(data_rows) > 10:
                print(f"    ... and {len(data_rows) - 10} more rows")

            # Count attending
            if status_col:
                attending_count = sum(
                    1 for r in data_rows
                    if is_attending(dict(zip(headers, r + [""] * (len(headers) - len(r)))), status_col)
                )
                print(f"\n  Summary: {attending_count} / {len(data_rows)} attending")

    # Also read Confirmed sheet
    if TARGET_SHEET in sheets:
        print(f"\n\n--- Current '{TARGET_SHEET}' sheet ---")
        rows = get_all_rows(service, TARGET_SHEET)
        print(f"  Total rows (including header): {len(rows)}")
        if rows:
            for i, row in enumerate(rows[:5]):
                print(f"    [{i}] {row}")


def sync(service, dry_run: bool = True) -> None:
    """Sync attending folks to the Confirmed sheet."""
    label = "DRY RUN" if dry_run else "COMMIT"
    print(f"\n{'=' * 70}")
    print(f"SYNC — {label}")
    print(f"{'=' * 70}")

    if not COLUMN_MAP:
        print("ERROR: COLUMN_MAP is empty. Run without --commit first to see the source headers.")
        print("Then update COLUMN_MAP (source_header → target_header) in this script.")
        sys.exit(1)

    if not STATUS_COLUMN:
        print("ERROR: STATUS_COLUMN is not set. Run without --commit first to see the source headers.")
        print("Then set STATUS_COLUMN in this script.")
        sys.exit(1)

    # Read source data
    source_rows = get_all_rows(service, SOURCE_SHEET)
    if len(source_rows) < 2:
        print(f"  '{SOURCE_SHEET}' is empty or has only headers.")
        return

    headers = source_rows[0]
    data_rows = source_rows[1:]

    # Verify expected columns exist
    for src_col in COLUMN_MAP:
        if src_col not in headers:
            print(f"ERROR: Column '{src_col}' not found in source headers: {headers}")
            sys.exit(1)

    if STATUS_COLUMN not in headers:
        print(f"ERROR: Status column '{STATUS_COLUMN}' not found in headers: {headers}")
        sys.exit(1)

    # Find rows where person is attending
    attending_rows = []
    for row in data_rows:
        row_dict = dict(zip(headers, row + [""] * (len(headers) - len(row))))
        if is_attending(row_dict, STATUS_COLUMN):
            attending_rows.append(row_dict)

    print(f"\n  Source: {len(data_rows)} total registrations")
    print(f"  Attending: {len(attending_rows)} people")

    # Build output rows
    target_headers = list(COLUMN_MAP.values())
    output_rows = [target_headers]

    for row_dict in attending_rows:
        output_row = [row_dict.get(src_col, "") for src_col in COLUMN_MAP]
        output_rows.append(output_row)

    # Show preview
    print(f"\n  Preview of {TARGET_SHEET} sheet:")
    for i, row in enumerate(output_rows[:6]):
        print(f"    {row}")
    if len(output_rows) > 6:
        print(f"    ... and {len(output_rows) - 6} more rows")

    if dry_run:
        print(f"\n  DRY RUN — no changes made. Run with --commit to write.")
        return

    # Write to target sheet
    print(f"\n  Writing {len(output_rows) - 1} rows to '{TARGET_SHEET}'...")

    # Ensure target sheet exists
    sheets = get_sheet_names(service)
    if TARGET_SHEET not in sheets:
        create_sheet(service, TARGET_SHEET)

    # Clear and write fresh (idempotent)
    clear_sheet(service, TARGET_SHEET)

    service.spreadsheets().values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=f"'{TARGET_SHEET}'!A1",
        valueInputOption="RAW",
        body={"values": output_rows},
    ).execute()

    print(f"  Done! {len(output_rows) - 1} confirmed attendees written to '{TARGET_SHEET}'.")


# ── Main ─────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(
        description="Copy attending rows from the source tab to the target tab of the attendance Google Sheet"
    )
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Write to the target tab: clears it, then rewrites it (default: dry run, writes nothing)",
    )
    args = parser.parse_args()

    try:
        service = get_sheets_service()
    except Exception as e:
        print(f"Authentication failed: {e}", file=sys.stderr)
        sys.exit(1)

    if args.commit:
        sync(service, dry_run=False)
    else:
        explore(service)
        # After exploring, attempt a dry-run sync if COLUMN_MAP is configured
        if COLUMN_MAP and STATUS_COLUMN:
            sync(service, dry_run=True)


if __name__ == "__main__":
    main()
