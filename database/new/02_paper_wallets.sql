-- NEW table: paper_wallets
-- Paper trading: simulated USDT wallet per user (default 100 USDT, resettable).
-- Generated from the application code; the app runs the same statements automatically on first use.

CREATE TABLE IF NOT EXISTS paper_wallets (
    user_id INT NOT NULL,
    balance DECIMAL(24,8) NOT NULL DEFAULT 0,
    initial_balance DECIMAL(24,8) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
