-- Feature flags: runtime toggles read via /api/feature-flags/:name
-- (admin-authenticated). Introduced for the debug-tools layered defense
-- (access-control.spec.md G8): where debug code ships (staging builds),
-- client /debug/* routes additionally require this flag AND an admin session.
--
-- enabled: 0|1 integer boolean per server convention.

CREATE TABLE feature_flags (
  name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0
);

-- Debug tools ship disabled; an admin flips this row on staging when needed.
INSERT INTO feature_flags (name, enabled) VALUES ('debug_tools', 0);
