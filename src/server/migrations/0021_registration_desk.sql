-- Registration Desk (2026-08-09)
--
-- 1. registrations gains checked_in_at / checked_in_by — the current
--    registration-level group check-in state (registration-desk.spec.md R4,
--    plan "Data Models"). NULL checked_in_at means not present.
-- 2. desk_idempotency persists actor-scoped spot-registration idempotency
--    keys for 30 days (registration-desk.spec.md R5.5/R5.6).
--
-- Forward-only. Rollback is code rollback plus removal of this migration
-- only in a disposable local database. Never attempt remote D1 rollback.
--
-- WHY THIS STRUCTURE: D1 enforces foreign keys like `PRAGMA foreign_keys =
-- on` and ignores `PRAGMA foreign_keys = off` mid-migration. `registrations`
-- is the parent of ten tables; dropping a parent whose children still
-- reference it fails with a FOREIGN KEY constraint error, and the
-- deferred-cascade fallback (defer_foreign_keys) deletes the child rows at
-- resolution time. The only D1-safe rebuild is: stage every affected table
-- (data + ids preserved), drop the children first, drop the parent once
-- nothing references it, recreate the parent, then recreate the children
-- from their staged data with their original ids (which keeps every FK
-- reference valid). Every step is verified FK-clean against local D1.
--
-- Staging uses CREATE TABLE ... AS SELECT, which preserves column names,
-- order, and values. Recreated tables restore constraints/indexes; staged
-- data already satisfied them, so INSERT ... SELECT cannot violate them.

-- ── Phase 1: stage all affected tables (data + ids preserved) ────────────
CREATE TABLE stage_registrations AS SELECT * FROM registrations;
CREATE TABLE stage_payments AS SELECT * FROM payments;
CREATE TABLE stage_attendees AS SELECT * FROM attendees;
CREATE TABLE stage_id_documents AS SELECT * FROM id_documents;
CREATE TABLE stage_audit_log AS SELECT * FROM audit_log;
CREATE TABLE stage_magic_links AS SELECT * FROM magic_links;
CREATE TABLE stage_roommate_preferences AS SELECT * FROM roommate_preferences;
CREATE TABLE stage_tshirts AS SELECT * FROM tshirts;
CREATE TABLE stage_additional_charges AS SELECT * FROM additional_charges;
CREATE TABLE stage_refunds AS SELECT * FROM refunds;
CREATE TABLE stage_bank_transaction_payments AS SELECT * FROM bank_transaction_payments;

-- ── Phase 2: drop children first (leaves before their parents) ───────────
DROP TABLE bank_transaction_payments;  -- references payments + bank_transactions
DROP TABLE refunds;                    -- references registrations + payments
DROP TABLE additional_charges;         -- references registrations + users
DROP TABLE tshirts;                    -- references registrations
DROP TABLE roommate_preferences;       -- references registrations x2 + users
DROP TABLE magic_links;                -- references registrations + users
DROP TABLE audit_log;                  -- references registrations
DROP TABLE id_documents;               -- references registrations
DROP TABLE attendees;                  -- references registrations
DROP TABLE payments;                   -- references registrations

-- ── Phase 3: drop the parent (no referencing tables remain) ──────────────
DROP TABLE registrations;

-- ── Phase 4: recreate registrations with check-in columns ────────────────
CREATE TABLE registrations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reg_code      TEXT    NOT NULL UNIQUE,
  status        TEXT    NOT NULL DEFAULT 'pending',
  full_name     TEXT NOT NULL,
  branch        TEXT NOT NULL,
  email         TEXT NOT NULL,
  whatsapp      TEXT NOT NULL,
  mobile_alternate TEXT,
  city          TEXT NOT NULL,
  country       TEXT NOT NULL DEFAULT 'India',
  attendance_intent  TEXT NOT NULL,
  participation_type TEXT NOT NULL DEFAULT 'full_celebration',
  gender        TEXT,
  tshirt_size   TEXT,
  alumni_meal   TEXT NOT NULL,
  accommodation TEXT NOT NULL DEFAULT 'none',
  check_in      TEXT,
  check_out     TEXT,
  extra_bed     INTEGER NOT NULL DEFAULT 0,
  breakfast_adult    INTEGER NOT NULL DEFAULT 0,
  breakfast_child    INTEGER NOT NULL DEFAULT 0,
  donation_amount    INTEGER NOT NULL DEFAULT 0,
  public_ack         INTEGER NOT NULL DEFAULT 0,
  ack_display_name   TEXT,
  felicitation       INTEGER NOT NULL DEFAULT 0,
  pricing_snapshot   TEXT NOT NULL,
  total_amount       INTEGER NOT NULL,
  contribution_splits TEXT NOT NULL DEFAULT '{}',
  id_note            TEXT,
  photo_file_key     TEXT,
  photo_thumb_key    TEXT,
  checked_in_at      INTEGER,                  -- Unix epoch ms; NULL = not present
  checked_in_by      INTEGER REFERENCES users(id),  -- staff actor id
  created_at         INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at         INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

INSERT INTO registrations (
  id, reg_code, status, full_name, branch, email, whatsapp, mobile_alternate,
  city, country, attendance_intent, participation_type, gender, tshirt_size,
  alumni_meal, accommodation, check_in, check_out, extra_bed, breakfast_adult,
  breakfast_child, donation_amount, public_ack, ack_display_name, felicitation,
  pricing_snapshot, total_amount, contribution_splits, id_note, photo_file_key,
  photo_thumb_key, created_at, updated_at
)
SELECT id, reg_code, status, full_name, branch, email, whatsapp, mobile_alternate,
  city, country, attendance_intent, participation_type, gender, tshirt_size,
  alumni_meal, accommodation, check_in, check_out, extra_bed, breakfast_adult,
  breakfast_child, donation_amount, public_ack, ack_display_name, felicitation,
  pricing_snapshot, total_amount, contribution_splits, id_note, photo_file_key,
  photo_thumb_key, created_at, updated_at
FROM stage_registrations;

-- ── Phase 5: recreate children from staged data (ids preserved) ──────────
CREATE TABLE payments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id  INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  amount           INTEGER NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'payment_pending',
  gateway          TEXT,
  gateway_ref      TEXT,
  gateway_response TEXT,
  proof_file_key   TEXT,
  verified_by      TEXT,
  verified_at      INTEGER,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

INSERT INTO payments (
  id, registration_id, amount, status, gateway, gateway_ref, gateway_response,
  proof_file_key, verified_by, verified_at, created_at, updated_at
)
SELECT id, registration_id, amount, status, gateway, gateway_ref, gateway_response,
  proof_file_key, verified_by, verified_at, created_at, updated_at
FROM stage_payments;

CREATE TABLE attendees (
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

INSERT INTO attendees (
  id, registration_id, type, name, age, relationship, meal, is_chargeable, created_at
)
SELECT id, registration_id, type, name, age, relationship, meal, is_chargeable, created_at
FROM stage_attendees;

CREATE TABLE id_documents (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id  INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  file_name        TEXT    NOT NULL,
  mime_type        TEXT    NOT NULL,
  size_bytes       INTEGER NOT NULL,
  r2_key           TEXT    NOT NULL,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

INSERT INTO id_documents (
  id, registration_id, file_name, mime_type, size_bytes, r2_key, created_at
)
SELECT id, registration_id, file_name, mime_type, size_bytes, r2_key, created_at
FROM stage_id_documents;

CREATE TABLE audit_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id  INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  action           TEXT    NOT NULL,
  actor            TEXT,
  changes          TEXT,
  snapshot         TEXT    NOT NULL,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

INSERT INTO audit_log (
  id, registration_id, action, actor, changes, snapshot, created_at
)
SELECT id, registration_id, action, actor, changes, snapshot, created_at
FROM stage_audit_log;

CREATE TABLE magic_links (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash      TEXT NOT NULL UNIQUE,
  registration_id INTEGER REFERENCES registrations(id),
  user_id         INTEGER REFERENCES users(id),
  expires_at      INTEGER NOT NULL,
  used_at         INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  CHECK ((registration_id IS NOT NULL AND user_id IS NULL) OR (registration_id IS NULL AND user_id IS NOT NULL))
);

INSERT INTO magic_links (
  id, token_hash, registration_id, user_id, expires_at, used_at, created_at
)
SELECT id, token_hash, registration_id, user_id, expires_at, used_at, created_at
FROM stage_magic_links;

CREATE TABLE roommate_preferences (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id           INTEGER NOT NULL REFERENCES registrations(id),
  preferred_registration_id INTEGER NOT NULL REFERENCES registrations(id),
  preference_order          INTEGER NOT NULL,
  created_by                INTEGER NOT NULL REFERENCES users(id),
  created_at                INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at                INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE(registration_id, preferred_registration_id),
  CHECK(registration_id != preferred_registration_id),
  CHECK(preference_order BETWEEN 1 AND 5)
);

INSERT INTO roommate_preferences (
  id, registration_id, preferred_registration_id, preference_order,
  created_by, created_at, updated_at
)
SELECT id, registration_id, preferred_registration_id, preference_order,
  created_by, created_at, updated_at
FROM stage_roommate_preferences;

CREATE TABLE tshirts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  gender          TEXT,
  size            TEXT    NOT NULL,
  is_included     INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

INSERT INTO tshirts (id, registration_id, gender, size, is_included, created_at)
SELECT id, registration_id, gender, size, is_included, created_at
FROM stage_tshirts;

CREATE TABLE additional_charges (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  description     TEXT    NOT NULL,
  amount          INTEGER NOT NULL CHECK (amount > 0),
  created_by      INTEGER NOT NULL REFERENCES users(id),
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

INSERT INTO additional_charges (id, registration_id, description, amount, created_by, created_at)
SELECT id, registration_id, description, amount, created_by, created_at
FROM stage_additional_charges;

CREATE TABLE refunds (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id            INTEGER REFERENCES registrations(id) ON DELETE SET NULL,
  original_registration_id   INTEGER,
  reg_code                   TEXT,
  full_name                  TEXT,
  email                      TEXT,
  source_payment_id          INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  source_payment_original_id INTEGER,
  source_payment_amount      INTEGER,
  source_payment_reference   TEXT,
  source_payment_gateway     TEXT,
  source_payment_created_at  INTEGER,
  source_payment_verified_by INTEGER,
  source_payment_verified_at INTEGER,
  source_payment_proof_key   TEXT,
  amount                     INTEGER NOT NULL CHECK (amount > 0),
  reason                     TEXT NOT NULL DEFAULT 'overpayment' CHECK (reason IN ('overpayment', 'cancellation')),
  cancellation_reason        TEXT,
  status                     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  bank_reference             TEXT,
  resolved_by                TEXT,
  resolved_at                INTEGER,
  created_at                 INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

INSERT INTO refunds (
  id, registration_id, original_registration_id, reg_code, full_name, email,
  source_payment_id, source_payment_original_id, source_payment_amount,
  source_payment_reference, source_payment_gateway, source_payment_created_at,
  source_payment_verified_by, source_payment_verified_at, source_payment_proof_key,
  amount, reason, cancellation_reason, status, bank_reference, resolved_by,
  resolved_at, created_at
)
SELECT id, registration_id, original_registration_id, reg_code, full_name, email,
  source_payment_id, source_payment_original_id, source_payment_amount,
  source_payment_reference, source_payment_gateway, source_payment_created_at,
  source_payment_verified_by, source_payment_verified_at, source_payment_proof_key,
  amount, reason, cancellation_reason, status, bank_reference, resolved_by,
  resolved_at, created_at
FROM stage_refunds;

CREATE TABLE bank_transaction_payments (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_transaction_id   INTEGER NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  payment_id            INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE(bank_transaction_id, payment_id)
);

INSERT INTO bank_transaction_payments (id, bank_transaction_id, payment_id, created_at)
SELECT id, bank_transaction_id, payment_id, created_at
FROM stage_bank_transaction_payments;

-- ── Phase 6: drop staging tables ─────────────────────────────────────────
DROP TABLE stage_registrations;
DROP TABLE stage_payments;
DROP TABLE stage_attendees;
DROP TABLE stage_id_documents;
DROP TABLE stage_audit_log;
DROP TABLE stage_magic_links;
DROP TABLE stage_roommate_preferences;
DROP TABLE stage_tshirts;
DROP TABLE stage_additional_charges;
DROP TABLE stage_refunds;
DROP TABLE stage_bank_transaction_payments;

-- ── Phase 7: recreate all indexes ────────────────────────────────────────
CREATE INDEX idx_reg_reg_code ON registrations(reg_code);
CREATE UNIQUE INDEX idx_reg_email_unique ON registrations(email);
CREATE INDEX idx_reg_whatsapp ON registrations(whatsapp);
CREATE INDEX idx_reg_status ON registrations(status);
CREATE INDEX idx_reg_branch ON registrations(branch);
CREATE INDEX idx_reg_created ON registrations(created_at);
CREATE INDEX idx_reg_checked_in ON registrations(checked_in_at);

CREATE INDEX idx_pay_registration ON payments(registration_id);
CREATE INDEX idx_pay_status ON payments(status);

CREATE INDEX idx_att_registration ON attendees(registration_id);
CREATE INDEX idx_att_type ON attendees(type);

CREATE INDEX idx_doc_registration ON id_documents(registration_id);

CREATE INDEX idx_audit_registration ON audit_log(registration_id);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_created ON audit_log(created_at);

CREATE INDEX idx_roommate_prefs_reg ON roommate_preferences(registration_id);
CREATE INDEX idx_roommate_prefs_preferred ON roommate_preferences(preferred_registration_id);

CREATE UNIQUE INDEX idx_tshirts_one_included
  ON tshirts(registration_id) WHERE is_included = 1;

CREATE INDEX idx_refund_registration ON refunds(registration_id);
CREATE INDEX idx_refund_status ON refunds(status);
CREATE INDEX idx_refund_original_registration ON refunds(original_registration_id);
CREATE INDEX idx_refund_source_payment ON refunds(source_payment_id);
CREATE UNIQUE INDEX uq_refund_cancellation_once
  ON refunds(original_registration_id, source_payment_original_id)
  WHERE reason = 'cancellation';

CREATE INDEX idx_btp_txn ON bank_transaction_payments(bank_transaction_id);
CREATE INDEX idx_btp_payment ON bank_transaction_payments(payment_id);

-- ── Phase 8: desk idempotency — actor-scoped, 30-day retention ───────────
CREATE TABLE desk_idempotency (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER NOT NULL REFERENCES users(id),
  idem_key    TEXT NOT NULL,
  fingerprint TEXT NOT NULL,                 -- SHA-256 hex of the canonical request body
  response    TEXT NOT NULL,                 -- JSON of the original desk-safe creation response
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE UNIQUE INDEX idx_desk_idem_actor_key ON desk_idempotency(actor_id, idem_key);
CREATE INDEX idx_desk_idem_created ON desk_idempotency(created_at);
