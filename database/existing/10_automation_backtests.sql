-- EXISTING table: automation_backtests
-- Defined in src/automation/backtest/store.ts.
-- Generated from the application code; the app runs the same statements automatically on first use.

CREATE TABLE IF NOT EXISTS automation_backtests (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    bot_id INT NULL,
    symbol VARCHAR(32) NOT NULL,
    timeframe VARCHAR(16) NOT NULL,
    start_time BIGINT NOT NULL,
    end_time BIGINT NOT NULL,
    initial_capital DOUBLE NOT NULL,
    config_json JSON NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
    progress_json JSON NULL,
    execution_policy VARCHAR(16) NULL,
    slippage_applied TINYINT(1) NOT NULL DEFAULT 0,
    metrics_json JSON NULL,
    equity_curve_json JSON NULL,
    error_message TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    KEY idx_user_id (user_id),
    KEY idx_user_created (user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
