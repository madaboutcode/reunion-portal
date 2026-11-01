-- Add participation_type column (full_celebration | campus_only | donation_only)
ALTER TABLE registrations ADD COLUMN participation_type TEXT NOT NULL DEFAULT 'full_celebration';

-- Backfill: donation_only registrations get donation_only participation type
UPDATE registrations SET participation_type = 'donation_only' WHERE attendance_intent = 'donation_only';

-- Clean up not_sure → attending (not_sure is being removed)
UPDATE registrations SET attendance_intent = 'attending' WHERE attendance_intent = 'not_sure';
