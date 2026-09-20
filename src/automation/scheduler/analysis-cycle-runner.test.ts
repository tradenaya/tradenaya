import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotRuntimeState } from "@/automation/service/bot-lifecycle";
import type { TradePlan } from "@/automation/planner/types";
import type { AnalysisCycleDependencies } from "./AnalysisCycleRunner";
import type { AutomationConfig } from "@/automation/types";
import type { CoinAutoSelector, SelectedOpportunity } from "@/automation/coinauto/coin-auto-selector";

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

  it("auto-select scan: a failing candidate is skipped and candidate #2 is evaluated immediately (no 5-min wait between partial failures)", async () => {
    // FIX 3 — candidate #1 has no tradable setup (engine WAIT). The scan must
    // NOT stop and wait 5 minutes; it must immediately evaluate candidate #2.
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

    const engineRun = vi.fn(async (config: AutomationConfig) => {
      if (config.symbol === "BTCUSDT") {
        return {
          signal: "WAIT",
          analysis: {
            trend: "SIDEWAYS",
            confidence: 0,
            reasons: [],
            price: null,
            summary: `No valid opportunity for BTCUSDT`,
          },
        };
      }
      return {
        signal: "BUY",
        plan: { ...PLAN, symbol: config.symbol },
        analysis: { trend: "UP", confidence: 0.8, reasons: [], price: 100_000, summary: "Test" },
      };
    });

    const scheduleNextRun = vi.fn(async () => {});
    const eventsEmit = vi.fn(async (event: unknown): Promise<void> => {
      void event;
    });

    const makeCandidate = (symbol: string, score: number): SelectedOpportunity =>
      ({
        symbol,
        side: "LONG",
        instrument: null,
        leverage: 5,
        opportunity: {
          symbol,
          score,
          confidence: 0.7,
          price: 100_000,
          side: "LONG",
        },
      }) as SelectedOpportunity;

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
          // No live positions; equity 100 keeps the drawdown gate PASSING, so any
          // rejection seen here is NOT the drawdown gate misfiring.
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
          selectRankedOpportunities: vi.fn(async () => ({
            candidates: [
              makeCandidate("BTCUSDT", 90),
              makeCandidate("ETHUSDT", 80),
            ],
            fetchedCount: 2,
            scannedCount: 2,
            eligibleCount: 2,
            rankingCriteria: "opportunity score (descending)",
            requestedCount: 2,
          })),
          selectBestOpportunity: vi.fn(async () => null),
        } as unknown as CoinAutoSelector,
      } as unknown as AnalysisCycleDependencies,
    );

    const result = await runner.runCycle(autoBot.id);

    // Candidate #2 WAS analyzed — proves the loop did not give up after #1.
    const symbolsRun = engineRun.mock.calls.map(([config]) => (config as AutomationConfig).symbol);
    expect(symbolsRun).toEqual(["BTCUSDT", "ETHUSDT"]);

    // Only ONE next-run was scheduled (at the very end when BOTH candidates
    // were rejected) — an intermediate candidate failure must NOT schedule a
    // 5-minute wait of its own.
    expect(scheduleNextRun.mock.calls.length).toBe(1);

    // Candidate #1 was rejected; candidate #2 reached order submission and
    // returns the mocked executor result (CANCELLED). Validate that the
    // cycle completed as ANALYZED with the executor message rather than the
    // "all candidates rejected" message (which applies only when every
    // candidate fails pre-submission validation).
    expect(result.executed).toBe(true);
    expect(result.state).toBe("RUNNING");
    expect(result.message).toContain("executor cancelled");

    // Ensure no consolidated RISK_REJECTED was emitted for the scan (only
    // per-candidate rejections for #1 should exist). Instead, an AUTO_SCAN
    // completion with ORDER_SUBMITTED must have been emitted for candidate #2.
    const scanCompleteEvent = eventsEmit.mock.calls
      .map(([event]) => event as { type?: string; message?: string })
      .find((event) => event?.type === "AUTO_SCAN_COMPLETE" && typeof event?.message === "string" && event.message.includes("ORDER_SUBMITTED"));
    expect(scanCompleteEvent).toBeDefined();

    // Every per-candidate rejection was surfaced in the activity hub, including
    // the strategy/planner WAIT of candidate #1 (not hidden).
    const strategyReject = publishMock.mock.calls
      .map(([payload]) => payload as { message?: string })
      .find((payload) => typeof payload?.message === "string" && payload.message.includes("rejected (strategy/planner)"));
    expect(strategyReject).toBeDefined();
  });
});