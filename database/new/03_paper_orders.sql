-- NEW table: paper_orders
-- Paper trading: simulated orders (entries, stop-loss, take-profit) and their fills.
-- Generated from the application code; the app runs the same statements automatically on first use.

CREATE TABLE IF NOT EXISTS paper_orders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_id VARCHAR(64) NOT NULL,
    client_order_id VARCHAR(64) NULL,
    user_id INT NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    side VARCHAR(10) NOT NULL,
    order_type VARCHAR(30) NOT NULL,
    quantity DECIMAL(24,8) NOT NULL,
    price DECIMAL(24,8) NULL,
    trigger_price DECIMAL(24,8) NULL,
    reduce_only TINYINT(1) NOT NULL DEFAULT 0,
    leverage DECIMAL(10,2) NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL,
    exec_quantity DECIMAL(24,8) NOT NULL DEFAULT 0,
    avg_execution_price DECIMAL(24,8) NULL,
    execution_fee DECIMAL(24,8) NULL,
    realised_pnl DECIMAL(24,8) NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_paper_order_id (order_id),
    KEY idx_paper_orders_user_status (user_id, status),
    KEY idx_paper_orders_user_symbol (user_id, symbol)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
