import { describe, expect, it } from "vitest";

import {
  buildExpiryLiteral,
  isValidDatetimeLiteral,
  isValidTimeLiteral,
  normalizeTimeInput,
} from "./time-literal";

describe("isValidTimeLiteral", () => {
  it("accepts the full 24-hour range", () => {
    for (const t of ["00:00", "09:05", "12:30", "20:54", "23:59"]) {
      expect(isValidTimeLiteral(t)).toBe(true);
    }
  });

  it("rejects 12-hour suffixes and out-of-range values", () => {
    for (const t of ["24:00", "23:60", "12:60", "20:5", "8:54", "20:54:00", "", "ab:cd", "20;54"]) {
      expect(isValidTimeLiteral(t)).toBe(false);
    }
  });
});

describe("normalizeTimeInput", () => {
  it("canonicalises both '2054' and '20:54' to the same 24-hour value", () => {
    expect(normalizeTimeInput("2054")).toBe("20:54");
    expect(normalizeTimeInput("20:54")).toBe("20:54");
  });

  it("stays partial until there are enough digits to be a time", () => {
    expect(normalizeTimeInput("")).toBe("");
    expect(normalizeTimeInput("2")).toBe("02");
    expect(normalizeTimeInput("20")).toBe("20");
    expect(normalizeTimeInput("20:")).toBe("20:");
    expect(normalizeTimeInput("205")).toBe("20:05");
  });

  it("zero-pads single digits so the result is always canonical", () => {
    expect(normalizeTimeInput("6:07")).toBe("06:07");
    expect(normalizeTimeInput("06:07")).toBe("06:07");
    expect(normalizeTimeInput("9")).toBe("09");
  });

  it("clamps out-of-range input so the field cannot settle on a value the API rejects", () => {
    expect(normalizeTimeInput("2960")).toBe("23:59");
    expect(normalizeTimeInput("2075")).toBe("20:59");
    expect(normalizeTimeInput("2560")).toBe("23:59");
    expect(isValidTimeLiteral(normalizeTimeInput("2960"))).toBe(true);
    expect(isValidTimeLiteral(normalizeTimeInput("2075"))).toBe(true);
  });

  it("drops non-digits and never exceeds four digits", () => {
    expect(normalizeTimeInput("ab20cd54")).toBe("20:54");
    expect(normalizeTimeInput("20:54:99")).toBe("20:54");
  });
});

describe("buildExpiryLiteral", () => {
  it("builds the exact literal with zero timezone conversion", () => {
    const picked = new Date(2026, 9, 18, 0, 0, 0); // 18 Oct 2026, local
    expect(buildExpiryLiteral(picked, "20:54")).toBe("2026-10-18T20:54");
  });

  it("pads single-digit months and days", () => {
    expect(buildExpiryLiteral(new Date(2026, 0, 5, 0, 0, 0), "06:07")).toBe("2026-01-05T06:07");
  });

  it("returns null when the date is missing or the time is unusable", () => {
    expect(buildExpiryLiteral(null, "20:54")).toBeNull();
    expect(buildExpiryLiteral(new Date(2026, 9, 18), "")).toBeNull();
    expect(buildExpiryLiteral(new Date(2026, 9, 18), "20")).toBeNull();
    expect(buildExpiryLiteral(new Date(2026, 9, 18), "24:00")).toBeNull();
    expect(buildExpiryLiteral(new Date("nonsense"), "20:54")).toBeNull();
  });

  it("only ever produces a literal the datetime validation accepts", () => {
    for (const time of ["00:00", "09:05", "12:30", "20:54", "23:59"]) {
      const literal = buildExpiryLiteral(new Date(2026, 9, 18), time);
      expect(literal).not.toBeNull();
      expect(isValidDatetimeLiteral(literal!)).toBe(true);
    }
  });
});
