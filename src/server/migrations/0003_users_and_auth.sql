-- Users table (staff/admin identities)
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('staff', 'admin')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- System audit log (non-registration events: login, export, staff CRUD)
CREATE TABLE system_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  target_type TEXT,
  target_id INTEGER,
  details TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Alter magic_links: add user_id, make registration_id nullable
-- NOTE: SQLite doesn't support ALTER COLUMN, so we recreate
CREATE TABLE magic_links_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  registration_id INTEGER REFERENCES registrations(id),
  user_id INTEGER REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  CHECK ((registration_id IS NOT NULL AND user_id IS NULL) OR (registration_id IS NULL AND user_id IS NOT NULL))
);

INSERT INTO magic_links_new (id, token_hash, registration_id, user_id, expires_at, used_at, created_at)
  SELECT id, token_hash, registration_id, NULL, expires_at, used_at, created_at FROM magic_links;

DROP TABLE magic_links;
ALTER TABLE magic_links_new RENAME TO magic_links;

-- Bootstrap admin. CHANGE THIS EMAIL to your own before applying migrations:
-- this is the only way the first admin account exists (see README).
INSERT INTO users (email, name, role, created_by) VALUES ('admin@example.com', 'Admin', 'admin', NULL);
