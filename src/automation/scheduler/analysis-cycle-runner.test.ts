import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotRuntimeState } from "@/automation/service/bot-lifecycle";
import type { TradePlan } from "@/automation/planner/types";
import type { AnalysisCycleDependencies } from "./AnalysisCycleRunner";

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
  strategy: "TradiAuraSmartV1",
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
    capital: 100,
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
        getPositions: vi.fn(async () => [
          {
            symbol: "BTCUSDT",
            side: "LONG",
            quantity: 1,
            entryPrice: 100_000,
            markPrice: 98_500,
            unrealizedPnl: -15,
            realizedPnl: 0,
            leverage: 10,
            positionId: "pos-1",
            liquidationPrice: null,
            maintMargin: null,
            positionMargin: null,
          },
        ]),
        getOpenOrders: vi.fn(async () => []),
      },
      engine: vi.fn(() => ({
        run: vi.fn(async () => ({
          signal: "BUY",
          plan: PLAN,
          analysis: { trend: "UP", confidence: 0.8, reasons: [], price: 100_000, summary: "Test" },
        })),
      })),
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

    // The authority is the live gate, not the reworded engine message: the rich
    // RiskManager decision (15% equity drawdown from the persisted peak) rejects.
    expect(result.executed).toBe(true);
    expect(result.state).toBe("RUNNING");
    expect(result.message).toContain("Risk rejected");

    const rejectionEvent = eventsEmit.mock.calls
      .map(([event]) => event as { type?: string; message?: string })
      .find((event) => event?.type === "RISK_REJECTED");
    expect(rejectionEvent).toBeDefined();
    expect(rejectionEvent?.message).toContain("Maximum drawdown");
    expect(rejectionEvent?.message).toContain("15.00%");

    // The Activity Hub — what the production UI surfaces — shows the rejection.
    const rejectedPublish = publishMock.mock.calls
      .map(([payload]) => payload as { message?: string; phase?: string })
      .find((payload) => typeof payload?.message === "string" && payload.message.startsWith("Risk check rejected:"));
    expect(rejectedPublish).toBeDefined();
    expect(rejectedPublish?.message).toContain("Maximum drawdown");
    expect(rejectedPublish?.phase).toBe("risk");
  });

  it("does not place an order when the live gate rejects (authoritative execution gate)", async () => {
    // The runner's risk gate sits BEFORE any executor call: on rejection the
    // cycle must complete as RISK_REJECTED/RUNNING without ever invoking the
    // executor. The deps above contain no executor at all — reaching it would
    // throw — so a completed cycle is itself the proof.
    const { runner, eventsEmit } = makeDeps();
    const result = await runner.runCycle(RUNNING_BOT.id);
    expect(result.action).toBe("ANALYZED");
    expect(
      eventsEmit.mock.calls
        .map(([event]) => event as { type?: string })
        .some((event) => event?.type === "RISK_REJECTED"),
    ).toBe(true);
  });
});