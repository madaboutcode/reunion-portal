-- Add bank transfer payment proof columns to payments table
ALTER TABLE payments ADD COLUMN proof_file_key TEXT;
ALTER TABLE payments ADD COLUMN verified_by TEXT;
ALTER TABLE payments ADD COLUMN verified_at INTEGER;
