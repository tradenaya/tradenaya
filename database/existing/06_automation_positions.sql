-- EXISTING table: automation_positions
-- Defined in src/automation/position/PositionStore.ts.
-- Generated from the application code; the app runs the same statements automatically on first use.

CREATE TABLE IF NOT EXISTS automation_positions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    execution_id BIGINT UNSIGNED NOT NULL,
    bot_id INT NOT NULL,
    user_id INT NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    side VARCHAR(10) NOT NULL,
    state VARCHAR(30) NOT NULL,
    quantity DECIMAL(18,8) NULL,
    filled_quantity DECIMAL(18,8) NULL,
    remaining_quantity DECIMAL(18,8) NULL,
    entry_price DECIMAL(18,8) NULL,
    current_price DECIMAL(18,8) NULL,
    stop_loss DECIMAL(18,8) NULL,
    take_profit DECIMAL(18,8) NULL,
    leverage DECIMAL(10,2) NULL,
    position_id VARCHAR(100) NULL,
    entry_order_id VARCHAR(100) NULL,
    sl_order_id VARCHAR(100) NULL,
    tp_order_id VARCHAR(100) NULL,
    sl_triggered TINYINT(1) NOT NULL DEFAULT 0,
    tp_triggered TINYINT(1) NOT NULL DEFAULT 0,
    exit_price DECIMAL(18,8) NULL,
    exit_reason VARCHAR(30) NULL,
    realized_pnl DECIMAL(18,8) NULL,
    fees DECIMAL(18,8) NULL,
    trailing_enabled TINYINT(1) NOT NULL DEFAULT 0,
    trailing_activated TINYINT(1) NOT NULL DEFAULT 0,
    trailing_distance_pct DECIMAL(10,4) NULL,
    trailing_activation_pct DECIMAL(10,4) NULL,
    highest_price DECIMAL(18,8) NULL,
    lowest_price DECIMAL(18,8) NULL,
    unrealized_pnl DECIMAL(18,8) NULL,
    last_sync_at TIMESTAMP NULL,
    error_message TEXT NULL,
    closed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_bot_state (bot_id, state),
    KEY idx_execution (execution_id),
    KEY idx_user_state (user_id, state)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Columns the app adds to older databases (it checks information_schema first;
-- run a line by hand only if that column is missing):
-- ALTER TABLE automation_positions ADD COLUMN remaining_quantity DECIMAL(18,8) NULL;
