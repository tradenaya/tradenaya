-- EXISTING table: automation_position_events
-- Defined in src/automation/position/PositionStore.ts.
-- Generated from the application code; the app runs the same statements automatically on first use.

CREATE TABLE IF NOT EXISTS automation_position_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT NOT NULL,
    bot_id INT NOT NULL,
    symbol VARCHAR(50) NULL,
    execution_id BIGINT UNSIGNED NOT NULL,
    position_id BIGINT UNSIGNED NULL,
    type VARCHAR(50) NOT NULL,
    message TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_position (position_id),
    KEY idx_user_created (user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Columns the app adds to older databases (it checks information_schema first;
-- run a line by hand only if that column is missing):
-- ALTER TABLE automation_position_events ADD COLUMN symbol VARCHAR(50) NULL;
