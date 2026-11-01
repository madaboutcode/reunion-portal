#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["openpyxl"]
# ///
"""Build tmp/desk-roster-<date>.xlsx — batch-wise registration desk handout sheets.

One sheet per branch (portrait A4, max font size), sorted by name. Columns:
  [branch tab] | ID | Name | Type | T-Shirts | V | NV | Kids | WhatsApp

The branch short name is printed rotated 90° in a tall merged cell on the
left edge — visible from the side when sheets are stacked.

V/NV = total food coupon count for the whole group (alumni + spouse/guests + children).
Kids  = children count with veg/nonveg split, dash if none.
T-Shirts = all shirts for the registration, sizes only (no gender), counts.

Plus a Summary sheet with per-branch totals.

READ-ONLY: only issues SELECTs against D1.


Requires --env stg|prod (no default). Account, D1 database and R2 come from
src/server/wrangler.toml; the token from CLOUDFLARE_API_TOKEN (process env or .env.ops) or --token <file>.
Output: tmp/desk-roster-<date>.xlsx (names, WhatsApp numbers) (tmp/ is git-ignored; the file contains personal data).

Usage:
  uv run scripts/build-desk-roster.py --env prod
  uv run scripts/build-desk-roster.py --env stg
  uv run scripts/build-desk-roster.py --env stg --dry-run
  uv run scripts/build-desk-roster.py --env prod --token tmp/cf-token.txt
"""
import argparse
import math
import os
import subprocess
from collections import defaultdict
from datetime import date

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

# Cloudflare settings (account, D1 database, token) are resolved in ops_common.py via site_config.py.
from ops_common import add_env_argument, d1_query, preflight  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PORTAL = os.path.dirname(HERE)

REGISTRATIONS_SQL = """
SELECT id, full_name, branch, alumni_meal, participation_type, whatsapp
FROM registrations
WHERE participation_type != 'donation_only' OR participation_type IS NULL
"""

ATTENDEES_SQL = """
SELECT registration_id, type, meal
FROM attendees
"""

TSHIRTS_SQL = """
SELECT registration_id, size
FROM tshirts
"""

BRANCH_ORDER = {
    "Architecture": "Arch",
    "Chemical Engineering": "Chem",
    "Civil Engineering": "Civil",
    "Computer Science & Engineering": "CSE",
    "Electrical & Electronics Engineering": "EEE",
    "Electronics & Communication Engineering": "ECE",
    "Mechanical Engineering": "ME",
    "Production Engineering": "PE",
}

PARTICIPATION_LABELS = {
    "full_celebration": "Full",
    "campus_only": "Campus",
}

# ── Page geometry ───────────────────────────────────────────────────────────
#
# A4 portrait: 210mm × 297mm = 8.27" × 11.69"
#
# Excel column width is measured in "number of characters that fit" using
# the Normal style font. At the default size 11, one character-width unit
# ≈ 7 pixels at 96 dpi ≈ 0.073". The relationship scales linearly with
# font size: char_width_inches ≈ 0.073 * (font_size / 11).
#
# We fix margins, a branch-tab column width (in inches), and the relative
# proportions of the 8 data columns, then solve for the largest integer
# font size where everything fits the printable width.

A4_WIDTH_IN = 8.27
MARGIN_LEFT_IN = 0.35
MARGIN_RIGHT_IN = 0.35
TAB_COL_IN = 0.45  # rotated branch label

PRINTABLE_DATA_WIDTH_IN = A4_WIDTH_IN - MARGIN_LEFT_IN - MARGIN_RIGHT_IN - TAB_COL_IN

# Column proportions in character-widths (relative, not absolute).
# These get scaled to fill available width at the chosen font size.
COL_PROPORTIONS = {
    "ID":       5,
    "Name":    24,
    "Type":     7,
    "T-Shirts":12,
    "V":        3,
    "NV":       3,
    "Kids":     9,
    "WhatsApp":12,
}
HEADERS = list(COL_PROPORTIONS.keys())
TOTAL_PROPORTION = sum(COL_PROPORTIONS.values())

CHAR_WIDTH_AT_11 = 0.073  # inches per column-width unit at font size 11


def compute_max_font_size():
    for sz in range(20, 8, -1):
        char_in = CHAR_WIDTH_AT_11 * (sz / 11)
        total_in = TOTAL_PROPORTION * char_in
        if total_in <= PRINTABLE_DATA_WIDTH_IN:
            return sz
    return 9


def col_widths_for_font(font_size):
    char_in = CHAR_WIDTH_AT_11 * (font_size / 11)
    avail_chars = PRINTABLE_DATA_WIDTH_IN / char_in
    scale = avail_chars / TOTAL_PROPORTION
    return {k: max(3, round(v * scale, 1)) for k, v in COL_PROPORTIONS.items()}


# ── Styling ─────────────────────────────────────────────────────────────────

THIN = Side(style="thin", color="B0B0B0")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
CHARCOAL = "1F2A33"
HEADER_FILL = PatternFill(start_color=CHARCOAL, end_color=CHARCOAL, fill_type="solid")
TAB_FILL = PatternFill(start_color=CHARCOAL, end_color=CHARCOAL, fill_type="solid")


def make_fonts(size):
    return {
        "body": Font(size=size),
        "header": Font(bold=True, color="FFFFFF", size=size),
        "title": Font(bold=True, size=size + 2),
        "total": Font(bold=True, size=size),
        "tab": Font(bold=True, color="FFFFFF", size=size + 8),
    }


def style_header(ws, row, col_start, ncols, font):
    for c in range(col_start, col_start + ncols):
        cell = ws.cell(row=row, column=c)
        cell.font = font
        cell.fill = HEADER_FILL
        cell.border = BORDER
        cell.alignment = Alignment(horizontal="center", vertical="center")


# ── D1 access ───────────────────────────────────────────────────────────────

# ── Data helpers ─────────────────────────────────────────────────────────────

def is_veg(meal):
    return (meal or "").lower() in ("veg", "vegetarian")


def format_tshirts(shirts):
    if not shirts:
        return ""
    counts = defaultdict(int)
    for s in shirts:
        counts[s["size"]] += 1
    SIZE_ORDER = ["2XS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"]
    ordered = sorted(counts.items(), key=lambda x: SIZE_ORDER.index(x[0]) if x[0] in SIZE_ORDER else 99)
    return ", ".join(f"{c}×{sz}" if c > 1 else sz for sz, c in ordered)


def format_kids(children):
    if not children:
        return "—"
    v = sum(1 for c in children if is_veg(c["meal"]))
    nv = len(children) - v
    n = len(children)
    if v and nv:
        return f"{n} ({v}V {nv}NV)"
    tag = "V" if v else "NV"
    return f"{n}({tag})"


def build_row(reg, attendees, shirts):
    alumni_veg = 1 if is_veg(reg["alumni_meal"]) else 0
    alumni_nv = 1 - alumni_veg

    guests = [a for a in attendees if a["type"] in ("spouse", "guest")]
    children = [a for a in attendees if a["type"] == "child"]

    guest_veg = sum(1 for g in guests if is_veg(g["meal"]))
    guest_nv = len(guests) - guest_veg
    child_veg = sum(1 for c in children if is_veg(c["meal"]))
    child_nv = len(children) - child_veg

    total_v = alumni_veg + guest_veg + child_veg
    total_nv = alumni_nv + guest_nv + child_nv

    return {
        "id": reg["id"],
        "name": (reg["full_name"] or "").strip(),
        "type": PARTICIPATION_LABELS.get(reg["participation_type"], reg["participation_type"] or ""),
        "tshirts": format_tshirts(shirts),
        "v": total_v,
        "nv": total_nv,
        "kids": format_kids(children),
        "whatsapp": reg["whatsapp"] or "",
    }


# ── Sheet builders ──────────────────────────────────────────────────────────

def build_branch_sheet(wb, branch_full, short_name, rows, font_size, col_widths):
    fonts = make_fonts(font_size)
    ws = wb.create_sheet(title=short_name)

    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.orientation = "portrait"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.page_margins.left = MARGIN_LEFT_IN
    ws.page_margins.right = MARGIN_RIGHT_IN
    ws.page_margins.top = 0.4
    ws.page_margins.bottom = 0.4

    row_height = font_size * 1.6
    data_col_start = 2  # column A is the tab

    # -- Branch tab: column A, merged down all data rows --
    tab_width_chars = TAB_COL_IN / (CHAR_WIDTH_AT_11 * (font_size / 11))
    ws.column_dimensions["A"].width = max(3, round(tab_width_chars, 1))

    # -- Title row (spans data columns) --
    title_cell = ws.cell(row=1, column=data_col_start,
                         value=f"{branch_full} ({len(rows)})")
    title_cell.font = fonts["title"]
    ws.merge_cells(start_row=1, start_column=data_col_start,
                   end_row=1, end_column=data_col_start + len(HEADERS) - 1)
    ws.row_dimensions[1].height = row_height + 4

    # -- Header row --
    hr = 2
    for i, h in enumerate(HEADERS):
        ws.cell(row=hr, column=data_col_start + i, value=h)
    style_header(ws, hr, data_col_start, len(HEADERS), fonts["header"])
    ws.row_dimensions[hr].height = row_height

    # -- Column widths --
    for i, h in enumerate(HEADERS):
        ws.column_dimensions[get_column_letter(data_col_start + i)].width = col_widths[h]

    # -- Data rows --
    sorted_rows = sorted(rows, key=lambda r: r["name"].lower())
    center_cols = {0, 2, 4, 5, 6}  # ID, Type, V, NV, Kids (0-indexed within data)
    for ri, row in enumerate(sorted_rows, start=hr + 1):
        ws.row_dimensions[ri].height = row_height
        vals = [row["id"], row["name"], row["type"], row["tshirts"],
                row["v"], row["nv"], row["kids"], row["whatsapp"]]
        for ci, val in enumerate(vals):
            cell = ws.cell(row=ri, column=data_col_start + ci, value=val)
            cell.font = fonts["body"]
            cell.border = BORDER
            if ci == 1:  # Name column
                cell.alignment = Alignment(wrap_text=True, vertical="center")
            elif ci in center_cols:
                cell.alignment = Alignment(horizontal="center", vertical="center")
            else:
                cell.alignment = Alignment(vertical="center")

    last_data_row = hr + len(sorted_rows)

    # -- Branch tab cell (column A, rows 1..last_data_row) --
    if last_data_row > 1:
        ws.merge_cells(start_row=1, start_column=1, end_row=last_data_row, end_column=1)
    tab_cell = ws.cell(row=1, column=1, value=short_name.upper())
    tab_cell.font = fonts["tab"]
    tab_cell.fill = TAB_FILL
    tab_cell.alignment = Alignment(text_rotation=90, horizontal="center",
                                   vertical="top")
    tab_cell.border = BORDER

    ws.freeze_panes = ws.cell(row=hr + 1, column=data_col_start).coordinate
    return len(sorted_rows)


def build_summary_sheet(wb, branch_data, font_size):
    fonts = make_fonts(font_size)
    ws = wb.create_sheet(title="Summary")

    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.orientation = "portrait"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_margins.left = MARGIN_LEFT_IN
    ws.page_margins.right = MARGIN_RIGHT_IN
    ws.page_margins.top = 0.5
    ws.page_margins.bottom = 0.5

    row_height = font_size * 1.6

    ws.cell(row=1, column=1, value="Registration Desk — Summary").font = Font(bold=True, size=font_size + 4)
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=8)
    ws.row_dimensions[1].height = row_height + 8

    headers = ["Branch", "Count", "Full", "Campus", "Veg", "Non-Veg", "Kids", "T-Shirts"]
    hr = 3
    for i, h in enumerate(headers, 1):
        ws.cell(row=hr, column=i, value=h)
    style_header(ws, hr, 1, len(headers), fonts["header"])
    ws.row_dimensions[hr].height = row_height

    grand = {"count": 0, "full": 0, "campus": 0, "v": 0, "nv": 0, "kids": 0, "shirts": 0}
    r = hr + 1
    for branch_full in BRANCH_ORDER:
        rows = branch_data.get(branch_full, [])
        if not rows:
            continue
        count = len(rows)
        full = sum(1 for x in rows if x["type"] == "Full")
        campus = sum(1 for x in rows if x["type"] == "Campus")
        v = sum(x["v"] for x in rows)
        nv = sum(x["nv"] for x in rows)
        kids_count = 0
        for x in rows:
            k = x["kids"]
            if k == "—":
                continue
            n = k.split("(")[0].strip() if "(" in k else k
            try:
                kids_count += int(n)
            except ValueError:
                pass
        shirt_count = sum(1 for x in rows if x["tshirts"])

        ws.row_dimensions[r].height = row_height
        vals = [branch_full, count, full, campus, v, nv, kids_count, shirt_count]
        for ci, val in enumerate(vals, 1):
            cell = ws.cell(row=r, column=ci, value=val)
            cell.font = fonts["body"]
            cell.border = BORDER
            if ci >= 2:
                cell.alignment = Alignment(horizontal="center")

        grand["count"] += count
        grand["full"] += full
        grand["campus"] += campus
        grand["v"] += v
        grand["nv"] += nv
        grand["kids"] += kids_count
        grand["shirts"] += shirt_count
        r += 1

    ws.row_dimensions[r].height = row_height
    vals = ["TOTAL", grand["count"], grand["full"], grand["campus"],
            grand["v"], grand["nv"], grand["kids"], grand["shirts"]]
    for ci, val in enumerate(vals, 1):
        cell = ws.cell(row=r, column=ci, value=val)
        cell.font = fonts["total"]
        cell.border = BORDER
        if ci >= 2:
            cell.alignment = Alignment(horizontal="center")

    # autofit summary columns
    for row in ws.iter_rows():
        for cell in row:
            if cell.value is None:
                continue
            col = cell.column_letter
            cur = ws.column_dimensions[col].width or 0
            ws.column_dimensions[col].width = max(cur, min(len(str(cell.value)) + 3, 35), 8)


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Build desk-roster Excel from D1")
    add_env_argument(parser)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--token", help="Path to CF API token file")
    args = parser.parse_args()

    db = args.env  # d1_query takes the environment name
    token = preflight(args.env, args.token)

    print(f"Querying {args.env} D1...")
    regs = d1_query(token, db, REGISTRATIONS_SQL)
    attendees_raw = d1_query(token, db, ATTENDEES_SQL)
    shirts_raw = d1_query(token, db, TSHIRTS_SQL)
    print(f"  {len(regs)} registrations, {len(attendees_raw)} attendees, {len(shirts_raw)} tshirts")

    att_by_reg = defaultdict(list)
    for a in attendees_raw:
        att_by_reg[a["registration_id"]].append(a)

    shirts_by_reg = defaultdict(list)
    for s in shirts_raw:
        shirts_by_reg[s["registration_id"]].append(s)

    branch_data = defaultdict(list)
    unknown_branches = set()
    for reg in regs:
        row = build_row(reg, att_by_reg.get(reg["id"], []), shirts_by_reg.get(reg["id"], []))
        branch = reg["branch"] or "Unknown"
        if branch not in BRANCH_ORDER:
            unknown_branches.add(branch)
        branch_data[branch].append(row)

    if unknown_branches:
        print(f"  Warning: unknown branches: {unknown_branches}")

    font_size = compute_max_font_size()
    col_widths = col_widths_for_font(font_size)
    print(f"  Font size: {font_size}pt (max for A4 portrait, {PRINTABLE_DATA_WIDTH_IN:.2f}\" data width)")

    if args.dry_run:
        for branch_full in BRANCH_ORDER:
            rows = branch_data.get(branch_full, [])
            short = BRANCH_ORDER[branch_full]
            v = sum(x["v"] for x in rows)
            nv = sum(x["nv"] for x in rows)
            print(f"  {short:<6} {len(rows):>3} regs, {v:>3}V {nv:>3}NV")
        total = sum(len(v) for v in branch_data.values())
        print(f"  Total: {total} registrations")
        return

    wb = Workbook()
    wb.remove(wb.active)

    for branch_full in BRANCH_ORDER:
        rows = branch_data.get(branch_full, [])
        if not rows:
            continue
        short = BRANCH_ORDER[branch_full]
        n = build_branch_sheet(wb, branch_full, short, rows, font_size, col_widths)
        print(f"  {short:<6} {n:>3} registrants")

    for branch in sorted(unknown_branches):
        rows = branch_data[branch]
        short = branch[:10]
        build_branch_sheet(wb, branch, short, rows, font_size, col_widths)
        print(f"  {short:<10} {len(rows):>3} registrants (unknown branch)")

    build_summary_sheet(wb, branch_data, font_size)

    os.makedirs(os.path.join(PORTAL, "tmp"), exist_ok=True)
    out = os.path.join(PORTAL, f"tmp/desk-roster-{date.today().isoformat()}.xlsx")
    wb.save(out)
    print(f"\n  Written to {out}")


if __name__ == "__main__":
    main()
