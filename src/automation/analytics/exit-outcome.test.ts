import { describe, it, expect } from "vitest";
import { exitOutcome } from "./exit-outcome";
import { normalizeExitReason } from "./types";
import { computeExitAnalytics } from "./calculators";
import type { ClosedTradeRow } from "./types";

describe("exit names follow what the trade earned", () => {
  it("a stop-loss close in profit is 'Profit locked', not a loss", () => {
    expect(exitOutcome("STOP_LOSS", 12.4)).toMatchObject({ key: "PROFIT_LOCKED", label: "Profit locked" });
    expect(exitOutcome("STOP_LOSS", -5)).toMatchObject({ key: "STOP_LOSS", label: "Stop-loss (loss)" });
    expect(exitOutcome("STOP_LOSS", 0)).toMatchObject({ key: "BREAKEVEN" });
    expect(exitOutcome("TAKE_PROFIT", 20)).toMatchObject({ key: "TAKE_PROFIT", label: "Take-profit hit" });
    expect(exitOutcome("TRAILING_STOP", 3)).toMatchObject({ key: "PROFIT_LOCKED" });
    expect(exitOutcome("ENTRY_CANCELLED", 0)).toMatchObject({ key: "CANCELLED" });
    expect(exitOutcome("MANUAL_CLOSE", -1).label).toBe("Closed manually");
  });

  it("analytics category is decided by P&L for stop-loss exits", () => {
    expect(normalizeExitReason("STOP_LOSS", false, 8)).toBe("TRAILING_STOP");
    expect(normalizeExitReason("STOP_LOSS", true, -2)).toBe("STOP_LOSS"); // trailed but still lost → a real loss
    expect(normalizeExitReason("STOP_LOSS", true)).toBe("TRAILING_STOP"); // no P&L known → old rule
    expect(normalizeExitReason("TAKE_PROFIT", false, -1)).toBe("TAKE_PROFIT");
  });

  it("all trades closed by stop-loss but mostly in profit → the exit chart shows them as profit locked", () => {
    const t = (id: number, pnl: number): ClosedTradeRow =>
      ({ id, exitReason: "STOP_LOSS", realizedPnl: pnl, grossProfit: 0, commission: 0, fundingFee: 0, fees: 0, trailingActivated: false } as unknown as ClosedTradeRow);
    const r = computeExitAnalytics([t(1, 30), t(2, 12), t(3, 18), t(4, -10)]);
    expect(r.tpSl.slHits).toBe(1);
    expect(r.tpSl.trailingHits).toBe(3);
    const locked = r.reasons.find((x) => x.reason === "TRAILING_STOP")!;
    expect(locked.count).toBe(3);
    expect(locked.pnl).toBeCloseTo(60, 6);
  });
});
