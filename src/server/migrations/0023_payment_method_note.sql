-- Payment method + desk note (2026-08-11)
--
-- registration-desk payment collection (desk-payment-collection plan, "Data
-- Models"). Adds the cash/offline settlement lane: `method` records how the
-- desk collected payment, `note` is an optional free-text desk comment.
--
-- Additive + nullable only -> deploy-safe, rollback-safe (old code ignores
-- the columns). No stage/drop/rebuild dance needed (unlike 0021).
--
-- Forward-only. Rollback is code rollback plus removal of this migration
-- only in a disposable local database. Never attempt remote D1 rollback.

ALTER TABLE payments ADD COLUMN method TEXT;   -- 'cash' | 'upi' | 'bank_transfer' (desk collection)
ALTER TABLE payments ADD COLUMN note   TEXT;   -- optional free-text desk comment
