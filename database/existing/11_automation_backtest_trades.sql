-- EXISTING table: automation_backtest_trades
-- Defined in src/automation/backtest/store.ts.
-- Generated from the application code; the app runs the same statements automatically on first use.

CREATE TABLE IF NOT EXISTS automation_backtest_trades (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    backtest_id BIGINT NOT NULL,
    trade_id VARCHAR(64) NOT NULL,
    symbol VARCHAR(32) NOT NULL,
    side VARCHAR(8) NOT NULL,
    entry_time BIGINT NOT NULL,
    entry_price DOUBLE NOT NULL,
    exit_time BIGINT NOT NULL,
    exit_price DOUBLE NOT NULL,
    quantity DOUBLE NOT NULL,
    leverage DOUBLE NOT NULL,
    margin DOUBLE NOT NULL,
    gross_pnl DOUBLE NOT NULL,
    entry_fee DOUBLE NOT NULL,
    exit_fee DOUBLE NOT NULL,
    total_fee DOUBLE NOT NULL,
    net_pnl DOUBLE NOT NULL,
    return_pct DOUBLE NOT NULL,
    mfe DOUBLE NOT NULL,
    mae DOUBLE NOT NULL,
    exit_reason VARCHAR(32) NOT NULL,
    duration_ms BIGINT NOT NULL,
    planned_risk_reward DOUBLE NOT NULL,
    KEY idx_backtest_id (backtest_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
