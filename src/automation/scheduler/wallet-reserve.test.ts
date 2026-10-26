import { describe, expect, it, vi, beforeEach } from "vitest";
import type { BotRuntimeState } from "@/automation/service/bot-lifecycle";
import type { TradePlan } from "@/automation/planner/types";
import type { AnalysisCycleDependencies } from "./AnalysisCycleRunner";

vi.mock("@/automation/scheduler/LiveActivityHub", () => ({ liveActivityHub: { publish: vi.fn() } }));
const dispatchTelegram = vi.fn();
vi.mock("@/lib/telegram-dispatch", () => ({ dispatchTelegram: (...a: unknown[]) => dispatchTelegram(...a) }));

import { AnalysisCycleRunner } from "./AnalysisCycleRunner";
import { DefaultRiskManager } from "@/automation/risk/risk-manager";
import { freeForNewTrades, WALLET_RESERVE_PCT } from "@/automation/risk/allocation-headroom";

/**
 * A Risky bot (or any bot) holds nearly the whole wallet in an open trade.
 * The other bots on that wallet must WAIT: no coin scan, no tiny trade from
 * the leftover cushion, no "risk rejected" alert — and trade again once the
 * money is free.
 */
const bot = (capitalMode: "percent" | "fixed"): BotRuntimeState =>
  ({
    id: 9, userId: 1, symbol: "AUTO", strategy: "TradenayaSmartV1", leverage: 5, capital: 100, capitalMode, status: "RUNNING", desiredStatus: "RUNNING",
    configJson: JSON.stringify({ symbol: "BTCUSDT", timeframe: "1h", leverage: 5, capital: 100, capitalMode, walletPercent: capitalMode === "percent" ? 100 : undefined, maxRiskPerTrade: 5, dailyLossLimit: 30, autoSelect: true, strategy: "TradenayaSmartV1", enableTrailingStop: false }),
  }) as unknown as BotRuntimeState;

const plan = (symbol: string): TradePlan => ({
  action: "BUY", side: "BUY", entryType: "LIMIT", limitPrice: 0.25, entryPrice: 0.25, stopLoss: 0.245, takeProfit: 0.26,
  riskRewardRatio: 2, confidence: 0.7, symbol, reason: "t", expiryTime: new Date(Date.now() + 3600e3).toISOString(),
});

type Wallet = { available: number; total: number } | Error;

function setup(wallets: Wallet[], capitalMode: "percent" | "fixed" = "percent") {
  let call = 0;
  const execute = vi.fn(async () => ({ success: true, executionId: 1, entryOrderId: "o-1", state: "MONITORING_ENTRY", message: "resting" }));
  const scanRanked = vi.fn(async () => ({
    ranked: [{ symbol: "DOGEUSDT", side: "LONG", score: 80, confidence: 0.7, price: 0.25, atrPct: 1, trend: "UP", factors: {}, leverage: 5, instrument: null }],
    summary: { timeframe: "1h", scanned: 1, noSetup: 0, momentumFiltered: 0, dataUnavailable: 0, leverageUnsafe: 0 },
  }));
  const deps = {
    store: {
      getBot: vi.fn(async () => bot(capitalMode)),
      hasActiveTradeForBot: vi.fn(async () => false),
      getDailyStats: vi.fn(async () => ({ realizedPnl: 0, tradeCount: 0 })),
      getActiveExecutionForBot: vi.fn(async () => null),
      getActivePositionForBot: vi.fn(async () => null),
    },
    stateManager: { transition: vi.fn(async () => true) },
    events: { emit: vi.fn(async () => {}) },
    lifecycle: new Proxy({}, { get: () => vi.fn(async () => 0) }),
    client: {
      getWalletSnapshot: vi.fn(async () => {
        const w = wallets[Math.min(call++, wallets.length - 1)];
        if (w instanceof Error) throw w;
        return { ...w, blocked: w.total - w.available, positionMargin: 0, openOrderMargin: 0, equity: null };
      }),
      getPositions: vi.fn(async () => []),
      getOpenOrders: vi.fn(async () => []),
    },
    engine: vi.fn(() => ({ run: vi.fn(async (c: { symbol: string }) => ({ signal: "BUY", plan: plan(c.symbol), analysis: { trend: "UP", confidence: 0.7, reasons: [], price: 1, summary: "long" } })) })),
    executor: { execute },
    riskManager: new DefaultRiskManager(),
    config: { analysisIntervalMinutes: 5 },
    refreshLease: vi.fn(async () => true),
    coinAutoSelector: { scanRanked },
  } as unknown as AnalysisCycleDependencies;
  return { runner: new AnalysisCycleRunner(deps), execute, scanRanked };
}

beforeEach(() => dispatchTelegram.mockReset());

describe("wallet reserve — the free-balance rule", () => {
  it(`below ${WALLET_RESERVE_PCT}% of the wallet free counts as nothing free`, () => {
    expect(freeForNewTrades(2, 100)).toBe(0); // a Risky trade holds the rest
    expect(freeForNewTrades(5, 100)).toBe(0);
    expect(freeForNewTrades(10, 100)).toBe(10);
    expect(freeForNewTrades(5, 5)).toBe(5); // nothing open on a tiny wallet: all of it is usable
    expect(freeForNewTrades(null, 100)).toBe(0);
    expect(freeForNewTrades(3, null)).toBe(3);
  });
});

describe("other bots while one trade holds the wallet", () => {
  it("skip the coin scan entirely, wait quietly (no alert), no order", async () => {
    const { runner, execute, scanRanked } = setup([{ available: 2, total: 100 }]);
    const r = await runner.runCycle(9);
    expect(scanRanked).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(r.message).toMatch(/No free balance in the wallet right now.*coin scan skipped/);
    expect(dispatchTelegram).not.toHaveBeenCalled();
  });

  it("the same for a fixed-amount bot", async () => {
    const { runner, execute, scanRanked } = setup([{ available: 1, total: 100 }], "fixed");
    await runner.runCycle(9);
    expect(scanRanked).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("once the trade closes and money is free again, the bot scans and trades", async () => {
    const { runner, execute, scanRanked } = setup([{ available: 100, total: 100 }]);
    await runner.runCycle(9);
    expect(scanRanked).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("enough left for its own share (e.g. 10% free) → still trades", async () => {
    const { runner, execute } = setup([{ available: 10, total: 100 }]);
    await runner.runCycle(9);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("another bot takes the money while this one is scanning → no tiny trade, quiet wait", async () => {
    // free at the start of the cycle, only the cushion left by order time
    const { runner, execute, scanRanked } = setup([{ available: 100, total: 100 }, { available: 2, total: 100 }]);
    const r = await runner.runCycle(9);
    expect(scanRanked).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    expect(r.message).toMatch(/No free balance/);
    expect(dispatchTelegram).not.toHaveBeenCalled();
  });

  it("a failed wallet read never blocks the scan (the order-time check decides)", async () => {
    const { runner, scanRanked } = setup([new Error("fetch failed"), { available: 100, total: 100 }]);
    await runner.runCycle(9);
    expect(scanRanked).toHaveBeenCalledTimes(1);
  });
});
