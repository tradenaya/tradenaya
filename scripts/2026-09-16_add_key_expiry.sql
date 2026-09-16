-- Migration: Add valid_until (DATETIME) to coinswitch_keys
-- Run this on your production MySQL database BEFORE deploying the new code.
--
-- Usage (mysql CLI):
--   mysql -u <user> -p <database_name> < scripts/2026-09-16_add_key_expiry.sql

ALTER TABLE coinswitch_keys
  ADD COLUMN valid_until DATETIME NULL
  AFTER created_at;

-- If the column was previously added as DATE by a dev build, widen it:
ALTER TABLE coinswitch_keys
  MODIFY COLUMN valid_until DATETIME NULL;
