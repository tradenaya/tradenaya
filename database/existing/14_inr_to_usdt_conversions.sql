-- EXISTING table: inr_to_usdt_conversions
-- Defined in src/app/api/coinswitch/convert/route.ts.
-- Generated from the application code; the app runs the same statements automatically on first use.

CREATE TABLE IF NOT EXISTS inr_to_usdt_conversions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT NULL,
    user_email VARCHAR(255) NULL,
    amount_inr DECIMAL(18, 8) NOT NULL,
    inr_spent DECIMAL(18, 8) NULL,
    usdt_received DECIMAL(18, 8) NULL,
    rate DECIMAL(18, 8) NULL,
    fee DECIMAL(18, 8) NULL,
    status VARCHAR(40) NOT NULL,
    message TEXT NULL,
    exchange_order_id VARCHAR(255) NULL,
    client_order_id VARCHAR(255) NULL,
    raw_response JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_user_created (user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
