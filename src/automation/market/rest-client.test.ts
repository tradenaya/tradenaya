import { describe, it, expect, vi } from "vitest";
import { MarketDataRestClient } from "./rest-client";

type KlineFn = (
  userId: number,
  symbol: string,
  interval: string,
  limit: number,
  options?: { startTime?: number; endTime?: number },
) => Promise<unknown>;

const NOW = 1_700_000_000_000;
const klineRow = (timestamp: number, close: number) => [timestamp, close - 2, close + 2, close - 1, close, 100];

describe("MarketDataRestClient.getHistoricalCandles", () => {
  it("retries once and returns candles when the first attempt flakes empty", async () => {
    const getKline = vi
      .fn<KlineFn>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([klineRow(NOW - 60_000, 100), klineRow(NOW - 300_000, 99)]);
    const client = new MarketDataRestClient({ now: () => NOW, getKline });

    const candles = await client.getHistoricalCandles(1, "BTCUSDT", "5m");

    expect(candles).toHaveLength(2);
    expect(candles[0].close).toBe(99);
    expect(getKline).toHaveBeenCalledTimes(2);
  });

  it("retries once when the first attempt throws", async () => {
    const getKline = vi
      .fn<KlineFn>()
      .mockRejectedValueOnce(new Error("upstream timeout"))
      .mockResolvedValueOnce([klineRow(NOW - 60_000, 100)]);
    const client = new MarketDataRestClient({ now: () => NOW, getKline });

    const candles = await client.getHistoricalCandles(1, "BTCUSDT", "5m");

    expect(candles).toHaveLength(1);
    expect(getKline).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the first attempt returns candles", async () => {
    const getKline = vi.fn<KlineFn>().mockResolvedValue([klineRow(NOW - 60_000, 100)]);
    const client = new MarketDataRestClient({ now: () => NOW, getKline });

    const candles = await client.getHistoricalCandles(1, "BTCUSDT", "5m");

    expect(candles).toHaveLength(1);
    expect(getKline).toHaveBeenCalledTimes(1);
  });

  it("returns empty after two failed attempts and does not loop forever", async () => {
    const getKline = vi.fn<KlineFn>().mockRejectedValue(new Error("upstream timeout"));
    const client = new MarketDataRestClient({ now: () => NOW, getKline });

    const candles = await client.getHistoricalCandles(1, "BTCUSDT", "5m");

    expect(candles).toHaveLength(0);
    expect(getKline).toHaveBeenCalledTimes(2);
  });
});