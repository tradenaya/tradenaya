import { describe, it, expect } from "vitest";
import { serverMarketDataService } from "@/automation/market/service";

describe("market-data repro", () => {
  it(
    "getSnapshot DOGEUSDT 5m",
    async () => {
      await serverMarketDataService.start();
      const snap = await serverMarketDataService.getSnapshot(1, "DOGEUSDT", "5m");
      console.log("isFresh:", snap.isFresh);
      console.log("price:", snap.price, "ticker source:", snap.dataSource);
      const candles = snap.candles["5"] ?? [];
      console.log("candles:", candles.length);
      if (candles.length) {
        const last = candles[candles.length - 1];
        console.log("last candle:", new Date(last.timestamp).toISOString(), "close:", last.close);
        const health = serverMarketDataService.getDetailedHealth();
        console.log("health:", JSON.stringify(health, null, 1));
      }
      await serverMarketDataService.stop();
      expect(snap).toBeTruthy();
    },
    60_000,
  );
});
