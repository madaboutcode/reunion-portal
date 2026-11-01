#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Check the repo's configuration. Run it with `make doctor`.

Part A: list every value that is still the original Smriti example (domains, resource
names, event title, sender). After the single-owner work the expected places are
site.config.json, src/server/wrangler.toml and branding copy/assets (UI text, email copy,
logos). A domain or resource name anywhere else in code or static files is a defect.
Each hit is printed as "still using the example value: <file>:<line>".
Part B: check that the config files agree with each other and that the required keys exist.

Exit codes:
  0  in this repo (it IS the Smriti example), unless Part B finds a real mismatch
  1  Part B found a mismatch or a missing key
  1  with --strict: any example value remains in site.config.json, wrangler.toml, code,
     static files or branding copy, or a REPLACE_WITH_* placeholder or the .env.ops token is missing.
     Docs (docs/, *.md) and test files are listed separately and do not count.
     Forks: run `make doctor-strict` before launch.

Usage:
  uv run scripts/doctor.py [--strict] [--verbose]
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import site_config as sc  # noqa: E402

# The original example values. A fork replaces them all. Case-insensitive regexes.
EXAMPLE_VALUES: list[tuple[str, str]] = [
    ("example domain (smriti2026.com, beta., cdn., betacdn.)", r"smriti2026\.com"),
    ("example resource name (smriti-26-*, *-smriti26*)", r"smriti-?26"),
    ("example event title", r"TKMCE 2006"),
    ("example event name", r"Smriti\s*['’]?\s*(26|2026)\b"),
    ("example event subtitle", r"TKM College of Engineering"),
]
EXAMPLE_RE = [(label, re.compile(rx, re.IGNORECASE)) for label, rx in EXAMPLE_VALUES]

CONFIG_FILES = {sc.SITE_REL, sc.WRANGLER_REL}
# Labels 0 and 1 are domains and resource names (config); the rest are branding copy.
N_CONFIG_LABELS = 2
# Worker vars that site.config.json owns. wrangler.toml must not define them (single owner).
URL_VARS = {"APP_BASE_URL", "PUBLIC_THUMBS_URL", "PUBLIC_PORTRAITS_URL", "SENDER_NAME"}
SKIP_FILES = {"package-lock.json", "uv.lock", "scripts/doctor.py", "LICENSE"}  # LICENSE names the copyright holder
MAX_BYTES = 2_000_000

REQUIRED_SITE_KEYS = ["eventName", "eventSubtitle", "eventTitle", "senderName",
                      "githubRepo"]
REQUIRED_ENV_SITE_KEYS = ["siteUrl", "cdnUrl", "pagesProject"]


def git_files(root: Path) -> list[str]:
    # Tracked files plus new, not-yet-committed ones (but never git-ignored files such as .env.ops).
    out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"],
                         cwd=root, capture_output=True, text=True, check=True)
    return [f for f in out.stdout.splitlines() if f]


def classify(path: str) -> str:
    if path in CONFIG_FILES:
        return "config"
    name = path.rsplit("/", 1)[-1]
    if path.startswith("docs/") or "/docs/" in path or path.endswith((".md", ".mdx")):
        return "docs"
    if ("__tests__/" in path or "/tests/" in path or ".test." in name or ".spec." in name
            or name.startswith("test_") or ".verify." in name or "/fixtures/" in path):
        return "tests"
    return "code"


def scan(root: Path) -> dict[str, list[tuple[str, int, str]]]:
    """Return {group: [(file, line, label)]} for every example value found in tracked text files."""
    found: dict[str, list[tuple[str, int, str]]] = {"config": [], "code": [], "branding": [], "docs": [], "tests": []}
    for rel in git_files(root):
        if rel in SKIP_FILES:
            continue
        p = root / rel
        try:
            if not p.is_file() or p.stat().st_size > MAX_BYTES:
                continue
            text = p.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue  # binary or unreadable
        group = classify(rel)
        for n, line in enumerate(text.splitlines(), 1):
            for i, (label, rx) in enumerate(EXAMPLE_RE):
                if rx.search(line):
                    g = "branding" if group == "code" and i >= N_CONFIG_LABELS else group
                    found[g].append((rel, n, label))
                    break
    return found


def compress(lines: list[int], cap: int = 8) -> str:
    shown = ",".join(str(n) for n in lines[:cap])
    return shown + (f",... (+{len(lines) - cap})" if len(lines) > cap else "")


def host_of(url: str) -> str:
    return (urlparse(url).hostname or "").lower()


def check_agreement(root: Path) -> tuple[list[str], list[str]]:
    """Return (errors, todos). errors are real mismatches; todos are unfinished setup."""
    errors: list[str] = []
    todos: list[str] = []

    try:
        site = sc.load_site()
    except sc.SiteConfigError as e:
        return [f"{e} Fix: create site.config.json (copy the one in the repo and edit it)."], todos
    try:
        sc.load_wrangler()
    except sc.SiteConfigError as e:
        return [f"{e}"], todos

    # Required site.config.json keys.
    for k in REQUIRED_SITE_KEYS:
        if not str(site.get(k) or "").strip():
            errors.append(f"site.config.json: '{k}' is missing. Fix: add \"{k}\": \"...\" to site.config.json.")
    for env in sc.ENVIRONMENTS:
        envs = (site.get("environments") or {}).get(env)
        if not isinstance(envs, dict):
            errors.append(f"site.config.json: environments.{env} is missing. Fix: add an \"{env}\" object under \"environments\".")
            continue
        for k in REQUIRED_ENV_SITE_KEYS:
            if not str(envs.get(k) or "").strip():
                errors.append(f"site.config.json: environments.{env}.{k} is missing. Fix: add it to site.config.json.")

    for env in sc.ENVIRONMENTS:
        # Required wrangler.toml keys. A REPLACE_WITH_* value is unfinished setup, not a mismatch.
        for key, label in (("accountId", "account_id"), ("workerName", "name"), ("d1Name", "database_name"),
                           ("d1Id", "database_id"), ("r2Bucket", "STORAGE bucket_name")):
            try:
                sc.get(key, env)
            except sc.SiteConfigError as e:
                msg = f"[{env}] {e}"
                (todos if "placeholder" in str(e) else errors).append(msg)

        # Route host vs siteUrl host.
        site_url = sc.try_get("siteUrl", env)
        hosts = sc.route_hosts(env)
        if site_url and hosts:
            want = host_of(site_url)
            for h in hosts:
                if h.lower() != want:
                    errors.append(
                        f"[{env}] route host '{h}' in {sc.WRANGLER_REL} does not match siteUrl host '{want}' in "
                        f"site.config.json. Fix: make routes[].pattern start with '{want}/' (or correct siteUrl)."
                    )
        elif site_url and not hosts:
            errors.append(f"[{env}] {sc.WRANGLER_REL} has no routes. Fix: add routes = [{{ pattern = \"{host_of(site_url)}/api/*\", zone_name = \"...\" }}].")

        # Single owner: URL and identity vars come from site.config.json through deploy.sh
        # (`wrangler deploy --var`), never from wrangler.toml.
        bad = sorted(set(sc.wrangler_vars(env)) & URL_VARS | {k for k, v in sc.wrangler_vars(env).items()
                                                               if isinstance(v, str) and v.startswith(("http://", "https://"))})
        if bad:
            errors.append(f"[{env}] {sc.WRANGLER_REL} defines URL/identity vars ({', '.join(bad)}). They are owned by "
                          f"site.config.json and passed by scripts/deploy.sh. Fix: delete them from {sc.WRANGLER_REL}.")

    # The Pages project name lives only in site.config.json (src/web/wrangler.toml was removed).
    if (root / "src/web/wrangler.toml").exists():
        errors.append("src/web/wrangler.toml exists. The Pages project name is owned by site.config.json "
                      "(environments.<env>.pagesProject; deploy.sh passes --project-name). Fix: delete the file.")

    # .env.ops
    ops = root / sc.OPS_REL
    ignored = subprocess.run(["git", "check-ignore", "-q", sc.OPS_REL], cwd=root).returncode == 0
    if not ignored:
        errors.append(f"{sc.OPS_REL} is not git-ignored. Fix: add '.env.ops' to .gitignore before you create it.")
    if not ops.exists():
        todos.append(f"{sc.OPS_REL} does not exist. Fix: cp .env.ops.example .env.ops, then set CLOUDFLARE_API_TOKEN (the agent token).")
    else:
        vals = sc.parse_env_file(ops)
        if not vals.get("CLOUDFLARE_API_TOKEN", "").strip():
            todos.append(f"{sc.OPS_REL} has no CLOUDFLARE_API_TOKEN. Fix: set it to the agent token (D1, R2 read, Workers tail). The deploy token never goes in this file.")
        stale = sorted(k for k in vals if k in OLD_KEYS)
        if stale:
            todos.append(f"{sc.OPS_REL} still has settings that moved to site.config.json / wrangler.toml and are no longer read: "
                         f"{', '.join(stale)}. Fix: delete these lines.")
    return errors, todos


OLD_KEYS = {
    "CF_ACCOUNT_ID", "D1_DATABASE_ID_STG", "D1_DATABASE_ID_PROD", "D1_DATABASE_NAME_STG", "D1_DATABASE_NAME_PROD",
    "WORKER_NAME_STG", "WORKER_NAME_PROD", "PAGES_PROJECT_STG", "PAGES_PROJECT_PROD", "R2_BUCKET_STG",
    "R2_BUCKET_PROD", "REPORT_BUCKET", "REPORT_PREFIX", "APP_BASE_URL_STG", "APP_BASE_URL_PROD",
    "PUBLIC_CDN_URL", "EVENT_TITLE", "REG_CODE_PREFIX", "GITHUB_REPO", "ATTENDANCE_SPREADSHEET_ID",
    "ATTENDANCE_SOURCE_SHEET", "ATTENDANCE_TARGET_SHEET",
}


def deploy_example_values(env: str) -> list[str]:
    """Values for one environment that still match an original example domain or resource name.

    Used by scripts/deploy.sh to refuse a real deploy. Checks the URLs and Pages project in
    site.config.json and the Worker name, routes, D1 and R2 names in src/server/wrangler.toml,
    against the config-level patterns in EXAMPLE_VALUES (the single list).
    """
    site = sc.load_site()["environments"][env]
    wr = sc.wrangler_env(env)
    items: list[tuple[str, object]] = [(f"{sc.SITE_REL}: environments.{env}.{k}", site.get(k))
                                       for k in ("siteUrl", "cdnUrl", "publicThumbsUrl", "pagesProject")]
    w = sc.WRANGLER_REL
    items.append((f"{w}: Worker name", wr.get("name")))
    for r in wr.get("routes") or []:
        if isinstance(r, dict):
            items += [(f"{w}: route pattern", r.get("pattern")), (f"{w}: route zone_name", r.get("zone_name"))]
        else:
            items.append((f"{w}: route", r))
    items += [(f"{w}: D1 database_name", d.get("database_name")) for d in wr.get("d1_databases") or []]
    items += [(f"{w}: R2 bucket_name", b.get("bucket_name")) for b in wr.get("r2_buckets") or []]
    hits = []
    for where, value in items:
        if isinstance(value, str) and any(rx.search(value) for _, rx in EXAMPLE_RE[:N_CONFIG_LABELS]):
            hits.append(f"{where} = {value}")
    return hits


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[0] == "--deploy-check":
        # Exit 0: no example values for this env. Exit 3: lists them, one per line.
        hits = deploy_example_values(sc.require_env(argv[1]))
        for h in hits:
            print(f"  {h}")
        return 3 if hits else 0
    ap = argparse.ArgumentParser(description="Check configuration; list values still equal to the original example.")
    ap.add_argument("--strict", action="store_true", help="exit non-zero if any example value or unfinished setup remains")
    ap.add_argument("--verbose", action="store_true", help="list every docs/test occurrence instead of one line per file")
    args = ap.parse_args(argv)
    root = sc.repo_root()

    print("== A. Values still equal to the original Smriti example ==")
    found = scan(root)
    for group, title in (("config", "Config files (site.config.json, src/server/wrangler.toml): expected"),
                         ("code", "Code and static files, domains and resource names: expected none")):
        hits = found[group]
        print(f"\n{title}: {len(hits)} occurrence(s)")
        for rel, n, label in hits:
            print(f"  still using the example value: {rel}:{n}  [{label}]")
    for group, title in (("branding", "Branding copy and assets in code (UI text, email copy, logos; see MAKE-IT-YOURS.md)"),
                         ("docs", "Docs (docs/, *.md): listed only, not counted by --strict"),
                         ("tests", "Test files and fixtures: listed only, not counted by --strict")):
        hits = found[group]
        print(f"\n{title}: {len(hits)} occurrence(s)")
        if args.verbose:
            for rel, n, label in hits:
                print(f"  still using the example value: {rel}:{n}  [{label}]")
        else:
            per_file: dict[str, list[int]] = {}
            for rel, n, _ in hits:
                per_file.setdefault(rel, []).append(n)
            for rel, lines in per_file.items():
                print(f"  still using the example value: {rel}:{compress(lines)}  ({len(lines)})")

    print("\n== B. Agreement and required settings ==")
    errors, todos = check_agreement(root)
    for e in errors:
        print(f"  ERROR: {e}")
    for t in todos:
        print(f"  TODO:  {t}")
    if not errors and not todos:
        print("  OK: required keys present, routes match siteUrl, wrangler.toml has no URL vars, .env.ops has the token.")

    counted = len(found["config"]) + len(found["code"]) + len(found["branding"])
    print("\n== Summary ==")
    print(f"  example values: config {len(found['config'])}, code/static (domains, names) {len(found['code'])}, branding copy {len(found['branding'])}")
    print(f"  example values in docs: {len(found['docs'])}; in tests: {len(found['tests'])} (not counted)")
    print(f"  mismatches/missing keys: {len(errors)}; unfinished setup: {len(todos)}")
    fail = bool(errors)
    if args.strict and (counted or todos):
        fail = True
    if fail:
        reason = "mismatch or missing key" if errors else "strict mode: example values or unfinished setup remain"
        print(f"  result: FAIL ({reason})")
        return 1
    print("  result: OK (informational: this repo ships the Smriti example values)" if counted or todos
          else "  result: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
