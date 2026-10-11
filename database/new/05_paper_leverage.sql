-- NEW table: paper_leverage
-- Paper trading: leverage per symbol.
-- Generated from the application code; the app runs the same statements automatically on first use.

CREATE TABLE IF NOT EXISTS paper_leverage (
    user_id INT NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    leverage DECIMAL(10,2) NOT NULL,
    PRIMARY KEY (user_id, symbol)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
