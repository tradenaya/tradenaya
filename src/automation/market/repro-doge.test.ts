import { describe, it, expect } from "vitest";
import { serverMarketDataService } from "@/automation/market/service";

describe("market-data repro", () => {
  it(
    "getSnapshot DOGEUSDT 5m",
    async () => {
      await serverMarketDataService.start();
      const snap = await serverMarketDataService.getSnapshot(1, "DOGEUSDT", "5m");
      const candles = snap.candles["5"] ?? [];
      if (candles.length) {
        const last = candles[candles.length - 1];
        const health = serverMarketDataService.getDetailedHealth();
      }
      await serverMarketDataService.stop();
      expect(snap).toBeTruthy();
    },
    60_000,
  );
});
