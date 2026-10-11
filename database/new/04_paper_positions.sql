-- NEW table: paper_positions
-- Paper trading: open simulated positions.
-- Generated from the application code; the app runs the same statements automatically on first use.

CREATE TABLE IF NOT EXISTS paper_positions (
    user_id INT NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    side VARCHAR(10) NOT NULL,
    quantity DECIMAL(24,8) NOT NULL,
    entry_price DECIMAL(24,8) NOT NULL,
    leverage DECIMAL(10,2) NOT NULL DEFAULT 1,
    position_id VARCHAR(64) NOT NULL,
    opened_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, symbol)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
