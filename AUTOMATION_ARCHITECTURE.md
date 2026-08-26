# TradeNaya Automation Architecture

## Purpose
This document captures the automation architecture added on top of the existing manual futures trading flow so another developer or AI agent can understand the system quickly.

## Project Context
TradeNaya already provides:
- customer authentication
- CoinSwitch account connection
- futures market pages
- live price and candles
- wallet balance and leverage controls
- manual futures order flow
- open / closed positions and orders

The automation layer is designed to extend that existing flow without replacing it.

## Core Principles
- The automation runs on the server, not in the browser.
- Bot state is persisted in MySQL.
- Every entry order is created as a LIMIT order.
- Every executed trade should automatically receive SL and TP when supported by the exchange flow.
- The system is modular and split by responsibility.
- Existing CoinSwitch order routes are reused rather than reimplemented.

## Automation Folder Structure

src/automation/
  engine/
    automation-engine.ts
  market/
    market-data-service.ts
  indicators/
    indicator-engine.ts
  planner/
    trade-planner.ts
    entry-planner.ts
    stop-loss-planner.ts
    take-profit-planner.ts
    risk-reward-validator.ts
    trade-validator.ts
    types.ts
  risk/
    risk-manager.ts
    types.ts
    capital-allocation.ts
    position-size-calculator.ts
    risk-validator.ts
    drawdown-protection.ts
    daily-loss-protection.ts
    exposure-manager.ts
    validation-engine.ts
  strategy/
    trend-strategy.ts
  service/
    bot-lifecycle.ts
    bot-runner.ts
  types/
    index.ts
    market.ts
    strategy.ts
    risk.ts
    order.ts

## Key Files and Responsibilities

### src/automation/types/index.ts
Defines shared automation types and config structures.

### src/automation/market/market-data-service.ts
Fetches the latest market snapshot and candles from the existing futures API routes.

### src/automation/indicators/indicator-engine.ts
Computes the first reusable indicator bundle used by the strategy layer.

### src/automation/strategy/trend-strategy.ts
Implements the first extensible strategy interface.

### src/automation/planner/trade-planner.ts
Creates the plan for entry, stop loss, take profit, and risk-reward.

### src/automation/risk/risk-manager.ts
Evaluates whether the current setup is within configured risk limits. The orchestrator (`DefaultRiskManager.evaluate`) receives wallet balance, capital selection, the Trade Plan, open positions, open orders, and daily statistics, then returns an APPROVE / REJECT decision with position size, capital used, expected loss / profit, and risk percentage. A backward-compatible `assess` method is kept for the existing engine. The module is fully config-driven via `RiskManagerConfig` defaults and never communicates with the exchange. Logic is split across:
- `capital-allocation.ts` — resolves fixed / percent capital selection against wallet and max allocation
- `position-size-calculator.ts` — sizes positions from capital, leverage, stop-loss distance and risk %
- `risk-validator.ts` — checks risk-reward, max risk per trade, max leverage, min wallet balance
- `drawdown-protection.ts` — blocks trades once max drawdown from peak equity is reached
- `daily-loss-protection.ts` — enforces daily loss and daily trade limits
- `exposure-manager.ts` — enforces max positions / bots and blocks duplicate symbol positions or pending LIMIT orders
- `validation-engine.ts` — aggregates all checks into a single `RiskDecision`

### src/automation/engine/automation-engine.ts
Coordinates market data, indicators, strategy analysis, risk validation, and planning.

### src/automation/service/bot-lifecycle.ts
Persists automation bot state in MySQL and supports lifecycle operations such as start, stop, pause and heartbeat updates.

### src/automation/service/bot-runner.ts
Starts a background bot loop that repeatedly evaluates the market and maintains bot state.

## Existing Files Reused
The automation layer intentionally reuses these existing modules:
- src/app/api/coinswitch/futures/order/route.ts
- src/app/api/coinswitch/futures/positions/route.ts
- src/app/api/coinswitch/futures/open-orders/route.ts
- src/app/api/coinswitch/futures/kline/route.ts
- src/lib/db.ts
- src/lib/auth.ts
- src/app/api/coinswitch/_helpers.ts

## Bot Lifecycle
A bot instance is created with:
- user ID
- symbol
- leverage
- capital configuration
- strategy

The lifecycle supports:
- RUNNING
- PAUSED
- STOPPED
- ERROR

## Important Notes
- The automation currently uses a simple trend-following strategy as the first working implementation.
- The architecture is intentionally modular so additional strategies, indicators, and risk rules can be added later.
- The UI should only display bot status and configuration; it should not be the source of truth for whether the bot keeps running.
- A production implementation should add a real scheduler, durable job queue, and recovery process after crashes.

## Recommended Next Steps
1. Add a bot management API route for start / stop / status.
2. Add a database-backed execution log table.
3. Add a server-side scheduler or worker runner.
4. Add order execution and position monitoring modules.
5. Add email and notification handlers.
6. Add persistence for trades, orders, and safety-rule events.
