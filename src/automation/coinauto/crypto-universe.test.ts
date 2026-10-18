import { describe, it, expect, beforeEach, vi } from "vitest";
import { isCryptoSymbol, nonCryptoSymbols, resetCryptoUniverseCache } from "./crypto-universe";

const live = (symbols: Array<{ symbol: string; underlyingType: string }>) =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => ({ symbols }) }) as unknown as typeof fetch;

describe("crypto-only universe", () => {
  beforeEach(() => resetCryptoUniverseCache());

  it("drops gold, oil and tokenized stocks / ETFs (built-in list)", async () => {
    const set = await nonCryptoSymbols();
    for (const s of ["XAUUSDT", "SOXLUSDT", "TSLAUSDT", "CLUSDT", "SPYUSDT", "BTCDOMUSDT", "USDCUSDT"]) expect(isCryptoSymbol(s, set)).toBe(false);
    for (const s of ["BTCUSDT", "ETHUSDT", "XRPUSDT", "HYPEUSDT", "ZECUSDT"]) expect(isCryptoSymbol(s, set)).toBe(true);
  });

  it("picks up newly listed non-crypto contracts from the live list", async () => {
    const fetcher = live([{ symbol: "NEWSTOCKUSDT", underlyingType: "EQUITY" }, { symbol: "NEWCOINUSDT", underlyingType: "COIN" }]);
    const set = await nonCryptoSymbols(fetcher);
    expect(isCryptoSymbol("NEWSTOCKUSDT", set)).toBe(false);
    expect(isCryptoSymbol("NEWCOINUSDT", set)).toBe(true);
    expect(isCryptoSymbol("XAUUSDT", set)).toBe(false); // snapshot still merged in
  });

  it("falls back to the built-in list when the live source fails, and caches", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("geo-blocked")) as unknown as typeof fetch;
    const set = await nonCryptoSymbols(failing);
    expect(isCryptoSymbol("SOXLUSDT", set)).toBe(false);
    const fetcher = live([]);
    await nonCryptoSymbols(fetcher); // within the retry window → served from cache
    expect(fetcher).not.toHaveBeenCalled();
  });
});
