-- Add contribution_splits column to registrations table
-- Stores per-cause college contributions as a JSON object: {"green_energy": 5000}
-- Default '{}' ensures all historical rows have a valid empty map.
ALTER TABLE registrations ADD COLUMN contribution_splits TEXT NOT NULL DEFAULT '{}';
