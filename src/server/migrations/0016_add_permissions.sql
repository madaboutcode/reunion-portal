-- Add optional permissions column to users table for scoped access control.
-- NULL = full access (backward compatible with all existing accounts).
-- When set, contains JSON: {"scopes": ["dashboard", "allocation", ...]}
-- See authentication.spec.md R3.5, R13–R17.
ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT NULL;
