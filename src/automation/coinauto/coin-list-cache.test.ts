import { describe, it, expect, vi, beforeEach } from "vitest";
import { cachedEligibleCoins, resetCoinListCache } from "./auto-best-selector";

const coins = [{ symbol: "BTCUSDT", quoteVolume24h: 1e9, change24h: 1, fundingRate: 0 }];

describe("coin list — shared, cached, and never a skipped cycle for a blip", () => {
  beforeEach(() => resetCoinListCache());

  it("is fetched once per minute and shared by every bot of the user", async () => {
    const fetcher = vi.fn(async () => coins);
    await Promise.all([cachedEligibleCoins(1, fetcher), cachedEligibleCoins(1, fetcher), cachedEligibleCoins(1, fetcher)]);
    await cachedEligibleCoins(1, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries once on failure", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("fetch failed")).mockResolvedValue(coins);
    expect(await cachedEligibleCoins(2, fetcher)).toEqual(coins);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("falls back to the last good list when CoinSwitch is briefly unreachable", async () => {
    const now = Date.now();
    await cachedEligibleCoins(3, async () => coins, now);
    const failing = vi.fn(async () => Promise.reject(new Error("fetch failed")));
    expect(await cachedEligibleCoins(3, failing, now + 5 * 60_000)).toEqual(coins);
  });

  it("with no good list at all, the failure is reported", async () => {
    await expect(cachedEligibleCoins(4, async () => Promise.reject(new Error("down")))).rejects.toThrow("down");
  });
});
