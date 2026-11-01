-- Cancellation & refunds (plan tasks/2026-08-03-cancellation-refunds.plan.md §9)
--
-- 1. Rebuild `refunds` so a cancellation refund survives the deletion of its
--    registration and source payment:
--      - registration_id / source_payment_id become NULLABLE live links with
--        ON DELETE SET NULL
--      - immutable identity + source-payment snapshot fields are copied onto
--        the row at creation time
--      - `reason` discriminates overpayment vs cancellation; cancellation
--        refunds carry `cancellation_reason`
-- 2. Add indexes + a partial duplicate guard so one verified payment cannot
--    produce two cancellation refunds.
-- 3. Add a unique archived_registrations.original_id guard so a repeated or
--    concurrent cancellation cannot create duplicate archive history.
--
-- Migration sequence (SQLite cannot alter FK nullability/delete actions in
-- place): create replacement table → copy/backfill with an explicit column
-- list → drop old table → rename → recreate indexes.
--
-- Compatibility: the new snapshot fields stay NULLABLE at the database
-- boundary and `reason` defaults to 'overpayment', so the pre-deploy
-- overpayment writer (INSERT of registration_id, source_payment_id, amount,
-- status) keeps working against this schema. The repository enforces the
-- snapshot fields at the service boundary for newly-created refunds.

CREATE TABLE refunds_new (
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

-- Backfill every existing refund row: preserve IDs, amounts, statuses, bank
-- fields and timestamps; snapshot identity/source-payment facts from the live
-- registration and source payment; existing rows are overpayment refunds.
INSERT INTO refunds_new (
  id,
  registration_id,
  original_registration_id,
  reg_code,
  full_name,
  email,
  source_payment_id,
  source_payment_original_id,
  source_payment_amount,
  source_payment_reference,
  source_payment_gateway,
  source_payment_created_at,
  source_payment_verified_by,
  source_payment_verified_at,
  source_payment_proof_key,
  amount,
  reason,
  cancellation_reason,
  status,
  bank_reference,
  resolved_by,
  resolved_at,
  created_at
)
SELECT
  r.id,
  r.registration_id,
  r.registration_id,
  reg.reg_code,
  reg.full_name,
  reg.email,
  r.source_payment_id,
  r.source_payment_id,
  p.amount,
  p.gateway_ref,
  p.gateway,
  p.created_at,
  p.verified_by,
  p.verified_at,
  p.proof_file_key,
  r.amount,
  'overpayment',
  NULL,
  r.status,
  r.bank_reference,
  r.resolved_by,
  r.resolved_at,
  r.created_at
FROM refunds r
LEFT JOIN registrations reg ON reg.id = r.registration_id
LEFT JOIN payments p ON p.id = r.source_payment_id;

DROP TABLE refunds;
ALTER TABLE refunds_new RENAME TO refunds;

CREATE INDEX idx_refund_registration ON refunds(registration_id);
CREATE INDEX idx_refund_status ON refunds(status);
CREATE INDEX idx_refund_original_registration ON refunds(original_registration_id);
CREATE INDEX idx_refund_source_payment ON refunds(source_payment_id);

-- Partial unique guard: one cancellation refund per (original registration,
-- original source payment). Duplicate/concurrent cancellation of the same
-- verified payment is rejected at the database level.
CREATE UNIQUE INDEX uq_refund_cancellation_once
  ON refunds(original_registration_id, source_payment_original_id)
  WHERE reason = 'cancellation';

-- Duplicate-cancellation guard for registrations that never had a verified
-- payment (archived without a refund). Preflight before adding the index:
--   SELECT original_id FROM archived_registrations GROUP BY original_id HAVING COUNT(*) > 1;
-- The CREATE UNIQUE INDEX below fails loudly if duplicates already exist —
-- do not silently drop archive history.
CREATE UNIQUE INDEX uq_archived_original_id ON archived_registrations(original_id);
