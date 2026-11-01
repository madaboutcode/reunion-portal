DROP INDEX IF EXISTS idx_reg_email;
CREATE UNIQUE INDEX idx_reg_email_unique ON registrations(email);
