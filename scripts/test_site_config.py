#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Tests for site_config.py and sql_guard.py. Run: uv run scripts/test_site_config.py

Builds a throwaway repo layout in a temp directory; no network, no real secrets.
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import doctor  # noqa: E402
import site_config as sc  # noqa: E402
import sql_guard  # noqa: E402

WRANGLER = '''
name = "w-stg"
account_id = "acct123"
routes = [{ pattern = "stg.example.org/api/*", zone_name = "example.org" }]
[[d1_databases]]
binding = "DB"
database_name = "db-stg"
database_id = "REPLACE_WITH_STAGING_D1_DATABASE_ID"
[[r2_buckets]]
binding = "STORAGE"
bucket_name = "files-stg"
[env.production]
name = "w-prod"
routes = [{ pattern = "example.org/api/*", zone_name = "example.org" }]
[[env.production.d1_databases]]
binding = "DB"
database_name = "db-prod"
database_id = "prod-id-1"
[[env.production.r2_buckets]]
binding = "STORAGE"
bucket_name = "files-prod"
'''
SITE = {
    "eventTitle": "Test Reunion",
    "environments": {"stg": {"siteUrl": "https://stg.example.org"}, "prod": {"siteUrl": "https://example.org"}},
}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        (root / "src/server").mkdir(parents=True)
        (root / "src/server/wrangler.toml").write_text(WRANGLER)
        (root / "site.config.json").write_text(json.dumps(SITE))
        self.root = root
        self._orig = sc.repo_root
        sc.repo_root = lambda: root
        self._env = dict(os.environ)
        os.environ.pop("CLOUDFLARE_API_TOKEN", None)

    def tearDown(self):
        sc.repo_root = self._orig
        os.environ.clear()
        os.environ.update(self._env)
        self.tmp.cleanup()


class DeployExampleCheck(Base):
    """deploy.sh refuses while an env still has the original Smriti example values."""

    def test_clean_config_has_no_hits(self):
        self.assertEqual(doctor.deploy_example_values("stg"), [])
        self.assertEqual(doctor.deploy_example_values("prod"), [])

    def test_site_config_example_values_are_listed(self):
        site = json.loads((self.root / "site.config.json").read_text())
        site["environments"]["stg"].update(siteUrl="https://beta.smriti2026.com", pagesProject="stg-smriti26")
        (self.root / "site.config.json").write_text(json.dumps(site))
        hits = doctor.deploy_example_values("stg")
        self.assertEqual(len(hits), 2)
        self.assertTrue(any("pagesProject = stg-smriti26" in h for h in hits))
        self.assertEqual(doctor.deploy_example_values("prod"), [])  # other env unaffected

    def test_wrangler_example_values_are_listed_per_env(self):
        w = (self.root / "src/server/wrangler.toml")
        w.write_text(WRANGLER.replace('"db-prod"', '"smriti-26-prod"').replace("pattern = \"example.org/api", "pattern = \"smriti2026.com/api"))
        self.assertEqual(doctor.deploy_example_values("stg"), [])
        hits = doctor.deploy_example_values("prod")
        self.assertTrue(any("D1 database_name = smriti-26-prod" in h for h in hits))
        self.assertTrue(any("route pattern = smriti2026.com/api/*" in h for h in hits))


class Resolution(Base):
    def test_infra_comes_from_wrangler_per_env(self):
        self.assertEqual(sc.get("d1Name", "stg"), "db-stg")
        self.assertEqual(sc.get("d1Name", "prod"), "db-prod")
        self.assertEqual(sc.get("workerName", "prod"), "w-prod")
        self.assertEqual(sc.get("r2Bucket", "prod"), "files-prod")
        self.assertEqual(sc.get("d1Id", "prod"), "prod-id-1")

    def test_account_id_is_inherited_by_prod(self):
        self.assertEqual(sc.get("accountId", "prod"), "acct123")

    def test_urls_come_from_site_config(self):
        self.assertEqual(sc.get("siteUrl", "stg"), "https://stg.example.org")
        self.assertEqual(sc.get("eventTitle"), "Test Reunion")

    def test_env_is_required_and_has_no_default(self):
        with self.assertRaises(sc.SiteConfigError):
            sc.get("d1Name", None)
        with self.assertRaises(sc.SiteConfigError):
            sc.get("d1Name", "production")

    def test_placeholder_is_an_error_naming_key_and_owner(self):
        with self.assertRaises(sc.SiteConfigError) as cm:
            sc.get("d1Id", "stg")
        self.assertIn("d1Id", str(cm.exception))
        self.assertIn("src/server/wrangler.toml", str(cm.exception))

    def test_missing_site_key_names_owner(self):
        with self.assertRaises(sc.SiteConfigError) as cm:
            sc.get("senderName")
        self.assertIn("site.config.json", str(cm.exception))
        self.assertIn("senderName", str(cm.exception))

    def test_route_hosts(self):
        self.assertEqual(sc.route_hosts("stg"), ["stg.example.org"])
        self.assertEqual(sc.route_hosts("prod"), ["example.org"])


class Secrets(Base):
    def test_env_file_is_used_and_process_env_wins(self):
        (self.root / ".env.ops").write_text('# c\nexport CLOUDFLARE_API_TOKEN="from-file"\nGEMINI_API_KEY=g\n')
        self.assertEqual(sc.secret("CLOUDFLARE_API_TOKEN"), "from-file")
        self.assertEqual(sc.secret_source("CLOUDFLARE_API_TOKEN")[1], ".env.ops")
        os.environ["CLOUDFLARE_API_TOKEN"] = "from-process"
        self.assertEqual(sc.secret("CLOUDFLARE_API_TOKEN"), "from-process")

    def test_process_env_only_ignores_file(self):
        (self.root / ".env.ops").write_text("CLOUDFLARE_API_TOKEN=from-file\n")
        with self.assertRaises(sc.SiteConfigError):
            sc.secret("CLOUDFLARE_API_TOKEN", process_env_only=True)

    def test_missing_secret_names_owner_file(self):
        with self.assertRaises(sc.SiteConfigError) as cm:
            sc.secret("CLOUDFLARE_API_TOKEN")
        self.assertIn(".env.ops", str(cm.exception))

    def test_dev_vars_fallback_only_for_worker_shared_secrets(self):
        (self.root / "src/server/.dev.vars").write_text("GOOGLE_SA_KEY=k\nCLOUDFLARE_API_TOKEN=x\n")
        self.assertEqual(sc.secret("GOOGLE_SA_KEY"), "k")
        with self.assertRaises(sc.SiteConfigError):
            sc.secret("CLOUDFLARE_API_TOKEN")

    def test_blank_value_counts_as_missing(self):
        (self.root / ".env.ops").write_text("CLOUDFLARE_API_TOKEN=\n")
        with self.assertRaises(sc.SiteConfigError):
            sc.secret("CLOUDFLARE_API_TOKEN")


class SqlGuard(unittest.TestCase):
    def test_reads_are_allowed(self):
        for q in ["SELECT 1", " select * from t where a = 'x;y' ;", "WITH a AS (SELECT 1) SELECT * FROM a",
                  "PRAGMA table_info(registrations)", "EXPLAIN QUERY PLAN SELECT 1",
                  "SELECT replace(a, 'x', 'y') FROM t -- trailing", "SELECT 'update' AS a", "SELECT 1 /* DROP */"]:
            self.assertTrue(sql_guard.is_read_only(q), q)

    def test_writes_are_refused(self):
        for q in ["UPDATE t SET a=1", "DELETE FROM t", "SELECT 1; DROP TABLE t", "WITH a AS (SELECT 1) DELETE FROM t",
                  "PRAGMA writable_schema=1", "PRAGMA foreign_keys=ON", "INSERT INTO t VALUES (1)", "",
                  "EXPLAIN DELETE FROM t", "REPLACE INTO t VALUES (1)", "-- x\nUPDATE t SET a=1",
                  "WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x", "CREATE TABLE t (a)", "DROP TABLE t"]:
            self.assertFalse(sql_guard.is_read_only(q), q)


if __name__ == "__main__":
    unittest.main(verbosity=2)
