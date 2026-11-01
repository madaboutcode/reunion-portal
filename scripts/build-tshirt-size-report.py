#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["openpyxl"]
# ///
"""Build tmp/tshirt-size-report-<date>.xlsx from live D1 data.

Pulls every registration that isn't donation-only (donation-only registrants
don't attend and don't need a shirt) — regardless of payment status — and
builds a t-shirt manufacturing order workbook: one sheet per branch, an
Overall size x gender count matrix, an Extras buffer sheet, and a Size Chart
reference sheet.

READ-ONLY: this script only ever issues a SELECT against D1. It has no
write/delete capability by design.


Requires --env stg|prod (no default). Account, D1 database and R2 come from
src/server/wrangler.toml; the token from CLOUDFLARE_API_TOKEN (process env or .env.ops) or --token <file>.
Output: tmp/tshirt-size-report-<date>.xlsx (tmp/ is git-ignored; the file contains personal data).

Usage:
  uv run scripts/build-tshirt-size-report.py --env prod
  uv run scripts/build-tshirt-size-report.py --env stg
  uv run scripts/build-tshirt-size-report.py --dry-run       # print summary, don't write
  uv run scripts/build-tshirt-size-report.py --token tmp/cf-token.txt
"""
import argparse
import os
import subprocess
from collections import defaultdict
from datetime import date

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, Side
from openpyxl.utils import get_column_letter

# Cloudflare settings (account, D1 database, token) are resolved in ops_common.py via site_config.py.
from ops_common import add_env_argument, d1_query, preflight  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PORTAL = os.path.dirname(HERE)

REGISTRATIONS_QUERY = """
SELECT id, full_name, branch, gender, tshirt_size
FROM registrations
WHERE participation_type != 'donation_only' OR participation_type IS NULL
"""

TSHIRTS_QUERY = """
SELECT registration_id, gender, size, is_included
FROM tshirts
"""

# Full branch name -> short code, mirrors src/shared/src/constants.ts BRANCH_SHORT_NAMES.
# Order here also drives sheet order in the workbook.
BRANCH_SHORT_NAMES = {
    "Architecture": "Arch",
    "Chemical Engineering": "Chem",
    "Civil Engineering": "Civil",
    "Computer Science & Engineering": "CSE",
    "Electrical & Electronics Engineering": "EEE",
    "Electronics & Communication Engineering": "ECE",
    "Mechanical Engineering": "ME",
    "Production Engineering": "PE",
}

# Canonical size ordering for the Overall matrix — matches SizeChartPage.tsx label order.
SIZE_ORDER = ["2XS", "XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"]

# Fixed procurement buffer for wrong-size cases. Do not derive this from live
# data: the committee-approved order is 4 female and 8 male shirts.
EXTRA_TSHIRT_ORDER = [
    {"size": "S", "female": 0, "male": 0},
    {"size": "M", "female": 1, "male": 0},
    {"size": "L", "female": 1, "male": 1},
    {"size": "XL", "female": 1, "male": 3},
    {"size": "2XL", "female": 1, "male": 2},
    {"size": "3XL", "female": 0, "male": 2},
]

GENDER_LABELS = {"male": "Male", "female": "Female"}

# Reference size charts — copied verbatim from
# portal/src/web/src/pages/SizeChartPage.tsx (MENS_SIZES / WOMENS_SIZES).
MENS_SIZES = [
    {"label": "XS", "chest": 34, "length": 25, "shoulder": 15},
    {"label": "S", "chest": 36, "length": 27, "shoulder": 15.75},
    {"label": "M", "chest": 38, "length": 28, "shoulder": 16.5},
    {"label": "L", "chest": 40, "length": 28, "shoulder": 17.25},
    {"label": "XL", "chest": 42, "length": 29, "shoulder": 18},
    {"label": "2XL", "chest": 44, "length": 30, "shoulder": 18.75},
    {"label": "3XL", "chest": 46, "length": 31, "shoulder": 19.5},
    {"label": "4XL", "chest": 48, "length": 32, "shoulder": 20.3},
    {"label": "5XL", "chest": 50, "length": 32, "shoulder": 21},
]

WOMENS_SIZES = [
    {"label": "2XS", "chest": 30, "length": 22, "shoulder": 13.5},
    {"label": "XS", "chest": 32, "length": 23, "shoulder": 14},
    {"label": "S", "chest": 34, "length": 24, "shoulder": 14.5},
    {"label": "M", "chest": 36, "length": 25, "shoulder": 15},
    {"label": "L", "chest": 38, "length": 26, "shoulder": 15.75},
    {"label": "XL", "chest": 40, "length": 27, "shoulder": 16.5},
    {"label": "2XL", "chest": 42, "length": 28, "shoulder": 17.38},
    {"label": "3XL", "chest": 44, "length": 29, "shoulder": 18.13},
    {"label": "4XL", "chest": 46, "length": 29, "shoulder": 18.9},
]

# ── Formatting helpers ───────────────────────────────────────────────────────

HEADER_FONT = Font(bold=True, color="FFFFFF")
HEADER_FILL_COLOR = "1F2A33"  # charcoal, matches app theme
TOTAL_FONT = Font(bold=True)
TITLE_FONT = Font(bold=True, size=13)
THIN = Side(style="thin", color="B0B0B0")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def style_header_row(ws, row_idx, ncols, start_col=1):
    from openpyxl.styles import PatternFill
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


# ── D1 access ────────────────────────────────────────────────────────────────

# ── Sheet builders ───────────────────────────────────────────────────────────

def format_shirts_cell(shirts):
    """R21: combined size/gender cell for bag-packing. E.g. '2 x L (M), 1 x M (W)'."""
    if not shirts:
        return ""
    gender_initials = {"male": "M", "female": "W"}
    combos = defaultdict(int)
    for s in shirts:
        g = gender_initials.get(s["gender"], "?")
        combos[f'{s["size"]} ({g})'] += 1
    parts = []
    for combo, count in combos.items():
        parts.append(f"{count} x {combo}" if count > 1 else combo)
    return ", ".join(parts)


def build_branch_sheet(wb, branch_full, short_name, rows, shirts_by_reg):
    ws = wb.create_sheet(title=short_name)

    ws.cell(row=1, column=1, value=branch_full).font = TITLE_FONT
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=5)

    header_row = 2
    headers = ["Reg ID", "Name", "Gender", "T-Shirts", "Total"]
    for i, h in enumerate(headers, start=1):
        ws.cell(row=header_row, column=i, value=h)
    style_header_row(ws, header_row, len(headers))

    sorted_rows = sorted(rows, key=lambda r: (r["full_name"] or "").strip().lower())
    r = header_row + 1
    for reg in sorted_rows:
        gender = GENDER_LABELS.get(reg["gender"], reg["gender"] or "")
        shirts = shirts_by_reg.get(reg["id"], [])
        ws.cell(row=r, column=1, value=reg["id"])
        ws.cell(row=r, column=2, value=(reg["full_name"] or "").strip())
        ws.cell(row=r, column=3, value=gender)
        if shirts:
            ws.cell(row=r, column=4, value=format_shirts_cell(shirts))
            ws.cell(row=r, column=5, value=len(shirts))
        else:
            ws.cell(row=r, column=4, value=reg["tshirt_size"] or "")
            ws.cell(row=r, column=5, value=1 if reg["tshirt_size"] else 0)
        for c in range(1, 6):
            ws.cell(row=r, column=c).border = BORDER
        r += 1

    ws.freeze_panes = ws.cell(row=header_row + 1, column=1).coordinate
    autofit_columns(ws)
    return len(sorted_rows)


def build_overall_sheet(wb, rows, all_shirts):
    ws = wb.create_sheet(title="Overall")

    # Overall is the complete vendor order: current shirts plus the fixed buffer.
    # size -> gender -> count (from tshirts table if available, fallback to registrations)
    matrix = defaultdict(lambda: defaultdict(int))
    sizes_present = set()
    if all_shirts:
        for s in all_shirts:
            size = s["size"] or "(unset)"
            gender = s["gender"] or "(unset)"
            matrix[size][gender] += 1
            sizes_present.add(size)
    else:
        for reg in rows:
            size = reg["tshirt_size"] or "(unset)"
            gender = reg["gender"] or "(unset)"
            matrix[size][gender] += 1
            sizes_present.add(size)

    for extra in EXTRA_TSHIRT_ORDER:
        size = extra["size"]
        matrix[size]["female"] += extra["female"]
        matrix[size]["male"] += extra["male"]
        sizes_present.add(size)

    ordered_sizes = [s for s in SIZE_ORDER if s in sizes_present]
    ordered_sizes += sorted(sizes_present - set(SIZE_ORDER))

    headers = ["Size", "Female", "Male", "Total"]
    header_row = 1
    for i, h in enumerate(headers, start=1):
        ws.cell(row=header_row, column=i, value=h)
    style_header_row(ws, header_row, len(headers))

    r = header_row + 1
    col_totals = {"female": 0, "male": 0}
    grand_total = 0
    for size in ordered_sizes:
        female = matrix[size].get("female", 0)
        male = matrix[size].get("male", 0)
        total = sum(matrix[size].values())
        ws.cell(row=r, column=1, value=size)
        ws.cell(row=r, column=2, value=female)
        ws.cell(row=r, column=3, value=male)
        ws.cell(row=r, column=4, value=total)
        for c in range(1, 5):
            ws.cell(row=r, column=c).border = BORDER
            ws.cell(row=r, column=c).alignment = Alignment(horizontal="center")
        ws.cell(row=r, column=1).alignment = Alignment(horizontal="left")
        col_totals["female"] += female
        col_totals["male"] += male
        grand_total += total
        r += 1

    ws.cell(row=r, column=1, value="Total")
    ws.cell(row=r, column=2, value=col_totals["female"])
    ws.cell(row=r, column=3, value=col_totals["male"])
    ws.cell(row=r, column=4, value=grand_total)
    for c in range(1, 5):
        cell = ws.cell(row=r, column=c)
        cell.font = TOTAL_FONT
        cell.border = BORDER
        cell.alignment = Alignment(horizontal="center" if c > 1 else "left")

    ws.freeze_panes = ws.cell(row=header_row + 1, column=1).coordinate
    autofit_columns(ws)
    return col_totals["female"], col_totals["male"], grand_total


def build_extras_sheet(wb):
    ws = wb.create_sheet(title="Extras")

    headers = ["Size", "Female", "Male", "Total"]
    header_row = 1
    for i, h in enumerate(headers, start=1):
        ws.cell(row=header_row, column=i, value=h)
    style_header_row(ws, header_row, len(headers))

    female_total = 0
    male_total = 0
    r = header_row + 1
    for order in EXTRA_TSHIRT_ORDER:
        female = order["female"]
        male = order["male"]
        ws.cell(row=r, column=1, value=order["size"])
        ws.cell(row=r, column=2, value=female)
        ws.cell(row=r, column=3, value=male)
        ws.cell(row=r, column=4, value=female + male)
        for c in range(1, 5):
            ws.cell(row=r, column=c).border = BORDER
            ws.cell(row=r, column=c).alignment = Alignment(horizontal="center")
        ws.cell(row=r, column=1).alignment = Alignment(horizontal="left")
        female_total += female
        male_total += male
        r += 1

    ws.cell(row=r, column=1, value="Total")
    ws.cell(row=r, column=2, value=female_total)
    ws.cell(row=r, column=3, value=male_total)
    ws.cell(row=r, column=4, value=female_total + male_total)
    for c in range(1, 5):
        cell = ws.cell(row=r, column=c)
        cell.font = TOTAL_FONT
        cell.border = BORDER
        cell.alignment = Alignment(horizontal="center" if c > 1 else "left")

    ws.freeze_panes = ws.cell(row=header_row + 1, column=1).coordinate
    autofit_columns(ws)
    return female_total, male_total, female_total + male_total


def build_size_chart_sheet(wb):
    ws = wb.create_sheet(title="Size Chart")

    def write_table(title, sizes, start_row):
        ws.cell(row=start_row, column=1, value=title).font = TITLE_FONT
        ws.merge_cells(start_row=start_row, start_column=1, end_row=start_row, end_column=4)
        header_row = start_row + 1
        headers = ["Label", "Chest", "Length", "Shoulder"]
        for i, h in enumerate(headers, start=1):
            ws.cell(row=header_row, column=i, value=h)
        style_header_row(ws, header_row, len(headers))
        r = header_row + 1
        for s in sizes:
            ws.cell(row=r, column=1, value=s["label"])
            ws.cell(row=r, column=2, value=s["chest"])
            ws.cell(row=r, column=3, value=s["length"])
            ws.cell(row=r, column=4, value=s["shoulder"])
            for c in range(1, 5):
                cell = ws.cell(row=r, column=c)
                cell.border = BORDER
                cell.alignment = Alignment(horizontal="center" if c > 1 else "left")
            r += 1
        return r + 1  # blank row before next table

    next_row = write_table("Men's Sizes (inches)", MENS_SIZES, 1)
    write_table("Women's Sizes (inches)", WOMENS_SIZES, next_row)

    autofit_columns(ws)
    return ws


def main():
    ap = argparse.ArgumentParser()
    add_env_argument(ap)
    ap.add_argument("--token", help="path to a file containing the CF token")
    ap.add_argument("--dry-run", action="store_true", help="print summary, don't write the xlsx")
    args = ap.parse_args()

    token = preflight(args.env, args.token)
    rows = d1_query(token, args.env, REGISTRATIONS_QUERY)
    print(f"{len(rows)} non-donation-only registrations pulled from {args.env}")

    try:
        all_shirts = d1_query(token, args.env, TSHIRTS_QUERY)
        print(f"{len(all_shirts)} shirt rows from tshirts table")
    except Exception:
        all_shirts = []
        print("tshirts table not yet migrated — falling back to registrations.tshirt_size")

    shirts_by_reg = defaultdict(list)
    for s in all_shirts:
        shirts_by_reg[s["registration_id"]].append(s)

    by_branch = defaultdict(list)
    for reg in rows:
        by_branch[reg["branch"]].append(reg)

    print("\nPer-branch counts:")
    for branch_full, short_name in BRANCH_SHORT_NAMES.items():
        print(f"  {short_name:<6} {branch_full:<45} {len(by_branch.get(branch_full, []))}")

    unknown_branches = set(by_branch) - set(BRANCH_SHORT_NAMES)
    if unknown_branches:
        print(f"WARNING: registrations with unrecognized branch values (not in a branch sheet): {sorted(unknown_branches)}")

    gender_counts = defaultdict(int)
    for reg in rows:
        gender_counts[reg["gender"] or "(unset)"] += 1
    print(f"\nGender totals: {dict(gender_counts)}")
    print(f"Grand total: {len(rows)}")

    if args.dry_run:
        print("\n--dry-run: not writing the report")
        return

    wb = Workbook()
    wb.remove(wb.active)  # drop default sheet, we create ours explicitly

    female_total, male_total, grand_total = build_overall_sheet(wb, rows, all_shirts)
    extra_female_total, extra_male_total, extra_grand_total = build_extras_sheet(wb)

    total_branch_rows = 0
    for branch_full, short_name in BRANCH_SHORT_NAMES.items():
        count = build_branch_sheet(wb, branch_full, short_name, by_branch.get(branch_full, []), shirts_by_reg)
        total_branch_rows += count

    build_size_chart_sheet(wb)

    out_path = os.path.join(PORTAL, f"tmp/tshirt-size-report-{date.today().isoformat()}.xlsx")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    wb.save(out_path)

    print(f"\nWrote {total_branch_rows} rows across {len(BRANCH_SHORT_NAMES)} branch sheets")
    print(f"Overall: female={female_total} male={male_total} total={grand_total}")
    print(f"Extras: female={extra_female_total} male={extra_male_total} total={extra_grand_total}")
    print(out_path)


if __name__ == "__main__":
    main()
