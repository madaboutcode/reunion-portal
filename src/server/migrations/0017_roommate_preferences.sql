-- Roommate preferences — M:M junction between shared-accommodation registrations.
-- See roommate-preferences.spec.md R1, R1.1.
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
