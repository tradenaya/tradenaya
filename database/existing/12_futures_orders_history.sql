-- EXISTING table: futures_orders_history
-- Defined in src/automation/order-history/repository.ts.
-- Generated from the application code; the app runs the same statements automatically on first use.

CREATE TABLE IF NOT EXISTS futures_orders_history (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT NULL,
    user_email VARCHAR(255) NULL,
    user_code VARCHAR(100) NULL,
    exchange VARCHAR(50) NULL,
    symbol VARCHAR(50) NOT NULL,
    side VARCHAR(10) NOT NULL,
    order_type VARCHAR(30) NOT NULL,
    order_context VARCHAR(30) NOT NULL DEFAULT 'entry',
    quantity DECIMAL(18, 8) NULL,
    price DECIMAL(18, 8) NULL,
    trigger_price DECIMAL(18, 8) NULL,
    reduce_only TINYINT(1) NOT NULL DEFAULT 0,
    status VARCHAR(40) NOT NULL,
    exchange_order_id VARCHAR(255) NULL,
    client_order_id VARCHAR(255) NULL,
    response_status VARCHAR(50) NULL,
    message TEXT NULL,
    amount_used DECIMAL(18, 8) NULL,
    avg_execution_price DECIMAL(18, 8) NULL,
    execution_fee DECIMAL(18, 8) NULL,
    pnl DECIMAL(18, 8) NULL,
    realized_pnl DECIMAL(18, 8) NULL,
    is_profit TINYINT(1) NULL,
    raw_response JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_user_symbol_created (user_id, symbol, created_at),
    KEY idx_status (status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Columns the app adds to older databases (it checks information_schema first;
-- run a line by hand only if that column is missing):
-- ALTER TABLE futures_orders_history ADD COLUMN exchange VARCHAR(50) NULL;
