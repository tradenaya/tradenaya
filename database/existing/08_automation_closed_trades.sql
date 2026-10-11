-- EXISTING table: automation_closed_trades
-- Defined in src/automation/position/PositionStore.ts.
-- Generated from the application code; the app runs the same statements automatically on first use.

CREATE TABLE IF NOT EXISTS automation_closed_trades (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    execution_id BIGINT UNSIGNED NOT NULL,
    bot_id INT NOT NULL,
    user_id INT NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    side VARCHAR(10) NOT NULL,
    entry_price DECIMAL(18,8) NULL,
    exit_price DECIMAL(18,8) NULL,
    exit_reason VARCHAR(30) NULL,
    realized_pnl DECIMAL(18,8) NULL,
    fees DECIMAL(18,8) NULL,
    position_size DECIMAL(18,8) NULL,
    closed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_execution (execution_id),
    KEY idx_user_created (user_id, closed_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Columns the app adds to older databases (it checks information_schema first;
-- run a line by hand only if that column is missing):
-- ALTER TABLE automation_closed_trades ADD COLUMN gross_profit DECIMAL(18,8) NULL DEFAULT 0;
-- ALTER TABLE automation_closed_trades ADD COLUMN commission DECIMAL(18,8) NULL DEFAULT 0;
-- ALTER TABLE automation_closed_trades ADD COLUMN funding_fee DECIMAL(18,8) NULL DEFAULT 0;
