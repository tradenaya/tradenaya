import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { query: vi.fn().mockResolvedValue([[]]) } }));

import { SchedulerRecovery } from "./SchedulerRecovery";
import { currentTradingMode, runWithTradingMode } from "@/automation/paper/mode";

/** Server start runs in LIVE mode; each bot must still be recovered in its own mode. */
describe("startup recovery keeps paper and live apart", () => {
  it("recovers a paper bot in PAPER mode and a live bot in LIVE mode", async () => {
    const seen: Record<number, string> = {};
    const recovery = new SchedulerRecovery({
      store: { lifecycle: { getBotsByDesiredStatus: async () => [{ id: 1, tradingMode: "PAPER" }, { id: 2, tradingMode: "LIVE" }, { id: 3 }] } },
    } as never);
    (recovery as unknown as { recoverBot(b: { id: number }): Promise<void> }).recoverBot = async (bot) => {
      seen[bot.id] = currentTradingMode();
    };
    await runWithTradingMode("LIVE", () => recovery.recoverAll());
    expect(seen).toEqual({ 1: "PAPER", 2: "LIVE", 3: "LIVE" });
  });
});
