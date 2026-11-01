-- Room inventory: staff-managed room quotas per night
CREATE TABLE room_inventory (
  night_date  TEXT PRIMARY KEY,
  total_rooms INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
