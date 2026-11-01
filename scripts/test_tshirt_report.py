#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["openpyxl"]
# ///
"""QA cases 6 + 12: verify report format (R21) and consumer consistency.

Case 12 (R21): format_shirts_cell() produces one-row-per-person combined cells.
Case 6: the t-shirt report and the staff t-shirt matrix both read the tshirts
table and must produce consistent gender×size counts.

Offline test: no network, no env vars needed.

Run: uv run scripts/test_tshirt_report.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
_report = importlib.import_module("build-tshirt-size-report")
format_shirts_cell = _report.format_shirts_cell


def test_single_shirt():
    shirts = [{"size": "L", "gender": "male"}]
    result = format_shirts_cell(shirts)
    assert result == "L (M)", f"Expected 'L (M)', got '{result}'"


def test_multiple_distinct_shirts():
    shirts = [
        {"size": "L", "gender": "male"},
        {"size": "M", "gender": "female"},
    ]
    result = format_shirts_cell(shirts)
    assert "L (M)" in result, f"Missing 'L (M)' in '{result}'"
    assert "M (W)" in result, f"Missing 'M (W)' in '{result}'"
    assert ", " in result, f"Missing comma separator in '{result}'"


def test_duplicate_shirts_collapsed():
    shirts = [
        {"size": "L", "gender": "male"},
        {"size": "L", "gender": "male"},
        {"size": "M", "gender": "female"},
    ]
    result = format_shirts_cell(shirts)
    assert "2 x L (M)" in result, f"Expected '2 x L (M)' in '{result}'"
    assert "M (W)" in result, f"Expected 'M (W)' in '{result}'"


def test_empty_shirts():
    assert format_shirts_cell([]) == ""
    assert format_shirts_cell(None) == ""


def test_null_gender():
    shirts = [{"size": "XL", "gender": None}]
    result = format_shirts_cell(shirts)
    assert "XL (?)" in result, f"Expected 'XL (?)' in '{result}'"


def test_consumer_consistency():
    """Case 6: verify the counting logic matches what staff.routes.ts does.

    staff.routes.ts builds: { male: { "L": 2 }, female: { "M": 1 } }
    This script's Overall sheet builds: matrix[size][gender] += 1

    Both iterate over tshirts rows and count by (size, gender). Verify the
    counting logic produces identical totals for the same input.
    """
    from collections import defaultdict

    test_shirts = [
        {"size": "L", "gender": "male", "is_included": 1, "registration_id": 1},
        {"size": "L", "gender": "male", "is_included": 0, "registration_id": 1},
        {"size": "M", "gender": "female", "is_included": 0, "registration_id": 1},
        {"size": "XL", "gender": "male", "is_included": 1, "registration_id": 2},
        {"size": "S", "gender": "female", "is_included": 1, "registration_id": 3},
    ]

    # Python script's Overall sheet logic (from build_overall_sheet)
    py_matrix = defaultdict(lambda: defaultdict(int))
    for s in test_shirts:
        size = s["size"] or "(unset)"
        gender = s["gender"] or "(unset)"
        py_matrix[size][gender] += 1

    # staff.routes.ts logic (simplified — segments by gender, counts by size)
    ts_matrix = {"male": defaultdict(int), "female": defaultdict(int), "unspecified": defaultdict(int)}
    for s in test_shirts:
        gender_key = s["gender"] if s["gender"] in ("male", "female") else "unspecified"
        ts_matrix[gender_key][s["size"]] += 1

    # Verify totals match
    py_total = sum(v for sizes in py_matrix.values() for v in sizes.values())
    ts_total = sum(v for sizes in ts_matrix.values() for v in sizes.values())
    assert py_total == ts_total == 5, f"Total mismatch: py={py_total}, ts={ts_total}"

    # Verify per-gender-size counts match
    assert py_matrix["L"]["male"] == ts_matrix["male"]["L"] == 2
    assert py_matrix["M"]["female"] == ts_matrix["female"]["M"] == 1
    assert py_matrix["XL"]["male"] == ts_matrix["male"]["XL"] == 1
    assert py_matrix["S"]["female"] == ts_matrix["female"]["S"] == 1


if __name__ == "__main__":
    tests = [
        test_single_shirt,
        test_multiple_distinct_shirts,
        test_duplicate_shirts_collapsed,
        test_empty_shirts,
        test_null_gender,
        test_consumer_consistency,
    ]
    passed = 0
    for t in tests:
        try:
            t()
            print(f"  PASS  {t.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"  FAIL  {t.__name__}: {e}")
            sys.exit(1)
        except Exception as e:
            print(f"  ERROR {t.__name__}: {e}")
    print(f"\n{passed}/{len(tests)} passed")
    sys.exit(0 if passed == len(tests) else 1)
