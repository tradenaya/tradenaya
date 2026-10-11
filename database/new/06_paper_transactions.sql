-- NEW table: paper_transactions
-- Paper trading: ledger (commission, realised PnL) used for close accounting.
-- Generated from the application code; the app runs the same statements automatically on first use.

CREATE TABLE IF NOT EXISTS paper_transactions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id INT NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    type VARCHAR(20) NOT NULL,
    amount DECIMAL(24,8) NOT NULL,
    order_id VARCHAR(64) NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (id),
    KEY idx_paper_tx_user_time (user_id, created_at),
    KEY idx_paper_tx_user_symbol (user_id, symbol)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
