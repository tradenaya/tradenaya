-- EXISTING table: automation_executions
-- Defined in src/automation/executor/store.ts.
-- Generated from the application code; the app runs the same statements automatically on first use.

CREATE TABLE IF NOT EXISTS automation_executions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    bot_id INT NOT NULL,
    user_id INT NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    side VARCHAR(10) NOT NULL,
    state VARCHAR(30) NOT NULL,
    execution_key VARCHAR(100) NOT NULL,
    limit_price DECIMAL(18,8) NULL,
    stop_loss DECIMAL(18,8) NULL,
    take_profit DECIMAL(18,8) NULL,
    quantity DECIMAL(18,8) NULL,
    filled_quantity DECIMAL(18,8) NULL,
    remaining_quantity DECIMAL(18,8) NULL,
    entry_avg_price DECIMAL(18,8) NULL,
    leverage DECIMAL(10,2) NULL,
    expires_at TIMESTAMP NULL,
    position_id VARCHAR(100) NULL,
    entry_exchange_order_id VARCHAR(100) NULL,
    entry_client_order_id VARCHAR(100) NULL,
    entry_status VARCHAR(50) NULL,
    sl_exchange_order_id VARCHAR(100) NULL,
    sl_client_order_id VARCHAR(100) NULL,
    sl_status VARCHAR(50) NULL,
    tp_exchange_order_id VARCHAR(100) NULL,
    tp_client_order_id VARCHAR(100) NULL,
    tp_status VARCHAR(50) NULL,
    protective_status VARCHAR(20) NOT NULL DEFAULT 'NONE',
    error_message TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_bot_state (bot_id, state),
    KEY idx_user_symbol (user_id, symbol, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Columns the app adds to older databases (it checks information_schema first;
-- run a line by hand only if that column is missing):
-- ALTER TABLE automation_executions ADD COLUMN remaining_quantity DECIMAL(18,8) NULL;
-- ALTER TABLE automation_executions ADD COLUMN entry_avg_price DECIMAL(18,8) NULL;
