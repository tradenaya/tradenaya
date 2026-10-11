-- EXISTING table: telegram_sent_log
-- Defined in src/automation/notification/telegram-dispatch.ts.
-- Generated from the application code; the app runs the same statements automatically on first use.

CREATE TABLE IF NOT EXISTS telegram_sent_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    dedupe_key VARCHAR(200) NOT NULL,
    type VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_dedupe_type (dedupe_key, type)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
