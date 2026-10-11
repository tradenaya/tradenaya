-- EXISTING table: automation_bots
-- Defined in src/automation/service/bot-lifecycle.ts.
-- Generated from the application code; the app runs the same statements automatically on first use.

CREATE TABLE IF NOT EXISTS automation_bots (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    strategy VARCHAR(100) NOT NULL,
    name VARCHAR(100) NULL,
    leverage DECIMAL(10,2) NOT NULL DEFAULT 1,
    capital DECIMAL(18,8) NOT NULL DEFAULT 0,
    capital_mode VARCHAR(20) NOT NULL DEFAULT 'fixed',
    wallet_percent DECIMAL(10,2) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'STOPPED',
    current_trade TEXT NULL,
    last_analysis_at TIMESTAMP NULL,
    last_execution_at TIMESTAMP NULL,
    config_json TEXT NULL,
    desired_status VARCHAR(20) NOT NULL DEFAULT 'STOPPED',
    last_error TEXT NULL,
    retry_count INT NOT NULL DEFAULT 0,
    next_run_at TIMESTAMP NULL,
    heartbeat_at TIMESTAMP NULL,
    lease_owner VARCHAR(64) NULL,
    lease_expires_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_user_status (user_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Columns the app adds to older databases (it checks information_schema first;
-- run a line by hand only if that column is missing):
-- ALTER TABLE automation_bots ADD COLUMN name VARCHAR(100) NULL;
-- ALTER TABLE automation_bots ADD COLUMN config_json TEXT NULL;
-- ALTER TABLE automation_bots ADD COLUMN desired_status VARCHAR(20) NOT NULL DEFAULT 'STOPPED';
-- ALTER TABLE automation_bots ADD COLUMN last_error TEXT NULL;
-- ALTER TABLE automation_bots ADD COLUMN retry_count INT NOT NULL DEFAULT 0;
-- ALTER TABLE automation_bots ADD COLUMN next_run_at TIMESTAMP NULL;
-- ALTER TABLE automation_bots ADD COLUMN heartbeat_at TIMESTAMP NULL;
-- ALTER TABLE automation_bots ADD COLUMN lease_owner VARCHAR(64) NULL;
-- ALTER TABLE automation_bots ADD COLUMN lease_expires_at TIMESTAMP NULL;
-- ALTER TABLE automation_bots ADD COLUMN trading_mode VARCHAR(10) NOT NULL DEFAULT 'LIVE';  -- NEW (paper trading)
