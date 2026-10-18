import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: { query: vi.fn().mockResolvedValue([[]]) } }));
const getCandles = vi.fn();
vi.mock("@/automation/market/service", () => ({ serverMarketDataService: { getCandles: (...a: unknown[]) => getCandles(...a) } }));

import { PositionMonitor } from "./PositionMonitor";
import type { PositionRecord, PositionSnapshot } from "./PositionManagerTypes";
import type { MarketCandle } from "@/automation/types";

/**
 * Trend Breakout exit rule: keep the ORIGINAL stop until the trade has been
 * +1.5R in profit, then move the stop to entry (+ costs) and trail the last
 * 10 closed candles — whichever is tighter.
 */
const H4 = 4 * 3600e3;
const OPENED = Date.parse("2026-10-13T00:00:00Z");

function candles(highs: number[], lows: number[]): MarketCandle[] {
  return highs.map((h, i) => ({ timestamp: OPENED + i * H4, open: (h + lows[i]) / 2, high: h, low: lows[i], close: (h + lows[i]) / 2, volume: 1, timeframe: "4h" }));
}

function setup(over: Partial<PositionRecord> = {}) {
  const monitor = new PositionMonitor({} as never);
  const store = { updateTrailing: vi.fn().mockResolvedValue(undefined), markTrailingActivated: vi.fn().mockResolvedValue(undefined), saveEvent: vi.fn().mockResolvedValue(undefined) };
  const trailing = { moveStopTo: vi.fn().mockResolvedValue({ moved: false, newStopLoss: null }) };
  const executionStore = { getExecution: vi.fn().mockResolvedValue({ stopLoss: 1.4 }) };
  Object.assign(monitor as object, { store, trailing, executionStore });
  // short XRP: entry 1.365, original stop 1.40 → 1R = 0.035; +1.5R = 1.3125
  const position = {
    id: 35, botId: 6, userId: 1, executionId: 51, symbol: "XRPUSDT", side: "SELL", state: "PROTECTED",
    entryPrice: 1.365, stopLoss: 1.4, takeProfit: 0.96, highestPrice: null, lowestPrice: null,
    trailingActivated: false, createdAt: new Date(OPENED - 60_000).toISOString(), ...over,
  } as unknown as PositionRecord;
  const snapshot = (price: number) => ({ position, currentPrice: price, exchangePosition: null, openOrders: [], positionsReadFailed: false, openOrdersReadFailed: false }) as unknown as PositionSnapshot;
  const run = (price: number) => (monitor as unknown as { syncChannelTrailing(s: PositionSnapshot, tf: number): Promise<void> }).syncChannelTrailing(snapshot(price), 240);
  return { store, trailing, position, run };
}

describe("Trend Breakout trailing (armed at +1.5R)", () => {
  beforeEach(() => getCandles.mockReset());

  it("keeps the original stop while the trade is below +1.5R", async () => {
    // best low 1.33 → (1.365-1.33)/0.035 = 1.0R
    getCandles.mockResolvedValue(candles(Array(12).fill(1.36), [1.35, 1.34, 1.33, ...Array(9).fill(1.345)]));
    const { trailing, store, run } = setup();
    await run(1.34);
    expect(trailing.moveStopTo).not.toHaveBeenCalled();
    expect(store.markTrailingActivated).not.toHaveBeenCalled();
  });

  it("arms at +1.5R and moves to the TIGHTER of breakeven and the 10-candle high", async () => {
    // best low 1.30 → 1.86R. Last 10 highs top out at 1.35 (looser than breakeven 1.3634? no: for a short tighter = lower).
    getCandles.mockResolvedValue(candles(Array(12).fill(1.35), [...Array(11).fill(1.31), 1.3]));
    const { trailing, store, run, position } = setup();
    await run(1.31);
    expect(store.markTrailingActivated).toHaveBeenCalledWith(35);
    expect(position.trailingActivated).toBe(true);
    // channel (10-candle high) = 1.35 is tighter than breakeven 1.365*(1-0.0012)=1.36336
    expect(trailing.moveStopTo).toHaveBeenCalledTimes(1);
    expect(trailing.moveStopTo.mock.calls[0][1]).toBeCloseTo(1.35, 8);
  });

  it("uses breakeven when it is tighter than the channel", async () => {
    // highs 1.40 → channel 1.40 is looser than breakeven 1.36336 → breakeven wins
    getCandles.mockResolvedValue(candles(Array(12).fill(1.4), [...Array(11).fill(1.32), 1.3]));
    const { trailing, run } = setup();
    await run(1.31);
    expect(trailing.moveStopTo.mock.calls[0][1]).toBeCloseTo(1.365 * (1 - 0.0012), 8);
  });

  it("stays armed after a dip back (remembered), even when best price is no longer in the candles", async () => {
    getCandles.mockResolvedValue(candles(Array(12).fill(1.35), Array(12).fill(1.34)));
    const { trailing, store, run } = setup({ trailingActivated: true, lowestPrice: 1.27 });
    await run(1.345);
    expect(store.markTrailingActivated).not.toHaveBeenCalled();
    expect(trailing.moveStopTo).toHaveBeenCalledTimes(1);
  });
});
