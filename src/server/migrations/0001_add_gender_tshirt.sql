-- Add gender and t-shirt size fields to registrations
ALTER TABLE registrations ADD COLUMN gender TEXT;
ALTER TABLE registrations ADD COLUMN tshirt_size TEXT;
