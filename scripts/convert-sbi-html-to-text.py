#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Convert an SBI YONO account-summary HTML export to SBI fixed-width text.

PRIMARY bank statement path. Only State Bank of India (SBI) statements are
supported. For another bank, or if SBI only gives you a PDF, see the PDF
fallback: scripts/build-statement-images.py + .claude/workflows/extract-statement.js.

Flow: export the statement as HTML from SBI YONO, run this script, then import
the .txt file in the staff UI at /staff/bank-transactions.

The HTML export contains the transaction table but not the account header, so
the header comes from the ACCOUNT_* constants below. Edit them once for your
account before the first run. The script refuses to run while any value is
still a placeholder.

  uv run scripts/convert-sbi-html-to-text.py \
    tmp/statement.html \
    --output tmp/statement.txt

The output is accepted by parseSbiStatement(), the format read by the bank
transaction import endpoint. Reads: the HTML file. Writes: --output file (use
tmp/, which is git-ignored) or stdout. Contacts no remote service.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from pathlib import Path


TRANSACTION_HEADER = (
    "Txn Date:    Value Date:            Description:"
    "                                                            Ref No./Cheque No.:"
    "                     Branch Code:            Debit:             Credit:            Balance:"
)

ACCOUNT_NAME = "YOUR ALUMNI ASSOCIATION"
ACCOUNT_ADDRESS = [
    "YOUR ADDRESS LINE 1",
    "YOUR CITY",
    "India - 000000",
]
ACCOUNT_NUMBER = "_00000000000000000"
BRANCH = "YOUR BRANCH"
IFS_CODE = "XXXX0000000"
ACCOUNT_DESCRIPTION = "CA-REGULAR-PUB-OTH-ALL-INR"


class ConversionError(ValueError):
    """Raised when the HTML cannot be converted without guessing."""


@dataclass(frozen=True)
class Transaction:
    txn_date: str
    value_date: str
    description: str
    ref_no: str
    branch_code: str
    debit_paise: int
    credit_paise: int
    balance_paise: int


@dataclass(frozen=True)
class Statement:
    transactions: list[Transaction]
    opening_balance_paise: int
    closing_balance_paise: int
    start_date: date
    end_date: date


class TransactionTableParser(HTMLParser):
    """Read transaction rows without requiring a third-party HTML package."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self._div_depth = 0
        self._row_depth: int | None = None
        self._cell_depth: int | None = None
        self._current_row: list[str] | None = None
        self._current_cell_text: list[str] = []
        self._current_cell_title: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "div":
            self._div_depth += 1
            attributes = dict(attrs)
            classes = set((attributes.get("class") or "").split())

            if "tr" in classes and "ng-star-inserted" in classes:
                if self._row_depth is not None:
                    raise ConversionError("Nested transaction rows found in HTML")
                self._row_depth = self._div_depth
                self._current_row = []
                return

            if "td" in classes and self._row_depth is not None:
                if self._cell_depth is not None:
                    raise ConversionError("Nested transaction cells found in HTML")
                self._cell_depth = self._div_depth
                self._current_cell_text = []
                self._current_cell_title = None
            return

        if tag == "span" and self._cell_depth is not None:
            attributes = dict(attrs)
            if "title" in attributes:
                self._current_cell_title = attributes["title"] or ""

    def handle_data(self, data: str) -> None:
        if self._cell_depth is not None:
            self._current_cell_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "div":
            return

        if self._cell_depth == self._div_depth:
            assert self._current_row is not None
            raw_value = (
                self._current_cell_title
                if self._current_cell_title is not None
                else "".join(self._current_cell_text)
            )
            self._current_row.append(raw_value)
            self._cell_depth = None
            self._current_cell_text = []
            self._current_cell_title = None

        if self._row_depth == self._div_depth:
            assert self._current_row is not None
            self.rows.append(self._current_row)
            self._row_depth = None
            self._current_row = None

        self._div_depth -= 1


MONTHS = {
    "Jan": 1,
    "Feb": 2,
    "Mar": 3,
    "Apr": 4,
    "May": 5,
    "Jun": 6,
    "Jul": 7,
    "Aug": 8,
    "Sep": 9,
    "Oct": 10,
    "Nov": 11,
    "Dec": 12,
}

MONTH_ABBR = {number: name for name, number in MONTHS.items()}

# YONO SBI exports dates as `01-Aug-2026 (01-Aug-2026)` — the value date
# inside parens is always present in the demonstrated HTML.
DATE_RE = re.compile(
    r"^\s*(\d{1,2})-([A-Za-z]{3})-(\d{4})"
    r"\s*\(\s*(\d{1,2})-([A-Za-z]{3})-(\d{4})\s*\)\s*$"
)


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def parse_html_date(raw: str, row_number: int) -> tuple[date, date]:
    match = DATE_RE.fullmatch(raw)
    if not match:
        raise ConversionError(f"Row {row_number}: invalid date {raw!r}")

    try:
        txn_date = date(
            int(match.group(3)),
            MONTHS[match.group(2).title()],
            int(match.group(1)),
        )
        value_date = date(
            int(match.group(6)),
            MONTHS[match.group(5).title()],
            int(match.group(4)),
        )
    except (KeyError, ValueError) as error:
        raise ConversionError(f"Row {row_number}: invalid date {raw!r}") from error

    return txn_date, value_date


def display_date(value: date) -> str:
    return f"{value.day} {MONTH_ABBR[value.month]} {value.year}"


def parse_amount(raw: str, row_number: int, field: str) -> int:
    value = clean_text(raw).replace("\u20b9", "").replace(",", "").strip()
    if not value:
        if field == "balance":
            raise ConversionError(f"Row {row_number}: missing {field} amount")
        return 0
    try:
        amount = Decimal(value)
    except InvalidOperation as error:
        raise ConversionError(f"Row {row_number}: invalid {field} amount {raw!r}") from error
    if not amount.is_finite() or amount < 0 or amount.as_tuple().exponent < -2:
        raise ConversionError(f"Row {row_number}: invalid {field} amount {raw!r}")
    paise = amount * 100
    if paise != paise.to_integral_value():
        raise ConversionError(f"Row {row_number}: invalid {field} amount {raw!r}")
    return int(paise)


def restore_bank_prefix(description: str) -> str:
    """Restore punctuation removed by the HTML table rendering."""

    return re.sub(
        r"^(CHQ TRANSFER|BY TRANSFER)(NEFT|UPI|IMPS|SBIY)",
        r"\1-\2",
        description,
    )


def parse_transactions(html: str) -> Statement:
    parser = TransactionTableParser()
    parser.feed(html)
    parser.close()

    if not parser.rows:
        raise ConversionError("No transaction rows found in HTML")

    transactions: list[Transaction] = []
    for row_number, row in enumerate(parser.rows, start=1):
        if len(row) != 7:
            raise ConversionError(
                f"Row {row_number}: expected 7 cells, found {len(row)}"
            )

        txn_date, value_date = parse_html_date(row[0], row_number)
        description = restore_bank_prefix(clean_text(row[1]))
        ref_no = clean_text(row[2])
        branch_code = clean_text(row[3])
        debit_paise = parse_amount(row[4], row_number, "debit")
        credit_paise = parse_amount(row[5], row_number, "credit")
        balance_paise = parse_amount(row[6], row_number, "balance")

        if debit_paise and credit_paise:
            raise ConversionError(f"Row {row_number}: both debit and credit are set")
        if not debit_paise and not credit_paise:
            raise ConversionError(f"Row {row_number}: neither debit nor credit is set")

        if transactions:
            previous = transactions[-1]
            expected = previous.balance_paise + credit_paise - debit_paise
            if balance_paise != expected:
                raise ConversionError(
                    f"Row {row_number}: balance is {balance_paise / 100:.2f}, "
                    f"expected {expected / 100:.2f}"
                )

        transactions.append(
            Transaction(
                txn_date=display_date(txn_date),
                value_date=display_date(value_date),
                description=description,
                ref_no=ref_no,
                branch_code=branch_code,
                debit_paise=debit_paise,
                credit_paise=credit_paise,
                balance_paise=balance_paise,
            )
        )

    first = transactions[0]
    opening_balance_paise = first.balance_paise - first.credit_paise + first.debit_paise
    first_txn_date, _ = parse_html_date(parser.rows[0][0], 1)
    last_txn_date, _ = parse_html_date(parser.rows[-1][0], len(parser.rows))

    return Statement(
        transactions=transactions,
        opening_balance_paise=opening_balance_paise,
        closing_balance_paise=transactions[-1].balance_paise,
        start_date=first_txn_date,
        end_date=last_txn_date,
    )


def indian_amount(paise: int) -> str:
    rupees = str(paise // 100)
    if len(rupees) > 3:
        suffix = rupees[-3:]
        prefix = rupees[:-3]
        groups: list[str] = []
        while prefix:
            groups.insert(0, prefix[-2:])
            prefix = prefix[:-2]
        rupees = ",".join(groups + [suffix])
    return f"{rupees}.{paise % 100:02d}"


def build_header(statement: Statement) -> list[str]:
    start = display_date(statement.start_date)
    end = display_date(statement.end_date)
    closing = indian_amount(statement.closing_balance_paise)
    opening = indian_amount(statement.opening_balance_paise)

    return [
        f"Account Name:                      {ACCOUNT_NAME}",
        f"Address:                           {ACCOUNT_ADDRESS[0]}",
        f"                                    {ACCOUNT_ADDRESS[1]}",
        f"                                    {ACCOUNT_ADDRESS[2]}",
        f"Date:                              {end}",
        f"Account Number:                    {ACCOUNT_NUMBER}",
        "",
        f"Branch:                            {BRANCH}",
        "",
        "Interest Rate(% p.a.):             0.0",
        f"IFS Code            :              {IFS_CODE}",
        f"Account Description:               {ACCOUNT_DESCRIPTION}",
        "Currency:                          INR",
        f"Book Balance:                      {closing}",
        "Hold Value:                        0.00",
        f"Available Balance:                 {closing}",
        "Uncleared Amount:                  0.0",
        f"Opening Balance as on {start}  {opening}",
        f"Start Date:                        {start}",
        f"End Date:                          {end}",
    ]


def fixed_width_transaction(transaction: Transaction) -> str:
    if len(transaction.description) > 72:
        raise ConversionError(
            f"Description is {len(transaction.description)} characters; SBI allows 72"
        )
    if len(transaction.branch_code) > 21:
        raise ConversionError(
            f"Branch code is {len(transaction.branch_code)} characters; SBI allows 21"
        )

    # The HTML cell can contain more than the fixed-width export's 40-char
    # reference column. Match the bank export by keeping the column prefix.
    ref_no = transaction.ref_no[:40]
    debit = indian_amount(transaction.debit_paise) if transaction.debit_paise else ""
    credit = indian_amount(transaction.credit_paise) if transaction.credit_paise else ""
    balance = indian_amount(transaction.balance_paise)

    # These positions match sbi-statement-parser.ts. Amounts are placed so the
    # parser can distinguish debit (< column 181.5) from credit (>= column 181.5).
    prefix = (
        f"{transaction.txn_date:<13}"
        f"{transaction.value_date:<23}"
        f"{transaction.description:<72}"
        f"{ref_no:<40}"
        f"{transaction.branch_code:<21}"
    )
    return f"{prefix}{debit:>13}{' ' * 7}{credit:>12}{' ' * 5}{balance}"


def convert(
    html_path: Path,
) -> str:
    statement = parse_transactions(html_path.read_text(encoding="utf-8"))
    header = build_header(statement)

    lines = header + [TRANSACTION_HEADER]
    lines.extend(fixed_width_transaction(transaction) for transaction in statement.transactions)
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("html", type=Path, help="YONO SBI account-summary HTML export")
    parser.add_argument("--output", type=Path, help="Write converted text here instead of stdout")
    args = parser.parse_args()

    placeholders = [
        name for name, value in [
            ("ACCOUNT_NAME", ACCOUNT_NAME), ("ACCOUNT_ADDRESS", " ".join(ACCOUNT_ADDRESS)),
            ("ACCOUNT_NUMBER", ACCOUNT_NUMBER), ("BRANCH", BRANCH), ("IFS_CODE", IFS_CODE),
        ]
        if "YOUR " in value or "000000" in value
    ]
    if placeholders:
        print("Edit the account details at the top of scripts/convert-sbi-html-to-text.py first. "
              f"Still placeholders: {', '.join(placeholders)}.", file=sys.stderr)
        return 1

    if not args.html.exists():
        print(f"File not found: {args.html}", file=sys.stderr)
        return 1

    try:
        output = convert(args.html)
    except (OSError, ConversionError) as error:
        print(f"Conversion failed: {error}", file=sys.stderr)
        return 1

    if args.output:
        args.output.write_text(output, encoding="utf-8")
        print(f"Wrote {args.output}", file=sys.stderr)
    else:
        sys.stdout.write(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
