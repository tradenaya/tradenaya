import { describe, expect, it } from "vitest";
import { MIN_MOMENTUM_BODY_ATR, hasMomentumBody, passesMomentumFilter } from "./momentum-filter";
import { sanitizeConfig } from "@/app/api/bots/_helpers";

describe("passesMomentumFilter", () => {
  it("keeps longs only when RSI is already strong (>= 80)", () => {
    expect(passesMomentumFilter("BUY", 82)).toBe(true);
    expect(passesMomentumFilter("LONG", 80)).toBe(true);
    expect(passesMomentumFilter("BUY", 72)).toBe(false);
  });

  it("keeps shorts only when RSI is already weak (<= 20)", () => {
    expect(passesMomentumFilter("SELL", 18)).toBe(true);
    expect(passesMomentumFilter("SHORT", 20)).toBe(true);
    expect(passesMomentumFilter("SELL", 35)).toBe(false);
  });

  it("rejects when RSI is unavailable", () => {
    expect(passesMomentumFilter("BUY", null)).toBe(false);
    expect(passesMomentumFilter("SELL", Number.NaN)).toBe(false);
  });
});

describe("hasMomentumBody — a momentum entry needs a momentum candle", () => {
  it(`needs a body of at least ${MIN_MOMENTUM_BODY_ATR} ATR`, () => {
    expect(hasMomentumBody({ open: 100, close: 101 }, 1)).toBe(true); // 1.0 ATR
    expect(hasMomentumBody({ open: 100, close: 100.6 }, 1)).toBe(true); // exactly the minimum
    expect(hasMomentumBody({ open: 100, close: 100.3 }, 1)).toBe(false); // small body
    expect(hasMomentumBody({ open: 101, close: 100 }, 1)).toBe(true); // a strong red candle counts too (shorts)
  });
  it("an unknown ATR or candle never blocks a trade", () => {
    expect(hasMomentumBody({ open: 100, close: 100 }, null)).toBe(true);
    expect(hasMomentumBody(undefined, 1)).toBe(true);
  });
});

describe("Smart is always strong-momentum only", () => {
  it("bot config saves the filter on for Smart, even if the request turns it off", () => {
    expect(sanitizeConfig({ strategy: "TradenayaSmartV1", momentumEntriesOnly: false, timeframe: "1h" }).momentumEntriesOnly).toBe(true);
    expect(sanitizeConfig({ strategy: "TrendBreakoutV1", momentumEntriesOnly: true, timeframe: "4h" }).momentumEntriesOnly).toBe(false);
  });
});
