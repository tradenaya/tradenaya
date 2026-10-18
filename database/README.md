# Database scripts

Every table the Tradenaya app uses, as plain MySQL 8 scripts, for review and
future use. They are generated from the application code: the app runs these
same `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN` statements by itself the first
time a feature needs them, so **you do not have to run anything by hand** for a
deploy. The scripts are here so you can see exactly what exists, rebuild a
database from scratch, or check a server manually.

## How the app creates tables automatically

- **New tables** are created with `CREATE TABLE IF NOT EXISTS …` right before
  the first query that needs them, then the request continues normally. The
  paper tables are created on the first paper-trading request
  (`ensurePaperSchema()` in `src/automation/paper/store.ts`).
- **New columns** on existing tables are added only when
  `information_schema.COLUMNS` shows they are missing
  (e.g. `automation_bots.trading_mode` in `BotLifecycleService.ensureSchedulerSchema()`),
  so running twice is harmless and existing data is never changed.

## Folders

### `existing/` — tables that were already in the app before this change

| File | Table | Purpose |
|---|---|---|
| 01_coinswitch_keys.sql | coinswitch_keys | Users' CoinSwitch API keys |
| 02_automation_bots.sql | automation_bots | Bots and their settings (now also `trading_mode`, see `new/07`) |
| 03_automation_executions.sql | automation_executions | One row per trade attempt (entry / SL / TP order refs) |
| 04_automation_order_submissions.sql | automation_order_submissions | Duplicate-order guard |
| 05_automation_execution_notifications.sql | automation_execution_notifications | Execution events / notifications |
| 06_automation_positions.sql | automation_positions | Positions being managed |
| 07_automation_position_events.sql | automation_position_events | Position event log |
| 08_automation_closed_trades.sql | automation_closed_trades | Closed trades with PnL and fees (analytics) |
| 09_automation_scheduler_events.sql | automation_scheduler_events | Scheduler / bot activity log |
| 10_automation_backtests.sql | automation_backtests | Backtest runs |
| 11_automation_backtest_trades.sql | automation_backtest_trades | Trades inside a backtest |
| 12_futures_orders_history.sql | futures_orders_history | Order history (paper orders use `exchange = 'PAPER'`) |
| 13_telegram_sent_log.sql | telegram_sent_log | Telegram de-duplication |
| 14_inr_to_usdt_conversions.sql | inr_to_usdt_conversions | INR → USDT conversions |

Some of these files end with commented `ALTER TABLE … ADD COLUMN` lines: those
are columns the app added to older databases over time. The app adds them
itself; run one by hand only if that column is missing.

The `scripts/2026-09-16_add_key_expiry.sql` migration (coinswitch_keys
`valid_until`) is also listed in `existing/01_coinswitch_keys.sql`.

Not included: the login / tenant tables (users, customers, admins, tenants).
They are not created by the app code; to export their structure from the
server run:

```bash
mysqldump -u <user> -p --no-data <database> > database/existing/auth_tables.sql
```

### `new/` — added with this change

| File | What | Purpose |
|---|---|---|
| 01_usdt_to_inr_conversions.sql | new table | USDT → INR conversions (sell) |
| 02_paper_wallets.sql | new table | Paper trading — simulated wallet per user (default 100 USDT) |
| 03_paper_orders.sql | new table | Paper trading — simulated orders and their fills |
| 04_paper_positions.sql | new table | Paper trading — open simulated positions |
| 05_paper_leverage.sql | new table | Paper trading — leverage per coin |
| 06_paper_transactions.sql | new table | Paper trading — commission / realised PnL ledger |
| 07_automation_bots_trading_mode.sql | new column | `automation_bots.trading_mode` = `LIVE` or `PAPER` (existing bots become `LIVE`) |
| 08_automation_position_events_details.sql | new column | `automation_position_events.details` — JSON proof for stop-loss moves (old / new level, orders, status) |

## Running them by hand (optional)

```bash
# whole database from scratch
for f in database/existing/*.sql database/new/*.sql; do mysql -u <user> -p <database> < "$f"; done
```

All `CREATE TABLE` statements use `IF NOT EXISTS`, so they are safe to re-run.
The `ALTER TABLE` line in `new/07` fails harmlessly with "Duplicate column" if
the app already added the column.
