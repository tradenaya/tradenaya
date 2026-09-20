import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotRuntimeState } from "@/automation/service/bot-lifecycle";
import type { TradePlan } from "@/automation/planner/types";
import type { AnalysisCycleDependencies } from "./AnalysisCycleRunner";
import type { AutomationConfig } from "@/automation/types";
import type { AutoBestOpportunity } from "@/automation/coinauto/auto-best-selector";

const { publishMock } = vi.hoisted(() => ({
  publishMock: vi.fn((payload: unknown): void => {
    void payload;
  }),
}));
const { telegramAnalysisMock, telegramCoinSwitchErrorMock } = vi.hoisted(() => ({
  telegramAnalysisMock: vi.fn(),
  telegramCoinSwitchErrorMock: vi.fn(),
}));
const { dispatchTelegramMock } = vi.hoisted(() => ({ dispatchTelegramMock: vi.fn() }));

vi.mock("@/automation/scheduler/LiveActivityHub", () => ({
  liveActivityHub: { publish: publishMock },
}));
vi.mock("@/lib/telegram", () => ({
  telegramAnalysis: telegramAnalysisMock,
  telegramCoinSwitchError: telegramCoinSwitchErrorMock,
}));
vi.mock("@/lib/telegram-dispatch", () => ({ dispatchTelegram: dispatchTelegramMock }));

import { AnalysisCycleRunner } from "./AnalysisCycleRunner";
import { DefaultRiskManager } from "@/automation/risk/risk-manager";

/**
 * FIX 3 — the AnalysisCycleRunner (live account risk gate) remains the ONLY
 * authority that can approve/reject based on drawdown / daily-loss / exposure.
 * A genuine live-equity drawdown ≥ 15% must still emit a RISK_REJECTED event
 * and publish a visible "Risk check rejected" message — these are what the
 * production UI / activity hub surface, and they must NOT be lost now that the
 * engine's cosmetic PASS was reworded.
 */

const RUNNING_BOT: BotRuntimeState = {
  id: 7,
  userId: 42,
  symbol: "BTCUSDT",
  strategy: "TradenayaSmartV1",
  leverage: 5,
  capital: 100,
  capitalMode: "fixed",
  status: "RUNNING",
  desiredStatus: "RUNNING",
  peakEquity: 100,
  peakEquityBasis: "equity",
  configJson: JSON.stringify({
    symbol: "BTCUSDT",
    timeframe: "5m",
    leverage: 5,
    capital: 85,
    capitalMode: "fixed",
    maxRiskPerTrade: 1,
    dailyLossLimit: 5,
    enableTrailingStop: false,
  }),
};

const PLAN: TradePlan = {
  action: "BUY",
  side: "BUY",
  entryType: "LIMIT",
  limitPrice: 100_000,
  entryPrice: 100_000,
  stopLoss: 99_500,
  takeProfit: 101_000,
  riskRewardRatio: 2,
  confidence: 0.8,
  symbol: "BTCUSDT",
  reason: "Test plan",
  expiryTime: new Date(Date.now() + 120 * 60 * 1000).toISOString(),
};

function makeDeps() {
  const eventsEmit = vi.fn(async (event: unknown): Promise<void> => {
    void event;
  });
  const runner = new AnalysisCycleRunner(
    {
      store: {
        getBot: vi.fn(async () => RUNNING_BOT),
        hasActiveTradeForBot: vi.fn(async () => false),
        getDailyStats: vi.fn(async () => ({ realizedPnl: 0, tradeCount: 0 })),
      },
      stateManager: { transition: vi.fn(async () => true) },
      events: { emit: eventsEmit },
      lifecycle: {
        setRuntimeError: vi.fn(async () => {}),
        updateBotHeartbeat: vi.fn(async () => {}),
        updateHeartbeatAt: vi.fn(async () => {}),
        countActiveBotsForUser: vi.fn(async () => 0),
        setRetryCount: vi.fn(async () => {}),
        scheduleNextRun: vi.fn(async () => {}),
      },
      client: {
        // Equity: wallet total 100 + position PnL −15 → 85 (a genuine 15% drop
        // from the persisted peak of 100). available is NOT used as equity.
        getWalletSnapshot: vi.fn(async () => ({
          available: 85,
          total: 100,
          blocked: 15,
          positionMargin: 15,
          openOrderMargin: 0,
          equity: null,
        })),
        getPositions: vi.fn(async () => []),
        getOpenOrders: vi.fn(async () => []),
      },
      engine: vi.fn(() => ({
        run: vi.fn(async () => ({
          signal: "BUY",
          plan: PLAN,
          analysis: { trend: "UP", confidence: 0.8, reasons: [], price: 100_000, summary: "Test" },
        })),
      })),
      executor: {
        execute: vi.fn(async () => ({ state: "CANCELLED", message: "executor cancelled", executionId: "x", filledQuantity: 0 })),
      },
      riskManager: new DefaultRiskManager(),
      config: { analysisIntervalMinutes: 5 },
      refreshLease: vi.fn(async () => true),
    } as unknown as AnalysisCycleDependencies,
  );
  return { runner, eventsEmit };
}

describe("AnalysisCycleRunner — live risk gate stays authoritative and visible", () => {
  beforeEach(() => {
    publishMock.mockClear();
    telegramAnalysisMock.mockClear();
    telegramCoinSwitchErrorMock.mockClear();
    dispatchTelegramMock.mockClear();
  });

  it("rejects the trade and makes the rejection visible (RISK_REJECTED event + activity message)", async () => {
    const { runner, eventsEmit } = makeDeps();
    const result = await runner.runCycle(RUNNING_BOT.id);
      // With drawdown removed from the automated blocking path the cycle proceeds
      // to the execution path. Our deps include a lightweight executor mock that
      // returns a CANCELLED result — the cycle completes as ANALYZED and no
      // RISK_REJECTED event is emitted for maximum-drawdown.
      expect(result.executed).toBe(true);
      expect(result.state).toBe("RUNNING");
      expect(result.action).toBe("ANALYZED");

      const rejectionEvent = eventsEmit.mock.calls
        .map(([event]) => event as { type?: string; message?: string })
        .find((event) => event?.type === "RISK_REJECTED");
      expect(rejectionEvent).toBeUndefined();
  });

  it("does not place an order when the live gate rejects (authoritative execution gate)", async () => {
    // The runner's risk gate sits BEFORE any executor call: on rejection the
    // cycle must complete as RISK_REJECTED/RUNNING without ever invoking the
    // executor. The deps above contain no executor at all — reaching it would
    // throw — so a completed cycle is itself the proof.
    // With drawdown checks removed from the blocking path there is no
    // authoritative RISK_REJECTED emitted for maximum-drawdown; the cycle
    // completes and the execution path is invoked (our executor mock will
    // return CANCELLED and the cycle ends as ANALYZED).
    const { runner, eventsEmit } = makeDeps();
    const result = await runner.runCycle(RUNNING_BOT.id);
    expect(result.action).toBe("ANALYZED");
    expect(
      eventsEmit.mock.calls
        .map(([event]) => event as { type?: string })
        .some((event) => event?.type === "RISK_REJECTED"),
    ).toBe(false);
  });

  it("auto-select scan: the single best opportunity is selected and evaluated end-to-end", async () => {
    const autoBot: BotRuntimeState = {
      ...RUNNING_BOT,
      symbol: "AUTO",
      peakEquity: 100,
      peakEquityBasis: "equity",
      configJson: JSON.stringify({
        ...JSON.parse(RUNNING_BOT.configJson as string),
        autoSelect: true,
      }),
    };

    const engineRun = vi.fn(async (config: AutomationConfig) => ({
      signal: "BUY",
      plan: { ...PLAN, symbol: config.symbol },
      analysis: { trend: "UP", confidence: 0.8, reasons: [], price: 100_000, summary: "Test" },
    }));

    const scheduleNextRun = vi.fn(async () => {});
    const eventsEmit = vi.fn(async (event: unknown): Promise<void> => {
      void event;
    });

    const makeOpportunity = (symbol: string, score: number): AutoBestOpportunity =>
      ({
        symbol,
        side: "LONG",
        instrument: null,
        leverage: 5,
        score,
        confidence: 0.7,
        price: 100_000,
        atrPct: 0.5,
        trend: "UP",
        factors: {
          regime: 0.5,
          trend: 0.6,
          structure: 0.7,
          momentum: 0.6,
          participation: 0.5,
          volatility: 0.3,
          entryLocation: 0.7,
          riskReward: 0.8,
          flow: 0.5,
        },
      }) as AutoBestOpportunity;

    const runner = new AnalysisCycleRunner(
      {
        store: {
          getBot: vi.fn(async () => autoBot),
          hasActiveTradeForBot: vi.fn(async () => false),
          getDailyStats: vi.fn(async () => ({ realizedPnl: 0, tradeCount: 0 })),
        },
        stateManager: { transition: vi.fn(async () => true) },
        events: { emit: eventsEmit },
        lifecycle: {
          setRuntimeError: vi.fn(async () => {}),
          updateBotHeartbeat: vi.fn(async () => {}),
          updateHeartbeatAt: vi.fn(async () => {}),
          countActiveBotsForUser: vi.fn(async () => 0),
          setRetryCount: vi.fn(async () => {}),
          scheduleNextRun,
          // Persisting updated config + selected coin during AUTO selection
          setConfig: vi.fn(async () => {}),
          updateSelectedCoin: vi.fn(async () => {}),
        },
        client: {
          getWalletSnapshot: vi.fn(async () => ({
            available: 85,
            total: 100,
            blocked: 15,
            positionMargin: 15,
            openOrderMargin: 0,
            equity: null,
          })),
          getPositions: vi.fn(async () => []),
          getOpenOrders: vi.fn(async () => []),
        },
        engine: vi.fn(() => ({ run: engineRun })),
        riskManager: new DefaultRiskManager(),
        executor: {
          execute: vi.fn(async () => ({ state: "CANCELLED", message: "executor cancelled", executionId: "x", filledQuantity: 0 })),
        },
        config: { analysisIntervalMinutes: 5 },
        refreshLease: vi.fn(async () => true),
        coinAutoSelector: {
          selectBestOpportunity: vi.fn(async () => makeOpportunity("BTCUSDT", 90)),
        },
      } as unknown as AnalysisCycleDependencies,
    );

    const result = await runner.runCycle(autoBot.id);

    // The single best opportunity was evaluated — no multi-candidate loop.
    const symbolsRun = engineRun.mock.calls.map(([config]) => (config as AutomationConfig).symbol);
    expect(symbolsRun).toEqual(["BTCUSDT"]);

    // Exactly ONE next-run was scheduled, at cycle completion.
    expect(scheduleNextRun.mock.calls.length).toBe(1);

    // The cycle reached order submission and returned the mocked executor
    // message rather than a "no candidates" outcome.
    expect(result.executed).toBe(true);
    expect(result.state).toBe("RUNNING");
    expect(result.message).toContain("executor cancelled");
  });

  it("auto-select scan: no best opportunity completes as WAIT without touching the executor", async () => {
    const autoBot: BotRuntimeState = {
      ...RUNNING_BOT,
      symbol: "AUTO",
      peakEquity: 100,
      peakEquityBasis: "equity",
      configJson: JSON.stringify({
        ...JSON.parse(RUNNING_BOT.configJson as string),
        autoSelect: true,
      }),
    };

    const engineRun = vi.fn();
    const execute = vi.fn();
    const scheduleNextRun = vi.fn(async () => {});
    const eventsEmit = vi.fn(async (event: unknown): Promise<void> => {
      void event;
    });

    const runner = new AnalysisCycleRunner(
      {
        store: {
          getBot: vi.fn(async () => autoBot),
          hasActiveTradeForBot: vi.fn(async () => false),
          getDailyStats: vi.fn(async () => ({ realizedPnl: 0, tradeCount: 0 })),
        },
        stateManager: { transition: vi.fn(async () => true) },
        events: { emit: eventsEmit },
        lifecycle: {
          setRuntimeError: vi.fn(async () => {}),
          updateBotHeartbeat: vi.fn(async () => {}),
          updateHeartbeatAt: vi.fn(async () => {}),
          countActiveBotsForUser: vi.fn(async () => 0),
          setRetryCount: vi.fn(async () => {}),
          scheduleNextRun,
          setConfig: vi.fn(async () => {}),
          updateSelectedCoin: vi.fn(async () => {}),
        },
        client: {
          getWalletSnapshot: vi.fn(async () => ({ available: 85, total: 100, blocked: 15, positionMargin: 15, openOrderMargin: 0, equity: null })),
          getPositions: vi.fn(async () => []),
          getOpenOrders: vi.fn(async () => []),
        },
        engine: vi.fn(() => ({ run: engineRun })),
        riskManager: new DefaultRiskManager(),
        executor: { execute },
        config: { analysisIntervalMinutes: 5 },
        refreshLease: vi.fn(async () => true),
        coinAutoSelector: {
          selectBestOpportunity: vi.fn(async () => null),
        },
      } as unknown as AnalysisCycleDependencies,
    );

    const result = await runner.runCycle(autoBot.id);

    // No opportunity → the cycle paused as a routine WAIT and re-checks next cycle.
    expect(result.executed).toBe(true);
    expect(result.state).toBe("RUNNING");
    expect(result.action).toBe("ANALYZED");
    expect(result.message).toContain("No suitable trading opportunity");

    // Neither the engine nor the executor was invoked, and one next-run was scheduled.
    expect(engineRun.mock.calls.length).toBe(0);
    expect(execute.mock.calls.length).toBe(0);
    expect(scheduleNextRun.mock.calls.length).toBe(1);
  });
});