import { describe, it, expect } from "vitest";
import type { MarketCandle } from "@/automation/types";
import { AutomationEngine } from "./automation-engine";
import { HistoricalMarketDataAdapter } from "@/automation/backtest/market-adapter";

/**
 * Wallet-% bots keep the capital they were created with (e.g. 5 USDT) in their
 * saved config; real sizing uses the wallet's free balance at order time. The
 * engine's early check must not drop their trades because of that stale number.
 */
const H4 = 4 * 3_600_000;
const T0 = 1_700_000_000_000;
function breakout(): MarketCandle[] {
  const out: MarketCandle[] = [];
  let p = 100;
  for (let i = 0; i < 320; i++) {
    if (i < 295) p += 0.2;
    const w = i % 2 ? 0.4 : -0.4;
    out.push({ timestamp: T0 + i * H4, open: p, high: Math.max(p, p + w) + 0.3, low: Math.min(p, p + w) - 0.3, close: p + w, volume: 1000, timeframe: "4h" });
  }
  const high = Math.max(...out.slice(-21, -1).map((c) => c.high));
  out[319] = { ...out[319], close: high + 2, high: high + 2.2, volume: 2500 };
  return out;
}

async function run(capitalMode: "fixed" | "percent", capital: number, steps: string[] = []) {
  const candles = breakout();
  const adapter = new HistoricalMarketDataAdapter();
  adapter.setSlice(candles, candles.length);
  const realNow = Date.now;
  Date.now = () => candles[candles.length - 1].timestamp + H4 + 1; // last candle closed
  try {
    return await new AutomationEngine(adapter).run({
      symbol: "BTCUSDT", timeframe: "4h", strategy: "TrendBreakoutV1", leverage: 5, capital, capitalMode,
      walletPercent: capitalMode === "percent" ? 100 : undefined, maxRiskPerTrade: 1, dailyLossLimit: 10, enableTrailingStop: false,
    } as never, (step) => void steps.push(step.message));
  } finally {
    Date.now = realNow;
  }
}

describe("engine pre-check vs wallet-% bots", () => {
  it("a wallet-% bot's trade is NOT dropped because its saved capital is tiny", async () => {
    const r = await run("percent", 0.01);
    expect(r.signal).toBe("BUY");
    expect(r.plan).toBeDefined();
  });

  it("only wallet-% bots skip the capital pre-check; fixed-capital bots still go through it", async () => {
    const pct: string[] = [];
    const fixed: string[] = [];
    await run("percent", 5, pct);
    await run("fixed", 100, fixed);
    expect(pct.some((m) => /free wallet balance when the order is placed/.test(m))).toBe(true);
    expect(pct.some((m) => /Position sizing check/.test(m))).toBe(false);
    expect(fixed.some((m) => /Position sizing check passed|Risk check failed/.test(m))).toBe(true);
  });
});
