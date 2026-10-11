import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/coinswitch.store", () => ({ getKeysForUser: async () => ({ apiKey: "k", apiSecret: "s", status: "A" }) }));

import { AutoBestSelector, MAJOR_COINS } from "./auto-best-selector";
import type { AutomationConfig } from "@/automation/types";

const COINS = ["1000PEPEUSDT", "HYPEUSDT", "SOLXUSDT", "BTCUSDT", "ETHUSDT", "DOGEUSDT", "ZECUSDT", "XRPUSDT"].map((symbol, i) => ({
  symbol,
  quoteVolume24h: 1_000_000 - i * 1000, // hype coins first by volume
  change24h: 0,
  fundingRate: 0,
}));

function selector() {
  const scanned: string[] = [];
  const s = new AutoBestSelector({
    client: { getInstrumentInfo: async () => null } as never,
    marketData: () => ({
      getSnapshot: async (symbol: string) => {
        scanned.push(symbol);
        return { isFresh: "UNAVAILABLE", candles: {} } as never;
      },
    }),
    fetchEligibleCoins: async () => COINS,
  });
  return { s, scanned };
}

const base = { symbol: "AUTO", timeframe: "4h", leverage: 5, capital: 100, capitalMode: "fixed", maxRiskPerTrade: 1, dailyLossLimit: 10, enableTrailingStop: false, autoSelect: true } as AutomationConfig;

describe("auto-select coin universe", () => {
  it("Major coins only: scans only BTC/ETH/SOL/XRP/BNB/DOGE even when hype coins have more volume", async () => {
    const { s, scanned } = selector();
    await s.scanRanked(1, { ...base, coinUniverse: "MAJORS" });
    expect(scanned.sort()).toEqual(["BTCUSDT", "DOGEUSDT", "ETHUSDT", "XRPUSDT"]);
    expect(scanned.every((c) => MAJOR_COINS.includes(c))).toBe(true);
  });

  it("Top by volume (and old bots without the setting): unchanged — top coins by volume", async () => {
    const { s, scanned } = selector();
    await s.scanRanked(1, base);
    expect(scanned).toContain("1000PEPEUSDT");
    expect(scanned).toContain("HYPEUSDT");
  });
});
