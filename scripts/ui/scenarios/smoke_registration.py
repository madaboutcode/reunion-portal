#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# ///
"""Smoke test: full registration flow in a real browser (developer / QA tool).

Solo "Full Celebration" alumnus through all 7 steps, ending at payment proof
upload. Each step saves a screenshot to tmp/ui-screenshots/ in the repo
(git-ignored; delete it when done).

Needs the `agent-browser` CLI on PATH (https://github.com/vercel-labs/agent-browser).
Start the app first for the default target: `make dev` (web on http://localhost:5173).

WRITES: a real registration with a throwaway email (smoke-<timestamp>@example.com)
on whatever site --base-url points to. It never defaults to a live site.

Usage:
  uv run scripts/ui/scenarios/smoke_registration.py                              # http://localhost:5173
  uv run scripts/ui/scenarios/smoke_registration.py --base-url http://localhost:5173
  uv run scripts/ui/scenarios/smoke_registration.py --base-url https://your-staging-host --allow-remote
"""

from __future__ import annotations

import argparse
import shutil
import sys
import time
from urllib.parse import urlparse
from pathlib import Path

# Add parent dir to path for portal/asserts imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from portal import create_portal, PortalError
from asserts import SmritiAsserts

# ── Config ────────────────────────────────────────────────────────────────────

LOCAL_URL = "http://localhost:5173"

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"
PHOTO_PATH = str(FIXTURES_DIR / "test-photo.jpg")
ID_PATH = str(FIXTURES_DIR / "test-id.jpg")

# Generate unique email per run
EMAIL = f"smoke-{int(time.time())}@example.com"

# ── Test data ─────────────────────────────────────────────────────────────────

ALUMNI = {
    "fullName": "Mundakkal Shekaran",
    "branch": "Computer Science & Engineering",
    "gender": "male",
    "email": EMAIL,
    "whatsapp": "+919876543210",
    "city": "Kochi",
}

ATTENDEES = {
    "alumniMeal": "non_veg",
    "tshirtSize": "L",
}

ACCOMMODATION = {
    "accommodation": "none",
}

GIVING_BACK = {
    "collegeContributionCause": "green_energy",
    "collegeContribution": 500,
}

EXPECTED_IN_REVIEW = [
    "Mundakkal Shekaran",
    "Computer Science",
    EMAIL,
    "Kochi",
]

# ── Runner ────────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Browser smoke test of the registration flow. Creates a real registration on the target site.")
    parser.add_argument("--base-url", default=LOCAL_URL,
                        help=f"Site to test (default: {LOCAL_URL}). Never defaults to a live site.")
    parser.add_argument("--allow-remote", action="store_true",
                        help="Required when --base-url is not localhost: confirms you accept a test registration there.")
    args = parser.parse_args()
    base_url = args.base_url.rstrip("/")
    if urlparse(base_url).hostname not in ("localhost", "127.0.0.1") and not args.allow_remote:
        print(f"Refusing to run against {base_url}: this test creates a registration. "
              "Add --allow-remote if that is intended.", file=sys.stderr)
        return 2
    if not shutil.which("agent-browser"):
        print("The `agent-browser` CLI is not on PATH. Install it first (see this script's docstring).",
              file=sys.stderr)
        return 2
    print(f"🎯 Smoke test against {base_url}")
    print(f"📧 Email: {EMAIL}")

    portal = create_portal(base_url=base_url)
    asserts = SmritiAsserts(portal.ui)
    results: list[tuple[str, bool, str]] = []

    def check(name: str, fn):
        try:
            fn()
            results.append((name, True, ""))
            print(f"  ✅ {name}")
        except Exception as e:
            results.append((name, False, str(e)))
            print(f"  ❌ {name}: {e}")

    try:
        # ── Open registration page ────────────────────────────────────────
        print("\n📍 Opening registration page...")
        portal.go_home()
        asserts.page_loaded()
        portal.screenshot("home.png")

        # ── Step 1: Participation ─────────────────────────────────────────
        print("\n📍 Step 1: Participation")
        portal.registration.select_participation("full_celebration")
        check("Step 1 → Step 2", lambda: asserts.on_registration_step(2))

        # ── Step 2: Alumni Details ────────────────────────────────────────
        print("\n📍 Step 2: Alumni Details")
        portal.registration.fill_alumni_details(ALUMNI)
        check("Step 2 → Step 3", lambda: asserts.on_registration_step(3))

        # ── Step 3: Attendees & Meals ─────────────────────────────────────
        print("\n📍 Step 3: Attendees & Meals")
        portal.registration.fill_attendees_meals(ATTENDEES)
        check("Step 3 → Step 4", lambda: asserts.on_registration_step(4))

        # ── Step 4: Accommodation ─────────────────────────────────────────
        print("\n📍 Step 4: Accommodation")
        portal.registration.fill_accommodation(ACCOMMODATION)
        check("Step 4 → Step 5", lambda: asserts.on_registration_step(5))

        # ── Step 5: Giving Back ───────────────────────────────────────────
        print("\n📍 Step 5: Giving Back")
        portal.registration.fill_giving_back(GIVING_BACK)
        check("Step 5 → Step 6", lambda: asserts.on_registration_step(6))

        # ── Step 6: Photo & ID ────────────────────────────────────────────
        print("\n📍 Step 6: Photo & ID")
        portal.registration.upload_photo_id(PHOTO_PATH, ID_PATH)
        check("Step 6 → Step 7", lambda: asserts.on_registration_step(7))

        # ── Step 7: Review ────────────────────────────────────────────────
        print("\n📍 Step 7: Review & Pay")
        review = portal.registration.review_text()
        for text in EXPECTED_IN_REVIEW:
            check(f"Review contains '{text}'", lambda t=text: _assert_in(t, review))

        pay = portal.registration.pay_button_state()
        check("Pay button found", lambda: _assert_not_none(pay["text"]))
        portal.screenshot("review.png")

        # ── Submit payment ────────────────────────────────────────────────
        print("\n📍 Submitting payment...")
        portal.registration.click_pay()
        portal.screenshot("after_pay.png")

        # Check if we reached payment proof page
        url = portal.ui.get_url()
        check("Reached payment page", lambda: _assert_contains(url, "pay"))
        portal.screenshot("payment_proof.png")

    except PortalError as e:
        print(f"\n💥 Portal error: {e}")
        try:
            portal.screenshot("error.png")
        except Exception:
            pass
        results.append(("Flow completed", False, str(e)))

    # ── Summary ───────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"Results: {passed}/{total} passed")
    for name, ok, err in results:
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {name}{f' — {err}' if err else ''}")
    print("\nScreenshots: tmp/ui-screenshots/ (delete when done)")

    return 0 if passed == total else 1


# ── Assertion helpers ─────────────────────────────────────────────────────────


def _assert_in(needle: str, haystack: str) -> None:
    if needle not in haystack:
        raise AssertionError(f"'{needle}' not found in text")


def _assert_not_none(value) -> None:
    if value is None or value == "not found":
        raise AssertionError(f"Expected a value, got {value!r}")


def _assert_contains(text: str, fragment: str) -> None:
    if fragment not in text:
        raise AssertionError(f"'{fragment}' not in '{text}'")


if __name__ == "__main__":
    sys.exit(main())
