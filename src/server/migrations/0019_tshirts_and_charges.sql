-- Extra t-shirts table (one row per shirt, including the free included one)
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

-- Additional charges table (staff-created arbitrary line items)
CREATE TABLE additional_charges (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  description     TEXT    NOT NULL,
  amount          INTEGER NOT NULL CHECK (amount > 0),
  created_by      INTEGER NOT NULL REFERENCES users(id),
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Backfill: copy each existing registrant's tshirt_size into tshirts as the included row
INSERT INTO tshirts (registration_id, gender, size, is_included)
SELECT
  r.id,
  r.gender,
  r.tshirt_size,
  1
FROM registrations r
WHERE r.tshirt_size IS NOT NULL
  AND r.tshirt_size != ''
  AND NOT EXISTS (
    SELECT 1 FROM tshirts t
    WHERE t.registration_id = r.id AND t.is_included = 1
  );
