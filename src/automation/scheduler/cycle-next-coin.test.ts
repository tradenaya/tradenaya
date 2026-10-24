import { describe, expect, it, vi } from "vitest";
import type { BotRuntimeState } from "@/automation/service/bot-lifecycle";
import type { TradePlan } from "@/automation/planner/types";
import type { AnalysisCycleDependencies } from "./AnalysisCycleRunner";

vi.mock("@/automation/scheduler/LiveActivityHub", () => ({ liveActivityHub: { publish: vi.fn() } }));
vi.mock("@/lib/telegram-dispatch", () => ({ dispatchTelegram: vi.fn() }));

import { AnalysisCycleRunner, isAccountLevelRejection } from "./AnalysisCycleRunner";
import { DefaultRiskManager } from "@/automation/risk/risk-manager";

/**
 * Regression (Oct 21–22 production): four Breakout bots planned BTC ~260 times.
 * The account was too small for BTC's minimum order at the bot's risk, the
 * executor refused it BEFORE placing anything — and that ended the whole cycle,
 * so the bots never tried any other coin. A pre-submission refusal must move
 * on to the next ranked coin.
 */
const BOT: BotRuntimeState = {
  id: 9, userId: 1, symbol: "BTCUSDT", strategy: "TrendBreakoutV1", leverage: 5, capital: 25, capitalMode: "percent",
  status: "RUNNING", desiredStatus: "RUNNING",
  configJson: JSON.stringify({ symbol: "BTCUSDT", timeframe: "4h", leverage: 5, capital: 25, capitalMode: "percent", walletPercent: 25, maxRiskPerTrade: 1, dailyLossLimit: 10, autoSelect: true, strategy: "TrendBreakoutV1", enableTrailingStop: false }),
} as unknown as BotRuntimeState;

const plan = (symbol: string, price: number): TradePlan => ({
  action: "BUY", side: "BUY", entryType: "LIMIT", limitPrice: price, entryPrice: price, stopLoss: price * 0.98, takeProfit: price * 1.3,
  riskRewardRatio: 15, confidence: 0.7, symbol, reason: "breakout", expiryTime: new Date(Date.now() + 4 * 3600e3).toISOString(),
});

function setup(executeImpl: (input: { plan: TradePlan }) => Promise<unknown>, wallet = 116, readsFail = false) {
  const execute = vi.fn(executeImpl);
  const transition = vi.fn(async () => true);
  const opp = (symbol: string, price: number) => ({ symbol, side: "LONG", score: 80, confidence: 0.7, price, atrPct: 1, trend: "UP", factors: {}, leverage: 5, instrument: null });
  const deps = {
    store: {
      getBot: vi.fn(async () => BOT),
      hasActiveTradeForBot: vi.fn(async () => false),
      getDailyStats: vi.fn(async () => ({ realizedPnl: 0, tradeCount: 0 })),
      getActiveExecutionForBot: vi.fn(async () => null),
      getActivePositionForBot: vi.fn(async () => null),
    },
    stateManager: { transition },
    events: { emit: vi.fn(async () => {}) },
    lifecycle: new Proxy({}, { get: () => vi.fn(async () => 0) }),
    client: {
      getWalletSnapshot: vi.fn(async () => ({ available: wallet, total: wallet, blocked: 0, positionMargin: 0, openOrderMargin: 0, equity: null })),
      getPositions: vi.fn(async () => (readsFail ? Promise.reject(new Error("fetch failed")) : [])),
      getOpenOrders: vi.fn(async () => []),
    },
    engine: vi.fn(() => ({
      run: vi.fn(async (config: { symbol: string }) => ({
        signal: "BUY",
        plan: plan(config.symbol, config.symbol === "BTCUSDT" ? 84_500 : 0.25),
        analysis: { trend: "UP", confidence: 0.7, reasons: [], price: 1, summary: `LONG breakout on ${config.symbol}` },
      })),
    })),
    executor: { execute },
    riskManager: new DefaultRiskManager(),
    config: { analysisIntervalMinutes: 5 },
    refreshLease: vi.fn(async () => true),
    coinAutoSelector: {
      scanRanked: vi.fn(async () => ({ ranked: [opp("BTCUSDT", 84_500), opp("DOGEUSDT", 0.25)], summary: { timeframe: "4h", scanned: 2, noSetup: 0, momentumFiltered: 0, dataUnavailable: 0, leverageUnsafe: 0 } })),
    },
  } as unknown as AnalysisCycleDependencies;
  return { runner: new AnalysisCycleRunner(deps), execute, transition };
}

describe("a coin refused before ordering never blocks the other coins", () => {
  it("BTC below the minimum order → the bot goes on and trades the next coin", async () => {
    const { runner, execute } = setup(async ({ plan: p }) =>
      p.symbol === "BTCUSDT"
        ? { success: false, executionId: 31, entryOrderId: null, state: "CANCELLED", coinSkipped: true, message: "Position size 0 is below the exchange minimum (0.001) for BTCUSDT; raising it to 0.001 would risk ~1.73 USDT at SL, above the Max Risk limit of 1.16 USDT — trade skipped." }
        : { success: true, executionId: 77, entryOrderId: "o-1", state: "MONITORING_ENTRY", message: "resting" },
    );
    await runner.runCycle(9);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0].plan.symbol).toBe("DOGEUSDT");
  });

  it("an order that WAS placed and then cancelled still ends the cycle (no double entry)", async () => {
    const { runner, execute } = setup(async () => ({ success: false, executionId: 55, entryOrderId: "o-9", state: "CANCELLED", message: "entry cancelled by exchange" }));
    await runner.runCycle(9);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("a cancellation that is NOT a coin skip (e.g. lost the submission claim) ends the cycle", async () => {
    const { runner, execute } = setup(async () => ({ success: false, executionId: 56, entryOrderId: null, state: "CANCELLED", message: "another worker holds this submission" }));
    await runner.runCycle(9);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("no free balance is an account-level wait: stop scanning, plain message", async () => {
    const { runner, execute } = setup(async () => ({ state: "MONITORING_ENTRY" }), 0);
    const result = await runner.runCycle(9);
    expect(execute).not.toHaveBeenCalled();
    expect(result.message).toMatch(/No free balance in the wallet right now/);
    expect(isAccountLevelRejection("No free balance in the wallet right now")).toBe(true);
  });

  it("if open positions can't be read, it does NOT trade (could double up on a coin another bot holds)", async () => {
    const { runner, execute } = setup(async () => ({ state: "MONITORING_ENTRY", entryOrderId: "o" }), 116, true);
    const result = await runner.runCycle(9);
    expect(execute).not.toHaveBeenCalled();
    expect(result.message).toMatch(/Could not read open positions/);
  });
});
