-- Memory stories + feature flag audit metadata (2026-08-17)
--
-- Runtime feature flags (feature-flags.spec.md): adds update actor/time so
-- the admin snapshot can show who changed a flag and when (R2.2, R6.4).
-- Additive + nullable only -> deploy-safe (existing rows default to NULL,
-- meaning "never explicitly updated").
--
-- Memory stories (memory-stories.spec.md): one story per registration
-- (R6), immediately public unless hidden by an administrator (R9).
-- hidden_by_user_id references users(id) — administrators are staff/admin
-- users, not registrations.
--
-- Forward-only. Rollback is code rollback plus removal of this migration
-- only in a disposable local database. Never attempt remote D1 rollback.

ALTER TABLE feature_flags ADD COLUMN updated_at INTEGER;
ALTER TABLE feature_flags ADD COLUMN updated_by TEXT;

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

CREATE UNIQUE INDEX uq_memory_stories_registration ON memory_stories(registration_id);
CREATE INDEX idx_memory_stories_visibility_published ON memory_stories(visibility, published_at DESC);
