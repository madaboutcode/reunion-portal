"""Read and edit the committee to-do list in the committee Google Sheet (`todo` tab).

This is a separate Google Sheet from the registration data. Only needed if your
committee tracks its to-do list in the sheet that the app's /committee page reads.

Commands (all but `read` WRITE to the shared Google Sheet):
  uv run scripts/committee-todo-cli.py read
  uv run scripts/committee-todo-cli.py add "Task title" "Assignee Name" ["Notes"]
  uv run scripts/committee-todo-cli.py set_task <row> "<new title>"
  uv run scripts/committee-todo-cli.py set_due <row> "<due text>"
  uv run scripts/committee-todo-cli.py delete <row> [<row> ...]

Needs GOOGLE_SA_KEY and GOOGLE_COMMITTEE_SHEET_ID. Both are secrets the Worker also uses:
process env, .env.ops, or src/server/.dev.vars (see src/server/.dev.vars.example).
Share the sheet with the service account's email.
"""
import base64
import json
import sys

from ops_common import load_secrets


def main():
    if any(a in ("-h", "--help") for a in sys.argv[1:]):
        print(__doc__)
        return
    env = load_secrets("GOOGLE_SA_KEY", "GOOGLE_COMMITTEE_SHEET_ID")
    sa_key_b64 = env["GOOGLE_SA_KEY"]
    sheet_id = env["GOOGLE_COMMITTEE_SHEET_ID"]
    import gspread
    from google.oauth2.service_account import Credentials

    sa_info = json.loads(base64.b64decode(sa_key_b64))
    creds = Credentials.from_service_account_info(
        sa_info, scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    gc = gspread.authorize(creds)
    sh = gc.open_by_key(sheet_id)
    todo = sh.worksheet("todo")

    cmd = sys.argv[1] if len(sys.argv) > 1 else "read"

    if cmd == "read":
        rows = todo.get_all_values()
        header, body = rows[0], rows[1:]
        print(" | ".join(header))
        for i, row in enumerate(body, start=2):
            row = row + [""] * (len(header) - len(row))
            if not row[0].strip():
                continue
            print(f"[{i}] " + " | ".join(row))

    elif cmd == "add":
        if len(sys.argv) < 4:
            print("usage: add \"Task title\" \"Assignee Name\" [\"Notes\"]", file=sys.stderr)
            sys.exit(1)
        title = sys.argv[2]
        assignee = sys.argv[3]
        notes = sys.argv[4] if len(sys.argv) > 4 else ""
        # columns: Task | Assignee | Due | Done | Notes
        todo.append_row([title, assignee, "", "FALSE", notes], value_input_option="USER_ENTERED")
        print(f"Added: {title!r} -> {assignee}")

    elif cmd == "set_task":
        if len(sys.argv) < 4:
            print("usage: set_task <row> <new-title>", file=sys.stderr)
            sys.exit(1)
        row = int(sys.argv[2])
        title = sys.argv[3]
        todo.update_cell(row, 1, title)  # column A = Task
        print(f"Row {row}: Task -> {title!r}")

    elif cmd == "set_due":
        if len(sys.argv) < 4:
            print("usage: set_due <row> <due-text>", file=sys.stderr)
            sys.exit(1)
        row = int(sys.argv[2])
        due = sys.argv[3]
        todo.update_cell(row, 3, due)  # column C = Due
        print(f"Row {row}: Due -> {due!r}")

    elif cmd == "delete":
        if len(sys.argv) < 3:
            print("usage: delete <row> [<row> ...]", file=sys.stderr)
            sys.exit(1)
        rows = sorted((int(r) for r in sys.argv[2:]), reverse=True)
        for r in rows:
            todo.delete_rows(r)
            print(f"Deleted row {r}")

    else:
        print(f"unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
