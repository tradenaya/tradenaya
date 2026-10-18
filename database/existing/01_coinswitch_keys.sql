-- EXISTING table: coinswitch_keys
-- Defined in src/lib/coinswitch.store.ts.
-- Generated from the application code; the app runs the same statements automatically on first use.

CREATE TABLE IF NOT EXISTS coinswitch_keys (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    api_key TEXT NOT NULL,
      api_key_masked TEXT DEFAULT NULL,
    api_secret_enc TEXT NOT NULL,
      valid_until DATETIME NULL,
    status CHAR(1) NOT NULL DEFAULT 'A',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user (user_id),
    CONSTRAINT coinswitch_keys_user_fk FOREIGN KEY (user_id) REFERENCES users(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Columns the app adds to older databases (it checks information_schema first;
-- run a line by hand only if that column is missing):
-- ALTER TABLE coinswitch_keys ADD COLUMN valid_until DATETIME NULL AFTER created_at; -- scripts/2026-09-16_add_key_expiry.sql
-- ALTER TABLE coinswitch_keys ADD COLUMN api_key_masked TEXT DEFAULT NULL AFTER api_key;
-- UPDATE coinswitch_keys SET api_key_masked = CONCAT(LEFT(api_key,4),'...',RIGHT(api_key,4)) WHERE api_key_masked IS NULL;
