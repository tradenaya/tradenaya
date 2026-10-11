-- EXISTING table: automation_order_submissions
-- Defined in src/automation/executor/store.ts.
-- Generated from the application code; the app runs the same statements automatically on first use.

CREATE TABLE IF NOT EXISTS automation_order_submissions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT NOT NULL,
    bot_id INT NOT NULL,
    execution_key VARCHAR(100) NOT NULL,
    execution_id BIGINT UNSIGNED NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'IN_FLIGHT',
    claimed_at TIMESTAMP NULL,
    released_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_execution_key (execution_key),
    KEY idx_holder (status, execution_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
