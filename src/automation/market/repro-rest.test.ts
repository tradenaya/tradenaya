import { describe, it, expect } from "vitest";
import { coinswitchClient } from "@/automation/executor/client";

describe("rest repro", () => {
  it("direct getTicker + getKline", async () => {
    try {
      const t = await coinswitchClient.getTicker(1, "DOGEUSDT");
      console.log("ticker:", JSON.stringify(t).slice(0, 300));
    } catch (e: any) {
      console.log("TICKER ERROR:", e.message);
    }
    try {
      const k = await coinswitchClient.getKline(1, "DOGEUSDT", "5", 10);
      console.log("kline rows:", k?.length);
      console.log("kline first:", JSON.stringify(k?.[0] ?? null).slice(0, 200));
    } catch (e: any) {
      console.log("KLINE ERROR:", e.message);
    }
    expect(true).toBe(true);
  }, 30_000);
});
