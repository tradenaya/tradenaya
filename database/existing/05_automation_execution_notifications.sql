-- EXISTING table: automation_execution_notifications
-- Defined in src/automation/executor/store.ts.
-- Generated from the application code; the app runs the same statements automatically on first use.

CREATE TABLE IF NOT EXISTS automation_execution_notifications (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT NOT NULL,
    bot_id INT NOT NULL,
    execution_id BIGINT UNSIGNED NOT NULL,
    type VARCHAR(50) NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    message TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_user_created (user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
