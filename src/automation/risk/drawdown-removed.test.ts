import { describe, expect, it } from "vitest";
import { DefaultRiskManager } from "./risk-manager";
import { DEFAULT_RISK_CONFIG, type RiskManagerInput } from "./types";

/**
 * Drawdown protection has been removed from the automated trading path.
 *
 * Regression guard: the account-level maximum-drawdown gate (previously 15%
 * against a persisted peak equity) no longer exists, so a candidate must be
 * approved no matter how far the account sits below its historical peak. Every
 * OTHER risk limit must keep rejecting exactly as before — this file proves
 * both halves of that.
 */

const ENTRY = 100_000;
const STOP = 99_500;
const TAKE_PROFIT = 101_000;

function makeInput(overrides: Partial<RiskManagerInput> = {}): RiskManagerInput {
  const balance = 85;
  return {
    config: {
      maxRiskPerTradePct: 1.5,
      maxCapitalAllocationPct: 100,
      minWalletBalance: 0,
      maxLeverage: 10,
      maxSimultaneousPositions: 5,
      maxSimultaneousBots: 5,
      dailyLossLimitPct: 5,
      dailyTradeLimit: 20,
      minRiskRewardRatio: 1.5,
    },
    wallet: { balance },
    capital: { mode: "fixed", amount: 85, leverage: 5 },
    plan: {
      action: "BUY",
      side: "BUY",
      symbol: "BTCUSDT",
      entryType: "LIMIT",
      limitPrice: ENTRY,
      stopLoss: STOP,
      takeProfit: TAKE_PROFIT,
      riskRewardRatio: 2,
      confidence: 0.8,
      reason: "Test plan",
      expiryTime: new Date(Date.now() + 120 * 60 * 1000).toISOString(),
    },
    openPositions: [],
    openOrders: [],
    daily: { date: "2026-01-01", realizedPnl: 0, tradeCount: 0 },
    runningBots: 0,
    ...overrides,
  };
}

/** Scales the wallet and capital together so only the balance level changes. */
function atHistoricalDrawdown(peak: number, drawdownPct: number): RiskManagerInput {
  const balance = peak * (1 - drawdownPct / 100);
  return makeInput({ wallet: { balance }, capital: { mode: "fixed", amount: balance, leverage: 5 } });
}

describe("drawdown protection removed — account drawdown no longer rejects a candidate", () => {
  const riskManager = new DefaultRiskManager();

  it.each([15, 20, 30, 50, 80, 99])("approves a candidate at %i%% below the historical peak of 100", (drawdownPct) => {
    const decision = riskManager.evaluate(atHistoricalDrawdown(100, drawdownPct));

    expect(decision.approved).toBe(true);
    expect(decision.reason).not.toMatch(/drawdown/i);
    expect(decision.reason).toBe("Trade approved by all risk checks.");
  });

  it("emits no drawdown risk check at any check list", () => {
    const decision = riskManager.evaluate(atHistoricalDrawdown(100, 50));

    const names = (decision.checks ?? []).map((check) => check.name);
    expect(names).not.toContain("drawdown");
    expect(names).not.toContain("max-drawdown");
    expect(decision.checks?.every((check) => check.passed)).toBe(true);
  });

  it("no longer exposes a max-drawdown threshold in the risk configuration", () => {
    expect("maxDrawdownPct" in DEFAULT_RISK_CONFIG).toBe(false);
  });
});

describe("every other risk limit is untouched and still rejects", () => {
  const riskManager = new DefaultRiskManager();

  function failedChecks(overrides: Partial<RiskManagerInput>): string[] {
    const decision = riskManager.evaluate(makeInput(overrides));
    expect(decision.approved).toBe(false);
    return (decision.checks ?? []).filter((check) => !check.passed).map((check) => check.name);
  }

  it("still rejects on the daily loss limit", () => {
    const failed = failedChecks({ daily: { date: "2026-01-01", realizedPnl: -10, tradeCount: 0 } });
    expect(failed).toContain("daily-loss-limit");
  });

  it("still rejects on the daily trade limit", () => {
    const failed = failedChecks({ daily: { date: "2026-01-01", realizedPnl: 0, tradeCount: 20 } });
    expect(failed).toContain("daily-trade-limit");
  });

  it("still caps position size at the configured maximum risk per trade", () => {
    // The position sizer derives expected loss from maxRiskPerTradePct, so the
    // observable effect of the limit is a smaller position as the cap tightens.
    const wide = riskManager.evaluate(makeInput());
    const tight = riskManager.evaluate(
      makeInput({ config: { ...makeInput().config, maxRiskPerTradePct: 0.5 } }),
    );

    expect(tight.approved).toBe(true);
    expect(tight.positionSize).toBeGreaterThan(0);
    expect(tight.positionSize).toBeLessThan(wide.positionSize);
    expect((tight.checks ?? []).find((check) => check.name === "max-risk-per-trade")?.passed).toBe(true);
  });

  it("still rejects when the capital allocation limit is exceeded", () => {
    const failed = failedChecks({ capital: { mode: "fixed", amount: 5_000, leverage: 5 } });
    expect(failed).toContain("capital-allocation");
  });

  it("still rejects when maximum leverage is exceeded", () => {
    const failed = failedChecks({ capital: { mode: "fixed", amount: 85, leverage: 50 } });
    expect(failed).toContain("max-leverage");
  });

  it("still rejects when the minimum risk/reward is not met", () => {
    const failed = failedChecks({ config: { ...makeInput().config, minRiskRewardRatio: 3 } });
    expect(failed).toContain("risk-reward");
  });

  it("still rejects when the maximum number of open positions is reached", () => {
    const openPositions = Array.from({ length: 5 }, (_, index) => ({
      symbol: `ETH${index}USDT`,
      side: "LONG" as const,
      size: 1,
    }));
    const failed = failedChecks({ openPositions });
    expect(failed).toContain("max-simultaneous-positions");
  });

  it("still rejects when a position already exists for the candidate symbol", () => {
    const failed = failedChecks({ openPositions: [{ symbol: "BTCUSDT", side: "LONG", size: 1 }] });
    expect(failed).toContain("existing-position-symbol");
  });

  it("still rejects when the wallet balance cannot cover the configured capital", () => {
    const decision = riskManager.evaluate(
      makeInput({ wallet: { balance: 10 }, capital: { mode: "fixed", amount: 85, leverage: 5 } }),
    );
    expect(decision.approved).toBe(false);
    expect((decision.checks ?? []).find((check) => check.name === "capital-allocation")?.passed).toBe(false);
  });

  it("still rejects a non-actionable trade plan (missing levels)", () => {
    const failed = failedChecks({
      plan: { ...makeInput().plan, action: "WAIT", limitPrice: null, stopLoss: null, takeProfit: null },
    });
    expect(failed).toContain("actionable-plan");
  });
});
