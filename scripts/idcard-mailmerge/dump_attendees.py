#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Build the ID-card mail-merge manifest from live registration data.

Reads registration rows as JSON on stdin (id, full_name, branch,
participation_type), downloads each attendee's transparent portrait from the
public CDN, and writes a manifest the renderer (idcards.py) consumes.
Portraits are public — no auth here; the caller supplies the D1 rows (which do
need the read-only deploy token).

Donors (participation_type == 'donation_only') get NO card — they don't attend.
The SQL below already excludes them, and the loop below skips any that slip
through, so a forgotten WHERE clause can't leak a donor card either way.

Usage (from scripts/idcard-mailmerge/; `make dump ENV=prod` runs this whole pipeline):
    ../../.claude/skills/devops/scripts/d1-query prod \\
      "SELECT id, full_name, branch, participation_type FROM registrations \\
       WHERE participation_type IS NOT 'donation_only'" \\
      | python3 -c 'import sys,json; s=sys.stdin.read(); print(json.dumps(json.loads(s[s.index("["):])[0]["results"]))' \\
      | uv run dump_attendees.py --env prod

Reads D1 (via d1-query, needs CLOUDFLARE_API_TOKEN) and downloads portraits from
<cdnUrl>/portraits/<id>.webp, where cdnUrl is environments.<env>.cdnUrl in
site.config.json. --env stg|prod is required (no default). Use --portraits-src <dir>
to copy portraits from a local folder instead (no network, --env not needed).

(SQLite `IS NOT` is NULL-safe: a NULL participation_type is kept, unlike `!=`.)

There is deliberately no status filter: filtering on status='confirmed' dropped
attendees who should have a card (the Makefile's DUMP_SQL is the reference).

Output (all under data/, which is gitignored — real names + photos are PII):
    data/attendees.json          manifest: {schema_version, cards[]}
    data/portraits/<id>.webp     one transparent portrait per card

photo_path in the manifest is RELATIVE to the manifest file, so the whole
data/ dir is portable.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

# Base URL of the public CDN (site.config.json environments.<env>.cdnUrl). Set in main() unless
# --portraits-src is used.
CDN_BASE_URL = ""
DATA_DIR = Path(__file__).resolve().parent / "data"
PORTRAITS_DIR = DATA_DIR / "portraits"
MANIFEST_PATH = DATA_DIR / "attendees.json"


def fetch_portrait(attendee_id: str, src_dir: Path | None) -> bool:
    """Place one portrait at data/portraits/<id>.webp. Returns False if absent.

    With src_dir, copies from a local directory (e.g. an already-downloaded
    tmp/ mirror) — no network. Without it, downloads from the public CDN.
    """
    dest = PORTRAITS_DIR / f"{attendee_id}.webp"
    if src_dir is not None:
        src = src_dir / f"{attendee_id}.webp"
        if not src.is_file():
            return False
        shutil.copyfile(src, dest)
        return True
    url = f"{CDN_BASE_URL}/portraits/{attendee_id}.webp"
    # Cloudflare rejects the default urllib User-Agent with 403; a browser UA passes.
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status != 200:
                return False
            data = resp.read()
    except urllib.error.HTTPError:
        return False
    if not data:
        return False
    dest.write_bytes(data)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--portraits-src",
        type=Path,
        default=None,
        help="Local dir of <id>.webp portraits to copy from (skips CDN download).",
    )
    parser.add_argument(
        "--env",
        choices=["stg", "prod"],
        default=None,
        help="Environment whose CDN serves the portraits (required unless --portraits-src is given).",
    )
    args = parser.parse_args()

    global CDN_BASE_URL
    if args.portraits_src is None:
        if args.env is None:
            print("--env stg|prod is required (no default), or pass --portraits-src <dir>.", file=sys.stderr)
            return 2
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        import site_config
        try:
            CDN_BASE_URL = site_config.get("cdnUrl", args.env).rstrip("/")
        except site_config.SiteConfigError as e:
            print(f"error: {e}", file=sys.stderr)
            return 2

    rows = json.load(sys.stdin)
    if not isinstance(rows, list):
        print("expected a JSON array of registration rows on stdin", file=sys.stderr)
        return 2

    PORTRAITS_DIR.mkdir(parents=True, exist_ok=True)

    cards: list[dict[str, str]] = []
    missing: list[str] = []
    donors: list[str] = []
    for row in rows:
        attendee_id = str(row["id"])
        name = (row.get("full_name") or "").strip()
        branch = (row.get("branch") or "").strip()
        # Donors don't attend — no card, and don't waste a portrait fetch.
        if (row.get("participation_type") or "").strip() == "donation_only":
            donors.append(f"{attendee_id} ({name})")
            continue
        if not fetch_portrait(attendee_id, args.portraits_src):
            missing.append(f"{attendee_id} ({name})")
            continue
        cards.append(
            {
                "name": name,
                "branch": branch,
                "photo_path": f"portraits/{attendee_id}.webp",
                "attendee_id": attendee_id,
            }
        )

    manifest = {"schema_version": 1, "cards": cards}
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

    print(
        f"wrote {MANIFEST_PATH} — {len(cards)} cards, "
        f"{len(donors)} donors excluded, {len(missing)} skipped (no portrait)"
    )
    if donors:
        print("  donors excluded (participation_type=donation_only):", file=sys.stderr)
        for d in donors:
            print(f"    - {d}", file=sys.stderr)
    if missing:
        print("  no portrait on CDN (skipped):", file=sys.stderr)
        for m in missing:
            print(f"    - {m}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
