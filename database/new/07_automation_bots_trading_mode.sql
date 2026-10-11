-- NEW column: automation_bots.trading_mode
-- LIVE = real CoinSwitch account, PAPER = simulated account. Existing bots become LIVE.
-- Generated from the application code; the app runs the same statements automatically on first use.

-- The app adds this automatically (BotLifecycleService.ensureSchedulerSchema) when the column is missing.
ALTER TABLE automation_bots ADD COLUMN trading_mode VARCHAR(10) NOT NULL DEFAULT 'LIVE';

-- futures_orders_history needs no new column: paper orders are stored with exchange = 'PAPER'.
