-- EXISTING table: automation_scheduler_events
-- Defined in src/automation/scheduler/SchedulerStore.ts.
-- Generated from the application code; the app runs the same statements automatically on first use.

CREATE TABLE IF NOT EXISTS automation_scheduler_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    bot_id INT NOT NULL,
    user_id INT NOT NULL,
    type VARCHAR(50) NOT NULL,
    message TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_user_created (user_id, created_at),
    KEY idx_bot_created (bot_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
