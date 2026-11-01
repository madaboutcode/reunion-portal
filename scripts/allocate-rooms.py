#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["networkx", "openpyxl", "pillow"]
# ///
"""
Build tmp/room-allocation-report.xlsx and tmp/room-allocation-hotel.xlsx from
live D1 data: the hotel handoff report for shared_double accommodation.
Optional step: only needed if your event offers shared hotel rooms.

READ-ONLY: only ever issues SELECT against D1. Never touches the app's
`rooms` / `registration_room_assignments` tables.

Event name and subtitle come from site.config.json (eventName, eventSubtitle). Edit NIGHT_DATES and
MANUAL_GROUPS (room pairs you want fixed by hand).

Requires --env stg|prod (no default). Account, D1 database and R2 come from
src/server/wrangler.toml; the token from CLOUDFLARE_API_TOKEN (process env or .env.ops) or --token <file>.

Usage:
  uv run scripts/allocate-rooms.py --env prod
  uv run scripts/allocate-rooms.py --env stg --dry-run   # print summary, don't write
  uv run scripts/allocate-rooms.py --env prod --out tmp/x.xlsx # custom output path
  uv run scripts/allocate-rooms.py --env prod --token tmp/cf-token.txt

Algorithm: scripts/allocate_rooms_lib.py (see its module docstring).
"""
import argparse
import dataclasses
import os
import subprocess
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from openpyxl import Workbook
from openpyxl.drawing.image import Image as XLImage
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from allocate_rooms_lib import (  # noqa: E402
    BRANCH_SHORT_NAMES,
    BRUTE_FORCE_COMPONENT_LIMIT,
    WEIGHTS,
    Dataset,
    Person,
    branch_component,
    enumerate_pairings,
    pref_only_weight,
    run_allocation,
)

# Cloudflare settings (account, D1 database, token) are resolved in ops_common.py via site_config.py.
from ops_common import add_env_argument, d1_query, preflight, site_value  # noqa: E402

# ── Manual pinned groups ────────────────────────────────
#
# Each group is {"reg_codes": ORDERED list, "room_capacity": int (default 2)}.
# The group is removed from Stage A (mutual-dyad freezing + residual
# brute-force) entirely — pinned people contribute no Stage A edges. A group
# of n people becomes ceil(n/capacity) CONSECUTIVE rooms, filled
# capacity-at-a-time in listed order: capacity=2, [A,B,C] -> room(A+B),
# room(C solo) next door; capacity=3, [A,B,C] -> ONE room(A+B+C). Listed
# order is the human's only control over who groups with whom. This is a
# deliberate override of the solver's own capacity — solver-produced rooms
# stay strictly capacity 2, only a manual pin can be a different size.
# Preference edges from unpinned people toward a pinned person still count in
# Stage B ordering (their room can sit near the pinned block); the pinned
# block itself participates in Stage B ordering as a fixed cluster, same
# branch-block sort as everything else.
#
# Example shape (keep the list EMPTY in the repo; reg codes are personal data):
#   MANUAL_GROUPS = [
#       {"reg_codes": ["SMRTAAAAAAAAAAAA", "SMRTBBBBBBBBBBBB", "SMRTCCCCCCCCCCCC"],
#        "room_capacity": 3},
#   ]
MANUAL_GROUPS: list[dict] = []

HERE = os.path.dirname(os.path.abspath(__file__))
PORTAL = os.path.dirname(HERE)
DEFAULT_OUT = os.path.join(PORTAL, "tmp/room-allocation-report.xlsx")
DEFAULT_HOTEL_OUT = os.path.join(PORTAL, "tmp/room-allocation-hotel.xlsx")
LOGO_PATH = os.path.join(PORTAL, "src/web/public/assets/smriti-logo.png")

# ── Branding (design note "Night-sheet extra-bed markers + branding") ──────
# Facts sourced from repo docs only, nothing invented: event name + college +
# batch year from src/web/index.html meta tags; event dates from NIGHT_DATES
# (already the single source of truth for the two nights covered by this run).
EVENT_TITLE = site_value("eventName")  # from site.config.json
EVENT_SUBTITLE = site_value("eventSubtitle")  # from site.config.json

# The two hotel nights covered by the report: [first night, second night].
# Edit these for your event. Every date in the workbooks derives from this list.
NIGHT_DATES = ["2026-08-14", "2026-08-15"]

REGISTRATIONS_QUERY = """
SELECT id, reg_code, full_name, gender, branch, status, check_in, check_out, extra_bed
FROM registrations
WHERE accommodation = 'shared_double'
ORDER BY id
"""

PREFERENCES_QUERY = """
SELECT registration_id, preferred_registration_id, preference_order
FROM roommate_preferences
ORDER BY id
"""

# Report format v2: private registrations are included in the report (still
# fully outside the optimization) as P-1..P-n, sorted by name — no proximity
# semantics, just alphabetical bookkeeping.
PRIVATE_QUERY = """
SELECT id, reg_code, full_name, gender, branch, status, check_in, check_out, extra_bed
FROM registrations
WHERE accommodation = 'private'
ORDER BY full_name
"""

# ── Styling (matches build-tshirt-size-report.py conventions) ───────────────

HEADER_FONT = Font(bold=True, color="FFFFFF")
HEADER_FILL_COLOR = "1F2A33"  # charcoal
TOTAL_FONT = Font(bold=True)
TITLE_FONT = Font(bold=True, size=13)
NOTE_FONT = Font(italic=True, size=9, color="666666")
SETTLED_FILL = PatternFill(start_color="E8F5E9", end_color="E8F5E9", fill_type="solid")
REVIEW_FILL = PatternFill(start_color="FFF6E5", end_color="FFF6E5", fill_type="solid")
THIN = Side(style="thin", color="B0B0B0")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

# Brand palette (docs/STYLE_GUIDE.md — soft-aqua, terracotta, charcoal), used
# for the hotel workbook's branded title rows and cover front page.
BRAND_SOFT_AQUA = "B9DFE2"
BRAND_TERRACOTTA = "D76B51"
BRAND_CHARCOAL = "1F2A33"
BRAND_MUTED = "6B7280"
BRAND_TITLE_FILL = PatternFill(start_color=BRAND_SOFT_AQUA, end_color=BRAND_SOFT_AQUA, fill_type="solid")
BRAND_TITLE_FONT = Font(bold=True, size=13, color=BRAND_CHARCOAL)
BRAND_HEADLINE_FONT = Font(bold=True, size=20, color=BRAND_TERRACOTTA)
BRAND_SUBHEAD_FONT = Font(bold=True, size=13, color=BRAND_CHARCOAL)
BRAND_META_FONT = Font(italic=True, size=10, color=BRAND_MUTED)


def style_brand_title_row(ws, row_idx, ncols, text):
    """Branded merged title band for a hotel-workbook sheet — soft-aqua fill,
    charcoal bold text, event name prefixed so the sheet identifies itself
    even opened directly (not via the Cover tab)."""
    ws.merge_cells(start_row=row_idx, start_column=1, end_row=row_idx, end_column=ncols)
    cell = ws.cell(row=row_idx, column=1, value=f"{EVENT_TITLE} — {text}")
    cell.font = BRAND_TITLE_FONT
    cell.alignment = Alignment(horizontal="left", vertical="center")
    for c in range(1, ncols + 1):
        ws.cell(row=row_idx, column=c).fill = BRAND_TITLE_FILL
    ws.row_dimensions[row_idx].height = 20


def style_header_row(ws, row_idx, ncols, start_col=1):
    fill = PatternFill(start_color=HEADER_FILL_COLOR, end_color=HEADER_FILL_COLOR, fill_type="solid")
    for c in range(start_col, start_col + ncols):
        cell = ws.cell(row=row_idx, column=c)
        cell.font = HEADER_FONT
        cell.fill = fill
        cell.border = BORDER
        cell.alignment = Alignment(horizontal="center", vertical="center")


def autofit_columns(ws, min_width=8, max_width=50):
    widths = {}
    for row in ws.iter_rows():
        for cell in row:
            if cell.value is None:
                continue
            length = len(str(cell.value))
            col = cell.column_letter
            widths[col] = max(widths.get(col, 0), length)
    for col, width in widths.items():
        ws.column_dimensions[col].width = max(min_width, min(width + 2, max_width))


# ── D1 access (mirrors build-tshirt-size-report.py) ─────────────────────────


def _person_from_row(r) -> Person:
    return Person(
        id=r["id"],
        reg_code=r["reg_code"],
        name=r["full_name"],
        gender=r["gender"],
        branch=r["branch"],
        check_in=r["check_in"],
        check_out=r["check_out"],
    )


def load_dataset(token, db) -> Dataset:  # db is the environment name, "stg" or "prod"
    reg_rows = d1_query(token, db, REGISTRATIONS_QUERY)
    pref_rows = d1_query(token, db, PREFERENCES_QUERY)

    people = [_person_from_row(r) for r in reg_rows]
    edges = [
        (r["registration_id"], r["preferred_registration_id"], r["preference_order"])
        for r in pref_rows
    ]
    # extra_bed is a recorded accommodation preference (D1: INTEGER 0/1, see
    # migration 0006_add_extra_bed.sql), not a solver input — kept as a
    # driver-side dict (id -> bool) rather than a Person field, so it never
    # touches allocate_rooms_lib.py.
    extra_bed_by_id = {r["id"]: bool(r["extra_bed"]) for r in reg_rows}
    return Dataset(people=people, edges=edges), len(reg_rows), len(pref_rows), extra_bed_by_id


def load_private_people(token, db) -> tuple[list[Person], dict[int, bool]]:
    """Private registrations — never part of the optimization, but included
    in the report per Report format v2 as P-1..P-n."""
    rows = d1_query(token, db, PRIVATE_QUERY)
    people = [_person_from_row(r) for r in rows]
    extra_bed_by_id = {r["id"]: bool(r["extra_bed"]) for r in rows}
    return people, extra_bed_by_id


def resolve_manual_groups(manual_groups, dataset: Dataset) -> list[dict]:
    """Reg codes -> ids, in order, keeping each group's capacity. Fails
    loudly (not silently) if a reg code isn't in the shared-70 population —
    report back rather than guessing, per instructions."""
    by_reg_code = {p.reg_code: p for p in dataset.people}
    resolved = []
    for group in manual_groups:
        ids = []
        for reg_code in group["reg_codes"]:
            person = by_reg_code.get(reg_code)
            if person is None:
                sys.exit(
                    f"MANUAL_GROUPS reg code {reg_code} not found in the shared_double population "
                    f"({len(dataset.people)} people) — check the reg code is current, don't guess."
                )
            ids.append(person.id)
        resolved.append({"ids": ids, "capacity": group.get("room_capacity", 2)})
    return resolved


# ── Console summary + verification prints ───────────────────────────────────


def is_settled(room) -> bool:
    """Mutual (real preference satisfied) and manual (human-decided) rooms
    both need no reviewer attention — the opposite of needs-review."""
    return room.match_kind in ("mutual", "manual")


def print_console_summary(result, dataset: Dataset, raw_reg_count, raw_pref_count):
    by_id = result["by_id"]
    rooms = result["rooms"]

    print(f"\n{'=' * 78}\nROOM ALLOCATION — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n{'=' * 78}")
    print(f"population: {len(dataset.people)} people "
          f"({sum(1 for p in dataset.people if p.gender == 'male')}M / "
          f"{sum(1 for p in dataset.people if p.gender == 'female')}F)")

    print(f"\npreference edges: {raw_pref_count} raw -> {result['clean_edge_count']} clean "
          f"({len(result['dropped_edges'])} dropped, stale)")
    if result["dropped_edges"]:
        print("  dropped edges (endpoint not in shared-70 population):")
        for f, t, o in result["dropped_edges"]:
            print(f"    {f} -> {t} (order {o})")

    print(f"\nfrozen mutual dyads: {result['frozen_dyad_count']} rooms")
    print(f"mutual cliques (size >= 3, sent to residual pool for the 2-of-3 search):")
    for c in result["cliques"]:
        names = [f"{by_id[m].name} (#{by_id[m].reg_code})" for m in c["members"]]
        print(f"  {c['gender']}: {', '.join(names)}")

    print("\nresidual pool solve (brute-force, authoritative):")
    for gender, info in result["residual_solve"].items():
        print(f"  {gender}: pool={info['pool']}")
        print(f"    pairings enumerated: {info['pairings_tried']}")
        print(f"    chosen pref-only cost: {info['pref_cost']}  (same-branch pairing bonus: {info['branch_bonus']})")
        print(f"    staged (old max-weight matching) pref-only cost on same pool: {info['staged_pref_cost']}")
        gap = info["staged_pref_cost"] - info["pref_cost"]
        verdict = "brute-force matches staged" if gap == 0 else f"brute-force wins by {gap}"
        print(f"    sanity verdict: {verdict}")

    print(f"\nStage B residual-graph components (branch EXCLUDED from ordering weight — see lib docstring):")
    any_greedy = False
    for c in result["component_report"]:
        flag = ""
        if c["used_greedy"]:
            flag = f"  <-- GREEDY FALLBACK (size {c['size']} > limit {BRUTE_FORCE_COMPONENT_LIMIT})"
            any_greedy = True
        print(f"  component size={c['size']}{flag}")
    if any_greedy:
        print("  *** at least one component exceeded the exact-ordering threshold — greedy result is NOT provably optimal for that component ***")
    else:
        print("  all components <= threshold — every ordering is exactly optimal")

    print(f"\nrooms: {len(rooms)}  |  objective (Σ preference-weight × distance): {result['objective']}")

    mutual_rooms = [r for r in rooms if r.match_kind == "mutual"]
    manual_rooms = [r for r in rooms if r.match_kind == "manual"]
    settled_rooms = [r for r in rooms if is_settled(r)]
    people_settled = sum(len(r.occupants) for r in settled_rooms)
    print(f"mutual rooms: {len(mutual_rooms)}  |  manual (pinned) rooms: {len(manual_rooms)}  |  "
          f"settled total: {len(settled_rooms)} rooms, {people_settled} people "
          f"({people_settled / len(dataset.people) * 100:.1f}% of population, need no review)")

    needs_review = [r for r in rooms if not is_settled(r)]
    print(f"needs-review rooms: {len(needs_review)}")
    for r in needs_review:
        occ = " + ".join(f"{by_id[p].name} (#{by_id[p].reg_code})" for p in r.occupants)
        print(f"  Room-{r.number:<3} [{len(r.occupants)}] {r.gender:<6} {occ:<50} {r.match_kind} — {r.match_detail}")

    if manual_rooms:
        print("\nmanual pinned groups (removed from Stage A, placed directly):")
        for r in sorted(manual_rooms, key=lambda x: x.number):
            occ = " + ".join(f"{by_id[p].name} (#{by_id[p].reg_code})" for p in r.occupants)
            print(f"  Room-{r.number:<3} [{len(r.occupants)}] {r.gender:<6} {occ}")
        nums = sorted(r.number for r in manual_rooms)
        if len(nums) > 1:
            gaps = [nums[i + 1] - nums[i] for i in range(len(nums) - 1)]
            print(f"  room numbers: {nums}  (consecutive: {'yes' if all(g == 1 for g in gaps) else 'NO — gap present: ' + str(gaps)})")

        pinned_ids = result["pinned_ids"]
        elsewhere = [
            (pid, r.number) for pid in pinned_ids for r in rooms if pid in r.occupants and r.match_kind != "manual"
        ]
        if elsewhere:
            print(f"  *** VERIFICATION FAILED: pinned people appear outside their manual room: {elsewhere} ***")
        else:
            print("  verified: none of the pinned people appear in any non-manual room")
        pinned_room_count_check = sum(1 for pid in pinned_ids for r in rooms if pid in r.occupants)
        print(f"  verified: each of the {len(pinned_ids)} pinned people appears in exactly "
              f"{'1 room each' if pinned_room_count_check == len(pinned_ids) else f'{pinned_room_count_check} total room-memberships (expected {len(pinned_ids)})'}")

    print("\ntriad/clique placement:")
    for c in result["cliques"]:
        clique_rooms = {r.number: r for r in rooms if any(p in c["members"] for p in r.occupants)}
        nums = sorted(clique_rooms.keys())
        print(f"  {c['gender']} clique {c['members']}:")
        for num in nums:
            r = clique_rooms[num]
            occ = ", ".join(f"{by_id[p].name}" for p in r.occupants if p in c["members"] or True)
            print(f"    Room-{num}: {occ}")
        if len(nums) == 2:
            print(f"    distance between the two rooms: {abs(nums[0] - nums[1])}")


# ── Excel report (Report format v2: one row per attendee) ──────────────────
#
# Room is a repeating column value, not the row's identity — so the sheet
# sorts/filters by person or by room. Private registrations (out of scope
# for the optimization) are included as P-1..P-n rows, sorted by name — that
# numbering is alphabetical bookkeeping only, NOT a proximity signal the way
# the shared Room-N sequence is.

ATTENDEE_HEADERS = ["Room", "Room Occupancy", "Name", "Reg Code", "Gender", "Check-in", "Check-out", "Branch", "Type", "Match Status", "Notes"]


@dataclass
class AttendeeRow:
    room_label: str
    room_occupancy: int
    name: str
    reg_code: str
    gender: str
    branch_short: str
    type_: str  # "shared" | "private"
    match_status: str
    notes: str
    check_in: str | None
    check_out: str | None
    person_id: int
    sort_key: tuple
    # Hotel-facing note — guest logistics ONLY (room moves, delayed roommates).
    # Deliberately a separate field, never derived from `notes`: `notes` is
    # built from internal match reasoning ("mutual preference + same
    # branch", "pinned, capacity 3...") which must never reach the hotel
    # file. Empty by default — most rows need no guest-facing note at all.
    guest_notes: str = ""
    # The registration's own recorded `extra_bed` preference (D1 column,
    # independent of room occupancy) — one of the two Extra Bed sources on
    # the Bookings sheet (design note "Hotel bookings view", 2026-08-13).
    extra_bed_recorded: bool = False


def build_shared_attendee_rows(result, extra_bed_by_id: dict[int, bool]) -> list[AttendeeRow]:
    by_id = result["by_id"]
    rows = []
    for room in result["rooms"]:
        for pid in room.occupants:
            p = by_id[pid]
            rows.append(
                AttendeeRow(
                    room_label=f"Room-{room.number}",
                    room_occupancy=len(room.occupants),
                    name=p.name.strip(),
                    reg_code=p.reg_code,
                    gender=p.gender,
                    branch_short=p.branch_short,
                    type_="shared",
                    match_status=room.match_kind,
                    notes=room.match_detail,
                    check_in=p.check_in,
                    check_out=p.check_out,
                    person_id=pid,
                    sort_key=(0, room.number, pid),
                    extra_bed_recorded=extra_bed_by_id.get(pid, False),
                )
            )
    return rows


def build_private_attendee_rows(private_people: list[Person], extra_bed_by_id: dict[int, bool]) -> list[AttendeeRow]:
    # sorted by (trimmed) name -- no proximity semantics, P-N is just bookkeeping
    ordered = sorted(private_people, key=lambda p: p.name.strip().lower())
    rows = []
    for i, p in enumerate(ordered, start=1):
        rows.append(
            AttendeeRow(
                room_label=f"P-{i}",
                room_occupancy=1,
                name=p.name.strip(),
                reg_code=p.reg_code,
                gender=p.gender,
                branch_short=p.branch_short,
                type_="private",
                match_status="private",
                notes="private room — outside the shared_double optimization",
                check_in=p.check_in,
                check_out=p.check_out,
                person_id=p.id,
                sort_key=(1, i, p.id),
                extra_bed_recorded=extra_bed_by_id.get(p.id, False),
            )
        )
    return rows


def _room_number_from_label(label: str) -> int:
    return int(label.split("-")[1])


def apply_night14_consolidation(
    shared_rows: list[AttendeeRow], affinity, by_id, night14_date=NIGHT_DATES[0]
) -> tuple[list[AttendeeRow], dict[int, AttendeeRow]]:
    """
    Night-14 consolidation, design note "Night-14 consolidation (option B)".

    A shared guest present on the 14th whose PERMANENT roommate is absent
    that night is "stranded". Stranded guests are consolidated for that
    night ONLY: grouped by gender, paired into floor(n/2) rooms (an odd one
    stays alone, same as before this change), pair choice = maximize
    affinity weight (mutual/one-way), then same-branch count, then a
    deterministic reg-code tie-break — reusing the same enumerate_pairings +
    weight functions the residual-pool solver uses, not new pairing logic.
    Host room = whichever of the pair's PERMANENT rooms has the lower number;
    that becomes the shared room for the night. The mover's own permanent
    room has nobody in it that night, so it simply doesn't appear.

    This is report-rendering only — it never touches the permanent
    allocation, the objective, or Needs Review classification (those stay
    defined by the permanent room). Room/occupancy/match-status on Night 15
    are untouched; only Notes gain an explicit cross-reference for the two
    people involved, on BOTH nights, per the doc.

    Returns (night14_rows, night15_annotations) where night15_annotations
    maps person_id -> a replacement AttendeeRow (same room/occupancy/status,
    Notes appended) to splice into the Night 15 sheet for the host and mover.
    """
    by_room: dict[str, list[AttendeeRow]] = {}
    for row in shared_rows:
        by_room.setdefault(row.room_label, []).append(row)

    night14_rows: list[AttendeeRow] = []
    stranded: dict[str, list[AttendeeRow]] = {}  # gender -> stranded rows
    absent_by_pid: dict[int, list[AttendeeRow]] = {}

    for row in shared_rows:
        if row.check_in != night14_date:
            continue
        roommates = by_room[row.room_label]
        absent = [rm for rm in roommates if rm.person_id != row.person_id and rm.check_in != night14_date]
        if absent and row.room_occupancy > 1:
            stranded.setdefault(row.gender, []).append(row)
            absent_by_pid[row.person_id] = absent
        else:
            night14_rows.append(row)  # settled: roommate(s) present too, or already a solo room

    night15_annotations: dict[int, AttendeeRow] = {}

    for gender in sorted(stranded):
        pool_rows = {r.person_id: r for r in stranded[gender]}
        pool_ids = sorted(pool_rows)

        best = None
        for pairing in enumerate_pairings(pool_ids):
            aff_total = branch_total = 0
            for occ in pairing:
                if len(occ) == 2:
                    a, b = occ
                    key = (a, b) if a < b else (b, a)
                    entry = affinity.get(key, (0, {}))
                    aff_total += pref_only_weight(entry)
                    branch_total += branch_component(entry)
            reg_code_key = tuple(
                sorted((by_id[pid].reg_code for pid in occ)) for occ in sorted(pairing, key=lambda o: min(by_id[p].reg_code for p in o))
            )
            cand = (-aff_total, -branch_total, reg_code_key)
            if best is None or cand < best[0]:
                best = (cand, pairing)
        chosen = best[1]

        for occ in chosen:
            if len(occ) == 1:
                # odd leftover: stays alone, same "roommate not present" note as before
                (pid,) = occ
                row = pool_rows[pid]
                absent_names = ", ".join(f"{a.name} (arrives {a.check_in})" for a in absent_by_pid[pid])
                notes = f"{row.notes} — roommate(s) not present tonight: {absent_names}"
                # guest-facing: plain logistics, no internal reasoning
                guest_note = f"Roommate arrives {absent_by_pid[pid][0].check_in}." if len(absent_by_pid[pid]) == 1 else (
                    f"Roommates arrive {', '.join(a.check_in for a in absent_by_pid[pid])}."
                )
                night14_rows.append(dataclasses.replace(row, notes=notes, guest_notes=guest_note))
                continue

            a, b = occ
            row_a, row_b = pool_rows[a], pool_rows[b]
            host, mover = (
                (row_a, row_b)
                if _room_number_from_label(row_a.room_label) < _room_number_from_label(row_b.room_label)
                else (row_b, row_a)
            )

            host_note = f"{host.notes} — Night-14 consolidation: hosts {mover.name} (permanent {mover.room_label}) on 14th only."
            mover_note = f"{mover.notes} — Night-14 consolidation: shares {host.room_label} on 14th, moves to own {mover.room_label} on 15th."
            # guest-facing versions: logistics only, matches the doc's example phrasing directly
            host_guest_note = f"Hosts {mover.name} tonight only."
            mover_guest_note = f"Shares {host.room_label} on 14th, moves to {mover.room_label} on 15th."

            # sort_key must key off the HOST's room number for both rows —
            # otherwise the mover's row (relabeled to the host's room) would
            # sort back at its own now-vacant permanent room number and land
            # far away from the host it's actually sharing with tonight.
            host_room_num = _room_number_from_label(host.room_label)
            night14_rows.append(
                dataclasses.replace(
                    host, room_occupancy=2, notes=host_note, guest_notes=host_guest_note, sort_key=(0, host_room_num, host.person_id)
                )
            )
            night14_rows.append(
                dataclasses.replace(
                    mover,
                    room_label=host.room_label,
                    room_occupancy=2,
                    notes=mover_note,
                    guest_notes=mover_guest_note,
                    sort_key=(0, host_room_num, mover.person_id),
                )
            )

            night15_annotations[host.person_id] = dataclasses.replace(
                host,
                notes=f"{host.notes} — Night-14 consolidation: hosted {mover.name} (permanent {mover.room_label}) on 14th only; both back in own rooms from 15th.",
                guest_notes=f"Hosted {mover.name} on 14th only.",
            )
            night15_annotations[mover.person_id] = dataclasses.replace(
                mover,
                notes=f"{mover.notes} — Night-14 consolidation: shared {host.room_label} with {host.name} on 14th (own room unoccupied that night).",
                guest_notes=f"Shared {host.room_label} with {host.name} on 14th.",
            )

    return night14_rows, night15_annotations


def attendee_row_values(row: AttendeeRow) -> list:
    return [
        row.room_label,
        row.room_occupancy,
        row.name,
        row.reg_code,
        row.gender,
        row.check_in,
        row.check_out,
        row.branch_short,
        row.type_,
        row.match_status,
        row.notes,
    ]


def write_attendee_sheet(wb, title, rows: list[AttendeeRow], subtitle: str | None = None):
    ws = wb.create_sheet(title=title)
    # Event naming on the title row, minimal styling otherwise (decision doc
    # "Night-sheet extra-bed markers + branding" — review workbook keeps
    # TITLE_FONT, no fills/logo; this is an internal working document).
    ws.cell(row=1, column=1, value=f"{EVENT_TITLE} — {subtitle or title}").font = TITLE_FONT
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(ATTENDEE_HEADERS))

    header_row = 2
    for i, h in enumerate(ATTENDEE_HEADERS, start=1):
        ws.cell(row=header_row, column=i, value=h)
    style_header_row(ws, header_row, len(ATTENDEE_HEADERS))

    ordered = sorted(rows, key=lambda r: r.sort_key)
    r = header_row + 1
    for row in ordered:
        values = attendee_row_values(row)
        for i, v in enumerate(values, start=1):
            ws.cell(row=r, column=i, value=v)
        fill = SETTLED_FILL if row.match_status in ("mutual", "manual", "private") else REVIEW_FILL
        for c in range(1, len(ATTENDEE_HEADERS) + 1):
            ws.cell(row=r, column=c).border = BORDER
            ws.cell(row=r, column=c).fill = fill
        r += 1

    ws.freeze_panes = ws.cell(row=header_row + 1, column=1).coordinate
    autofit_columns(ws)
    return len(ordered)


# ── Hotel handoff workbook (Report format v3) ───────────────────────────────
#
# Shareable as-is with the hotel. NO internal vocabulary anywhere — no match
# status, no branch, no type, no "mutual"/"forced"/"manual"/"pinned"/"solo"/
# "affinity"/"needs review". Only what the hotel needs: who's in which room,
# when they arrive/leave, and any guest-logistics note (a room move, a
# delayed roommate) in the SAME plain language a front desk would use.

HOTEL_HEADERS = ["Room", "Occupancy", "Guest Name", "Reg Code", "Gender", "Check-in", "Check-out", "Notes"]

def format_night_title(date_str: str) -> str:
    d = date.fromisoformat(date_str)
    return f"Night of {d.strftime('%a %d %b %Y')}"


def rooms_needing_extra_bed_tonight(rows: list[AttendeeRow]) -> set[str]:
    """Rooms in THIS single night's attendee list that need an extra bed
    tonight — same two-source rule as the Bookings sheet (recorded
    registrations.extra_bed OR occupancy > 2), scoped to one night rather
    than the whole-event span, per design note "Night-sheet extra-bed
    markers": a clerk working from one night sheet needs nothing else."""
    by_room: dict[str, list[AttendeeRow]] = {}
    for row in rows:
        by_room.setdefault(row.room_label, []).append(row)
    needing = set()
    for room_label, room_rows in by_room.items():
        occupancy = room_rows[0].room_occupancy
        recorded = any(r.extra_bed_recorded for r in room_rows)
        if occupancy > 2 or recorded:
            needing.add(room_label)
    return needing


def hotel_row_values(row: AttendeeRow, extra_bed_rooms: set[str]) -> list:
    notes = row.guest_notes
    if row.room_label in extra_bed_rooms:
        notes = f"{notes} Extra bed required.".strip() if notes else "Extra bed required."
    return [row.room_label, row.room_occupancy, row.name, row.reg_code, row.gender, row.check_in, row.check_out, notes]


def write_hotel_night_sheet(wb, sheet_title, rows: list[AttendeeRow]):
    ws = wb.create_sheet(title=sheet_title)
    style_brand_title_row(ws, 1, len(HOTEL_HEADERS), sheet_title)

    header_row = 2
    for i, h in enumerate(HOTEL_HEADERS, start=1):
        ws.cell(row=header_row, column=i, value=h)
    style_header_row(ws, header_row, len(HOTEL_HEADERS))

    extra_bed_rooms = rooms_needing_extra_bed_tonight(rows)
    ordered = sorted(rows, key=lambda r: r.sort_key)
    r = header_row + 1
    for row in ordered:
        values = hotel_row_values(row, extra_bed_rooms)
        for i, v in enumerate(values, start=1):
            ws.cell(row=r, column=i, value=v)
        for c in range(1, len(HOTEL_HEADERS) + 1):
            ws.cell(row=r, column=c).border = BORDER
        r += 1

    ws.freeze_panes = ws.cell(row=header_row + 1, column=1).coordinate
    autofit_columns(ws)
    return len(ordered)


def _ordinal(day: int) -> str:
    if 11 <= day % 100 <= 13:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
    return f"{day}{suffix}"


def format_stay_line(night_dates: list[str], checkout_date: str) -> str:
    """Explicit stay line for the cover — team lead flagged that "Event
    dates: 14-15 August 2026" reads as the FULL stay to a hotel, when 14-15
    are the two NIGHTS and checkout is the 16th. States nights and checkout
    separately so it can't be misread as a booking window. checkout_date is
    derived from the actual data (max occupant check-out across all
    bookings), not a literal, so it stays correct if the event's length
    changes."""
    nights = sorted(date.fromisoformat(d) for d in night_dates)
    checkout = date.fromisoformat(checkout_date)
    first = nights[0]
    night_labels = " & ".join(_ordinal(n.day) for n in nights)
    if (first.year, first.month) == (checkout.year, checkout.month):
        range_str = f"{first.day}–{checkout.day} {first.strftime('%B %Y')}"
    else:
        range_str = f"{first.strftime('%d %b %Y')} – {checkout.strftime('%d %b %Y')}"
    return f"Stay: {range_str} (nights of {night_labels}; checkout {_ordinal(checkout.day)})"


def build_hotel_cover_sheet(wb, night_room_counts: dict[str, dict[str, int]], bookings: list[dict] | None = None):
    """night_room_counts: {date_str: {"shared": n, "private": n}} — distinct
    ROOM counts (not attendee counts) per night, for hotel provisioning.
    bookings: optional Bookings-sheet data (see build_bookings_rows) — when
    given, adds 2-night-room count and per-night extra-bed counts.

    Front page per design note "Night-sheet extra-bed markers + branding":
    event identity (name, college, batch, dates — all sourced from repo docs,
    nothing invented) over a soft-aqua banner, with the Smriti logo embedded
    from public/assets if the file is present; text-only otherwise."""
    ws = wb.create_sheet(title="Cover")

    banner_rows, banner_cols = 5, 6
    for rr in range(1, banner_rows + 1):
        for c in range(1, banner_cols + 1):
            ws.cell(row=rr, column=c).fill = BRAND_TITLE_FILL

    if bookings:
        checkout_date = max(b["checkout"] for b in bookings)
    else:
        # defensive fallback only — no per-guest data to derive checkout
        # from, so this is the day after the last covered night, not an
        # observed fact
        checkout_date = (max(date.fromisoformat(d) for d in NIGHT_DATES) + timedelta(days=1)).isoformat()

    ws.cell(row=1, column=1, value=EVENT_TITLE).font = BRAND_HEADLINE_FONT
    ws.cell(row=2, column=1, value=EVENT_SUBTITLE).font = BRAND_SUBHEAD_FONT
    ws.cell(row=3, column=1, value="Hotel Room Handoff").font = Font(italic=True, size=11, color=BRAND_CHARCOAL)
    ws.cell(row=4, column=1, value=format_stay_line(NIGHT_DATES, checkout_date)).font = BRAND_META_FONT
    ws.cell(row=5, column=1, value=f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}").font = BRAND_META_FONT

    if os.path.isfile(LOGO_PATH):
        try:
            logo = XLImage(LOGO_PATH)
            logo.width, logo.height = 90, 90
            logo.anchor = f"{get_column_letter(banner_cols)}1"
            ws.add_image(logo)
        except Exception as e:
            print(f"  (cover sheet: logo embed skipped — {e})")
    else:
        print(f"  (cover sheet: no logo found at {LOGO_PATH} — text-only branding)")

    r = banner_rows + 2
    ws.cell(row=r, column=1, value="Night").font = Font(bold=True)
    ws.cell(row=r, column=2, value="Shared Rooms").font = Font(bold=True)
    ws.cell(row=r, column=3, value="Private Rooms").font = Font(bold=True)
    ws.cell(row=r, column=4, value="Total Rooms").font = Font(bold=True)
    style_header_row(ws, r, 4)
    r += 1
    for date_str in NIGHT_DATES:
        counts = night_room_counts.get(date_str, {"shared": 0, "private": 0})
        total = counts["shared"] + counts["private"]
        ws.cell(row=r, column=1, value=format_night_title(date_str))
        ws.cell(row=r, column=2, value=counts["shared"])
        ws.cell(row=r, column=3, value=counts["private"])
        ws.cell(row=r, column=4, value=total)
        for c in range(1, 5):
            ws.cell(row=r, column=c).border = BORDER
        r += 1

    if bookings:
        r += 1
        two_night_rooms = sum(1 for b in bookings if b["nights"] == 2)
        ws.cell(row=r, column=1, value="2-night rooms").font = Font(bold=True)
        ws.cell(row=r, column=2, value=two_night_rooms)
        r += 1

        for date_str in NIGHT_DATES:
            extra_beds = sum(1 for b in bookings if b["needs_extra_bed_by_night"].get(date_str, False))
            ws.cell(row=r, column=1, value=f"Extra beds required — {format_night_title(date_str)}").font = Font(bold=True)
            ws.cell(row=r, column=2, value=extra_beds)
            r += 1

    autofit_columns(ws, min_width=14)
    return ws


def build_bookings_rows(night14_rows: list[AttendeeRow], night15_rows_all: list[AttendeeRow]) -> list[dict]:
    """
    One entry per distinct room (shared + private). Room span = the earliest
    NIGHT the room is actually occupied by anyone -> the latest guest
    check-out among those occupants. This is NOT the same as a guest's own
    personal check-in date: Night-14 consolidation can put a guest in a room
    that isn't their own that night (e.g. Uma Joiner physically
    stays in Room-15 on the 14th; his own Room-20 sits empty that night and
    only starts being occupied the 15th when he and his real roommate
    actually use it) — so span is derived from which of the two per-night
    attendee lists a room label actually appears in, not from any single
    guest's check_in field.

    Extra Bed = Yes from TWO sources, per night (design note "Hotel bookings
    view", 2026-08-13 addendum):
    (a) recorded — the registration's own `extra_bed` D1 field is set for a
    guest actually present that night (read off AttendeeRow.extra_bed_recorded,
    itself sourced from the registrations table, not hardcoded to any name);
    (b) derived — the room's occupancy that night exceeds the standard double
    capacity of 2 (generic rule, not a Room-8 special case; it happens to
    produce exactly one derived Yes on current data because Room-8
    (room_capacity: 3 pin) is the only room whose occupancy ever exceeds 2).
    A room's overall Extra Bed is Yes if either source fires on any night it's
    occupied.
    """
    by_room: dict[str, dict] = {}

    def note_night(rows: list[AttendeeRow], night_date: str):
        for row in rows:
            entry = by_room.setdefault(
                row.room_label,
                {"occupancy_by_night": {}, "recorded_by_night": {}, "checkouts": [], "guests": {}, "sort_key": row.sort_key[:2]},
            )
            # max(), not overwrite: two rows can land on the same room+night
            # (host + mover, night-14 consolidation) and each carries the
            # room's full occupancy that night, so this is already the
            # per-night total, not additive.
            entry["occupancy_by_night"][night_date] = max(entry["occupancy_by_night"].get(night_date, 0), row.room_occupancy)
            entry["recorded_by_night"][night_date] = entry["recorded_by_night"].get(night_date, False) or row.extra_bed_recorded
            entry["checkouts"].append(row.check_out)
            entry["guests"][row.person_id] = row.name
            entry["sort_key"] = min(entry["sort_key"], row.sort_key[:2])

    note_night(night14_rows, NIGHT_DATES[0])
    note_night(night15_rows_all, NIGHT_DATES[1])

    bookings = []
    for room_label, entry in by_room.items():
        nights_occupied = set(entry["occupancy_by_night"])
        checkin = min(nights_occupied)
        checkout = max(entry["checkouts"])
        nights = (date.fromisoformat(checkout) - date.fromisoformat(checkin)).days
        max_occupancy = max(entry["occupancy_by_night"].values())
        needs_extra_bed_by_night = {
            night_date: entry["occupancy_by_night"][night_date] > 2 or entry["recorded_by_night"].get(night_date, False)
            for night_date in nights_occupied
        }
        guests_str = ", ".join(name for _, name in sorted(entry["guests"].items()))
        bookings.append(
            {
                "room_label": room_label,
                "checkin": checkin,
                "checkout": checkout,
                "nights": nights,
                "max_occupancy": max_occupancy,
                "extra_bed": "Yes" if any(needs_extra_bed_by_night.values()) else "No",
                "guests": guests_str,
                "occupancy_by_night": entry["occupancy_by_night"],
                "needs_extra_bed_by_night": needs_extra_bed_by_night,
                "sort_key": entry["sort_key"],
            }
        )
    bookings.sort(key=lambda b: b["sort_key"])
    return bookings


BOOKINGS_HEADERS = ["Room", "Check-in", "Check-out", "Nights", "Max Occupancy", "Extra Bed", "Guests"]


def write_bookings_sheet(wb, bookings: list[dict]):
    ws = wb.create_sheet(title="Bookings")
    style_brand_title_row(ws, 1, len(BOOKINGS_HEADERS), "Bookings — one row per room")

    header_row = 2
    for i, h in enumerate(BOOKINGS_HEADERS, start=1):
        ws.cell(row=header_row, column=i, value=h)
    style_header_row(ws, header_row, len(BOOKINGS_HEADERS))

    r = header_row + 1
    for b in bookings:
        values = [b["room_label"], b["checkin"], b["checkout"], b["nights"], b["max_occupancy"], b["extra_bed"], b["guests"]]
        for i, v in enumerate(values, start=1):
            ws.cell(row=r, column=i, value=v)
        for c in range(1, len(BOOKINGS_HEADERS) + 1):
            ws.cell(row=r, column=c).border = BORDER
        r += 1

    ws.freeze_panes = ws.cell(row=header_row + 1, column=1).coordinate
    autofit_columns(ws)
    return len(bookings)


def build_summary_sheet(wb, result, dataset, raw_reg_count, raw_pref_count, raw_private_count, env, weights):
    ws = wb.create_sheet(title="Summary")
    by_id = result["by_id"]
    rooms = result["rooms"]

    r = 1
    ws.cell(row=r, column=1, value=f"{EVENT_TITLE} — Room Allocation Summary").font = TITLE_FONT
    r += 2

    def kv(label, value):
        nonlocal r
        ws.cell(row=r, column=1, value=label).font = Font(bold=True)
        ws.cell(row=r, column=2, value=value)
        r += 1

    kv("Generated", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
    kv("Data source", f"{env} D1")
    kv("Shared population (accommodation=shared_double, in the optimization)", len(dataset.people))
    kv("  Male", sum(1 for p in dataset.people if p.gender == "male"))
    kv("  Female", sum(1 for p in dataset.people if p.gender == "female"))
    kv("Private population (accommodation=private, report-only, never in the solver)", raw_private_count)
    kv("Night 15 Aug attendee rows (shared + private)", len(dataset.people) + raw_private_count)
    kv("Preference edges (raw)", raw_pref_count)
    kv("Preference edges (clean, after stale-edge filter)", result["clean_edge_count"])
    kv("Preference edges dropped (stale)", len(result["dropped_edges"]))
    r += 1

    kv("Shared rooms (solver output — capacity strictly 2, except manual pins)", len(rooms))
    mutual_rooms = [x for x in rooms if x.match_kind == "mutual"]
    manual_rooms = [x for x in rooms if x.match_kind == "manual"]
    settled_rooms = [x for x in rooms if is_settled(x)]
    people_settled = sum(len(x.occupants) for x in settled_rooms)
    kv("Mutual rooms (settled — real preference satisfied)", len(mutual_rooms))
    kv("Manual rooms (settled — human-decided pin, see Pinned Groups below)", len(manual_rooms))
    kv("Settled total (% of people needing no review)", f"{len(settled_rooms)} rooms, {people_settled / len(dataset.people) * 100:.1f}% of population")
    kv("Needs-review rooms", len([x for x in rooms if not is_settled(x)]))
    kv("Solo rooms", len([x for x in rooms if x.match_kind == "solo"]))
    r += 1

    kv("Objective (Σ preference-weight × distance)", result["objective"])
    r += 1

    ws.cell(row=r, column=1, value="Weights used (R12, tunable — committee has not signed off)").font = Font(bold=True)
    r += 1
    for k, v in weights.items():
        kv(f"  {k}", v)
    r += 1

    ws.cell(row=r, column=1, value="Residual-pool solver (brute-force, authoritative) vs. old staged matching — sanity check").font = Font(bold=True)
    r += 1
    for gender, info in result["residual_solve"].items():
        kv(f"  {gender} pool size", len(info["pool"]))
        kv(f"  {gender} pairings enumerated", info["pairings_tried"])
        kv(f"  {gender} brute-force pref-only cost", info["pref_cost"])
        kv(f"  {gender} staged pref-only cost (same pool)", info["staged_pref_cost"])
        gap = info["staged_pref_cost"] - info["pref_cost"]
        kv(f"  {gender} sanity verdict", "brute-force matches staged" if gap == 0 else f"brute-force wins by {gap}")
    r += 1

    ws.cell(row=r, column=1, value="Stage B residual-graph components (branch excluded from ordering weight)").font = Font(bold=True)
    r += 1
    any_greedy = False
    for c in result["component_report"]:
        note = ""
        if c["used_greedy"]:
            note = f" -- GREEDY FALLBACK (exceeds exact threshold {BRUTE_FORCE_COMPONENT_LIMIT})"
            any_greedy = True
        kv(f"  component size", f"{c['size']}{note}")
    kv("Any greedy fallback used", "YES — see flagged component(s) above" if any_greedy else "No — all orderings exactly optimal")
    r += 1

    ws.cell(row=r, column=1, value="Mutual cliques (size >= 3) — 2-of-3 split chosen by the residual-pool search").font = Font(bold=True)
    r += 1
    for c in result["cliques"]:
        names = ", ".join(by_id[m].name for m in c["members"])
        kv(f"  {c['gender']} clique", names)
    r += 1

    if manual_rooms:
        ws.cell(row=r, column=1, value="Pinned Groups (manual, removed from Stage A entirely — human-decided, not reviewer judgment)").font = Font(bold=True)
        r += 1
        # row-per-attendee, matching the night-sheet convention (Report format v2)
        for room in sorted(manual_rooms, key=lambda x: x.number):
            for pid in room.occupants:
                p = by_id[pid]
                kv(f"  Room-{room.number} [{room.gender}, capacity {len(room.occupants)}]", f"{p.name.strip()} ({p.reg_code})")
        nums = sorted(x.number for x in manual_rooms)
        if len(nums) > 1:
            kv("  Room numbers", f"{nums} (adjacent: {'yes' if all(nums[i+1]-nums[i]==1 for i in range(len(nums)-1)) else 'NO'})")

    autofit_columns(ws, min_width=10, max_width=70)
    return ws


def main():
    ap = argparse.ArgumentParser()
    add_env_argument(ap)
    ap.add_argument("--token", help="path to a file containing the CF token")
    ap.add_argument("--dry-run", action="store_true", help="print summary, don't write the xlsx")
    ap.add_argument("--out", default=DEFAULT_OUT, help="review workbook output path")
    ap.add_argument("--hotel-out", default=DEFAULT_HOTEL_OUT, help="hotel handoff workbook output path")
    args = ap.parse_args()

    token = preflight(args.env, args.token)
    dataset, raw_reg_count, raw_pref_count, extra_bed_by_id = load_dataset(token, args.env)
    print(f"{raw_reg_count} shared_double registrations, {raw_pref_count} preference edges pulled from {args.env}")

    private_people, private_extra_bed_by_id = load_private_people(token, args.env)
    print(f"{len(private_people)} private registrations pulled from {args.env} (report-only, never in the solver)")
    all_extra_bed_by_id = {**extra_bed_by_id, **private_extra_bed_by_id}
    recorded_extra_bed_names = [p.name.strip() for p in dataset.people + private_people if all_extra_bed_by_id.get(p.id, False)]
    print(f"recorded extra_bed=1 (D1 field, either accommodation type): {len(recorded_extra_bed_names)} "
          f"({', '.join(recorded_extra_bed_names) if recorded_extra_bed_names else 'none'})")

    pinned_groups = resolve_manual_groups(MANUAL_GROUPS, dataset)
    if pinned_groups:
        by_id_preview = dataset.by_id()
        print(f"\n{len(pinned_groups)} manual pinned group(s) configured:")
        for group in pinned_groups:
            ids = group["ids"]
            names = ", ".join(f"{by_id_preview[pid].name.strip()} (#{pid})" for pid in ids)
            nights = {(by_id_preview[pid].check_in, by_id_preview[pid].check_out) for pid in ids}
            print(f"  capacity={group['capacity']}  [{names}]  nights: {nights}")

    result = run_allocation(dataset, WEIGHTS, pinned_groups=pinned_groups)
    print_console_summary(result, dataset, raw_reg_count, raw_pref_count)

    shared_rows = build_shared_attendee_rows(result, extra_bed_by_id)
    private_rows = build_private_attendee_rows(private_people, private_extra_bed_by_id)

    night14_shared_rows, night15_annotations = apply_night14_consolidation(shared_rows, result["affinity"], result["by_id"])
    private_night14_rows = [r for r in private_rows if r.check_in == NIGHT_DATES[0]]
    night14_rows = night14_shared_rows + private_night14_rows

    # splice the "explicit note on both nights" annotations into the Night 15
    # shared rows for the host/mover, without touching room/occupancy/status
    night15_shared_rows = [night15_annotations.get(r.person_id, r) for r in shared_rows]

    if night15_annotations:
        consolidated_names = ", ".join(sorted(r.name for r in night15_annotations.values()))
        print(f"\nNight-14 consolidation applied: {len(night15_annotations)} people annotated ({consolidated_names})")

    print(f"\nreport format v2 row counts:")
    print(f"  Night 15 Aug: {len(shared_rows) + len(private_rows)} attendee rows "
          f"({len(shared_rows)} shared + {len(private_rows)} private)")
    print(f"  Night 14 Aug: {len(night14_rows)} attendee rows "
          f"({len(night14_shared_rows)} shared + {len(private_night14_rows)} private)")

    night15_rows_all = night15_shared_rows + private_rows

    night_room_counts = {
        NIGHT_DATES[0]: {
            "shared": len({r.room_label for r in night14_shared_rows}),
            "private": len(private_night14_rows),
        },
        NIGHT_DATES[1]: {
            "shared": len({r.room_label for r in night15_shared_rows}),
            "private": len(private_rows),
        },
    }
    bookings = build_bookings_rows(night14_rows, night15_rows_all)
    extra_bed_rooms = [b for b in bookings if b["extra_bed"] == "Yes"]
    two_night_rooms = [b for b in bookings if b["nights"] == 2]
    print(f"\nbookings: {len(bookings)} rooms (expect 49 = 35 shared + 14 private)")
    print(f"  extra-bed rooms (recorded extra_bed=1, or occupancy > 2 on any occupied night): {[b['room_label'] for b in extra_bed_rooms]}")
    print(f"  2-night rooms: {len(two_night_rooms)}")

    if args.dry_run:
        print("\n--dry-run: not writing the report")
        return

    # --- Review workbook (existing v2 + consolidation format, now with dates) ---
    wb = Workbook()
    wb.remove(wb.active)

    night15_count = write_attendee_sheet(wb, "Night 15 Aug", night15_rows_all)
    night14_count = write_attendee_sheet(wb, "Night 14 Aug", night14_rows)
    review_rows = [r for r in shared_rows if r.match_status not in ("mutual", "manual")]
    review_count = write_attendee_sheet(
        wb, "Needs Review", review_rows, subtitle="Needs Review — judgment attendees only (mutual + manual/pinned rooms are settled; private is out of scope)"
    )
    build_summary_sheet(wb, result, dataset, raw_reg_count, raw_pref_count, len(private_people), args.env, WEIGHTS)

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    wb.save(args.out)

    # --- Hotel handoff workbook (Report format v3) — separate file, zero internal vocabulary ---
    wb_hotel = Workbook()
    wb_hotel.remove(wb_hotel.active)
    build_hotel_cover_sheet(wb_hotel, night_room_counts, bookings)
    hotel_night14_count = write_hotel_night_sheet(wb_hotel, format_night_title(NIGHT_DATES[0]), night14_rows)
    hotel_night15_count = write_hotel_night_sheet(wb_hotel, format_night_title(NIGHT_DATES[1]), night15_rows_all)
    bookings_count = write_bookings_sheet(wb_hotel, bookings)

    os.makedirs(os.path.dirname(args.hotel_out), exist_ok=True)
    wb_hotel.save(args.hotel_out)

    print(f"\nsheet row counts: Night 15 Aug={night15_count}, Night 14 Aug={night14_count}, Needs Review={review_count}")
    print(f"Wrote {args.out}")
    print(f"\nhotel workbook room totals: 14th={night_room_counts[NIGHT_DATES[0]]}, 15th={night_room_counts[NIGHT_DATES[1]]}")
    print(f"hotel sheet row counts: {format_night_title(NIGHT_DATES[0])}={hotel_night14_count}, {format_night_title(NIGHT_DATES[1])}={hotel_night15_count}, Bookings={bookings_count}")
    print(f"Wrote {args.hotel_out}")


if __name__ == "__main__":
    main()
