#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Decide whether one SQL statement is a read. Standard library only.

Accepted without --write:
  SELECT ...
  WITH ... SELECT ...            (no INSERT/UPDATE/DELETE/... keyword outside quotes)
  PRAGMA table_info(t) and the other read-only schema pragmas (no assignment)
  EXPLAIN [QUERY PLAN] <a read>
Everything else is refused: INSERT, UPDATE, DELETE, REPLACE, DROP, CREATE, ALTER, ATTACH,
VACUUM, any other PRAGMA, and any input with more than one statement.

This is a guard against mistakes, not a security boundary. The token's own permissions
are the boundary.

Usage:
  sql_guard.py "<sql>"      exit 0 and print "read" if allowed; exit 1 and say why if not
"""
from __future__ import annotations

import re
import sys

READ_PRAGMAS = {"table_info", "table_xinfo", "table_list", "index_list", "index_info",
                "index_xinfo", "foreign_key_list", "database_list", "collation_list"}
WRITE_WORDS = {"INSERT", "UPDATE", "DELETE", "REPLACE", "DROP", "CREATE", "ALTER", "ATTACH",
               "DETACH", "VACUUM", "REINDEX", "PRAGMA", "TRUNCATE"}


class NotARead(Exception):
    pass


def _mask(sql: str) -> str:
    """Remove comments; replace quoted text with spaces so keywords inside literals are ignored."""
    out, i, n = [], 0, len(sql)
    while i < n:
        c = sql[i]
        if sql.startswith("--", i):
            j = sql.find("\n", i)
            i = n if j == -1 else j
            out.append(" ")
        elif sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            if j == -1:
                raise NotARead("unterminated /* comment")
            i = j + 2
            out.append(" ")
        elif c in "'\"`[":
            close = "]" if c == "[" else c
            j = i + 1
            while True:
                k = sql.find(close, j)
                if k == -1:
                    raise NotARead("unterminated quote")
                if close != "]" and sql.startswith(close * 2, k):
                    j = k + 2
                    continue
                break
            i = k + 1
            out.append(" _Q_ ")
        else:
            out.append(c)
            i += 1
    return "".join(out)


def check_read_only(sql: str) -> None:
    """Raise NotARead (with a reason) unless `sql` is a single read statement."""
    masked = _mask(sql).strip()
    if not masked:
        raise NotARead("empty statement")
    body = masked.rstrip(";").rstrip()
    if ";" in body:
        raise NotARead("more than one statement")
    words = re.findall(r"[A-Za-z_]+", body)
    first = words[0].upper()
    if first == "EXPLAIN":
        rest = re.sub(r"^\s*EXPLAIN(\s+QUERY\s+PLAN)?", "", body, flags=re.I)
        if not rest.strip():
            raise NotARead("EXPLAIN without a statement")
        check_read_only(rest)
        return
    if first == "SELECT":
        return
    if first == "WITH":
        bad = sorted({w.upper() for w in words} & WRITE_WORDS)
        if bad:
            raise NotARead(f"WITH statement contains {', '.join(bad)}")
        if "SELECT" not in {w.upper() for w in words}:
            raise NotARead("WITH statement has no SELECT")
        return
    if first == "PRAGMA":
        m = re.match(r"PRAGMA\s+(?:\w+\s*\.\s*)?(\w+)\s*(.*)$", body, flags=re.I | re.S)
        if m and m.group(1).lower() in READ_PRAGMAS and "=" not in m.group(2):
            return
        raise NotARead("only read-only schema PRAGMAs are allowed (table_info, table_list, index_list, ...)")
    raise NotARead(f"{first} is not a read")


def is_read_only(sql: str) -> bool:
    try:
        check_read_only(sql)
        return True
    except NotARead:
        return False


def main(argv: list[str]) -> int:
    if len(argv) != 1 or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0 if argv[:1] in (["-h"], ["--help"]) else 2
    try:
        check_read_only(argv[0])
    except NotARead as e:
        print(f"refused: {e}. Pass --write to run a statement that changes data.", file=sys.stderr)
        return 1
    print("read")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
