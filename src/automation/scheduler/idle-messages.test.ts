import { describe, expect, it } from "vitest";
import { describeIdleScan, nextRunText } from "./AnalysisCycleRunner";

describe("idle / next-run log messages", () => {
  it("explains why no coin qualified, per reason", () => {
    const text = describeIdleScan({ timeframe: "1h", scanned: 10, noSetup: 7, momentumFiltered: 2, dataUnavailable: 1, leverageUnsafe: 0 });
    expect(text).toContain("scanned 10 top coins on 1h");
    expect(text).toContain("7 had no valid long/short setup");
    expect(text).toContain("2 had a setup but momentum was not strong enough");
    expect(text).toContain("1 had stale or missing market data");
    expect(text).not.toContain("leverage");
  });

  it("reports a scan that could not run at all", () => {
    expect(describeIdleScan({ timeframe: "1h", scanned: 0, noSetup: 0, momentumFiltered: 0, dataUnavailable: 0, leverageUnsafe: 0, error: "could not load the coin list from CoinSwitch" }))
      .toBe("Could not scan coins — could not load the coin list from CoinSwitch.");
  });

  it("says when the next scan runs", () => {
    expect(nextRunText(5 * 60_000, "No setup")).toBe("Next scan in ~5 min.");
  });

  it("adds the daily-limit reset time when a daily limit blocked trading", () => {
    const now = Date.UTC(2026, 9, 10, 21, 30); // 21:30 UTC -> 2h 30m to reset
    const text = nextRunText(5 * 60_000, "Daily loss limit reached: -5.00 is at or beyond the limit of -4.25.", now);
    expect(text).toContain("Daily limits reset at 00:00 UTC (in ~2h 30m)");
  });
});
