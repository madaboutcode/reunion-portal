-- Add archived_registrations table for staff archive workflow
-- Stores a full snapshot of a registration at the time of archival.
-- Original registration is hard-deleted; snapshot preserved here for audit.
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

CREATE INDEX idx_archived_email ON archived_registrations(email);
CREATE INDEX idx_archived_reg_code ON archived_registrations(reg_code);
