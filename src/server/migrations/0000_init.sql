-- Base schema for the D1 database
-- All subsequent migrations assume these tables exist.

CREATE TABLE IF NOT EXISTS registrations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reg_code      TEXT    NOT NULL UNIQUE,
  status        TEXT    NOT NULL DEFAULT 'pending',

  -- Alumni details (Step 1)
  full_name          TEXT NOT NULL,
  branch             TEXT NOT NULL,
  email              TEXT NOT NULL,
  whatsapp           TEXT NOT NULL,
  mobile_alternate   TEXT,
  city               TEXT NOT NULL,
  country            TEXT NOT NULL DEFAULT 'India',
  attendance_intent  TEXT NOT NULL,
  id_doc_uploaded    INTEGER NOT NULL DEFAULT 0,

  -- Meals (Step 2)
  alumni_meal        TEXT NOT NULL,

  -- Accommodation (Step 3)
  accommodation      TEXT NOT NULL DEFAULT 'none',
  check_in           TEXT,
  check_out          TEXT,

  -- Donation (Step 3)
  donation_amount    INTEGER NOT NULL DEFAULT 0,
  public_ack         INTEGER NOT NULL DEFAULT 0,
  ack_display_name   TEXT,
  felicitation       INTEGER NOT NULL DEFAULT 0,

  -- Pricing (frozen at submission)
  pricing_snapshot   TEXT NOT NULL,
  total_amount       INTEGER NOT NULL,

  -- Notes
  id_note            TEXT,

  -- Timestamps
  created_at         INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at         INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

INSERT OR IGNORE INTO sqlite_sequence (name, seq) VALUES ('registrations', 1000);

CREATE INDEX IF NOT EXISTS idx_reg_reg_code ON registrations(reg_code);
CREATE INDEX IF NOT EXISTS idx_reg_email ON registrations(email);
CREATE INDEX IF NOT EXISTS idx_reg_whatsapp ON registrations(whatsapp);
CREATE INDEX IF NOT EXISTS idx_reg_status ON registrations(status);
CREATE INDEX IF NOT EXISTS idx_reg_branch ON registrations(branch);
CREATE INDEX IF NOT EXISTS idx_reg_created ON registrations(created_at);

CREATE TABLE IF NOT EXISTS attendees (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id  INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  type             TEXT    NOT NULL,
  name             TEXT,
  age              INTEGER,
  relationship     TEXT,
  meal             TEXT    NOT NULL,
  is_chargeable    INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_att_registration ON attendees(registration_id);
CREATE INDEX IF NOT EXISTS idx_att_type ON attendees(type);

CREATE TABLE IF NOT EXISTS id_documents (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id  INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  file_name        TEXT    NOT NULL,
  mime_type        TEXT    NOT NULL,
  size_bytes       INTEGER NOT NULL,
  r2_key           TEXT    NOT NULL,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_doc_registration ON id_documents(registration_id);

CREATE TABLE IF NOT EXISTS payments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id  INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  amount           INTEGER NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'pending',
  gateway          TEXT,
  gateway_ref      TEXT,
  gateway_response TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_pay_registration ON payments(registration_id);
CREATE INDEX IF NOT EXISTS idx_pay_status ON payments(status);

CREATE TABLE IF NOT EXISTS audit_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id  INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  action           TEXT    NOT NULL,
  actor            TEXT,
  changes          TEXT,
  snapshot         TEXT    NOT NULL,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_audit_registration ON audit_log(registration_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS magic_links (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash       TEXT    NOT NULL UNIQUE,
  registration_id  INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  expires_at       INTEGER NOT NULL,
  used_at          INTEGER,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_ml_token ON magic_links(token_hash);
CREATE INDEX IF NOT EXISTS idx_ml_expires ON magic_links(expires_at);
