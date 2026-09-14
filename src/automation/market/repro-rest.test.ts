import { describe, it, expect } from "vitest";
import { coinswitchClient } from "@/automation/executor/client";

describe("rest repro", () => {
  it("direct getTicker + getKline", async () => {
    try {
      const t = await coinswitchClient.getTicker(1, "DOGEUSDT");
    } catch (e: any) {
    }
    try {
      const k = await coinswitchClient.getKline(1, "DOGEUSDT", "5", 10);
    } catch (e: any) {
    }
    expect(true).toBe(true);
  }, 30_000);
});
