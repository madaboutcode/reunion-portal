-- Allow multiple stories per registration (up to STORIES_PER_PERSON_MAX=3).
-- The old unique index enforced one-per-person; replace with a plain index.
DROP INDEX IF EXISTS uq_memory_stories_registration;
CREATE INDEX idx_memory_stories_registration ON memory_stories(registration_id);
