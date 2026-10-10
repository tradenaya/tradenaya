import { describe, expect, it } from "vitest";
import { defaultEntryExpiryMinutes } from "./entry-expiry";

describe("defaultEntryExpiryMinutes", () => {
  it("is one candle of the timeframe, never under 30 minutes", () => {
    expect(defaultEntryExpiryMinutes("5m")).toBe(30);
    expect(defaultEntryExpiryMinutes("15m")).toBe(30);
    expect(defaultEntryExpiryMinutes("1h")).toBe(60);
    expect(defaultEntryExpiryMinutes("4h")).toBe(240);
  });

  it("falls back to 120 minutes for an unknown timeframe", () => {
    expect(defaultEntryExpiryMinutes(undefined)).toBe(120);
    expect(defaultEntryExpiryMinutes("weird")).toBe(120);
  });
});
