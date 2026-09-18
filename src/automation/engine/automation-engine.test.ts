import { describe, expect, it } from "vitest";
import type { MarketCandle, MarketSnapshot } from "@/automation/types";
import { AutomationEngine, type EngineStep } from "./automation-engine";

/**
 * FIX 3 — observability correction.
 *
 * The engine's backward-compatible risk assessment runs with
 * `config.capital` as wallet/equity, no persisted peak, and
 * `maxDrawdownPct = 100`, so its PASS message must not be phrased as the
 * authoritative live drawdown approval. The message is explicitly scoped to
 * position sizing, and the live gate (AnalysisCycleRunner) is the only
 * authority that can approve/reject a trade based on live account risk.
 */

// Deterministic 5m candle series (mirrors the strategy suite's fixture so the
// stock TradiAuraSmartV1 strategy reliably emits a LONG signal).
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildUptrendCandles(count: number): MarketCandle[] {
  const rand = mulberry32(7);
  const candles: MarketCandle[] = [];
  let price = 100;
  for (let i = 0; i < count; i += 1) {
    const open = price;
    const inPullback = i % 30 >= 27;
    const move = 0.0018 + (inPullback ? -0.005 : 0);
    const close = open * (1 + move + (rand() - 0.5) * 0.0012);
    candles.push({
      timestamp: 1_700_000_000_000 + i * 5 * 60_000,
      open,
      high: Math.max(open, close) * (1 + rand() * 0.0004),
      low: Math.min(open, close) * (1 - rand() * 0.0004),
      close,
      volume: 1000 * (1 + (rand() - 0.5) * 0.2),
      timeframe: "5",
    });
    price = close;
  }
  return candles;
}

const candles = buildUptrendCandles(320);

const marketService = {
  async getSnapshot(): Promise<MarketSnapshot> {
    const last = candles[candles.length - 1];
    return {
      symbol: "BTCUSDT",
      exchange: "EXCHANGE_2",
      timestamp: 1_700_000_000_000,
      price: last.close,
      bid: last.close,
      ask: last.close,
      volume: last.volume,
      candles: { "5m": candles },
      isFresh: "FRESH",
    };
  },
};

describe("AutomationEngine — FIX 3 risk observability", () => {
  it("does NOT present the cosmetic risk PASS as the authoritative live drawdown approval", async () => {
    const engine = new AutomationEngine(marketService);
    const steps: EngineStep[] = [];
    const result = await engine.run(
      {
        symbol: "BTCUSDT",
        timeframe: "5m",
        leverage: 5,
        capital: 100,
        capitalMode: "fixed",
        maxRiskPerTrade: 1,
        dailyLossLimit: 5,
        enableTrailingStop: false,
      },
      (step) => steps.push(step),
    );

    // The strategy fixture must reach the risk step for this test to be valid.
    expect(result.signal).toBe("BUY");

    const messages = steps.map((step) => step.message);
    const riskMessages = steps.filter((step) => step.phase === "risk").map((step) => step.message);

    // The old misleading wording is gone.
    expect(messages.some((message) => message.includes("Risk check passed"))).toBe(false);

    // The replacement is explicitly scoped to position sizing and defers the
    // live account gate (drawdown / daily-loss / exposure) to the authoritative
    // runner that runs AFTER planning.
    expect(riskMessages.length).toBeGreaterThan(0);
    expect(riskMessages[0]).toMatch(/^Position sizing check passed/);
    expect(riskMessages[0]).toContain("Live account risk gate");
    expect(riskMessages[0]).toContain("after planning");
  });

  it("still surfaces a real risk FAILURE for the sizing assessment (fail is not muted)", async () => {
    // A plan with an extreme stop (huge risk per trade) must still produce a
    // visible risk-failure step rather than a silent PASS. Using a zero-ish
    // capital the allocation cannot pass, exercising the failure branch.
    const engine = new AutomationEngine(marketService);
    const steps: EngineStep[] = [];
    await engine.run(
      {
        symbol: "BTCUSDT",
        timeframe: "5m",
        leverage: 1,
        capital: 0,
        capitalMode: "fixed",
        maxRiskPerTrade: 0,
        dailyLossLimit: 5,
        enableTrailingStop: false,
      },
      (step) => steps.push(step),
    );

    const riskMessages = steps.filter((step) => step.phase === "risk").map((step) => step.message);
    // The engine returns WAIT because the sizing/risk assessment failed.
    const hasFailure = riskMessages.some((message) => message.startsWith("Risk check failed"));
    expect(hasFailure).toBe(true);
    expect(riskMessages.some((message) => message.includes("Position sizing check passed"))).toBe(false);
  });
});