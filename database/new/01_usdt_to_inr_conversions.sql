-- NEW table: usdt_to_inr_conversions
-- USDT -> INR conversions (sell) — added with the two-way convert dialog.
-- Generated from the application code; the app runs the same statements automatically on first use.

CREATE TABLE IF NOT EXISTS usdt_to_inr_conversions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT NULL,
    user_email VARCHAR(255) NULL,
    amount_usdt DECIMAL(18, 8) NOT NULL,
    usdt_sold DECIMAL(18, 8) NULL,
    inr_received DECIMAL(18, 8) NULL,
    rate DECIMAL(18, 8) NULL,
    fee DECIMAL(18, 8) NULL,
    status VARCHAR(40) NOT NULL,
    message TEXT NULL,
    exchange_order_id VARCHAR(255) NULL,
    raw_response JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_user_created (user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
