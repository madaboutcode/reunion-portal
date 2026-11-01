-- Reference schema for the the D1 database, loaded by the in-memory
-- SQLite test harness (src/__tests__/helpers/sqlite-d1.ts).
--
-- Migrations in ../../migrations are AUTHORITATIVE. Never deploy from this file:
-- apply migrations with `wrangler d1 migrations apply`. This file mirrors
-- migrations 0000 through 0025 except for these known deviations (checked by
-- applying both to scratch SQLite databases): column order of payments
-- created_at/updated_at and users.permissions; refunds.source_payment_verified_by
-- is TEXT here but INTEGER in the migrations; and two magic_links indexes
-- (idx_ml_expires, idx_ml_token) that exist only here.
-- CREATE TABLE (no IF NOT EXISTS) will fail if tables already exist. That is intentional.

CREATE TABLE registrations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reg_code      TEXT    NOT NULL UNIQUE,       -- 12-char base32, public-facing
  status        TEXT    NOT NULL DEFAULT 'pending',  -- pending | pending_verification | confirmed

  -- Alumni details (Step 1)
  full_name          TEXT NOT NULL,
  branch             TEXT NOT NULL,
  email              TEXT NOT NULL,
  whatsapp           TEXT NOT NULL,
  mobile_alternate   TEXT,
  city               TEXT NOT NULL,
  country            TEXT NOT NULL DEFAULT 'India',
  attendance_intent  TEXT NOT NULL,             -- attending | donation_only
  participation_type TEXT NOT NULL DEFAULT 'full_celebration',  -- full_celebration | campus_only | donation_only
  gender             TEXT,                      -- male | female | prefer_not_to_say
  tshirt_size        TEXT,                      -- 2XS | XS | S | M | L | XL | 2XL | 3XL | 4XL | 5XL | 6XL

  -- Meals (Step 2)
  alumni_meal        TEXT NOT NULL,             -- veg | non_veg | none (donation-only)

  -- Accommodation (Step 3)
  accommodation      TEXT NOT NULL DEFAULT 'none',  -- none | private | shared_double | shared_triple
  check_in           TEXT,
  check_out          TEXT,
  extra_bed          INTEGER NOT NULL DEFAULT 0,  -- boolean: private-room extra bed
  breakfast_adult    INTEGER NOT NULL DEFAULT 0,  -- count: additional breakfasts (12+)
  breakfast_child    INTEGER NOT NULL DEFAULT 0,  -- count: additional breakfasts (6-12)

  -- Donation (Step 3)
  donation_amount    INTEGER NOT NULL DEFAULT 0,    -- whole INR
  public_ack         INTEGER NOT NULL DEFAULT 0,    -- boolean: display name on programme
  ack_display_name   TEXT,
  felicitation       INTEGER NOT NULL DEFAULT 0,    -- boolean: consent for on-stage recognition

  -- Pricing (frozen at submission)
  pricing_snapshot   TEXT NOT NULL,             -- JSON: full PricingBreakup
  total_amount       INTEGER NOT NULL,          -- whole INR, denormalized for queries

  -- College contributions (Step 5 "Giving Back")
  contribution_splits TEXT NOT NULL DEFAULT '{}',  -- JSON: { cause → amount_in_INR }

  -- Notes
  id_note            TEXT,

  -- Files
  photo_file_key     TEXT,                      -- R2 key for alumni photo
  photo_thumb_key    TEXT,                      -- R2 key for 200x200 face-cropped thumbnail

  -- Registration-desk check-in (registration-desk.spec.md R4)
  checked_in_at      INTEGER,                   -- Unix epoch ms; NULL = not present
  checked_in_by      INTEGER REFERENCES users(id),  -- staff actor id

  -- Timestamps
  created_at         INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at         INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Seed autoincrement to start at 1001
INSERT INTO sqlite_sequence (name, seq) VALUES ('registrations', 1000);

CREATE INDEX idx_reg_reg_code ON registrations(reg_code);
CREATE UNIQUE INDEX idx_reg_email_unique ON registrations(email);
CREATE INDEX idx_reg_whatsapp ON registrations(whatsapp);
CREATE INDEX idx_reg_status ON registrations(status);
CREATE INDEX idx_reg_branch ON registrations(branch);
CREATE INDEX idx_reg_created ON registrations(created_at);
CREATE INDEX idx_reg_checked_in ON registrations(checked_in_at);

CREATE TABLE attendees (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id  INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  type             TEXT    NOT NULL,            -- spouse | child | guest
  name             TEXT,
  age              INTEGER,                     -- children only
  relationship     TEXT,                        -- guests only
  meal             TEXT    NOT NULL,            -- veg | non_veg
  is_chargeable    INTEGER NOT NULL DEFAULT 1,  -- 0 for children under threshold
  created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX idx_att_registration ON attendees(registration_id);
CREATE INDEX idx_att_type ON attendees(type);

CREATE TABLE id_documents (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id  INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  file_name        TEXT    NOT NULL,
  mime_type        TEXT    NOT NULL,            -- image/jpeg | image/png | application/pdf
  size_bytes       INTEGER NOT NULL,
  r2_key           TEXT    NOT NULL,            -- R2 object key
  created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX idx_doc_registration ON id_documents(registration_id);

CREATE TABLE payments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id  INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  amount           INTEGER NOT NULL,            -- whole INR
  status           TEXT    NOT NULL DEFAULT 'payment_pending',  -- payment_pending | pending_verification | verified
  gateway          TEXT,                        -- provider name (null for mock)
  gateway_ref      TEXT,                        -- provider's transaction ID
  gateway_response TEXT,                        -- JSON blob of provider response
  proof_file_key   TEXT,                        -- R2 key for bank transfer proof document
  verified_by      TEXT,                        -- email address of verifying admin
  verified_at      INTEGER,                     -- Unix epoch ms when payment was verified
  method           TEXT,                        -- 'cash' | 'upi' | 'bank_transfer' (desk collection)
  note             TEXT,                        -- optional free-text desk comment
  created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX idx_pay_registration ON payments(registration_id);
CREATE INDEX idx_pay_status ON payments(status);

-- Refunds (rebuilt by 0020): live links are NULLABLE with ON DELETE SET NULL;
-- identity/source-payment snapshot fields survive deletion of the live rows.
-- New snapshot columns are nullable at the DB boundary for pre-deploy writer
-- compatibility; the repository enforces them for newly-created refunds.
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
  source_payment_verified_by TEXT,
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

CREATE INDEX idx_refund_registration ON refunds(registration_id);
CREATE INDEX idx_refund_status ON refunds(status);
CREATE INDEX idx_refund_original_registration ON refunds(original_registration_id);
CREATE INDEX idx_refund_source_payment ON refunds(source_payment_id);
CREATE UNIQUE INDEX uq_refund_cancellation_once
  ON refunds(original_registration_id, source_payment_original_id)
  WHERE reason = 'cancellation';

CREATE TABLE audit_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id  INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  action           TEXT    NOT NULL,            -- created | updated | payment_created | proof_uploaded | proof_rejected | proof_uploaded_by_staff | payment_verified | amended | payment_amended | registration_archived
  actor            TEXT,                        -- email address or 'system'
  changes          TEXT,                        -- JSON: { field: { old: x, new: y } }  (null for 'created')
  snapshot         TEXT    NOT NULL,            -- JSON: full registration state at this point
  created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX idx_audit_registration ON audit_log(registration_id);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_created ON audit_log(created_at);

CREATE TABLE users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name       TEXT    NOT NULL,
  role       TEXT    NOT NULL CHECK (role IN ('staff', 'admin')),
  is_active  INTEGER NOT NULL DEFAULT 1,
  permissions TEXT   DEFAULT NULL,              -- JSON: {"scopes": [...]} (0016)
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE system_audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  action      TEXT    NOT NULL,
  actor       TEXT    NOT NULL,
  target_type TEXT,
  target_id   INTEGER,
  details     TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE room_inventory (
  night_date  TEXT PRIMARY KEY,           -- "2026-08-14" or "2026-08-15"
  total_rooms INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE magic_links (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash       TEXT    NOT NULL UNIQUE,     -- SHA-256 hash of the raw token
  registration_id  INTEGER REFERENCES registrations(id),
  user_id          INTEGER REFERENCES users(id),
  expires_at       INTEGER NOT NULL,            -- Unix epoch ms; caller provides value
  used_at          INTEGER,                     -- null until consumed
  created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  CHECK ((registration_id IS NOT NULL AND user_id IS NULL) OR (registration_id IS NULL AND user_id IS NOT NULL))
);

CREATE INDEX idx_ml_token ON magic_links(token_hash);
CREATE INDEX idx_ml_expires ON magic_links(expires_at);

-- Staff archive / cancellation history. original_id is UNIQUE (0020): a
-- repeated or concurrent cancellation fails as a known conflict instead of
-- creating duplicate history.
CREATE TABLE archived_registrations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  original_id   INTEGER NOT NULL,
  reg_code      TEXT NOT NULL,
  email         TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  snapshot      TEXT NOT NULL,
  archived_by   TEXT NOT NULL,
  archived_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE UNIQUE INDEX uq_archived_original_id ON archived_registrations(original_id);
CREATE INDEX idx_archived_email ON archived_registrations(email);
CREATE INDEX idx_archived_reg_code ON archived_registrations(reg_code);

CREATE TABLE bank_transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_hash        TEXT    NOT NULL UNIQUE,
  txn_date        TEXT    NOT NULL,
  txn_date_iso    TEXT    NOT NULL,
  value_date      TEXT    NOT NULL,
  description     TEXT    NOT NULL,
  ref_no          TEXT,
  branch_code     TEXT,
  debit_paise     INTEGER NOT NULL DEFAULT 0,
  credit_paise    INTEGER NOT NULL DEFAULT 0,
  balance_paise   INTEGER NOT NULL DEFAULT 0,
  txn_type        TEXT    NOT NULL CHECK (txn_type IN ('credit', 'debit')),
  comment         TEXT,
  import_batch    TEXT    NOT NULL,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX idx_btxn_date ON bank_transactions(txn_date_iso);
CREATE INDEX idx_btxn_type ON bank_transactions(txn_type);
CREATE INDEX idx_btxn_batch ON bank_transactions(import_batch);

CREATE TABLE bank_transaction_payments (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_transaction_id   INTEGER NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  payment_id            INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE(bank_transaction_id, payment_id)
);

CREATE INDEX idx_btp_txn ON bank_transaction_payments(bank_transaction_id);
CREATE INDEX idx_btp_payment ON bank_transaction_payments(payment_id);

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

CREATE INDEX idx_roommate_prefs_reg ON roommate_preferences(registration_id);
CREATE INDEX idx_roommate_prefs_preferred ON roommate_preferences(preferred_registration_id);

CREATE TABLE feature_flags (
  name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER,                     -- Unix epoch ms; NULL until first admin update (0024)
  updated_by TEXT                         -- admin email; NULL until first admin update (0024)
);

INSERT INTO feature_flags (name, enabled) VALUES ('debug_tools', 0);

CREATE TABLE tshirts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  gender          TEXT,
  size            TEXT    NOT NULL,
  is_included     INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- At most one included shirt per registration
CREATE UNIQUE INDEX idx_tshirts_one_included
  ON tshirts(registration_id) WHERE is_included = 1;

CREATE TABLE additional_charges (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  description     TEXT    NOT NULL,
  amount          INTEGER NOT NULL CHECK (amount > 0),
  created_by      INTEGER NOT NULL REFERENCES users(id),
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Registration-desk spot-registration idempotency (registration-desk.spec.md
-- R5.5/R5.6): actor-scoped keys retained 30 days. Same actor/key/body replays
-- the original desk-safe response; same actor/key with a different body is 409.
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

-- Physical room assignment (room-assignment.spec.md R1/R2). Capacity is
-- deliberately not stored or validated (R1.1). UNIQUE(registration_id,
-- night_date) enforces at most one room per registration per night; the app
-- layer upserts on that key to replace rather than duplicate.
CREATE TABLE rooms (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  room_number   TEXT    NOT NULL UNIQUE,
  notes         TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX idx_rooms_active ON rooms(is_active);

CREATE TABLE registration_room_assignments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id  INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  room_id          INTEGER NOT NULL REFERENCES rooms(id),
  night_date       TEXT    NOT NULL,
  assigned_by      INTEGER NOT NULL REFERENCES users(id),
  created_at       INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE(registration_id, night_date)
);

CREATE INDEX idx_rra_room_night ON registration_room_assignments(room_id, night_date);
CREATE INDEX idx_rra_registration ON registration_room_assignments(registration_id);

-- Memory stories (memory-stories.spec.md): one story per registration (0024).
-- No FK/CASCADE on registration_id — story survival during registration
-- archival/deletion is an unresolved product decision (spec R12); a hard FK
-- would force a behavior (block or cascade-delete) that hasn't been decided.
CREATE TABLE memory_stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id INTEGER NOT NULL,
  author_name TEXT NOT NULL,
  author_branch TEXT NOT NULL,
  text TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'visible'
    CHECK (visibility IN ('visible', 'hidden')),
  published_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  hidden_at INTEGER,
  hidden_by_user_id INTEGER REFERENCES users(id),
  moderation_comment TEXT
);

CREATE INDEX idx_memory_stories_registration ON memory_stories(registration_id);
CREATE INDEX idx_memory_stories_visibility_published ON memory_stories(visibility, published_at DESC);
