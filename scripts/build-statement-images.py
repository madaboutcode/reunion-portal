#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pymupdf"]
# ///
"""Render a bank statement PDF as per-page PNG images (PDF FALLBACK path).

Use this only for banks that give you a PDF statement and no HTML/text export.
If you bank with SBI, use scripts/convert-sbi-html-to-text.py instead (primary path).

Flow: this script -> .claude/workflows/extract-statement.js (an agent reads the
PNGs and transcribes the transactions) -> import in the staff UI at
/staff/bank-transactions. See .claude/skills/payment-reconcile/SKILL.md.

The PNGs contain your account's financial data. Default output is tmp/statement-pages
(git-ignored). Delete that directory when you are done.

Contacts no remote service.

Usage:
  uv run scripts/build-statement-images.py path/to/statement.pdf
  uv run scripts/build-statement-images.py path/to/statement.pdf --out tmp/my-pages
  uv run scripts/build-statement-images.py path/to/statement.pdf --dpi 200
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "tmp" / "statement-pages"

import pymupdf


def main():
    parser = argparse.ArgumentParser(description="Render PDF pages as PNG images")
    parser.add_argument("pdf", help="Path to the bank statement PDF")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="Output directory, replaced on each run (default: tmp/statement-pages in the repo)")
    parser.add_argument("--dpi", type=int, default=200, help="Render resolution (default: 200)")
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    if not pdf_path.exists():
        print(f"File not found: {pdf_path}", file=sys.stderr)
        sys.exit(1)

    out_dir = Path(args.out)
    if out_dir.exists():
        stray = [p.name for p in out_dir.iterdir() if not (p.name.startswith("page-") and p.suffix == ".png")]
        if stray:
            print(f"{out_dir} exists and holds files that are not page-NN.png ({stray[0]}...). "
                  "Choose an empty or new --out directory.", file=sys.stderr)
            sys.exit(1)
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    doc = pymupdf.open(str(pdf_path))
    pages = []

    for i, page in enumerate(doc):
        mat = pymupdf.Matrix(args.dpi / 72, args.dpi / 72)
        pix = page.get_pixmap(matrix=mat)
        out_path = out_dir / f"page-{i + 1:02d}.png"
        pix.save(str(out_path))
        pages.append(str(out_path))

    doc.close()

    result = {"page_count": len(pages), "output_dir": str(out_dir), "pages": pages}
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
