#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Print accommodation statistics from D1 (SELECT only): counts by room type,
shared rooms by branch and gender, and the list of branches.

Needs --env stg|prod (no default). Account, D1 database and R2 come from
src/server/wrangler.toml; the token from CLOUDFLARE_API_TOKEN (process env or .env.ops) or --token <file>.
Output: stdout only. No files written.

Usage:
  uv run scripts/query-accommodation-stats.py --env prod
  uv run scripts/query-accommodation-stats.py --env stg
"""
import argparse

from ops_common import add_env_argument, d1_query as _d1_query, preflight

ap = argparse.ArgumentParser(description="Print accommodation statistics from D1 (read-only).")
add_env_argument(ap)
ap.add_argument("--token", help="path to a file containing the Cloudflare API token")
args = ap.parse_args()

token = preflight(args.env, args.token)


def d1_query(token, sql):
    return _d1_query(token, args.env, sql)

print("=" * 60)
print(f"ACCOMMODATION STATISTICS - {args.env} D1")
print("=" * 60)

# Query 1: Overall breakdown
print("\n1. Overall accommodation breakdown:")
print("-" * 60)
rows = d1_query(token, """
SELECT accommodation, COUNT(*) as count FROM registrations
GROUP BY accommodation
ORDER BY count DESC
""")
total_by_accommodation = 0
for r in rows:
    print(f"  {r['accommodation']:<20} {r['count']:>5}")
    total_by_accommodation += r['count']

# Query 2: Total registrations
print("\n2. Total registrations:")
print("-" * 60)
rows = d1_query(token, "SELECT COUNT(*) as total FROM registrations")
total = rows[0]['total']
print(f"  Total: {total}")

# Query 3: Shared accommodation by branch and gender
print("\n3. Shared accommodation by branch and gender:")
print("-" * 60)
rows = d1_query(token, """
SELECT branch, gender, accommodation, COUNT(*) as count
FROM registrations
WHERE accommodation IN ('shared_double', 'shared_triple')
GROUP BY branch, gender, accommodation
ORDER BY branch, gender, accommodation
""")
for r in rows:
    print(f"  {r['branch']:<20} {r['gender']:<10} {r['accommodation']:<20} {r['count']:>5}")

# Query 4: Distinct branches
print("\n4. Distinct branches:")
print("-" * 60)
rows = d1_query(token, "SELECT DISTINCT branch FROM registrations ORDER BY branch")
for r in rows:
    print(f"  {r['branch']}")

print("\n" + "=" * 60)
