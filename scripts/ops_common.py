"""Shared helpers for the ops scripts that call the Cloudflare REST API (D1, R2).

Not a script; imported by build-desk-roster.py, build-payment-pending-report.py,
build-tshirt-size-report.py, allocate-rooms.py, whos-coming.py and
query-accommodation-stats.py. Uses only the standard library.

Every setting comes from site_config.py (see its docstring for which file owns what):
account ID, D1 database ID and R2 bucket from src/server/wrangler.toml for the chosen
environment; the Cloudflare token from the process environment or .env.ops.
The environment is always explicit ("stg" or "prod"); there is no default.
Nothing here reads a token file unless you pass --token <file> to a script.
"""
import json
import os
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import site_config  # noqa: E402
from site_config import SiteConfigError  # noqa: E402,F401
from sql_guard import NotARead, check_read_only  # noqa: E402

# Cloudflare answers HTTP 403 "error 1010" to the default "Python-urllib" user
# agent. Every request sent by the ops scripts uses this header instead.
USER_AGENT = "Mozilla/5.0 (compatible; reunion-portal-ops/1.0)"

ENV_CHOICES = site_config.ENVIRONMENTS


def add_env_argument(parser):
    """Add a required --env stg|prod option. There is no default on purpose."""
    parser.add_argument("--env", choices=ENV_CHOICES, required=True,
                        help="Which environment to read: stg or prod (required, no default).")


def fail(err):
    """Exit with a short message (no traceback) for a SiteConfigError."""
    sys.exit(f"error: {err}")


def account_id(env):
    try:
        return site_config.get("accountId", env)
    except SiteConfigError as e:
        fail(e)


def db_id(env):
    try:
        return site_config.get("d1Id", env)
    except SiteConfigError as e:
        fail(e)


def r2_bucket(env):
    try:
        return site_config.get("r2Bucket", env)
    except SiteConfigError as e:
        fail(e)


def site_value(key, env=None):
    """One non-secret setting from site_config, or exit with the owner file named."""
    try:
        return site_config.get(key, env)
    except SiteConfigError as e:
        fail(e)


def resolve_token(token_file=None):
    """Return the Cloudflare API token from --token <file>, the process env or .env.ops."""
    if token_file:
        try:
            with open(token_file) as f:
                return f.read().strip()
        except OSError as e:
            sys.exit(f"Cannot read token file {token_file}: {e.strerror}")
    try:
        return site_config.secret("CLOUDFLARE_API_TOKEN")
    except SiteConfigError as e:
        fail(e)


def preflight(env, token_file=None):
    """Check all Cloudflare settings for `env` before any network call.

    Names every missing setting at once with the file that owns it. For prod, prints the
    target (D1 database, bucket, URL) to stderr. Returns the API token.
    """
    problems = []
    for key in ("accountId", "d1Id", "d1Name", "r2Bucket"):
        try:
            site_config.get(key, env)
        except SiteConfigError as e:
            problems.append(str(e))
    if not token_file:
        try:
            site_config.secret("CLOUDFLARE_API_TOKEN")
        except SiteConfigError as e:
            problems.append(str(e))
    if problems:
        sys.exit("error:\n  " + "\n  ".join(problems))
    if env == "prod":
        site_config.print_target(env)
    return resolve_token(token_file)


def cf_get(url, token, binary=False):
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {token}", "User-Agent": USER_AGENT}
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read() if binary else r.read().decode()


def d1_query(token, env, sql):
    """Run one read-only SQL statement on the D1 database of `env` through the REST API.

    Returns the result rows. Refuses anything that is not a read (see sql_guard.py).
    """
    try:
        check_read_only(sql)
    except NotARead as e:
        sys.exit(f"d1_query refused: {e}. The report scripts only read.")
    url = f"https://api.cloudflare.com/client/v4/accounts/{account_id(env)}/d1/database/{db_id(env)}/query"
    body = json.dumps({"sql": sql}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"Cloudflare API returned HTTP {e.code} {e.reason}. Check the token, account ID and database ID.")
    if not d.get("success"):
        sys.exit(f"D1 query failed: {d.get('errors')}")
    return d["result"][0]["results"]


def load_secrets(*required):
    """Return {name: value} for the secrets in `required`.

    Order per name: process environment, .env.ops, then (for secrets the Worker also uses,
    such as GOOGLE_SA_KEY) src/server/.dev.vars. Exits with the owner file when one is missing.
    """
    out = {}
    for name in required:
        try:
            out[name] = site_config.secret(name)
        except SiteConfigError as e:
            fail(e)
    return out
