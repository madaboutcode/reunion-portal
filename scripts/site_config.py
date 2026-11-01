#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""One reader for every ops setting. Standard library only.

Each setting has exactly one owner file:

  src/server/wrangler.toml  Cloudflare infra, per environment: account ID, Worker name,
                            D1 database name and ID, R2 bucket names.
                            Top level = staging (stg). [env.production] = production (prod).
  site.config.json          Identity and URLs: event name, sender, GitHub repo, per-environment
                            site, CDN and thumbnail URLs, Pages project, report bucket, sheet IDs.
  .env.ops                  Secrets and tokens only (git-ignored). A process environment variable
                            with the same name wins over the file.

The environment is always explicit: "stg" or "prod". There is no default.

Usage (works the same from bash):
  uv run scripts/site_config.py get <stg|prod|global> <key>   print one value
  uv run scripts/site_config.py env <stg|prod> [--keys a,b] [--secret NAME ...]
                                                              print shell exports (use with eval)
  uv run scripts/site_config.py keys                          list every key and its owner file
  uv run scripts/site_config.py target <stg|prod>             print the resources a command would touch
  uv run scripts/site_config.py secret-set NAME               exit 0 if the secret resolves (never prints it)

Use env "global" for keys that do not depend on the environment (eventTitle, githubRepo, ...).
`get` refuses secret names (UPPER_CASE) unless you pass --reveal. `env` prints secrets only
for names you pass with --secret: use that in `eval "$(...)"`, never in an agent-visible terminal.

A missing or placeholder (REPLACE_WITH_*) value is a hard error that names the key and the
file that owns it.
"""
from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:  # Python < 3.11
    sys.exit("site_config.py needs Python 3.11 or newer (tomllib). Run it with `uv run scripts/site_config.py ...`.")

ENVIRONMENTS = ("stg", "prod")
PLACEHOLDER = "REPLACE_WITH_"
WRANGLER_REL = "src/server/wrangler.toml"
SITE_REL = "site.config.json"
OPS_REL = ".env.ops"
DEV_VARS_REL = "src/server/.dev.vars"


class SiteConfigError(Exception):
    """A setting is missing, invalid or ambiguous. The message names the key and its owner file."""


# ── Repo root ────────────────────────────────────────────────────────────────

def repo_root() -> Path:
    """`git rev-parse --show-toplevel`, falling back to the parent of scripts/."""
    here = Path(__file__).resolve().parent
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"], cwd=Path.cwd(), capture_output=True, text=True, timeout=10
        )
        if out.returncode == 0 and out.stdout.strip():
            root = Path(out.stdout.strip())
            if (root / WRANGLER_REL).exists() and (root / "scripts" / "site_config.py").exists():
                return root
    except (OSError, subprocess.SubprocessError):
        pass
    return here.parent


def require_env(env: str | None) -> str:
    if env not in ENVIRONMENTS:
        raise SiteConfigError(f"environment must be 'stg' or 'prod' (got {env!r}). There is no default: pass it explicitly.")
    return env


# ── File loading ─────────────────────────────────────────────────────────────

def _load_json(path: Path, owner_hint: str) -> dict:
    try:
        data = json.loads(path.read_text())
    except FileNotFoundError:
        raise SiteConfigError(f"{owner_hint}: {path} does not exist.") from None
    except json.JSONDecodeError as e:
        raise SiteConfigError(f"{path} is not valid JSON: {e}") from None
    if not isinstance(data, dict):
        raise SiteConfigError(f"{path} must contain a JSON object.")
    return data


def load_site() -> dict:
    return _load_json(repo_root() / SITE_REL, f"{SITE_REL} owns identity and URLs")


def load_wrangler() -> dict:
    path = repo_root() / WRANGLER_REL
    try:
        with open(path, "rb") as f:
            return tomllib.load(f)
    except FileNotFoundError:
        raise SiteConfigError(f"{WRANGLER_REL} owns Cloudflare infra, but {path} does not exist.") from None
    except tomllib.TOMLDecodeError as e:
        raise SiteConfigError(f"{path} is not valid TOML: {e}") from None


def wrangler_env(env: str) -> dict:
    """wrangler.toml settings for one environment, as wrangler itself resolves them.

    stg is the top level. prod is [env.production]. Only `account_id` and `main`-style
    scalar keys are inherited by prod; bindings, routes and vars are not (wrangler does
    not inherit them), so a prod value must be written under [env.production].
    """
    require_env(env)
    top = load_wrangler()
    if env == "stg":
        return top
    prod = (top.get("env") or {}).get("production")
    if not isinstance(prod, dict):
        raise SiteConfigError(f"[env.production] is missing from {WRANGLER_REL}, which owns production infra.")
    merged = {"account_id": top.get("account_id")}
    merged.update(prod)
    return merged


def _binding(items, binding: str) -> dict:
    for item in items or []:
        if isinstance(item, dict) and item.get("binding") == binding:
            return item
    return {}


# ── Secrets ──────────────────────────────────────────────────────────────────

# Secrets that may also be read from src/server/.dev.vars, because the Worker uses the
# same value and local dev already keeps it there. Order: process env, .env.ops, .dev.vars.
DEV_VARS_FALLBACK = {
    "GOOGLE_SA_KEY", "GOOGLE_SPREADSHEET_ID", "GOOGLE_COMMITTEE_SHEET_ID",
    "MAILGUN_API_KEY", "MAILGUN_DOMAIN",
}
SECRET_NAMES = (
    "CLOUDFLARE_API_TOKEN", "GEMINI_API_KEY", "GOOGLE_SA_KEY", "GOOGLE_SPREADSHEET_ID",
    "GOOGLE_COMMITTEE_SHEET_ID", "MAILGUN_API_KEY", "MAILGUN_DOMAIN",
)


def parse_env_file(path: Path) -> dict[str, str]:
    """KEY=VALUE lines. Ignores blanks, comments and a leading `export `. Strips matching quotes."""
    out: dict[str, str] = {}
    try:
        text = path.read_text()
    except OSError:
        return out
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        k, _, v = line.partition("=")
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        out[k.strip()] = v
    return out


def secret_source(name: str, process_env_only: bool = False) -> tuple[str, str] | None:
    """Return (value, source) for a secret, or None. source is 'process env' or a file name."""
    val = os.environ.get(name, "").strip()
    if val:
        return val, "process env"
    if process_env_only:
        return None
    root = repo_root()
    files = [OPS_REL] + ([DEV_VARS_REL] if name in DEV_VARS_FALLBACK else [])
    for rel in files:
        val = parse_env_file(root / rel).get(name, "").strip()
        if val:
            return val, rel
    return None


def secret(name: str, process_env_only: bool = False) -> str:
    found = secret_source(name, process_env_only)
    if found:
        return found[0]
    if process_env_only:
        raise SiteConfigError(f"{name} is not set in the process environment (this tool reads it from there only).")
    where = f"{OPS_REL} (or export it in your shell)"
    if name in DEV_VARS_FALLBACK:
        where = f"{OPS_REL}, or {DEV_VARS_REL}, or export it in your shell"
    raise SiteConfigError(f"{name} is not set. It is a secret owned by {where}. See .env.ops.example.")


# ── Keys ─────────────────────────────────────────────────────────────────────
# key -> (scope, owner file, shell export name). scope "env" needs stg|prod, "global" does not.

KEYS: dict[str, tuple[str, str, str]] = {
    "accountId":       ("env",    WRANGLER_REL, "CF_ACCOUNT_ID"),
    "workerName":      ("env",    WRANGLER_REL, "WORKER_NAME"),
    "d1Name":          ("env",    WRANGLER_REL, "D1_DATABASE_NAME"),
    "d1Id":            ("env",    WRANGLER_REL, "D1_DATABASE_ID"),
    "r2Bucket":        ("env",    WRANGLER_REL, "R2_BUCKET"),
    "r2ThumbsBucket":  ("env",    WRANGLER_REL, "R2_THUMBS_BUCKET"),
    "siteUrl":         ("env",    SITE_REL, "SITE_URL"),
    "cdnUrl":          ("env",    SITE_REL, "CDN_URL"),
    "publicThumbsUrl": ("env",    SITE_REL, "PUBLIC_THUMBS_URL"),
    "pagesProject":    ("env",    SITE_REL, "PAGES_PROJECT"),
    "eventName":       ("global", SITE_REL, "EVENT_NAME"),
    "eventSubtitle":   ("global", SITE_REL, "EVENT_SUBTITLE"),
    "eventTitle":      ("global", SITE_REL, "EVENT_TITLE"),
    "senderName":      ("global", SITE_REL, "SENDER_NAME"),
    "githubRepo":      ("global", SITE_REL, "GITHUB_REPO"),
    "reportsBucket":   ("global", SITE_REL, "REPORT_BUCKET"),
    "reportsPrefix":   ("global", SITE_REL, "REPORT_PREFIX"),
    "attendanceSpreadsheetId": ("global", SITE_REL, "ATTENDANCE_SPREADSHEET_ID"),
    "attendanceSourceTab":     ("global", SITE_REL, "ATTENDANCE_SOURCE_SHEET"),
    "attendanceTargetTab":     ("global", SITE_REL, "ATTENDANCE_TARGET_SHEET"),
    "attendanceStatusColumn":  ("global", SITE_REL, "ATTENDANCE_STATUS_COLUMN"),
}

_SITE_PATHS = {
    "siteUrl": ("environments", "{env}", "siteUrl"),
    "cdnUrl": ("environments", "{env}", "cdnUrl"),
    "publicThumbsUrl": ("environments", "{env}", "publicThumbsUrl"),
    "pagesProject": ("environments", "{env}", "pagesProject"),
    "eventName": ("eventName",),
    "eventSubtitle": ("eventSubtitle",),
    "eventTitle": ("eventTitle",),
    "senderName": ("senderName",),
    "githubRepo": ("githubRepo",),
    "reportsBucket": ("reports", "bucket"),
    "reportsPrefix": ("reports", "prefix"),
    "attendanceSpreadsheetId": ("sheets", "attendance", "spreadsheetId"),
    "attendanceSourceTab": ("sheets", "attendance", "sourceTab"),
    "attendanceTargetTab": ("sheets", "attendance", "targetTab"),
    "attendanceStatusColumn": ("sheets", "attendance", "statusColumn"),
}


def _wrangler_value(key: str, env: str):
    w = wrangler_env(env)
    if key == "accountId":
        return w.get("account_id"), "account_id"
    if key == "workerName":
        return w.get("name"), "name"
    if key == "d1Name":
        return _binding(w.get("d1_databases"), "DB").get("database_name"), "[[d1_databases]] binding DB, database_name"
    if key == "d1Id":
        return _binding(w.get("d1_databases"), "DB").get("database_id"), "[[d1_databases]] binding DB, database_id"
    if key == "r2Bucket":
        return _binding(w.get("r2_buckets"), "STORAGE").get("bucket_name"), "[[r2_buckets]] binding STORAGE, bucket_name"
    if key == "r2ThumbsBucket":
        return _binding(w.get("r2_buckets"), "PUBLIC_THUMBS").get("bucket_name"), "[[r2_buckets]] binding PUBLIC_THUMBS, bucket_name"
    raise KeyError(key)


def _where(env: str, detail: str, owner: str) -> str:
    if owner == WRANGLER_REL and env == "prod" and not detail.startswith("account_id"):
        return f"{owner} under [env.production]: {detail}"
    return f"{owner}: {detail}"


def get(key: str, env: str | None = None) -> str:
    """Resolve one non-secret key. Raises SiteConfigError naming the key and its owner file."""
    if key not in KEYS:
        raise SiteConfigError(f"unknown key {key!r}. Run `site_config.py keys` to list them.")
    scope, owner, _ = KEYS[key]
    if scope == "env":
        require_env(env)
    if owner == WRANGLER_REL:
        value, detail = _wrangler_value(key, env)
        where = _where(env, detail, owner)
    else:
        path = tuple(env if p == "{env}" else p for p in _SITE_PATHS[key])
        node = load_site()
        for part in path:
            node = node.get(part) if isinstance(node, dict) else None
        value, where = node, f"{owner}: {'.'.join(path)}"
    if value is None or (isinstance(value, str) and not value.strip()):
        raise SiteConfigError(f"{key} is not set for {env or 'global'}. Set it in {where}.")
    if not isinstance(value, str):
        raise SiteConfigError(f"{key} must be a string. Fix it in {where}.")
    if value.startswith(PLACEHOLDER):
        raise SiteConfigError(f"{key} is still a placeholder ({value}). Replace it in {where}.")
    return value.strip()


def try_get(key: str, env: str | None = None) -> str | None:
    try:
        return get(key, env)
    except SiteConfigError:
        return None


def route_hosts(env: str) -> list[str]:
    """Hosts of the Worker routes for an environment (pattern up to the first '/')."""
    hosts = []
    for r in wrangler_env(env).get("routes") or []:
        pattern = r.get("pattern") if isinstance(r, dict) else r
        if isinstance(pattern, str):
            hosts.append(pattern.split("/", 1)[0])
    return hosts


REG_CODE_FILE_REL = "src/shared/src/reg-code.ts"


def reg_code_prefix() -> str:
    """The registration-code prefix. Owner: the REG_CODE_PREFIX constant in src/shared/src/reg-code.ts
    (the app code); it is not in site.config.json."""
    import re
    path = repo_root() / REG_CODE_FILE_REL
    try:
        m = re.search(r'export const REG_CODE_PREFIX\s*=\s*"([^"]+)"', path.read_text(encoding="utf-8"))
    except OSError as e:
        raise SiteConfigError(f"Cannot read {REG_CODE_FILE_REL} (owns the registration-code prefix): {e}")
    if not m:
        raise SiteConfigError(f"REG_CODE_PREFIX not found in {REG_CODE_FILE_REL} (it owns the registration-code prefix).")
    return m.group(1)


def wrangler_vars(env: str) -> dict:
    return dict(wrangler_env(env).get("vars") or {})


# ── Target description and CLI ───────────────────────────────────────────────

def target_lines(env: str) -> list[str]:
    """Human-readable list of the remote resources for `env`. Unresolved ones show as <missing>."""
    def v(key):
        try:
            return get(key, env)
        except SiteConfigError:
            return f"<not set: {key}, owner {KEYS[key][1]}>"
    return [
        f"environment : {env}",
        f"site URL    : {v('siteUrl')}",
        f"worker      : {v('workerName')}",
        f"D1 database : {v('d1Name')} ({v('d1Id')})",
        f"R2 bucket   : {v('r2Bucket')}",
        f"account     : {v('accountId')}",
    ]


def print_target(env: str, stream=sys.stderr) -> None:
    print(f"TARGET [{env}]", file=stream)
    for line in target_lines(env):
        print("  " + line, file=stream)


def _usage() -> int:
    print(__doc__, file=sys.stderr)
    return 2


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0 if argv else 2
    cmd, args = argv[0], argv[1:]
    try:
        if cmd == "keys":
            for k, (scope, owner, exp) in KEYS.items():
                print(f"{k:26} {scope:7} {owner:28} {exp}")
            for name in SECRET_NAMES:
                extra = f", {DEV_VARS_REL}" if name in DEV_VARS_FALLBACK else ""
                print(f"{name:26} secret  process env, {OPS_REL}{extra}")
            return 0
        if cmd == "get":
            reveal = "--reveal" in args
            args = [a for a in args if a != "--reveal"]
            if len(args) != 2:
                return _usage()
            scope_arg, key = args
            if key in KEYS:
                print(get(key, None if scope_arg == "global" else scope_arg))
                return 0
            if key.isupper():
                if scope_arg != "global":
                    require_env(scope_arg)
                if not reveal:
                    raise SiteConfigError(f"{key} is a secret: not printed. Pass --reveal to print it, or use `secret-set {key}`.")
                print(secret(key))
                return 0
            raise SiteConfigError(f"unknown key {key!r}. Run `site_config.py keys` to list them.")
        if cmd == "secret-set":
            if len(args) != 1:
                return _usage()
            found = secret_source(args[0])
            if not found:
                secret(args[0])  # raises with the owner message
            print(f"{args[0]} is set (from {found[1]})")
            return 0
        if cmd == "target":
            if len(args) != 1:
                return _usage()
            require_env(args[0])
            print_target(args[0], stream=sys.stdout)
            return 0
        if cmd == "env":
            if not args:
                return _usage()
            env, rest = args[0], args[1:]
            require_env(env)
            wanted: list[str] | None = None
            secrets: list[str] = []
            i = 0
            while i < len(rest):
                if rest[i] == "--keys" and i + 1 < len(rest):
                    wanted = [k for k in rest[i + 1].split(",") if k]
                    i += 2
                elif rest[i] == "--secret" and i + 1 < len(rest):
                    secrets.append(rest[i + 1])
                    i += 2
                else:
                    return _usage()
            names = wanted if wanted is not None else list(KEYS)
            for k in names:
                if k not in KEYS:
                    raise SiteConfigError(f"unknown key {k!r}. Run `site_config.py keys` to list them.")
                exp = KEYS[k][2]
                if wanted is None:
                    val = try_get(k, env)
                    if val is None:
                        print(f"# {k}: not set ({KEYS[k][1]})")
                        continue
                else:
                    val = get(k, env)  # hard error
                print(f"export {exp}={shlex.quote(val)}")
            for s in secrets:
                print(f"export {s}={shlex.quote(secret(s))}")
            print(f"export SITE_ENV={shlex.quote(env)}")
            print(f"export WRANGLER_ENV_FLAG={shlex.quote('' if env == 'stg' else '--env production')}")
            return 0
        return _usage()
    except SiteConfigError as e:
        print(f"site_config: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
