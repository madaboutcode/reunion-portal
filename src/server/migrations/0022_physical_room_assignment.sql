-- Physical Room Assignment (2026-08-10)
--
-- room-assignment.spec.md R1/R2. Two new tables, both fresh — no existing
-- columns change, so (unlike 0021) this is plain CREATE TABLE, no stage/
-- drop/rebuild dance.
--
-- 1. rooms — physical room records (number, notes, active state). R1/R1.1:
--    capacity is deliberately not stored or validated.
-- 2. registration_room_assignments — one row per (registration, night).
--    UNIQUE(registration_id, night_date) enforces "at most one room per
--    registration per night" (R2); the app layer upserts on that key to
--    replace rather than duplicate. Multiple registrations may reference the
--    same room_id + night_date — no capacity constraint (R2.1).
--
-- Forward-only. Rollback is code rollback plus removal of this migration
-- only in a disposable local database. Never attempt remote D1 rollback.

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
